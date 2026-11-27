-- Step 7: Staff Wallet Portal, In-App Notifications, Tips Overview & Pool Distribution

-- 1. Staff Portal Context (works for active AND inactive staff for withdraw-only access per L79/L270)
CREATE OR REPLACE FUNCTION public.get_staff_portal_context()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_ap RECORD;
  v_prop RECORD;
  v_dept RECORD;
  v_today DATE;
  v_toggles JSONB;
  v_rooms JSONB := '[]'::JSONB;
  v_tips JSONB := '[]'::JSONB;
  v_ledger JSONB := '[]'::JSONB;
  v_notifs JSONB := '[]'::JSONB;
  v_unread INT := 0;
  v_wallet BIGINT := 0;
  v_stripe_acct TEXT := NULL;
BEGIN
  SELECT * INTO v_ap FROM public.auth_person_including_inactive();
  IF v_ap.id IS NULL OR v_ap.role <> 'staff' THEN
    RAISE EXCEPTION 'STAFF_ONLY_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT p.name, p.wallet_balance_cents, p.stripe_connect_account_id, p.photo_path
  INTO v_prop -- reuse temp? No, use explicit vars
  FROM public.people p WHERE p.id = v_ap.id;

  SELECT wallet_balance_cents, stripe_connect_account_id
  INTO v_wallet, v_stripe_acct
  FROM public.people WHERE id = v_ap.id;

  SELECT * INTO v_prop FROM public.properties_staff_view WHERE id = v_ap.property_id;
  SELECT * INTO v_dept FROM public.departments WHERE id = v_ap.department_id AND property_id = v_ap.property_id;
  v_today := (now() AT TIME ZONE v_prop.timezone)::DATE;

  SELECT COALESCE(jsonb_object_agg(f.feature_key, f.enabled), '{}'::JSONB)
  INTO v_toggles
  FROM public.property_features f
  WHERE f.property_id = v_ap.property_id
    AND f.feature_key IN (
      'in_app_notifications', 'staff_wallet_and_withdrawals',
      'instant_payouts', 'weekly_batch_payouts', 'personal_staff_qr_codes'
    );

  IF v_ap.status = 'active' AND COALESCE(v_dept.is_housekeeping, false) THEN
    SELECT COALESCE(jsonb_agg(a.room_number ORDER BY
      CASE WHEN a.room_number ~ '^[0-9]+$' THEN 0 ELSE 1 END,
      CASE WHEN a.room_number ~ '^[0-9]+$' THEN a.room_number::NUMERIC ELSE 0 END,
      a.room_number), '[]'::JSONB)
    INTO v_rooms
    FROM public.assignments a
    WHERE a.property_id = v_ap.property_id
      AND a.assignment_date = v_today
      AND a.person_id = v_ap.id;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'amountCents', t.amount_cents,
    'netCents', t.net_cents,
    'roomNumber', t.room_number,
    'note', t.note,
    'status', t.status,
    'paidAt', t.paid_at
  ) ORDER BY t.paid_at DESC), '[]'::JSONB)
  INTO v_tips
  FROM (
    SELECT id, amount_cents, net_cents, room_number, note, status, paid_at
    FROM public.tips
    WHERE property_id = v_ap.property_id AND person_id = v_ap.id
    ORDER BY paid_at DESC
    LIMIT 50
  ) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'type', l.type,
    'amountCents', l.amount_cents,
    'createdAt', l.created_at
  ) ORDER BY l.created_at DESC), '[]'::JSONB)
  INTO v_ledger
  FROM (
    SELECT id, type, amount_cents, created_at
    FROM public.ledger
    WHERE property_id = v_ap.property_id AND person_id = v_ap.id
    ORDER BY created_at DESC
    LIMIT 50
  ) l;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'type', n.type,
    'message', n.message,
    'tipId', n.tip_id,
    'read', n.read,
    'createdAt', n.created_at
  ) ORDER BY n.created_at DESC), '[]'::JSONB)
  INTO v_notifs
  FROM (
    SELECT id, type, message, tip_id, read, created_at
    FROM public.notifications
    WHERE property_id = v_ap.property_id AND person_id = v_ap.id
    ORDER BY created_at DESC
    LIMIT 30
  ) n;

  SELECT COUNT(*)::INT INTO v_unread
  FROM public.notifications
  WHERE property_id = v_ap.property_id AND person_id = v_ap.id AND NOT read;

  RETURN jsonb_build_object(
    'person', jsonb_build_object(
      'id', v_ap.id,
      'name', (SELECT name FROM public.people WHERE id = v_ap.id),
      'status', v_ap.status,
      'departmentId', v_ap.department_id,
      'departmentName', COALESCE(v_dept.name, ''),
      'isHousekeeping', COALESCE(v_dept.is_housekeeping, false),
      'walletBalanceCents', v_wallet,
      'stripeConnectAccountId', v_stripe_acct
    ),
    'property', jsonb_build_object(
      'id', v_prop.id,
      'name', v_prop.name,
      'status', v_prop.status,
      'payoutWeekday', v_prop.payout_weekday,
      'minWithdrawalCents', v_prop.min_withdrawal_cents,
      'payoutFeePaidBy', v_prop.payout_fee_paid_by,
      'timezone', v_prop.timezone,
      'heroPhotoPath', v_prop.hero_photo_path
    ),
    'toggles', v_toggles,
    'todayDate', v_today,
    'todayRooms', v_rooms,
    'recentTips', v_tips,
    'ledgerEntries', v_ledger,
    'notifications', v_notifs,
    'unreadCount', v_unread
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_staff_portal_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_staff_portal_context() TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_staff_notifications_read(p_ids UUID[] DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_ap RECORD;
  v_updated INT := 0;
BEGIN
  SELECT * INTO v_ap FROM public.auth_person_including_inactive();
  IF v_ap.id IS NULL OR v_ap.role <> 'staff' THEN
    RAISE EXCEPTION 'STAFF_ONLY_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  UPDATE public.notifications
  SET read = true
  WHERE property_id = v_ap.property_id
    AND person_id = v_ap.id
    AND NOT read
    AND (p_ids IS NULL OR id = ANY (p_ids));

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('markedReadCount', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_staff_notifications_read(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_staff_notifications_read(UUID[]) TO authenticated;

-- 2. Admin / Dept Manager Tips Overview & Pool Balances
CREATE OR REPLACE FUNCTION public.get_admin_tips_overview(
  p_property_id UUID,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL,
  p_department_id UUID DEFAULT NULL,
  p_person_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_ap RECORD;
  v_prop RECORD;
  v_scoped_dept UUID := NULL;
  v_ft15 BOOLEAN;
  v_toggles JSONB;
  v_kpis JSONB;
  v_depts JSONB;
  v_by_person JSONB;
  v_tips JSONB;
  v_dists JSONB;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    SELECT * INTO v_ap FROM public.auth_active_person();
    IF v_ap.id IS NULL OR v_ap.property_id <> p_property_id THEN
      RAISE EXCEPTION 'CROSS_PROPERTY_OR_ROLE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF v_ap.role = 'dept_manager' THEN
      SELECT enabled INTO v_ft15 FROM public.property_features
      WHERE property_id = p_property_id AND feature_key = 'department_manager_role';
      IF NOT COALESCE(v_ft15, false) THEN
        RAISE EXCEPTION 'FEATURE_DISABLED:FT-15' USING ERRCODE = '42501';
      END IF;
      v_scoped_dept := v_ap.department_id;
    ELSIF v_ap.role <> 'property_admin' THEN
      RAISE EXCEPTION 'CROSS_PROPERTY_OR_ROLE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT id, name, timezone INTO v_prop FROM public.properties WHERE id = p_property_id;
  IF v_prop.id IS NULL THEN
    RAISE EXCEPTION 'PROPERTY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_object_agg(f.feature_key, f.enabled), '{}'::JSONB)
  INTO v_toggles
  FROM public.property_features f
  WHERE f.property_id = p_property_id
    AND f.feature_key IN ('pool_distribution', 'refunds', 'tips_overview_export', 'department_manager_role');

  -- KPIs over filtered tips (exclude guest_email PII)
  SELECT jsonb_build_object(
    'totalGrossCents', COALESCE(SUM(t.amount_cents), 0),
    'totalNetCents', COALESCE(SUM(t.net_cents), 0),
    'tipCount', COUNT(*)::INT,
    'averageNetCents', COALESCE(ROUND(AVG(t.net_cents))::BIGINT, 0)
  )
  INTO v_kpis
  FROM public.tips t
  WHERE t.property_id = p_property_id
    AND (v_scoped_dept IS NULL OR t.department_id = v_scoped_dept)
    AND (p_department_id IS NULL OR t.department_id = p_department_id)
    AND (p_person_id IS NULL OR t.person_id = p_person_id)
    AND (p_from_date IS NULL OR (t.paid_at AT TIME ZONE v_prop.timezone)::DATE >= p_from_date)
    AND (p_to_date IS NULL OR (t.paid_at AT TIME ZONE v_prop.timezone)::DATE <= p_to_date);

  -- Departments + unallocated pool balance + active frontline staff
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'name', d.name,
    'defaultDistribution', d.default_distribution,
    'unallocatedPoolCents', COALESCE((
      SELECT SUM(CASE
        WHEN l.type = 'pool_credit' THEN l.amount_cents
        WHEN l.type = 'pool_debit' THEN -l.amount_cents
        ELSE 0 END)
      FROM public.ledger l
      WHERE l.property_id = p_property_id
        AND l.department_id = d.id
        AND l.person_id IS NULL
    ), 0),
    'activeStaff', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', pe.id, 'name', pe.name) ORDER BY pe.name)
      FROM public.people pe
      WHERE pe.property_id = p_property_id
        AND pe.department_id = d.id
        AND pe.role = 'staff'
        AND pe.status = 'active'
    ), '[]'::JSONB)
  ) ORDER BY d.is_housekeeping DESC, d.name), '[]'::JSONB)
  INTO v_depts
  FROM public.departments d
  WHERE d.property_id = p_property_id
    AND (v_scoped_dept IS NULL OR d.id = v_scoped_dept);

  -- Summary by person
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'personId', x.person_id,
    'personName', x.person_name,
    'departmentName', x.dept_name,
    'tipCount', x.cnt,
    'totalNetCents', x.net_sum
  ) ORDER BY x.net_sum DESC, x.person_name), '[]'::JSONB)
  INTO v_by_person
  FROM (
    SELECT t.person_id, pe.name AS person_name, d.name AS dept_name,
           COUNT(*)::INT AS cnt, SUM(t.net_cents)::BIGINT AS net_sum
    FROM public.tips t
    JOIN public.people pe ON pe.property_id = t.property_id AND pe.id = t.person_id
    JOIN public.departments d ON d.property_id = t.property_id AND d.id = t.department_id
    WHERE t.property_id = p_property_id
      AND t.person_id IS NOT NULL
      AND (v_scoped_dept IS NULL OR t.department_id = v_scoped_dept)
      AND (p_department_id IS NULL OR t.department_id = p_department_id)
      AND (p_person_id IS NULL OR t.person_id = p_person_id)
      AND (p_from_date IS NULL OR (t.paid_at AT TIME ZONE v_prop.timezone)::DATE >= p_from_date)
      AND (p_to_date IS NULL OR (t.paid_at AT TIME ZONE v_prop.timezone)::DATE <= p_to_date)
    GROUP BY t.person_id, pe.name, d.name
  ) x;

  -- Tips list (omits guest_email PII)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'amountCents', t.amount_cents,
    'feeCents', t.fee_cents,
    'guestFeeCents', t.guest_fee_cents,
    'netCents', t.net_cents,
    'recipientType', t.recipient_type,
    'personId', t.person_id,
    'personName', pe.name,
    'departmentId', t.department_id,
    'departmentName', d.name,
    'roomNumber', t.room_number,
    'note', t.note,
    'status', t.status,
    'paidAt', t.paid_at
  ) ORDER BY t.paid_at DESC), '[]'::JSONB)
  INTO v_tips
  FROM public.tips t
  JOIN public.departments d ON d.property_id = t.property_id AND d.id = t.department_id
  LEFT JOIN public.people pe ON pe.property_id = t.property_id AND pe.id = t.person_id
  WHERE t.property_id = p_property_id
    AND (v_scoped_dept IS NULL OR t.department_id = v_scoped_dept)
    AND (p_department_id IS NULL OR t.department_id = p_department_id)
    AND (p_person_id IS NULL OR t.person_id = p_person_id)
    AND (p_from_date IS NULL OR (t.paid_at AT TIME ZONE v_prop.timezone)::DATE >= p_from_date)
    AND (p_to_date IS NULL OR (t.paid_at AT TIME ZONE v_prop.timezone)::DATE <= p_to_date);

  -- Recent pool distributions
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', pd.id,
    'departmentId', pd.department_id,
    'departmentName', d.name,
    'distributionDate', pd.distribution_date,
    'method', pd.method,
    'totalCents', pd.total_cents,
    'allocations', pd.allocations,
    'createdAt', pd.created_at
  ) ORDER BY pd.created_at DESC), '[]'::JSONB)
  INTO v_dists
  FROM (
    SELECT * FROM public.pool_distributions
    WHERE property_id = p_property_id
      AND (v_scoped_dept IS NULL OR department_id = v_scoped_dept)
    ORDER BY created_at DESC
    LIMIT 20
  ) pd
  JOIN public.departments d ON d.property_id = pd.property_id AND d.id = pd.department_id;

  RETURN jsonb_build_object(
    'propertyName', v_prop.name,
    'timezone', v_prop.timezone,
    'scopedDepartmentId', v_scoped_dept,
    'toggles', v_toggles,
    'kpis', v_kpis,
    'departments', v_depts,
    'byPerson', v_by_person,
    'tips', v_tips,
    'poolDistributions', v_dists
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_tips_overview(UUID, DATE, DATE, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_tips_overview(UUID, DATE, DATE, UUID, UUID) TO authenticated;

-- 3. Atomic Pool Distribution (locks department row, conserves exact cents, credits active frontline staff only)
CREATE OR REPLACE FUNCTION public.distribute_department_pool(
  p_property_id UUID,
  p_department_id UUID,
  p_method TEXT,
  p_allocations JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_ap RECORD;
  v_prop RECORD;
  v_dept RECORD;
  v_ft15 BOOLEAN;
  v_ft21 BOOLEAN;
  v_ft16 BOOLEAN;
  v_pool_balance BIGINT;
  v_staff_ids UUID[];
  v_staff_count INT;
  v_base BIGINT;
  v_rem BIGINT;
  v_idx INT;
  v_alloc_item JSONB;
  v_pid UUID;
  v_amt BIGINT;
  v_sum BIGINT := 0;
  v_final_allocs JSONB := '[]'::JSONB;
  v_seen UUID[] := ARRAY[]::UUID[];
  v_dist_id UUID;
  v_actor UUID := COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000001'::UUID);
  v_today DATE;
BEGIN
  IF p_method NOT IN ('split', 'individual') THEN
    RAISE EXCEPTION 'INVALID_DISTRIBUTION_METHOD' USING ERRCODE = '22023';
  END IF;

  IF NOT public.auth_is_super_admin() THEN
    SELECT * INTO v_ap FROM public.auth_active_person();
    IF v_ap.id IS NULL OR v_ap.property_id <> p_property_id THEN
      RAISE EXCEPTION 'CROSS_PROPERTY_OR_ROLE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF v_ap.role = 'dept_manager' THEN
      SELECT enabled INTO v_ft15 FROM public.property_features
      WHERE property_id = p_property_id AND feature_key = 'department_manager_role';
      IF NOT COALESCE(v_ft15, false) OR v_ap.department_id <> p_department_id THEN
        RAISE EXCEPTION 'CROSS_PROPERTY_OR_ROLE_FORBIDDEN' USING ERRCODE = '42501';
      END IF;
    ELSIF v_ap.role <> 'property_admin' THEN
      RAISE EXCEPTION 'CROSS_PROPERTY_OR_ROLE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT enabled INTO v_ft21 FROM public.property_features
  WHERE property_id = p_property_id AND feature_key = 'pool_distribution';
  IF NOT COALESCE(v_ft21, false) THEN
    RAISE EXCEPTION 'FEATURE_DISABLED:FT-21' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prop FROM public.properties WHERE id = p_property_id;
  IF v_prop.id IS NULL THEN
    RAISE EXCEPTION 'PROPERTY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  v_today := (now() AT TIME ZONE v_prop.timezone)::DATE;

  -- Lock the department row to prevent concurrent double distribution
  SELECT * INTO v_dept FROM public.departments
  WHERE id = p_department_id AND property_id = p_property_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPARTMENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(CASE
    WHEN type = 'pool_credit' THEN amount_cents
    WHEN type = 'pool_debit' THEN -amount_cents
    ELSE 0 END), 0)
  INTO v_pool_balance
  FROM public.ledger
  WHERE property_id = p_property_id
    AND department_id = p_department_id
    AND person_id IS NULL;

  IF v_pool_balance <= 0 THEN
    RAISE EXCEPTION 'POOL_EMPTY' USING ERRCODE = '22023';
  END IF;

  IF p_method = 'split' THEN
    SELECT array_agg(id ORDER BY id)
    INTO v_staff_ids
    FROM public.people
    WHERE property_id = p_property_id
      AND department_id = p_department_id
      AND role = 'staff'
      AND status = 'active';

    v_staff_count := COALESCE(array_length(v_staff_ids, 1), 0);
    IF v_staff_count = 0 THEN
      RAISE EXCEPTION 'NO_ACTIVE_STAFF_IN_DEPARTMENT' USING ERRCODE = '22023';
    END IF;

    v_base := v_pool_balance / v_staff_count;
    v_rem := v_pool_balance % v_staff_count;
    FOR v_idx IN 1..v_staff_count LOOP
      v_pid := v_staff_ids[v_idx];
      v_amt := v_base + CASE WHEN v_idx <= v_rem THEN 1 ELSE 0 END;
      IF v_amt > 0 THEN
        v_final_allocs := v_final_allocs || jsonb_build_object('personId', v_pid, 'amountCents', v_amt);
        v_sum := v_sum + v_amt;
      END IF;
    END LOOP;
  ELSE
    IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
      RAISE EXCEPTION 'NO_ALLOCATIONS' USING ERRCODE = '22023';
    END IF;

    FOR v_alloc_item IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
      v_pid := (v_alloc_item->>'personId')::UUID;
      v_amt := (v_alloc_item->>'amountCents')::BIGINT;
      IF v_amt IS NULL OR v_amt <= 0 THEN
        RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT' USING ERRCODE = '22023';
      END IF;
      IF v_pid = ANY (v_seen) THEN
        RAISE EXCEPTION 'DUPLICATE_PERSON_IN_POOL' USING ERRCODE = '22023';
      END IF;
      v_seen := array_append(v_seen, v_pid);

      IF NOT EXISTS (
        SELECT 1 FROM public.people
        WHERE id = v_pid AND property_id = p_property_id
          AND department_id = p_department_id
          AND role = 'staff' AND status = 'active'
      ) THEN
        RAISE EXCEPTION 'INVALID_POOL_RECIPIENT' USING ERRCODE = '22023';
      END IF;

      v_final_allocs := v_final_allocs || jsonb_build_object('personId', v_pid, 'amountCents', v_amt);
      v_sum := v_sum + v_amt;
    END LOOP;

    IF v_sum <> v_pool_balance THEN
      RAISE EXCEPTION 'POOL_SUM_MISMATCH:%:%', v_sum, v_pool_balance USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.pool_distributions (
    property_id, department_id, distribution_date, method, total_cents, allocations, created_by
  )
  VALUES (
    p_property_id, p_department_id, v_today, p_method, v_pool_balance, v_final_allocs, v_actor
  )
  RETURNING id INTO v_dist_id;

  -- Debit the department pool ledger
  INSERT INTO public.ledger (
    property_id, person_id, department_id, type, amount_cents, ref_id, idempotency_key
  )
  VALUES (
    p_property_id, NULL, p_department_id, 'pool_debit', v_pool_balance, v_dist_id,
    'pool:' || v_dist_id::TEXT || ':debit'
  );

  SELECT enabled INTO v_ft16 FROM public.property_features
  WHERE property_id = p_property_id AND feature_key = 'in_app_notifications';

  FOR v_alloc_item IN SELECT * FROM jsonb_array_elements(v_final_allocs) LOOP
    v_pid := (v_alloc_item->>'personId')::UUID;
    v_amt := (v_alloc_item->>'amountCents')::BIGINT;

    INSERT INTO public.ledger (
      property_id, person_id, department_id, type, amount_cents, ref_id, idempotency_key
    )
    VALUES (
      p_property_id, v_pid, p_department_id, 'pool_credit', v_amt, v_dist_id,
      'pool:' || v_dist_id::TEXT || ':credit:' || v_pid::TEXT
    );

    UPDATE public.people
    SET wallet_balance_cents = wallet_balance_cents + v_amt,
        last_activity_or_credit_at = now()
    WHERE id = v_pid;

    IF COALESCE(v_ft16, true) THEN
      INSERT INTO public.notifications (property_id, person_id, type, message)
      VALUES (
        p_property_id, v_pid, 'pool_distributed',
        v_dept.name || ' team pool distributed: +$' || to_char(v_amt / 100.0, 'FM999999990.00') || ' added to your wallet.'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'distributionId', v_dist_id,
    'departmentId', p_department_id,
    'method', p_method,
    'totalCents', v_pool_balance,
    'allocations', v_final_allocs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.distribute_department_pool(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.distribute_department_pool(UUID, UUID, TEXT, JSONB) TO authenticated;
