-- Hospitality Tipping Platform — FORCE RLS Policies, Column Grants, Auth Helpers & Step 1 RPCs

-- 1. Enable & Force RLS on all 24 public tables
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties FORCE ROW LEVEL SECURITY;
ALTER TABLE public.property_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_features FORCE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people FORCE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tips FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pool_distributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pool_distributions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trusted_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.otp_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_rate_limits FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sso_jti_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sso_jti_nonces FORCE ROW LEVEL SECURITY;
ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_admins FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sso_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sso_providers FORCE ROW LEVEL SECURITY;

-- 2. Default-Deny Table Privileges & Exact Column/Table Grants
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- properties: safe projection columns for authenticated; admin detail RPC serves billing fields
GRANT SELECT (
  id, name, status, payout_weekday, min_withdrawal_cents, timezone,
  payout_fee_paid_by, payment_fee_paid_by, hero_photo_path,
  accent_color_hex, tip_min_cents, tip_max_cents, tip_presets_cents
) ON public.properties TO authenticated;

CREATE VIEW public.properties_staff_view
WITH (security_invoker = true) AS
SELECT
  id, name, status, payout_weekday, min_withdrawal_cents, timezone,
  payout_fee_paid_by, payment_fee_paid_by, hero_photo_path,
  accent_color_hex, tip_min_cents, tip_max_cents, tip_presets_cents
FROM public.properties;

GRANT SELECT ON public.properties_staff_view TO authenticated;

GRANT SELECT ON public.property_features TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.departments TO authenticated;
GRANT SELECT ON public.people TO authenticated; -- zero direct INSERT/UPDATE/DELETE
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO authenticated;
GRANT SELECT ON public.assignments TO authenticated;
GRANT SELECT ON public.tips TO authenticated;
GRANT SELECT ON public.pool_distributions TO authenticated;
GRANT SELECT ON public.ledger TO authenticated;
GRANT SELECT ON public.withdrawals TO authenticated;
GRANT SELECT ON public.payout_batches TO authenticated;
GRANT SELECT, UPDATE (read) ON public.notifications TO authenticated;
GRANT SELECT ON public.agreements TO authenticated;
GRANT SELECT ON public.api_keys TO authenticated;
GRANT SELECT ON public.sso_providers TO authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT SELECT ON public.invoices TO authenticated;
GRANT SELECT ON public.super_admins TO authenticated;

-- 3. Live Auth Helpers (SECURITY DEFINER to avoid recursive RLS and JWT staleness)
CREATE OR REPLACE FUNCTION public.auth_is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.super_admins
    WHERE auth_user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_active_person()
RETURNS TABLE (
  id UUID,
  property_id UUID,
  department_id UUID,
  role TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT p.id, p.property_id, p.department_id, p.role
  FROM public.people p
  WHERE p.auth_user_id = auth.uid()
    AND p.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.auth_person_including_inactive()
RETURNS TABLE (
  id UUID,
  property_id UUID,
  department_id UUID,
  role TEXT,
  status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT p.id, p.property_id, p.department_id, p.role, p.status
  FROM public.people p
  WHERE p.auth_user_id = auth.uid()
  LIMIT 1;
$$;

-- 4. Custom Access Token Auth Hook (GoTrue claim injection)
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID;
  v_claims JSONB;
  v_person RECORD;
BEGIN
  v_uid := (event->>'user_id')::UUID;
  v_claims := COALESCE(event->'claims', '{}'::JSONB);

  IF EXISTS (SELECT 1 FROM public.super_admins WHERE auth_user_id = v_uid) THEN
    v_claims := jsonb_set(v_claims, '{app_role}', '"super_admin"'::JSONB);
    v_claims := jsonb_set(v_claims, '{property_id}', 'null'::JSONB);
    v_claims := jsonb_set(v_claims, '{department_id}', 'null'::JSONB);
    v_claims := jsonb_set(v_claims, '{person_id}', 'null'::JSONB);
  ELSE
    SELECT id, property_id, department_id, role
    INTO v_person
    FROM public.people
    WHERE auth_user_id = v_uid
    LIMIT 1;

    IF FOUND THEN
      v_claims := jsonb_set(v_claims, '{app_role}', to_jsonb(v_person.role));
      v_claims := jsonb_set(v_claims, '{property_id}', to_jsonb(v_person.property_id));
      v_claims := jsonb_set(v_claims, '{department_id}', COALESCE(to_jsonb(v_person.department_id), 'null'::JSONB));
      v_claims := jsonb_set(v_claims, '{person_id}', to_jsonb(v_person.id));
    END IF;
  END IF;

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(JSONB) FROM PUBLIC, anon, authenticated;

-- 5. RLS Policies per Table (Engine-Enforced Multi-Tenant & Role Isolation)

-- properties
CREATE POLICY properties_select_policy ON public.properties
  FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR id IN (SELECT p.property_id FROM public.auth_person_including_inactive() p)
  );

-- property_features
CREATE POLICY property_features_select_policy ON public.property_features
  FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR property_id IN (SELECT p.property_id FROM public.auth_person_including_inactive() p)
  );

-- departments
CREATE POLICY departments_select_policy ON public.departments
  FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR property_id IN (SELECT p.property_id FROM public.auth_active_person() p)
  );

CREATE POLICY departments_insert_policy ON public.departments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.auth_active_person() p
      WHERE p.property_id = departments.property_id
        AND p.role = 'property_admin'
    )
  );

CREATE POLICY departments_update_policy ON public.departments
  FOR UPDATE TO authenticated
  USING (
    public.auth_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.auth_active_person() p
      WHERE p.property_id = departments.property_id
        AND p.role = 'property_admin'
    )
  )
  WITH CHECK (
    public.auth_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.auth_active_person() p
      WHERE p.property_id = departments.property_id
        AND p.role = 'property_admin'
    )
  );

-- people (SELECT only on table; mutations via create_person_record / update_person_record RPCs)
CREATE POLICY people_select_policy ON public.people
  FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.auth_active_person() ap
      WHERE ap.property_id = people.property_id
        AND (
          ap.role = 'property_admin'
          OR (ap.role = 'dept_manager' AND people.department_id = ap.department_id)
        )
    )
    OR people.id IN (SELECT ip.id FROM public.auth_person_including_inactive() ip)
  );

-- rooms
CREATE POLICY rooms_select_policy ON public.rooms
  FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR property_id IN (SELECT p.property_id FROM public.auth_active_person() p)
  );

CREATE POLICY rooms_write_policy ON public.rooms
  FOR ALL TO authenticated
  USING (
    public.auth_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.auth_active_person() ap
      WHERE ap.property_id = rooms.property_id
        AND ap.role = 'property_admin'
    )
  )
  WITH CHECK (
    public.auth_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.auth_active_person() ap
      WHERE ap.property_id = rooms.property_id
        AND ap.role = 'property_admin'
    )
  );

-- assignments
CREATE POLICY assignments_select_policy ON public.assignments
  FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.auth_active_person() ap
      WHERE ap.property_id = assignments.property_id
        AND (
          ap.role = 'property_admin'
          OR (ap.role = 'staff' AND assignments.person_id = ap.id)
          OR (ap.role = 'dept_manager' AND EXISTS (
            SELECT 1 FROM public.people tp
            WHERE tp.id = assignments.person_id
              AND tp.property_id = ap.property_id
              AND tp.department_id = ap.department_id
          ))
        )
    )
  );

-- tips
CREATE POLICY tips_select_policy ON public.tips
  FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.auth_active_person() ap
      WHERE ap.property_id = tips.property_id
        AND (
          ap.role = 'property_admin'
          OR (ap.role = 'dept_manager' AND tips.department_id = ap.department_id)
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.auth_person_including_inactive() ip
      WHERE ip.property_id = tips.property_id
        AND tips.person_id = ip.id
    )
  );

-- pool_distributions (staff explicitly denied so coworker allocations never leak)
CREATE POLICY pool_distributions_select_policy ON public.pool_distributions
  FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.auth_active_person() ap
      WHERE ap.property_id = pool_distributions.property_id
        AND (
          ap.role = 'property_admin'
          OR (ap.role = 'dept_manager' AND pool_distributions.department_id = ap.department_id)
        )
    )
  );

-- ledger (dept_manager denied; staff sees own rows including inactive withdraw-only)
CREATE POLICY ledger_select_policy ON public.ledger
  FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.auth_active_person() ap
      WHERE ap.property_id = ledger.property_id
        AND ap.role = 'property_admin'
    )
    OR EXISTS (
      SELECT 1 FROM public.auth_person_including_inactive() ip
      WHERE ip.property_id = ledger.property_id
        AND ledger.person_id = ip.id
    )
  );

-- withdrawals (staff sees own rows including inactive; super_admin sees all)
CREATE POLICY withdrawals_select_policy ON public.withdrawals
  FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.auth_person_including_inactive() ip
      WHERE ip.property_id = withdrawals.property_id
        AND withdrawals.person_id = ip.id
    )
  );

-- payout_batches
CREATE POLICY payout_batches_select_policy ON public.payout_batches
  FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.auth_active_person() ap
      WHERE ap.property_id = payout_batches.property_id
        AND ap.role = 'property_admin'
    )
  );

-- notifications
CREATE POLICY notifications_select_policy ON public.notifications
  FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.auth_active_person() ap
      WHERE ap.property_id = notifications.property_id
        AND (
          ap.role = 'property_admin'
          OR notifications.person_id = ap.id
        )
    )
  );

CREATE POLICY notifications_update_read_policy ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.auth_active_person() ap
      WHERE ap.property_id = notifications.property_id
        AND notifications.person_id = ap.id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.auth_active_person() ap
      WHERE ap.property_id = notifications.property_id
        AND notifications.person_id = ap.id
    )
  );

-- agreements
CREATE POLICY agreements_select_policy ON public.agreements
  FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.auth_active_person() ap
      WHERE ap.property_id = agreements.property_id
        AND (
          ap.role = 'property_admin'
          OR (agreements.signer_type = 'staff' AND agreements.signer_id = ap.id)
        )
    )
  );

-- api_keys, sso_providers, super_admins (super_admin only)
CREATE POLICY api_keys_super_policy ON public.api_keys
  FOR SELECT TO authenticated
  USING (public.auth_is_super_admin());

CREATE POLICY sso_providers_super_policy ON public.sso_providers
  FOR SELECT TO authenticated
  USING (public.auth_is_super_admin());

CREATE POLICY super_admins_self_policy ON public.super_admins
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- audit_logs & invoices (super_admin + owning property_admin)
CREATE POLICY audit_logs_select_policy ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.auth_active_person() ap
      WHERE ap.property_id = audit_logs.property_id
        AND ap.role = 'property_admin'
    )
  );

CREATE POLICY invoices_select_policy ON public.invoices
  FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.auth_active_person() ap
      WHERE ap.property_id = invoices.property_id
        AND ap.role = 'property_admin'
    )
  );

-- 6. Storage Bucket RLS Policies (storage.objects)
CREATE POLICY storage_staff_photos_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'staff-photos'
    AND (
      public.auth_is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.auth_active_person() ap
        WHERE split_part(name, '/', 1) = ap.property_id::TEXT
      )
    )
  );

CREATE POLICY storage_staff_photos_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'staff-photos'
    AND (
      public.auth_is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.auth_active_person() ap
        WHERE ap.role = 'property_admin'
          AND split_part(name, '/', 1) = ap.property_id::TEXT
      )
    )
  );

CREATE POLICY storage_property_backdrops_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'property-backdrops'
    AND (
      public.auth_is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.auth_person_including_inactive() ip
        WHERE split_part(name, '/', 1) = ip.property_id::TEXT
      )
    )
  );

CREATE POLICY storage_property_backdrops_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'property-backdrops'
    AND (
      public.auth_is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.auth_active_person() ap
        WHERE ap.role = 'property_admin'
          AND split_part(name, '/', 1) = ap.property_id::TEXT
      )
    )
  );

CREATE POLICY storage_qr_templates_super ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'qr-templates' AND public.auth_is_super_admin())
  WITH CHECK (bucket_id = 'qr-templates' AND public.auth_is_super_admin());

CREATE POLICY storage_qr_exports_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'qr-exports'
    AND (
      public.auth_is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.auth_active_person() ap
        WHERE split_part(name, '/', 1) = ap.property_id::TEXT
          AND (ap.role = 'property_admin' OR split_part(name, '/', 2) = ap.id::TEXT)
      )
    )
  );

CREATE POLICY storage_assignment_sheets_policy ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'assignment-sheets'
    AND (
      public.auth_is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.auth_active_person() ap
        WHERE split_part(name, '/', 1) = ap.property_id::TEXT
          AND ap.role IN ('property_admin', 'dept_manager')
      )
    )
  )
  WITH CHECK (
    bucket_id = 'assignment-sheets'
    AND (
      public.auth_is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.auth_active_person() ap
        WHERE split_part(name, '/', 1) = ap.property_id::TEXT
          AND ap.role IN ('property_admin', 'dept_manager')
      )
    )
  );

CREATE POLICY storage_signed_agreements_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'signed-agreements'
    AND (
      public.auth_is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.auth_active_person() ap
        WHERE split_part(name, '/', 1) = ap.property_id::TEXT
          AND (
            ap.role = 'property_admin'
            OR name LIKE (ap.property_id::TEXT || '/staff_' || ap.id::TEXT || '_%')
          )
      )
    )
  );

-- 7. Step 1 SECURITY DEFINER RPCs

-- Admin Property Details (hides billing fields from staff/dept_manager)
CREATE OR REPLACE FUNCTION public.get_admin_property_details(p_property_id UUID)
RETURNS public.properties
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row public.properties;
  v_ap RECORD;
BEGIN
  IF public.auth_is_super_admin() THEN
    SELECT * INTO v_row FROM public.properties WHERE id = p_property_id;
    RETURN v_row;
  END IF;

  SELECT * INTO v_ap FROM public.auth_active_person();
  IF v_ap.id IS NULL OR v_ap.role <> 'property_admin' OR v_ap.property_id <> p_property_id THEN
    RAISE EXCEPTION 'FORBIDDEN_PROPERTY_ACCESS' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.properties WHERE id = p_property_id;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_property_details(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_property_details(UUID) TO authenticated;

-- Staff/Dept Creation RPC (enforces FT-15, leaves auth_user_id=NULL, blocks property_admin escalation)
CREATE OR REPLACE FUNCTION public.create_person_record(
  p_property_id UUID,
  p_name TEXT,
  p_email TEXT,
  p_role TEXT,
  p_department_id UUID,
  p_photo_path TEXT DEFAULT NULL
)
RETURNS public.people
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_is_super BOOLEAN;
  v_ap RECORD;
  v_ft15_enabled BOOLEAN;
  v_row public.people;
BEGIN
  v_is_super := public.auth_is_super_admin();
  IF NOT v_is_super THEN
    SELECT * INTO v_ap FROM public.auth_active_person();
    IF v_ap.id IS NULL OR v_ap.role <> 'property_admin' OR v_ap.property_id <> p_property_id THEN
      RAISE EXCEPTION 'CROSS_PROPERTY_OR_ROLE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_role NOT IN ('staff', 'dept_manager') THEN
      RAISE EXCEPTION 'PROPERTY_ADMIN_ESCALATION_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_role = 'dept_manager' THEN
    SELECT enabled INTO v_ft15_enabled
    FROM public.property_features
    WHERE property_id = p_property_id AND feature_key = 'department_manager_role';
    IF NOT COALESCE(v_ft15_enabled, false) THEN
      RAISE EXCEPTION 'FEATURE_DISABLED: department_manager_role' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.people (
    property_id, auth_user_id, name, email, role, department_id, photo_path, status
  ) VALUES (
    p_property_id, NULL, btrim(p_name), lower(btrim(p_email)), p_role, p_department_id, p_photo_path, 'active'
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_person_record(UUID, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_person_record(UUID, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;

-- Staff/Dept Update RPC (locks wallet_balance_cents, auth_user_id, stripe_connect_account_id, agreement_signed_at, email post-claim)
CREATE OR REPLACE FUNCTION public.update_person_record(
  p_person_id UUID,
  p_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_role TEXT DEFAULT NULL,
  p_department_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_photo_path TEXT DEFAULT NULL
)
RETURNS public.people
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_is_super BOOLEAN;
  v_ap RECORD;
  v_existing public.people;
  v_ft15_enabled BOOLEAN;
  v_next_role TEXT;
  v_row public.people;
BEGIN
  SELECT * INTO v_existing FROM public.people WHERE id = p_person_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PERSON_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_is_super := public.auth_is_super_admin();
  IF NOT v_is_super THEN
    SELECT * INTO v_ap FROM public.auth_active_person();
    IF v_ap.id IS NULL OR v_ap.role <> 'property_admin' OR v_ap.property_id <> v_existing.property_id THEN
      RAISE EXCEPTION 'CROSS_PROPERTY_OR_ROLE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_role IS NOT NULL AND p_role NOT IN ('staff', 'dept_manager') THEN
      RAISE EXCEPTION 'PROPERTY_ADMIN_ESCALATION_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_next_role := COALESCE(p_role, v_existing.role);
  IF v_next_role = 'dept_manager' THEN
    SELECT enabled INTO v_ft15_enabled
    FROM public.property_features
    WHERE property_id = v_existing.property_id AND feature_key = 'department_manager_role';
    IF NOT COALESCE(v_ft15_enabled, false) THEN
      RAISE EXCEPTION 'FEATURE_DISABLED: department_manager_role' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_email IS NOT NULL AND lower(btrim(p_email)) <> lower(v_existing.email) AND v_existing.auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIMED_EMAIL_LOCKED' USING ERRCODE = '42501';
  END IF;

  UPDATE public.people
  SET
    name = COALESCE(NULLIF(btrim(p_name), ''), name),
    email = COALESCE(NULLIF(lower(btrim(p_email)), ''), email),
    role = v_next_role,
    department_id = COALESCE(p_department_id, department_id),
    status = COALESCE(p_status, status),
    photo_path = COALESCE(p_photo_path, photo_path)
  WHERE id = p_person_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_person_record(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_person_record(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT) TO authenticated;

-- AC-8 Atomic Department Delete with Forced Reassignment
CREATE OR REPLACE FUNCTION public.delete_department_with_reassign(
  p_department_id UUID,
  p_reassign_to_department_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_dept public.departments;
  v_ap RECORD;
  v_people_count INT;
  v_moved_count INT := 0;
BEGIN
  SELECT * INTO v_dept FROM public.departments WHERE id = p_department_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPARTMENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.auth_is_super_admin() THEN
    SELECT * INTO v_ap FROM public.auth_active_person();
    IF v_ap.id IS NULL OR v_ap.role <> 'property_admin' OR v_ap.property_id <> v_dept.property_id THEN
      RAISE EXCEPTION 'CROSS_PROPERTY_OR_ROLE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT COUNT(*)::INT INTO v_people_count
  FROM public.people
  WHERE property_id = v_dept.property_id
    AND department_id = p_department_id;

  IF v_people_count > 0 THEN
    IF p_reassign_to_department_id IS NULL THEN
      RAISE EXCEPTION 'REASSIGN_TARGET_REQUIRED' USING ERRCODE = '23503';
    END IF;
    IF p_reassign_to_department_id = p_department_id THEN
      RAISE EXCEPTION 'REASSIGN_TARGET_CANNOT_EQUAL_SOURCE' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.departments
      WHERE id = p_reassign_to_department_id
        AND property_id = v_dept.property_id
    ) THEN
      RAISE EXCEPTION 'REASSIGN_TARGET_WRONG_PROPERTY' USING ERRCODE = '42501';
    END IF;

    UPDATE public.people
    SET department_id = p_reassign_to_department_id
    WHERE property_id = v_dept.property_id
      AND department_id = p_department_id;
    GET DIAGNOSTICS v_moved_count = ROW_COUNT;
  END IF;

  DELETE FROM public.departments WHERE id = p_department_id;

  RETURN jsonb_build_object(
    'deletedDepartmentId', p_department_id,
    'reassignedPeopleCount', v_moved_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_department_with_reassign(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_department_with_reassign(UUID, UUID) TO authenticated;

-- Unauthenticated Guest Projection RPC (strictly minimized; role='staff' only; excludes emails/balances/dept_manager)
CREATE OR REPLACE FUNCTION public.get_public_tip_target(
  p_type TEXT,
  p_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prop public.properties;
  v_room public.rooms;
  v_dept public.departments;
  v_person public.people;
  v_local_date DATE;
  v_toggles JSONB;
  v_assigned JSONB := NULL;
  v_assigned_id UUID := NULL;
  v_depts JSONB := '[]'::JSONB;
  v_ft3 BOOLEAN;
  v_ft4 BOOLEAN;
  v_ft5 BOOLEAN;
  v_ft6 BOOLEAN;
  v_ft7 BOOLEAN;
  v_ft8 BOOLEAN;
BEGIN
  IF p_type NOT IN ('room', 'dept', 'person') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TARGET_NOT_FOUND');
  END IF;

  IF p_type = 'room' THEN
    SELECT * INTO v_room FROM public.rooms WHERE id = p_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'TARGET_NOT_FOUND');
    END IF;
    SELECT * INTO v_prop FROM public.properties WHERE id = v_room.property_id;
  ELSIF p_type = 'dept' THEN
    SELECT * INTO v_dept FROM public.departments WHERE id = p_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'TARGET_NOT_FOUND');
    END IF;
    SELECT * INTO v_prop FROM public.properties WHERE id = v_dept.property_id;
  ELSE
    SELECT * INTO v_person FROM public.people WHERE id = p_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'TARGET_NOT_FOUND');
    END IF;
    SELECT * INTO v_prop FROM public.properties WHERE id = v_person.property_id;
  END IF;

  IF v_prop.status IN ('restricted', 'cancelled', 'pending') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'PROPERTY_RESTRICTED',
      'status', v_prop.status,
      'propertyName', v_prop.name
    );
  END IF;

  SELECT jsonb_object_agg(feature_key, enabled)
  INTO v_toggles
  FROM public.property_features
  WHERE property_id = v_prop.id
    AND feature_key IN (
      'guest_notes', 'email_receipts', 'tip_specific_housekeeper',
      'department_pool_tips', 'tip_specific_person_in_dept',
      'department_qr_codes', 'personal_staff_qr_codes',
      'room_qr_codes', 'guest_paid_fee_option'
    );

  v_ft3 := COALESCE((v_toggles->>'tip_specific_housekeeper')::BOOLEAN, true);
  v_ft4 := COALESCE((v_toggles->>'department_pool_tips')::BOOLEAN, true);
  v_ft5 := COALESCE((v_toggles->>'tip_specific_person_in_dept')::BOOLEAN, true);
  v_ft6 := COALESCE((v_toggles->>'department_qr_codes')::BOOLEAN, true);
  v_ft7 := COALESCE((v_toggles->>'personal_staff_qr_codes')::BOOLEAN, true);
  v_ft8 := COALESCE((v_toggles->>'room_qr_codes')::BOOLEAN, true);

  IF (p_type = 'room' AND NOT v_ft8)
     OR (p_type = 'dept' AND NOT v_ft6)
     OR (p_type = 'person' AND NOT v_ft7) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FEATURE_DISABLED', 'propertyName', v_prop.name);
  END IF;

  IF p_type = 'person' THEN
    IF v_person.status = 'inactive' THEN
      IF v_ft4 AND v_person.department_id IS NOT NULL THEN
        SELECT * INTO v_dept FROM public.departments WHERE id = v_person.department_id;
        RETURN jsonb_build_object(
          'ok', true,
          'mode', 'person_fallback_pool',
          'propertyId', v_prop.id,
          'propertyName', v_prop.name,
          'heroPhotoPath', v_prop.hero_photo_path,
          'accentColorHex', v_prop.accent_color_hex,
          'tipBounds', jsonb_build_object(
            'minCents', CASE WHEN v_prop.payment_fee_paid_by = 'guest' THEN v_prop.tip_min_cents ELSE GREATEST(v_prop.tip_min_cents, 200) END,
            'maxCents', v_prop.tip_max_cents,
            'presetsCents', v_prop.tip_presets_cents
          ),
          'guestFeePolicy', v_prop.payment_fee_paid_by,
          'enabledToggles', v_toggles,
          'fallbackPool', jsonb_build_object(
            'departmentId', v_dept.id,
            'departmentName', v_dept.name
          )
        );
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'RECIPIENT_UNAVAILABLE', 'propertyName', v_prop.name);
    END IF;

    IF v_person.role <> 'staff' OR v_person.agreement_signed_at IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'RECIPIENT_UNAVAILABLE', 'propertyName', v_prop.name);
    END IF;

    SELECT * INTO v_dept FROM public.departments WHERE id = v_person.department_id;
    RETURN jsonb_build_object(
      'ok', true,
      'mode', 'person',
      'propertyId', v_prop.id,
      'propertyName', v_prop.name,
      'heroPhotoPath', v_prop.hero_photo_path,
      'accentColorHex', v_prop.accent_color_hex,
      'tipBounds', jsonb_build_object(
        'minCents', CASE WHEN v_prop.payment_fee_paid_by = 'guest' THEN v_prop.tip_min_cents ELSE GREATEST(v_prop.tip_min_cents, 200) END,
        'maxCents', v_prop.tip_max_cents,
        'presetsCents', v_prop.tip_presets_cents
      ),
      'guestFeePolicy', v_prop.payment_fee_paid_by,
      'enabledToggles', v_toggles,
      'targetPerson', jsonb_build_object(
        'personId', v_person.id,
        'displayName', v_person.name,
        'photoPath', v_person.photo_path,
        'departmentId', v_dept.id,
        'departmentName', v_dept.name
      )
    );
  END IF;

  v_local_date := (now() AT TIME ZONE v_prop.timezone)::DATE;

  IF p_type = 'room' AND v_ft3 THEN
    SELECT p.id, jsonb_build_object(
      'personId', p.id,
      'displayName', p.name,
      'photoPath', p.photo_path,
      'departmentId', p.department_id
    )
    INTO v_assigned_id, v_assigned
    FROM public.assignments a
    JOIN public.people p
      ON p.property_id = a.property_id AND p.id = a.person_id
    WHERE a.property_id = v_prop.id
      AND a.assignment_date = v_local_date
      AND a.room_number = v_room.room_number
      AND p.status = 'active'
      AND p.agreement_signed_at IS NOT NULL
      AND p.role = 'staff'
    LIMIT 1;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'departmentId', d.id,
      'name', d.name,
      'isHousekeeping', d.is_housekeeping,
      'poolEnabled', v_ft4,
      'staff', CASE
        WHEN v_ft5 OR (d.is_housekeeping AND v_assigned_id IS NULL) THEN (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'personId', p.id,
              'displayName', p.name,
              'photoPath', p.photo_path
            )
            ORDER BY p.name
          ), '[]'::JSONB)
          FROM public.people p
          WHERE p.property_id = v_prop.id
            AND p.department_id = d.id
            AND p.status = 'active'
            AND p.agreement_signed_at IS NOT NULL
            AND p.role = 'staff'
        )
        ELSE '[]'::JSONB
      END
    )
    ORDER BY d.is_housekeeping DESC, d.name ASC
  ), '[]'::JSONB)
  INTO v_depts
  FROM public.departments d
  WHERE d.property_id = v_prop.id
    AND (p_type <> 'dept' OR d.id = v_dept.id);

  RETURN jsonb_build_object(
    'ok', true,
    'mode', p_type,
    'propertyId', v_prop.id,
    'propertyName', v_prop.name,
    'heroPhotoPath', v_prop.hero_photo_path,
    'accentColorHex', v_prop.accent_color_hex,
    'tipBounds', jsonb_build_object(
      'minCents', CASE WHEN v_prop.payment_fee_paid_by = 'guest' THEN v_prop.tip_min_cents ELSE GREATEST(v_prop.tip_min_cents, 200) END,
      'maxCents', v_prop.tip_max_cents,
      'presetsCents', v_prop.tip_presets_cents
    ),
    'guestFeePolicy', v_prop.payment_fee_paid_by,
    'enabledToggles', v_toggles,
    'room', CASE WHEN p_type = 'room' THEN jsonb_build_object('roomId', v_room.id, 'roomNumber', v_room.room_number) ELSE NULL END,
    'assignedHousekeeper', v_assigned,
    'departments', v_depts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_tip_target(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tip_target(TEXT, UUID) TO anon, authenticated;
