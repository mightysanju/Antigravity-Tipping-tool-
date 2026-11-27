-- Step 6: Guest Tipping Checkout Intent & Stripe Webhook Confirmation RPCs

CREATE OR REPLACE FUNCTION public.prepare_tip_checkout(
  p_source_type TEXT,
  p_source_id UUID,
  p_recipient_type TEXT,
  p_person_id UUID,
  p_department_id UUID,
  p_amount_cents BIGINT,
  p_note TEXT,
  p_guest_email TEXT,
  p_expected_person_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prop public.properties;
  v_room public.rooms;
  v_dept public.departments;
  v_person public.people;
  v_local_date DATE;
  v_assigned_person_id UUID;
  v_toggles JSONB;
  v_min_cents BIGINT;
  v_fee_cents BIGINT;
  v_guest_fee_cents BIGINT;
  v_net_cents BIGINT;
  v_charge_cents BIGINT;
  v_clean_note TEXT;
  v_clean_email TEXT;
  v_room_number TEXT := NULL;
  v_target_dept_id UUID;
  v_target_person_id UUID := NULL;
  v_recipient_name TEXT;
  v_ci_id UUID;
BEGIN
  IF p_source_type NOT IN ('room', 'dept', 'person') THEN
    RAISE EXCEPTION 'TARGET_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF p_recipient_type NOT IN ('person', 'department_pool') THEN
    RAISE EXCEPTION 'INVALID_RECIPIENT_TYPE' USING ERRCODE = '22023';
  END IF;

  -- Resolve source target and property
  IF p_source_type = 'room' THEN
    SELECT * INTO v_room FROM public.rooms WHERE id = p_source_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TARGET_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    v_room_number := v_room.room_number;
    SELECT * INTO v_prop FROM public.properties WHERE id = v_room.property_id;
  ELSIF p_source_type = 'dept' THEN
    SELECT * INTO v_dept FROM public.departments WHERE id = p_source_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TARGET_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_prop FROM public.properties WHERE id = v_dept.property_id;
  ELSE
    SELECT * INTO v_person FROM public.people WHERE id = p_source_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TARGET_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_prop FROM public.properties WHERE id = v_person.property_id;
  END IF;

  IF v_prop.status IN ('restricted', 'cancelled', 'pending') THEN
    RAISE EXCEPTION 'PROPERTY_RESTRICTED' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_object_agg(feature_key, enabled), '{}'::JSONB)
  INTO v_toggles
  FROM public.property_features
  WHERE property_id = v_prop.id
    AND feature_key IN (
      'guest_notes', 'email_receipts', 'tip_specific_housekeeper',
      'department_pool_tips', 'tip_specific_person_in_dept',
      'department_qr_codes', 'personal_staff_qr_codes',
      'room_qr_codes', 'guest_paid_fee_option'
    );

  IF (p_source_type = 'room' AND NOT COALESCE((v_toggles->>'room_qr_codes')::BOOLEAN, true))
     OR (p_source_type = 'dept' AND NOT COALESCE((v_toggles->>'department_qr_codes')::BOOLEAN, true))
     OR (p_source_type = 'person' AND NOT COALESCE((v_toggles->>'personal_staff_qr_codes')::BOOLEAN, true)) THEN
    RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = '42501';
  END IF;

  -- AC-4: Check mid-day room reassignment if guest selected a specific room-assigned housekeeper
  IF p_source_type = 'room' AND p_expected_person_id IS NOT NULL THEN
    v_local_date := (now() AT TIME ZONE v_prop.timezone)::DATE;
    SELECT p.id INTO v_assigned_person_id
    FROM public.assignments a
    JOIN public.people p ON p.property_id = a.property_id AND p.id = a.person_id
    WHERE a.property_id = v_prop.id
      AND a.assignment_date = v_local_date
      AND a.room_number = v_room.room_number
      AND p.status = 'active'
      AND p.agreement_signed_at IS NOT NULL
      AND p.role = 'staff'
    LIMIT 1;

    IF v_assigned_person_id IS DISTINCT FROM p_expected_person_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_CHANGED' USING ERRCODE = '40001';
    END IF;
  END IF;

  -- Validate recipient eligibility and feature toggles
  IF p_recipient_type = 'department_pool' THEN
    IF NOT COALESCE((v_toggles->>'department_pool_tips')::BOOLEAN, true) THEN
      RAISE EXCEPTION 'FEATURE_DISABLED:FT-4' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_dept FROM public.departments
    WHERE id = p_department_id AND property_id = v_prop.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RECIPIENT_UNAVAILABLE' USING ERRCODE = 'P0002';
    END IF;
    v_target_dept_id := v_dept.id;
    v_recipient_name := v_dept.name || ' Team Pool';
  ELSE
    SELECT * INTO v_person FROM public.people
    WHERE id = p_person_id AND property_id = v_prop.id;
    IF NOT FOUND OR v_person.status <> 'active' OR v_person.role <> 'staff' OR v_person.agreement_signed_at IS NULL THEN
      RAISE EXCEPTION 'RECIPIENT_UNAVAILABLE' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_dept FROM public.departments
    WHERE id = v_person.department_id AND property_id = v_prop.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RECIPIENT_UNAVAILABLE' USING ERRCODE = '42501';
    END IF;

    IF p_source_type = 'room' THEN
      IF v_dept.is_housekeeping THEN
        -- Could be assigned housekeeper (FT-3) or directory pick (FT-5); allow if either is enabled
        IF NOT COALESCE((v_toggles->>'tip_specific_housekeeper')::BOOLEAN, true)
           AND NOT COALESCE((v_toggles->>'tip_specific_person_in_dept')::BOOLEAN, true) THEN
          RAISE EXCEPTION 'FEATURE_DISABLED' USING ERRCODE = '42501';
        END IF;
      ELSIF NOT COALESCE((v_toggles->>'tip_specific_person_in_dept')::BOOLEAN, true) THEN
        RAISE EXCEPTION 'FEATURE_DISABLED:FT-5' USING ERRCODE = '42501';
      END IF;
    ELSIF p_source_type = 'dept' THEN
      IF NOT COALESCE((v_toggles->>'tip_specific_person_in_dept')::BOOLEAN, true) THEN
        RAISE EXCEPTION 'FEATURE_DISABLED:FT-5' USING ERRCODE = '42501';
      END IF;
    END IF;

    v_target_person_id := v_person.id;
    v_target_dept_id := v_dept.id;
    v_recipient_name := v_person.name;
  END IF;

  -- Amount bounds
  v_min_cents := CASE
    WHEN v_prop.payment_fee_paid_by = 'guest' AND COALESCE((v_toggles->>'guest_paid_fee_option')::BOOLEAN, true)
      THEN v_prop.tip_min_cents
    ELSE GREATEST(v_prop.tip_min_cents, 200)
  END;

  IF p_amount_cents IS NULL OR p_amount_cents < v_min_cents OR p_amount_cents > v_prop.tip_max_cents THEN
    RAISE EXCEPTION 'INVALID_TIP_AMOUNT:%:%', v_min_cents, v_prop.tip_max_cents USING ERRCODE = '22023';
  END IF;

  -- Sanitize optional note (FT-1) and receipt email (FT-2)
  v_clean_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF v_clean_note IS NOT NULL THEN
    IF NOT COALESCE((v_toggles->>'guest_notes')::BOOLEAN, true) THEN
      v_clean_note := NULL;
    ELSIF char_length(v_clean_note) > 150 THEN
      RAISE EXCEPTION 'NOTE_TOO_LONG_MAX_150' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_clean_email := NULLIF(lower(btrim(COALESCE(p_guest_email, ''))), '');
  IF v_clean_email IS NOT NULL THEN
    IF NOT COALESCE((v_toggles->>'email_receipts')::BOOLEAN, true) THEN
      v_clean_email := NULL;
    ELSIF v_clean_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'INVALID_GUEST_EMAIL' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Fee calculation (2.9% + $0.30)
  v_fee_cents := ROUND(p_amount_cents * 0.029)::BIGINT + 30;
  IF v_prop.payment_fee_paid_by = 'guest' AND COALESCE((v_toggles->>'guest_paid_fee_option')::BOOLEAN, true) THEN
    v_guest_fee_cents := v_fee_cents;
    v_net_cents := p_amount_cents;
    v_charge_cents := p_amount_cents + v_guest_fee_cents;
  ELSIF v_prop.payment_fee_paid_by = 'staff' THEN
    v_guest_fee_cents := 0;
    v_net_cents := GREATEST(p_amount_cents - v_fee_cents, 0);
    v_charge_cents := p_amount_cents;
  ELSE
    -- property pays fee
    v_guest_fee_cents := 0;
    v_net_cents := p_amount_cents;
    v_charge_cents := p_amount_cents;
  END IF;

  INSERT INTO public.checkout_intents (
    property_id, recipient_type, person_id, department_id, room_number,
    amount_cents, fee_cents, guest_fee_cents, net_cents, note, guest_email,
    stripe_payment_intent_id, status
  )
  VALUES (
    v_prop.id, p_recipient_type, v_target_person_id, v_target_dept_id, v_room_number,
    p_amount_cents, v_fee_cents, v_guest_fee_cents, v_net_cents, v_clean_note, v_clean_email,
    'pending_' || gen_random_uuid()::TEXT, 'created'
  )
  RETURNING id INTO v_ci_id;

  RETURN jsonb_build_object(
    'checkoutIntentId', v_ci_id,
    'propertyId', v_prop.id,
    'propertyName', v_prop.name,
    'recipientType', p_recipient_type,
    'recipientName', v_recipient_name,
    'personId', v_target_person_id,
    'departmentId', v_target_dept_id,
    'roomNumber', v_room_number,
    'amountCents', p_amount_cents,
    'feeCents', v_fee_cents,
    'guestFeeCents', v_guest_fee_cents,
    'netCents', v_net_cents,
    'chargeCents', v_charge_cents
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_tip_checkout(TEXT, UUID, TEXT, UUID, UUID, BIGINT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.attach_payment_intent_to_checkout(
  p_checkout_intent_id UUID,
  p_payment_intent_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.checkout_intents
  SET stripe_payment_intent_id = p_payment_intent_id
  WHERE id = p_checkout_intent_id;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_payment_intent_to_checkout(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Webhook confirmation: idempotent on stripe_events + checkout_intents; credits wallet + ledger + notification
CREATE OR REPLACE FUNCTION public.confirm_tip_payment_webhook(
  p_event_id TEXT,
  p_event_type TEXT,
  p_payment_intent_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_event TEXT;
  v_ci public.checkout_intents;
  v_tip public.tips;
  v_person public.people;
  v_ft16 BOOLEAN;
  v_msg TEXT;
BEGIN
  INSERT INTO public.stripe_events (event_id, event_type)
  VALUES (p_event_id, p_event_type)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO v_inserted_event;

  IF v_inserted_event IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'deduplicated', true);
  END IF;

  SELECT * INTO v_ci
  FROM public.checkout_intents
  WHERE stripe_payment_intent_id = p_payment_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'reason', 'INTENT_NOT_FOUND');
  END IF;

  IF v_ci.status = 'succeeded' THEN
    SELECT id INTO v_tip FROM public.tips WHERE checkout_intent_id = v_ci.id;
    RETURN jsonb_build_object('ok', true, 'deduplicated', true, 'tipId', v_tip.id);
  END IF;

  UPDATE public.checkout_intents SET status = 'succeeded' WHERE id = v_ci.id;

  INSERT INTO public.tips (
    property_id, checkout_intent_id, amount_cents, fee_cents, guest_fee_cents,
    net_cents, recipient_type, person_id, department_id, room_number,
    note, guest_email, stripe_payment_intent_id, status, paid_at
  )
  VALUES (
    v_ci.property_id, v_ci.id, v_ci.amount_cents, v_ci.fee_cents, v_ci.guest_fee_cents,
    v_ci.net_cents, v_ci.recipient_type, v_ci.person_id, v_ci.department_id, v_ci.room_number,
    v_ci.note, v_ci.guest_email, v_ci.stripe_payment_intent_id, 'paid', now()
  )
  RETURNING * INTO v_tip;

  IF v_ci.recipient_type = 'person' THEN
    INSERT INTO public.ledger (
      property_id, person_id, department_id, type, amount_cents, ref_id, idempotency_key
    )
    VALUES (
      v_ci.property_id, v_ci.person_id, v_ci.department_id, 'tip_credit',
      v_ci.net_cents, v_tip.id, 'tip:' || v_tip.id::TEXT || ':credit'
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    UPDATE public.people
    SET wallet_balance_cents = wallet_balance_cents + v_ci.net_cents,
        last_activity_or_credit_at = now()
    WHERE id = v_ci.person_id
    RETURNING * INTO v_person;

    IF v_person.status = 'inactive' THEN
      INSERT INTO public.audit_logs (
        property_id, actor_role, action, target_type, target_id, metadata
      )
      VALUES (
        v_ci.property_id, 'system', 'INFLIGHT_TIP_CREDITED_TO_INACTIVE',
        'person', v_person.id::TEXT,
        jsonb_build_object('tipId', v_tip.id, 'netCents', v_ci.net_cents)
      );
    END IF;

    SELECT enabled INTO v_ft16
    FROM public.property_features
    WHERE property_id = v_ci.property_id AND feature_key = 'in_app_notifications';

    IF COALESCE(v_ft16, true) THEN
      v_msg := 'You received a $' || to_char(v_ci.net_cents / 100.0, 'FM999999990.00') || ' tip';
      IF v_ci.room_number IS NOT NULL THEN
        v_msg := v_msg || ' for Room ' || v_ci.room_number;
      END IF;
      IF v_ci.note IS NOT NULL THEN
        v_msg := v_msg || ' — "' || v_ci.note || '"';
      END IF;

      INSERT INTO public.notifications (
        property_id, person_id, type, message, tip_id
      )
      VALUES (
        v_ci.property_id, v_ci.person_id, 'tip_received', v_msg, v_tip.id
      );
    END IF;
  ELSE
    INSERT INTO public.ledger (
      property_id, person_id, department_id, type, amount_cents, ref_id, idempotency_key
    )
    VALUES (
      v_ci.property_id, NULL, v_ci.department_id, 'pool_credit',
      v_ci.net_cents, v_tip.id, 'tip:' || v_tip.id::TEXT || ':pool_credit'
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'deduplicated', false,
    'tipId', v_tip.id,
    'recipientType', v_ci.recipient_type,
    'personId', v_ci.person_id,
    'departmentId', v_ci.department_id,
    'netCents', v_ci.net_cents,
    'guestEmail', v_ci.guest_email,
    'amountCents', v_ci.amount_cents,
    'guestFeeCents', v_ci.guest_fee_cents,
    'roomNumber', v_ci.room_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_tip_payment_webhook(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fail_tip_payment_webhook(
  p_event_id TEXT,
  p_event_type TEXT,
  p_payment_intent_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_event TEXT;
BEGIN
  INSERT INTO public.stripe_events (event_id, event_type)
  VALUES (p_event_id, p_event_type)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO v_inserted_event;

  IF v_inserted_event IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'deduplicated', true);
  END IF;

  UPDATE public.checkout_intents
  SET status = 'failed'
  WHERE stripe_payment_intent_id = p_payment_intent_id
    AND status = 'created';

  RETURN jsonb_build_object('ok', true, 'markedFailed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.fail_tip_payment_webhook(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
