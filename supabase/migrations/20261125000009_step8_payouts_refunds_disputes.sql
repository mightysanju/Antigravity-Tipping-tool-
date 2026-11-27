-- Step 8: Withdrawals, Connect Express Weekly/Instant Payouts, Two-Phase Refunds, Disputes & Unclaimed Reminders

-- 1. Save Stripe Connect Express Account ID on person
CREATE OR REPLACE FUNCTION public.set_staff_connect_account(p_account_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_ap RECORD;
BEGIN
  SELECT * INTO v_ap FROM public.auth_person_including_inactive();
  IF v_ap.id IS NULL OR v_ap.role <> 'staff' THEN
    RAISE EXCEPTION 'STAFF_ONLY_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  UPDATE public.people
  SET stripe_connect_account_id = p_account_id
  WHERE id = v_ap.id;

  RETURN jsonb_build_object('personId', v_ap.id, 'stripeConnectAccountId', p_account_id);
END;
$$;

REVOKE ALL ON FUNCTION public.set_staff_connect_account(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_staff_connect_account(TEXT) TO authenticated;

-- 2. Request Withdrawal (active AND inactive withdraw-only staff; blocked on restricted/cancelled properties per L270)
CREATE OR REPLACE FUNCTION public.create_staff_withdrawal(
  p_person_id UUID,
  p_amount_cents BIGINT,
  p_method TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person public.people;
  v_prop public.properties;
  v_ft18 BOOLEAN;
  v_fee_cents BIGINT := 0;
  v_net_cents BIGINT;
  v_w public.withdrawals;
BEGIN
  IF p_method NOT IN ('standard', 'instant') THEN
    RAISE EXCEPTION 'INVALID_WITHDRAWAL_METHOD' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_person FROM public.people WHERE id = p_person_id FOR UPDATE;
  IF NOT FOUND OR v_person.role <> 'staff' THEN
    RAISE EXCEPTION 'STAFF_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_prop FROM public.properties WHERE id = v_person.property_id;
  IF v_prop.status IN ('restricted', 'cancelled', 'pending') THEN
    RAISE EXCEPTION 'PROPERTY_RESTRICTED' USING ERRCODE = '42501';
  END IF;

  IF v_person.stripe_connect_account_id IS NULL THEN
    RAISE EXCEPTION 'CONNECT_ONBOARDING_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_method = 'instant' THEN
    SELECT enabled INTO v_ft18 FROM public.property_features
    WHERE property_id = v_prop.id AND feature_key = 'instant_payouts';
    IF NOT COALESCE(v_ft18, false) THEN
      RAISE EXCEPTION 'FEATURE_DISABLED:FT-18' USING ERRCODE = '42501';
    END IF;
    -- Instant payout fee: max($0.50, 1.5%) when staff pays or standard instant fee
    IF v_prop.payout_fee_paid_by = 'staff' THEN
      v_fee_cents := GREATEST(50, ROUND(p_amount_cents * 0.015)::BIGINT);
    END IF;
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents < v_prop.min_withdrawal_cents THEN
    RAISE EXCEPTION 'BELOW_MINIMUM_WITHDRAWAL:%', v_prop.min_withdrawal_cents USING ERRCODE = '22023';
  END IF;

  IF v_person.wallet_balance_cents < p_amount_cents THEN
    RAISE EXCEPTION 'INSUFFICIENT_WALLET_BALANCE' USING ERRCODE = '22023';
  END IF;

  v_net_cents := p_amount_cents - v_fee_cents;
  IF v_net_cents <= 0 THEN
    RAISE EXCEPTION 'INVALID_NET_PAYOUT' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.withdrawals (
    property_id, person_id, amount_cents, method, fee_cents, status, stripe_idempotency_key
  )
  VALUES (
    v_prop.id, v_person.id, p_amount_cents, p_method, v_fee_cents,
    CASE WHEN p_method = 'instant' THEN 'processing' ELSE 'queued' END,
    'wd:' || gen_random_uuid()::TEXT
  )
  RETURNING * INTO v_w;

  INSERT INTO public.ledger (
    property_id, person_id, department_id, type, amount_cents, ref_id, idempotency_key
  )
  VALUES (
    v_prop.id, v_person.id, v_person.department_id, 'payout', -p_amount_cents, v_w.id,
    'payout:' || v_w.id::TEXT || ':debit'
  );

  UPDATE public.people
  SET wallet_balance_cents = wallet_balance_cents - p_amount_cents,
      last_activity_or_credit_at = now()
  WHERE id = v_person.id;

  RETURN jsonb_build_object(
    'withdrawalId', v_w.id,
    'propertyId', v_prop.id,
    'personId', v_person.id,
    'destinationAccountId', v_person.stripe_connect_account_id,
    'amountCents', v_w.amount_cents,
    'feeCents', v_w.fee_cents,
    'netPayoutCents', v_w.net_payout_cents,
    'method', v_w.method,
    'status', v_w.status,
    'idempotencyKey', v_w.stripe_idempotency_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_staff_withdrawal(UUID, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;

-- Mark withdrawal paid or failed (with payout_reversal credit back to wallet on failure)
CREATE OR REPLACE FUNCTION public.finalize_withdrawal_payout(
  p_withdrawal_id UUID,
  p_success BOOLEAN,
  p_stripe_payout_id TEXT DEFAULT NULL,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_w public.withdrawals;
  v_person public.people;
BEGIN
  SELECT * INTO v_w FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WITHDRAWAL_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_w.status IN ('paid', 'failed') THEN
    RETURN jsonb_build_object('withdrawalId', v_w.id, 'status', v_w.status, 'alreadyFinalized', true);
  END IF;

  SELECT * INTO v_person FROM public.people WHERE id = v_w.person_id FOR UPDATE;

  IF p_success THEN
    UPDATE public.withdrawals
    SET status = 'paid',
        stripe_payout_id = p_stripe_payout_id,
        paid_at = now()
    WHERE id = v_w.id;

    INSERT INTO public.notifications (property_id, person_id, type, message)
    VALUES (
      v_w.property_id, v_w.person_id, 'payout_paid',
      'Payout of $' || to_char(v_w.net_payout_cents / 100.0, 'FM999999990.00') || ' has been sent to your bank.'
    );
    RETURN jsonb_build_object('withdrawalId', v_w.id, 'status', 'paid', 'stripePayoutId', p_stripe_payout_id);
  ELSE
    UPDATE public.withdrawals
    SET status = 'failed',
        failure_reason = COALESCE(p_failure_reason, 'PAYOUT_FAILED')
    WHERE id = v_w.id;

    INSERT INTO public.ledger (
      property_id, person_id, department_id, type, amount_cents, ref_id, idempotency_key
    )
    VALUES (
      v_w.property_id, v_w.person_id, v_person.department_id, 'payout_reversal', v_w.amount_cents, v_w.id,
      'payout:' || v_w.id::TEXT || ':reversal'
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    UPDATE public.people
    SET wallet_balance_cents = wallet_balance_cents + v_w.amount_cents
    WHERE id = v_w.person_id;

    INSERT INTO public.notifications (property_id, person_id, type, message)
    VALUES (
      v_w.property_id, v_w.person_id, 'payout_failed',
      'Your $' || to_char(v_w.amount_cents / 100.0, 'FM999999990.00') || ' payout could not be completed and was returned to your wallet.'
    );
    RETURN jsonb_build_object('withdrawalId', v_w.id, 'status', 'failed', 'reversedCents', v_w.amount_cents);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_withdrawal_payout(UUID, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- 3. Weekly Batch Payout Claim (DOW = payout_weekday AND HOUR = 9 in p.timezone, unless p_force_property_id for tests)
CREATE OR REPLACE FUNCTION public.claim_weekly_payout_batch(
  p_property_id UUID DEFAULT NULL,
  p_ignore_schedule BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prop RECORD;
  v_local_ts TIMESTAMP;
  v_local_date DATE;
  v_batch_id UUID;
  v_claimed JSONB := '[]'::JSONB;
  v_w RECORD;
  v_total BIGINT := 0;
  v_cnt INT := 0;
  v_batches JSONB := '[]'::JSONB;
BEGIN
  FOR v_prop IN
    SELECT * FROM public.properties p
    WHERE p.status = 'active'
      AND (p_property_id IS NULL OR p.id = p_property_id)
  LOOP
    v_local_ts := now() AT TIME ZONE v_prop.timezone;
    v_local_date := v_local_ts::DATE;

    IF NOT p_ignore_schedule THEN
      IF EXTRACT(DOW FROM v_local_ts)::INT <> v_prop.payout_weekday
         OR EXTRACT(HOUR FROM v_local_ts)::INT <> 9 THEN
        CONTINUE;
      END IF;
    END IF;

    -- Idempotent per (property_id, payout_date)
    INSERT INTO public.payout_batches (property_id, payout_date, status)
    VALUES (v_prop.id, v_local_date, 'processing')
    ON CONFLICT (property_id, payout_date) DO NOTHING
    RETURNING id INTO v_batch_id;

    IF v_batch_id IS NULL THEN
      CONTINUE;
    END IF;

    v_claimed := '[]'::JSONB;
    v_total := 0;
    v_cnt := 0;

    FOR v_w IN
      SELECT w.*, pe.stripe_connect_account_id
      FROM public.withdrawals w
      JOIN public.people pe ON pe.id = w.person_id
      WHERE w.property_id = v_prop.id
        AND w.status = 'queued'
        AND w.method = 'standard'
        AND pe.stripe_connect_account_id IS NOT NULL
      ORDER BY w.requested_at ASC
      LIMIT 20
      FOR UPDATE OF w SKIP LOCKED
    LOOP
      UPDATE public.withdrawals
      SET status = 'processing',
          batch_id = v_batch_id,
          processing_started_at = now()
      WHERE id = v_w.id;

      v_claimed := v_claimed || jsonb_build_object(
        'withdrawalId', v_w.id,
        'destinationAccountId', v_w.stripe_connect_account_id,
        'netPayoutCents', v_w.net_payout_cents,
        'idempotencyKey', v_w.stripe_idempotency_key
      );
      v_total := v_total + v_w.net_payout_cents;
      v_cnt := v_cnt + 1;
    END LOOP;

    UPDATE public.payout_batches
    SET total_cents = v_total,
        withdrawal_count = v_cnt,
        status = CASE WHEN v_cnt = 0 THEN 'completed' ELSE 'processing' END
    WHERE id = v_batch_id;

    v_batches := v_batches || jsonb_build_object(
      'batchId', v_batch_id,
      'propertyId', v_prop.id,
      'payoutDate', v_local_date,
      'withdrawals', v_claimed
    );
  END LOOP;

  RETURN v_batches;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_weekly_payout_batch(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- 4. Two-Phase Refund (Property Admin / Super Admin only, 24h window, FT-20)
CREATE OR REPLACE FUNCTION public.start_tip_refund(p_tip_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tip public.tips;
  v_ap RECORD;
  v_ft20 BOOLEAN;
  v_attempt_id UUID := gen_random_uuid();
BEGIN
  SELECT * INTO v_tip FROM public.tips WHERE id = p_tip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TIP_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.auth_is_super_admin() THEN
    SELECT * INTO v_ap FROM public.auth_active_person();
    IF v_ap.id IS NULL OR v_ap.role <> 'property_admin' OR v_ap.property_id <> v_tip.property_id THEN
      RAISE EXCEPTION 'CROSS_PROPERTY_OR_ROLE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT enabled INTO v_ft20 FROM public.property_features
  WHERE property_id = v_tip.property_id AND feature_key = 'refunds';
  IF NOT COALESCE(v_ft20, false) THEN
    RAISE EXCEPTION 'FEATURE_DISABLED:FT-20' USING ERRCODE = '42501';
  END IF;

  IF v_tip.status <> 'paid' THEN
    RAISE EXCEPTION 'TIP_NOT_REFUNDABLE:%', v_tip.status USING ERRCODE = '22023';
  END IF;

  IF now() - v_tip.paid_at > interval '24 hours' THEN
    RAISE EXCEPTION 'REFUND_WINDOW_EXPIRED_24H' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tips
  SET status = 'refund_pending',
      active_refund_attempt_id = v_attempt_id,
      refund_pending_started_at = now(),
      refund_attempt_count = refund_attempt_count + 1
  WHERE id = v_tip.id;

  RETURN jsonb_build_object(
    'tipId', v_tip.id,
    'paymentIntentId', v_tip.stripe_payment_intent_id,
    'attemptId', v_attempt_id,
    'idempotencyKey', 'refund:' || v_tip.id::TEXT || ':' || v_attempt_id::TEXT
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_tip_refund(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_tip_refund(UUID) TO authenticated;

-- Confirm refund from charge.refunded webhook (or roll back if Stripe call failed synchronously)
CREATE OR REPLACE FUNCTION public.finalize_tip_refund(
  p_tip_id UUID,
  p_success BOOLEAN,
  p_event_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tip public.tips;
  v_inserted_event TEXT;
BEGIN
  IF p_event_id IS NOT NULL THEN
    INSERT INTO public.stripe_events (event_id, event_type)
    VALUES (p_event_id, 'charge.refunded')
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id INTO v_inserted_event;
    IF v_inserted_event IS NULL THEN
      RETURN jsonb_build_object('ok', true, 'deduplicated', true);
    END IF;
  END IF;

  SELECT * INTO v_tip FROM public.tips WHERE id = p_tip_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true);
  END IF;

  IF v_tip.status = 'refunded' THEN
    RETURN jsonb_build_object('ok', true, 'deduplicated', true, 'tipId', v_tip.id);
  END IF;

  IF NOT p_success THEN
    UPDATE public.tips
    SET status = 'paid',
        active_refund_attempt_id = NULL,
        refund_pending_started_at = NULL
    WHERE id = v_tip.id AND status = 'refund_pending';
    RETURN jsonb_build_object('ok', true, 'rolledBack', true, 'tipId', v_tip.id);
  END IF;

  UPDATE public.tips
  SET status = 'refunded'
  WHERE id = v_tip.id;

  INSERT INTO public.ledger (
    property_id, person_id, department_id, type, amount_cents, ref_id, idempotency_key
  )
  VALUES (
    v_tip.property_id, v_tip.person_id, v_tip.department_id, 'refund', -v_tip.net_cents, v_tip.id,
    'refund:' || v_tip.id::TEXT || ':debit'
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  IF v_tip.recipient_type = 'person' AND v_tip.person_id IS NOT NULL THEN
    UPDATE public.people
    SET wallet_balance_cents = wallet_balance_cents - v_tip.net_cents
    WHERE id = v_tip.person_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'tipId', v_tip.id, 'status', 'refunded', 'debitedCents', v_tip.net_cents);
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_tip_refund(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;

-- 5. Chargeback / Dispute Handling (supports person AND department_pool + won reversal)
CREATE OR REPLACE FUNCTION public.handle_tip_dispute_webhook(
  p_event_id TEXT,
  p_event_type TEXT,
  p_payment_intent_id TEXT,
  p_dispute_status TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_event TEXT;
  v_tip public.tips;
BEGIN
  INSERT INTO public.stripe_events (event_id, event_type)
  VALUES (p_event_id, p_event_type)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO v_inserted_event;

  IF v_inserted_event IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'deduplicated', true);
  END IF;

  SELECT * INTO v_tip FROM public.tips
  WHERE stripe_payment_intent_id = p_payment_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true);
  END IF;

  IF p_event_type = 'charge.dispute.created' THEN
    UPDATE public.tips SET status = 'disputed' WHERE id = v_tip.id;

    INSERT INTO public.ledger (
      property_id, person_id, department_id, type, amount_cents, ref_id, idempotency_key
    )
    VALUES (
      v_tip.property_id, v_tip.person_id, v_tip.department_id, 'chargeback', -v_tip.net_cents, v_tip.id,
      'dispute:' || v_tip.id::TEXT || ':debit'
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    IF v_tip.recipient_type = 'person' AND v_tip.person_id IS NOT NULL THEN
      UPDATE public.people
      SET wallet_balance_cents = wallet_balance_cents - v_tip.net_cents
      WHERE id = v_tip.person_id;

      INSERT INTO public.notifications (property_id, person_id, type, message, tip_id)
      VALUES (
        v_tip.property_id, v_tip.person_id, 'chargeback',
        'A $' || to_char(v_tip.net_cents / 100.0, 'FM999999990.00') || ' tip is under card dispute and has been debited from your balance.',
        v_tip.id
      );
    END IF;

    RETURN jsonb_build_object('ok', true, 'tipId', v_tip.id, 'action', 'chargeback_debited');
  ELSIF p_event_type = 'charge.dispute.closed' AND p_dispute_status = 'won' THEN
    UPDATE public.tips SET status = 'paid' WHERE id = v_tip.id AND status = 'disputed';

    INSERT INTO public.ledger (
      property_id, person_id, department_id, type, amount_cents, ref_id, idempotency_key
    )
    VALUES (
      v_tip.property_id, v_tip.person_id, v_tip.department_id, 'chargeback_reversal', v_tip.net_cents, v_tip.id,
      'dispute:' || v_tip.id::TEXT || ':reversal'
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    IF v_tip.recipient_type = 'person' AND v_tip.person_id IS NOT NULL THEN
      UPDATE public.people
      SET wallet_balance_cents = wallet_balance_cents + v_tip.net_cents,
          last_activity_or_credit_at = now()
      WHERE id = v_tip.person_id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'tipId', v_tip.id, 'action', 'chargeback_reversed');
  END IF;

  RETURN jsonb_build_object('ok', true, 'tipId', v_tip.id, 'action', 'dispute_closed_no_reversal');
END;
$$;

REVOKE ALL ON FUNCTION public.handle_tip_dispute_webhook(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- 6. Reconcile stale (>15 min) processing withdrawals & refund_pending tips
CREATE OR REPLACE FUNCTION public.reconcile_stale_operations()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stale_wd INT := 0;
  v_stale_ref INT := 0;
  v_w RECORD;
BEGIN
  FOR v_w IN
    SELECT id FROM public.withdrawals
    WHERE status = 'processing'
      AND processing_started_at IS NOT NULL
      AND processing_started_at < now() - interval '15 minutes'
  LOOP
    PERFORM public.finalize_withdrawal_payout(v_w.id, false, NULL, 'STALE_PROCESSING_TIMEOUT');
    v_stale_wd := v_stale_wd + 1;
  END LOOP;

  UPDATE public.tips
  SET status = 'paid',
      active_refund_attempt_id = NULL,
      refund_pending_started_at = NULL
  WHERE status = 'refund_pending'
    AND refund_pending_started_at IS NOT NULL
    AND refund_pending_started_at < now() - interval '15 minutes';
  GET DIAGNOSTICS v_stale_ref = ROW_COUNT;

  RETURN jsonb_build_object('reconciledWithdrawals', v_stale_wd, 'reconciledRefunds', v_stale_ref);
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_stale_operations() FROM PUBLIC, anon, authenticated;

-- 7. Unclaimed Balance Reminders (30/60/90 days)
CREATE OR REPLACE FUNCTION public.claim_unclaimed_balance_reminders()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_days INT;
  v_milestone SMALLINT;
  v_out JSONB := '[]'::JSONB;
BEGIN
  FOR v_row IN
    SELECT pe.id, pe.property_id, pe.name, pe.email, pe.wallet_balance_cents,
           pe.last_activity_or_credit_at, pe.last_reminder_milestone,
           pr.name AS property_name
    FROM public.people pe
    JOIN public.properties pr ON pr.id = pe.property_id
    WHERE pe.role = 'staff'
      AND pe.wallet_balance_cents > 0
      AND pe.last_activity_or_credit_at IS NOT NULL
    FOR UPDATE OF pe
  LOOP
    v_days := EXTRACT(DAY FROM (now() - v_row.last_activity_or_credit_at))::INT;
    v_milestone := CASE
      WHEN v_days >= 90 THEN 90
      WHEN v_days >= 60 THEN 60
      WHEN v_days >= 30 THEN 30
      ELSE NULL END;

    IF v_milestone IS NOT NULL AND (v_row.last_reminder_milestone IS NULL OR v_milestone > v_row.last_reminder_milestone) THEN
      UPDATE public.people
      SET last_reminder_milestone = v_milestone
      WHERE id = v_row.id;

      v_out := v_out || jsonb_build_object(
        'personId', v_row.id,
        'email', v_row.email,
        'name', v_row.name,
        'propertyName', v_row.property_name,
        'balanceCents', v_row.wallet_balance_cents,
        'milestoneDays', v_milestone
      );
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_unclaimed_balance_reminders() FROM PUBLIC, anon, authenticated;
