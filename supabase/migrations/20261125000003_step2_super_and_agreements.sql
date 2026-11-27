-- Step 2: Super Admin Operations, 27-Toggle Management, Agreement Immutability & Activation Gate

-- 1. Agreement & Signed-PDF Immutability
CREATE OR REPLACE FUNCTION public.prevent_agreement_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AGREEMENT_IMMUTABLE: UPDATE and DELETE are forbidden on public.agreements'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_prevent_agreement_mutation
  BEFORE UPDATE OR DELETE ON public.agreements
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_agreement_mutation();

CREATE OR REPLACE FUNCTION public.prevent_signed_agreement_object_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.bucket_id = 'signed-agreements' THEN
    RAISE EXCEPTION 'SIGNED_AGREEMENT_OBJECT_IMMUTABLE: Signed agreement copies cannot be modified or deleted'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_prevent_signed_agreement_object_mutation
  BEFORE UPDATE OR DELETE ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_signed_agreement_object_mutation();

-- 2. Property pending -> active Gate (Requires Signed Property Agreement)
CREATE OR REPLACE FUNCTION public.enforce_property_activation_agreement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'active' AND NEW.status = 'active' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.agreements a
      WHERE a.property_id = NEW.id
        AND a.signer_type = 'property'
        AND a.checkbox_confirmed = true
    ) THEN
      RAISE EXCEPTION 'PROPERTY_AGREEMENT_REQUIRED: Property service agreement must be signed before activation'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_property_activation_agreement
  BEFORE UPDATE OF status ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_property_activation_agreement();

-- 3. Feature Toggle Assertion Helper
CREATE OR REPLACE FUNCTION public.assert_property_feature_enabled(
  p_property_id UUID,
  p_feature_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled BOOLEAN;
BEGIN
  SELECT enabled INTO v_enabled
  FROM public.property_features
  WHERE property_id = p_property_id
    AND feature_key = p_feature_key;

  IF NOT COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'FEATURE_DISABLED: %', p_feature_key USING ERRCODE = '42501';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_property_feature_enabled(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_property_feature_enabled(UUID, TEXT) TO authenticated;

-- 4. Super Admin Dashboard Metrics
CREATE OR REPLACE FUNCTION public.get_super_dashboard_metrics()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_total_tips BIGINT;
  v_tip_count INT;
  v_fees_collected BIGINT;
  v_wallet_liability BIGINT;
  v_active_subs INT;
  v_overdue_subs INT;
  v_props JSONB;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT
    COALESCE(SUM(amount_cents), 0)::BIGINT,
    COUNT(*)::INT,
    COALESCE(SUM(fee_cents), 0)::BIGINT
  INTO v_total_tips, v_tip_count, v_fees_collected
  FROM public.tips
  WHERE status <> 'refunded';

  SELECT COALESCE(SUM(GREATEST(wallet_balance_cents, 0)), 0)::BIGINT
  INTO v_wallet_liability
  FROM public.people;

  SELECT
    COUNT(*) FILTER (WHERE status = 'active')::INT,
    COUNT(*) FILTER (WHERE status = 'restricted' OR stripe_subscription_status IN ('past_due', 'unpaid'))::INT
  INTO v_active_subs, v_overdue_subs
  FROM public.properties;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', pr.id,
      'name', pr.name,
      'address', pr.address,
      'contactName', pr.contact_name,
      'contactEmail', pr.contact_email,
      'status', pr.status,
      'planType', pr.plan_type,
      'planPriceCents', pr.plan_price_cents,
      'paymentFeePaidBy', pr.payment_fee_paid_by,
      'payoutFeePaidBy', pr.payout_fee_paid_by,
      'payoutWeekday', pr.payout_weekday,
      'timezone', pr.timezone,
      'minWithdrawalCents', pr.min_withdrawal_cents,
      'stripeSubscriptionStatus', pr.stripe_subscription_status,
      'staffCount', (SELECT COUNT(*)::INT FROM public.people pe WHERE pe.property_id = pr.id AND pe.status = 'active'),
      'roomCount', (SELECT COUNT(*)::INT FROM public.rooms rm WHERE rm.property_id = pr.id),
      'totalTipsCents', (SELECT COALESCE(SUM(tp.amount_cents), 0)::BIGINT FROM public.tips tp WHERE tp.property_id = pr.id AND tp.status <> 'refunded'),
      'agreementSigned', EXISTS (SELECT 1 FROM public.agreements ag WHERE ag.property_id = pr.id AND ag.signer_type = 'property'),
      'createdAt', pr.created_at
    )
    ORDER BY pr.created_at DESC
  ), '[]'::JSONB)
  INTO v_props
  FROM public.properties pr;

  RETURN jsonb_build_object(
    'kpis', jsonb_build_object(
      'totalTipsCents', v_total_tips,
      'tipCount', v_tip_count,
      'feesCollectedCents', v_fees_collected,
      'totalWalletLiabilityCents', v_wallet_liability,
      'activeSubscriptionsCount', v_active_subs,
      'overdueOrRestrictedCount', v_overdue_subs
    ),
    'properties', v_props
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_super_dashboard_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_super_dashboard_metrics() TO authenticated;

-- 5. Super Admin Property Detail
CREATE OR REPLACE FUNCTION public.get_property_super_detail(p_property_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_prop public.properties;
  v_features JSONB;
  v_depts JSONB;
  v_agreements JSONB;
  v_admins JSONB;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prop FROM public.properties WHERE id = p_property_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROPERTY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'featureKey', pf.feature_key,
      'enabled', pf.enabled,
      'updatedAt', pf.updated_at
    )
    ORDER BY pf.feature_key
  ), '[]'::JSONB)
  INTO v_features
  FROM public.property_features pf
  WHERE pf.property_id = p_property_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'name', d.name,
      'isHousekeeping', d.is_housekeeping,
      'defaultDistribution', d.default_distribution
    )
    ORDER BY d.is_housekeeping DESC, d.name ASC
  ), '[]'::JSONB)
  INTO v_depts
  FROM public.departments d
  WHERE d.property_id = p_property_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ag.id,
      'signerType', ag.signer_type,
      'signerId', ag.signer_id,
      'version', ag.version,
      'typedName', ag.typed_name,
      'signedAt', ag.signed_at,
      'ipAddress', host(ag.ip_address),
      'pdfStoragePath', ag.pdf_storage_path
    )
    ORDER BY ag.signed_at DESC
  ), '[]'::JSONB)
  INTO v_agreements
  FROM public.agreements ag
  WHERE ag.property_id = p_property_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', pe.id,
      'name', pe.name,
      'email', pe.email,
      'status', pe.status,
      'authLinked', (pe.auth_user_id IS NOT NULL),
      'agreementSignedAt', pe.agreement_signed_at
    )
    ORDER BY pe.created_at ASC
  ), '[]'::JSONB)
  INTO v_admins
  FROM public.people pe
  WHERE pe.property_id = p_property_id
    AND pe.role = 'property_admin';

  RETURN jsonb_build_object(
    'property', to_jsonb(v_prop),
    'features', v_features,
    'departments', v_depts,
    'agreements', v_agreements,
    'admins', v_admins
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_property_super_detail(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_property_super_detail(UUID) TO authenticated;

-- 6. 7-Step Property Onboarding Wizard RPC
CREATE OR REPLACE FUNCTION public.onboard_property_wizard(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_prop_id UUID;
  v_admin_id UUID;
  v_dept_ids UUID[] := ARRAY[]::UUID[];
  v_dept_item JSONB;
  v_dept_id UUID;
  v_payment_fee TEXT;
  v_min_tip BIGINT;
  v_default_features BOOLEAN;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(jsonb_array_length(p_payload->'departments'), 0) < 1 THEN
    RAISE EXCEPTION 'DEPARTMENTS_REQUIRED' USING ERRCODE = '22023';
  END IF;

  v_payment_fee := p_payload->>'paymentFeePaidBy';
  v_min_tip := CASE
    WHEN v_payment_fee = 'guest' THEN COALESCE((p_payload->>'tipMinCents')::BIGINT, 100)
    ELSE GREATEST(COALESCE((p_payload->>'tipMinCents')::BIGINT, 200), 200)
  END;

  INSERT INTO public.properties (
    name,
    address,
    contact_name,
    contact_email,
    status,
    plan_type,
    plan_price_cents,
    contract_term_months,
    notice_days,
    payment_fee_paid_by,
    payout_fee_paid_by,
    payout_weekday,
    timezone,
    min_withdrawal_cents,
    template_path,
    hero_photo_path,
    qr_position,
    tip_min_cents,
    tip_max_cents,
    tip_presets_cents,
    accent_color_hex
  ) VALUES (
    btrim(p_payload->>'name'),
    btrim(p_payload->>'address'),
    btrim(p_payload->>'contactName'),
    lower(btrim(p_payload->>'contactEmail')),
    'pending',
    p_payload->>'planType',
    (p_payload->>'planPriceCents')::BIGINT,
    COALESCE((p_payload->>'contractTermMonths')::INT, 12),
    COALESCE((p_payload->>'noticeDays')::INT, 30),
    v_payment_fee,
    p_payload->>'payoutFeePaidBy',
    COALESCE((p_payload->>'payoutWeekday')::SMALLINT, 4),
    COALESCE(NULLIF(p_payload->>'timezone', ''), 'America/Chicago'),
    COALESCE((p_payload->>'minWithdrawalCents')::BIGINT, 1000),
    NULLIF(p_payload->>'templatePath', ''),
    NULLIF(p_payload->>'heroPhotoPath', ''),
    p_payload->'qrPosition',
    v_min_tip,
    COALESCE((p_payload->>'tipMaxCents')::BIGINT, 20000),
    COALESCE(
      (SELECT array_agg(val::BIGINT) FROM jsonb_array_elements_text(p_payload->'tipPresetsCents') val),
      ARRAY[300, 500, 1000, 2000]::BIGINT[]
    ),
    NULLIF(p_payload->>'accentColorHex', '')
  )
  RETURNING id INTO v_prop_id;

  IF p_payload ? 'defaultFeaturesEnabled' THEN
    v_default_features := (p_payload->>'defaultFeaturesEnabled')::BOOLEAN;
    IF NOT v_default_features THEN
      UPDATE public.property_features
      SET enabled = false, updated_at = now(), updated_by = auth.uid()
      WHERE property_id = v_prop_id;
    END IF;
  END IF;

  INSERT INTO public.people (
    property_id, auth_user_id, name, email, role, department_id, status
  ) VALUES (
    v_prop_id,
    NULL,
    btrim(COALESCE(NULLIF(p_payload->>'adminName', ''), p_payload->>'contactName')),
    lower(btrim(COALESCE(NULLIF(p_payload->>'adminEmail', ''), p_payload->>'contactEmail'))),
    'property_admin',
    NULL,
    'active'
  )
  RETURNING id INTO v_admin_id;

  FOR v_dept_item IN SELECT * FROM jsonb_array_elements(p_payload->'departments')
  LOOP
    INSERT INTO public.departments (
      property_id, name, is_housekeeping, default_distribution
    ) VALUES (
      v_prop_id,
      btrim(v_dept_item->>'name'),
      COALESCE((v_dept_item->>'isHousekeeping')::BOOLEAN, false),
      COALESCE(NULLIF(v_dept_item->>'defaultDistribution', ''), 'split')
    )
    RETURNING id INTO v_dept_id;
    v_dept_ids := array_append(v_dept_ids, v_dept_id);
  END LOOP;

  INSERT INTO public.audit_logs (
    property_id, actor_user_id, actor_role, action, target_type, target_id, metadata
  ) VALUES (
    v_prop_id,
    auth.uid(),
    'super_admin',
    'property_onboarded',
    'property',
    v_prop_id::TEXT,
    jsonb_build_object('adminId', v_admin_id, 'departmentCount', array_length(v_dept_ids, 1))
  );

  RETURN jsonb_build_object(
    'propertyId', v_prop_id,
    'propertyAdminId', v_admin_id,
    'departmentIds', to_jsonb(v_dept_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.onboard_property_wizard(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.onboard_property_wizard(JSONB) TO authenticated;

-- 7. Update Property Settings (Super Admin)
CREATE OR REPLACE FUNCTION public.update_property_settings_super(
  p_property_id UUID,
  p_patch JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row public.properties;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  UPDATE public.properties
  SET
    name = COALESCE(NULLIF(btrim(p_patch->>'name'), ''), name),
    address = COALESCE(NULLIF(btrim(p_patch->>'address'), ''), address),
    contact_name = COALESCE(NULLIF(btrim(p_patch->>'contactName'), ''), contact_name),
    contact_email = COALESCE(NULLIF(lower(btrim(p_patch->>'contactEmail')), ''), contact_email),
    status = COALESCE(NULLIF(p_patch->>'status', ''), status),
    plan_type = COALESCE(NULLIF(p_patch->>'planType', ''), plan_type),
    plan_price_cents = COALESCE((p_patch->>'planPriceCents')::BIGINT, plan_price_cents),
    contract_term_months = COALESCE((p_patch->>'contractTermMonths')::INT, contract_term_months),
    notice_days = COALESCE((p_patch->>'noticeDays')::INT, notice_days),
    payment_fee_paid_by = COALESCE(NULLIF(p_patch->>'paymentFeePaidBy', ''), payment_fee_paid_by),
    payout_fee_paid_by = COALESCE(NULLIF(p_patch->>'payoutFeePaidBy', ''), payout_fee_paid_by),
    payout_weekday = COALESCE((p_patch->>'payoutWeekday')::SMALLINT, payout_weekday),
    timezone = COALESCE(NULLIF(p_patch->>'timezone', ''), timezone),
    min_withdrawal_cents = COALESCE((p_patch->>'minWithdrawalCents')::BIGINT, min_withdrawal_cents),
    template_path = CASE WHEN p_patch ? 'templatePath' THEN NULLIF(p_patch->>'templatePath', '') ELSE template_path END,
    hero_photo_path = CASE WHEN p_patch ? 'heroPhotoPath' THEN NULLIF(p_patch->>'heroPhotoPath', '') ELSE hero_photo_path END,
    qr_position = CASE WHEN p_patch ? 'qrPosition' THEN p_patch->'qrPosition' ELSE qr_position END,
    tip_min_cents = COALESCE((p_patch->>'tipMinCents')::BIGINT, tip_min_cents),
    tip_max_cents = COALESCE((p_patch->>'tipMaxCents')::BIGINT, tip_max_cents),
    accent_color_hex = CASE WHEN p_patch ? 'accentColorHex' THEN NULLIF(p_patch->>'accentColorHex', '') ELSE accent_color_hex END
  WHERE id = p_property_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROPERTY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_logs (
    property_id, actor_user_id, actor_role, action, target_type, target_id, metadata
  ) VALUES (
    p_property_id, auth.uid(), 'super_admin', 'property_updated', 'property', p_property_id::TEXT, p_patch
  );

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.update_property_settings_super(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_property_settings_super(UUID, JSONB) TO authenticated;

-- 8. Per-Property Feature Toggle Update (Super Admin Only; Preserves Data)
CREATE OR REPLACE FUNCTION public.set_property_feature_toggle(
  p_property_id UUID,
  p_feature_key TEXT,
  p_enabled BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row public.property_features;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.property_features (property_id, feature_key, enabled, updated_at, updated_by)
  VALUES (p_property_id, p_feature_key, p_enabled, now(), auth.uid())
  ON CONFLICT (property_id, feature_key)
  DO UPDATE SET
    enabled = EXCLUDED.enabled,
    updated_at = now(),
    updated_by = auth.uid()
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (
    property_id, actor_user_id, actor_role, action, target_type, target_id, metadata
  ) VALUES (
    p_property_id,
    auth.uid(),
    'super_admin',
    'feature_toggle_updated',
    'property_feature',
    p_feature_key,
    jsonb_build_object('enabled', p_enabled)
  );

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.set_property_feature_toggle(UUID, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_property_feature_toggle(UUID, TEXT, BOOLEAN) TO authenticated;

-- 9. Platform Payments Overview & Global Default Update
CREATE OR REPLACE FUNCTION public.get_platform_payments_overview()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_props JSONB;
  v_batches JSONB;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'status', p.status,
      'payoutWeekday', p.payout_weekday,
      'timezone', p.timezone,
      'minWithdrawalCents', p.min_withdrawal_cents,
      'payoutFeePaidBy', p.payout_fee_paid_by,
      'paymentFeePaidBy', p.payment_fee_paid_by
    )
    ORDER BY p.name ASC
  ), '[]'::JSONB)
  INTO v_props
  FROM public.properties p;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', pb.id,
      'propertyId', pb.property_id,
      'propertyName', pr.name,
      'payoutDate', pb.payout_date,
      'status', pb.status,
      'totalCents', pb.total_cents,
      'withdrawalCount', pb.withdrawal_count,
      'createdAt', pb.created_at
    )
    ORDER BY pb.created_at DESC
  ), '[]'::JSONB)
  INTO v_batches
  FROM public.payout_batches pb
  JOIN public.properties pr ON pr.id = pb.property_id;

  RETURN jsonb_build_object('properties', v_props, 'batches', v_batches);
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_payments_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_payments_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.update_platform_payment_defaults(
  p_payout_weekday SMALLINT,
  p_min_withdrawal_cents BIGINT,
  p_apply_to_all BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_updated INT := 0;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_payout_weekday < 0 OR p_payout_weekday > 6 THEN
    RAISE EXCEPTION 'INVALID_PAYOUT_WEEKDAY' USING ERRCODE = '22023';
  END IF;
  IF p_min_withdrawal_cents < 100 THEN
    RAISE EXCEPTION 'INVALID_MIN_WITHDRAWAL' USING ERRCODE = '22023';
  END IF;

  IF p_apply_to_all THEN
    UPDATE public.properties
    SET payout_weekday = p_payout_weekday, min_withdrawal_cents = p_min_withdrawal_cents
    WHERE status <> 'cancelled';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  INSERT INTO public.audit_logs (
    property_id, actor_user_id, actor_role, action, target_type, target_id, metadata
  ) VALUES (
    NULL,
    auth.uid(),
    'super_admin',
    'platform_payment_defaults_updated',
    'platform',
    'payments',
    jsonb_build_object(
      'payoutWeekday', p_payout_weekday,
      'minWithdrawalCents', p_min_withdrawal_cents,
      'appliedToAllCount', v_updated
    )
  );

  RETURN jsonb_build_object(
    'payoutWeekday', p_payout_weekday,
    'minWithdrawalCents', p_min_withdrawal_cents,
    'updatedPropertiesCount', v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_platform_payment_defaults(SMALLINT, BIGINT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_platform_payment_defaults(SMALLINT, BIGINT, BOOLEAN) TO authenticated;

-- 10. Property Admin Directory, Invite & Removal (Super Admin Only)
CREATE OR REPLACE FUNCTION public.list_property_admins_super()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', pe.id,
      'propertyId', pe.property_id,
      'propertyName', pr.name,
      'propertyStatus', pr.status,
      'name', pe.name,
      'email', pe.email,
      'status', pe.status,
      'authLinked', (pe.auth_user_id IS NOT NULL),
      'agreementSignedAt', pe.agreement_signed_at,
      'createdAt', pe.created_at
    )
    ORDER BY pr.name ASC, pe.created_at ASC
  ), '[]'::JSONB)
  INTO v_rows
  FROM public.people pe
  JOIN public.properties pr ON pr.id = pe.property_id
  WHERE pe.role = 'property_admin';

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.list_property_admins_super() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_property_admins_super() TO authenticated;

CREATE OR REPLACE FUNCTION public.invite_property_admin_super(
  p_property_id UUID,
  p_name TEXT,
  p_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_prop public.properties;
  v_person public.people;
  v_invite_enabled BOOLEAN;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prop FROM public.properties WHERE id = p_property_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROPERTY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.people (
    property_id, auth_user_id, name, email, role, department_id, status
  ) VALUES (
    p_property_id, NULL, btrim(p_name), lower(btrim(p_email)), 'property_admin', NULL, 'active'
  )
  RETURNING * INTO v_person;

  SELECT enabled INTO v_invite_enabled
  FROM public.property_features
  WHERE property_id = p_property_id AND feature_key = 'email_invites';

  INSERT INTO public.audit_logs (
    property_id, actor_user_id, actor_role, action, target_type, target_id, metadata
  ) VALUES (
    p_property_id,
    auth.uid(),
    'super_admin',
    'property_admin_invited',
    'person',
    v_person.id::TEXT,
    jsonb_build_object('email', v_person.email, 'emailInviteEnabled', COALESCE(v_invite_enabled, false))
  );

  RETURN jsonb_build_object(
    'person', to_jsonb(v_person),
    'propertyName', v_prop.name,
    'emailInviteEnabled', COALESCE(v_invite_enabled, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invite_property_admin_super(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_property_admin_super(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_property_admin_super(p_person_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row public.people;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  UPDATE public.people
  SET status = 'inactive'
  WHERE id = p_person_id
    AND role = 'property_admin'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROPERTY_ADMIN_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_logs (
    property_id, actor_user_id, actor_role, action, target_type, target_id, metadata
  ) VALUES (
    v_row.property_id,
    auth.uid(),
    'super_admin',
    'property_admin_removed',
    'person',
    p_person_id::TEXT,
    jsonb_build_object('email', v_row.email)
  );

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_property_admin_super(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_property_admin_super(UUID) TO authenticated;

-- 11. Click-to-Accept Agreement Signing RPC (Property & Staff)
CREATE OR REPLACE FUNCTION public.record_signed_agreement(
  p_signer_type TEXT,
  p_signer_id UUID,
  p_property_id UUID,
  p_version TEXT,
  p_typed_name TEXT,
  p_checkbox_confirmed BOOLEAN,
  p_ip_address INET,
  p_user_agent TEXT,
  p_pdf_storage_path TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, storage
AS $$
DECLARE
  v_uid UUID;
  v_is_super BOOLEAN;
  v_ap RECORD;
  v_agreement public.agreements;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(p_checkbox_confirmed, false) THEN
    RAISE EXCEPTION 'CHECKBOX_CONFIRMATION_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(COALESCE(p_typed_name, ''))) < 2 THEN
    RAISE EXCEPTION 'TYPED_NAME_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_signer_type NOT IN ('property', 'staff') THEN
    RAISE EXCEPTION 'INVALID_SIGNER_TYPE' USING ERRCODE = '22023';
  END IF;

  v_is_super := public.auth_is_super_admin();

  IF p_signer_type = 'property' THEN
    IF p_signer_id <> p_property_id THEN
      RAISE EXCEPTION 'SIGNER_ID_MUST_MATCH_PROPERTY_ID' USING ERRCODE = '22023';
    END IF;
    IF NOT v_is_super THEN
      SELECT * INTO v_ap FROM public.auth_active_person();
      IF v_ap.id IS NULL OR v_ap.role <> 'property_admin' OR v_ap.property_id <> p_property_id THEN
        RAISE EXCEPTION 'FORBIDDEN_PROPERTY_SIGNER' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.people pe
      WHERE pe.id = p_signer_id
        AND pe.property_id = p_property_id
        AND (v_is_super OR pe.auth_user_id = v_uid)
    ) THEN
      RAISE EXCEPTION 'FORBIDDEN_STAFF_SIGNER' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.agreements (
    signer_type, signer_id, signer_auth_user_id, property_id,
    version, typed_name, checkbox_confirmed, signed_at,
    ip_address, user_agent, pdf_storage_path
  ) VALUES (
    p_signer_type, p_signer_id, v_uid, p_property_id,
    p_version, btrim(p_typed_name), true, now(),
    COALESCE(p_ip_address, '127.0.0.1'::INET), p_user_agent, p_pdf_storage_path
  )
  RETURNING * INTO v_agreement;

  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('signed-agreements', p_pdf_storage_path);

  IF p_signer_type = 'property' THEN
    UPDATE public.properties
    SET status = 'active'
    WHERE id = p_property_id
      AND status = 'pending';

    UPDATE public.people
    SET agreement_signed_at = COALESCE(agreement_signed_at, now())
    WHERE auth_user_id = v_uid
      AND property_id = p_property_id
      AND role = 'property_admin';
  ELSE
    UPDATE public.people
    SET agreement_signed_at = COALESCE(agreement_signed_at, now())
    WHERE id = p_signer_id
      AND property_id = p_property_id;
  END IF;

  INSERT INTO public.audit_logs (
    property_id, actor_user_id, actor_role, action, target_type, target_id, ip_address, metadata
  ) VALUES (
    p_property_id,
    v_uid,
    CASE WHEN v_is_super THEN 'super_admin' ELSE 'user' END,
    'agreement_signed',
    p_signer_type,
    p_signer_id::TEXT,
    COALESCE(p_ip_address, '127.0.0.1'::INET),
    jsonb_build_object('agreementId', v_agreement.id, 'version', p_version, 'pdfPath', p_pdf_storage_path)
  );

  RETURN to_jsonb(v_agreement);
END;
$$;

REVOKE ALL ON FUNCTION public.record_signed_agreement(TEXT, UUID, UUID, TEXT, TEXT, BOOLEAN, INET, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_signed_agreement(TEXT, UUID, UUID, TEXT, TEXT, BOOLEAN, INET, TEXT, TEXT) TO authenticated;
