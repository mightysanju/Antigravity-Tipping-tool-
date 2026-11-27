-- Step 3: Departments, People Directory, Salted/Keyed Email OTP, Trusted Devices & Join QR

-- 1. Admin Departments & People Queries
CREATE OR REPLACE FUNCTION public.list_admin_departments(p_property_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_ap RECORD;
  v_rows JSONB;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    SELECT * INTO v_ap FROM public.auth_active_person();
    IF v_ap.id IS NULL OR v_ap.role <> 'property_admin' OR v_ap.property_id <> p_property_id THEN
      RAISE EXCEPTION 'CROSS_PROPERTY_OR_ROLE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'propertyId', d.property_id,
      'name', d.name,
      'isHousekeeping', d.is_housekeeping,
      'defaultDistribution', d.default_distribution,
      'peopleCount', (
        SELECT COUNT(*)::INT FROM public.people pe
        WHERE pe.property_id = d.property_id AND pe.department_id = d.id
      ),
      'createdAt', d.created_at
    )
    ORDER BY d.is_housekeeping DESC, d.name ASC
  ), '[]'::JSONB)
  INTO v_rows
  FROM public.departments d
  WHERE d.property_id = p_property_id;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.list_admin_departments(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_admin_departments(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_admin_department(
  p_property_id UUID,
  p_department_id UUID,
  p_name TEXT,
  p_is_housekeeping BOOLEAN,
  p_default_distribution TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_ap RECORD;
  v_row public.departments;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    SELECT * INTO v_ap FROM public.auth_active_person();
    IF v_ap.id IS NULL OR v_ap.role <> 'property_admin' OR v_ap.property_id <> p_property_id THEN
      RAISE EXCEPTION 'CROSS_PROPERTY_OR_ROLE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_department_id IS NULL THEN
    INSERT INTO public.departments (property_id, name, is_housekeeping, default_distribution)
    VALUES (p_property_id, btrim(p_name), COALESCE(p_is_housekeeping, false), COALESCE(NULLIF(p_default_distribution, ''), 'split'))
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.departments
    SET
      name = COALESCE(NULLIF(btrim(p_name), ''), name),
      is_housekeeping = COALESCE(p_is_housekeeping, is_housekeeping),
      default_distribution = COALESCE(NULLIF(p_default_distribution, ''), default_distribution)
    WHERE id = p_department_id AND property_id = p_property_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DEPARTMENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_admin_department(UUID, UUID, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_admin_department(UUID, UUID, TEXT, BOOLEAN, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_admin_people(p_property_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_ap RECORD;
  v_rows JSONB;
  v_toggles JSONB;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    SELECT * INTO v_ap FROM public.auth_active_person();
    IF v_ap.id IS NULL OR v_ap.role <> 'property_admin' OR v_ap.property_id <> p_property_id THEN
      RAISE EXCEPTION 'CROSS_PROPERTY_OR_ROLE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', pe.id,
      'propertyId', pe.property_id,
      'name', pe.name,
      'email', pe.email,
      'role', pe.role,
      'departmentId', pe.department_id,
      'departmentName', d.name,
      'photoPath', pe.photo_path,
      'status', pe.status,
      'authLinked', (pe.auth_user_id IS NOT NULL),
      'agreementSignedAt', pe.agreement_signed_at,
      'createdAt', pe.created_at
    )
    ORDER BY pe.status ASC, pe.name ASC
  ), '[]'::JSONB)
  INTO v_rows
  FROM public.people pe
  LEFT JOIN public.departments d ON d.id = pe.department_id
  WHERE pe.property_id = p_property_id;

  SELECT COALESCE(jsonb_object_agg(feature_key, enabled), '{}'::JSONB)
  INTO v_toggles
  FROM public.property_features
  WHERE property_id = p_property_id
    AND feature_key IN ('department_manager_role', 'join_qr', 'email_invites');

  RETURN jsonb_build_object('people', v_rows, 'toggles', v_toggles);
END;
$$;

REVOKE ALL ON FUNCTION public.list_admin_people(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_admin_people(UUID) TO authenticated;

-- 2. Rate-Limited Email OTP Creation & Atomic FOR UPDATE Verification
CREATE OR REPLACE FUNCTION public.create_hashed_otp_with_rate_limit(
  p_email TEXT,
  p_purpose TEXT,
  p_client_ip INET,
  p_hashed_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_email TEXT;
  v_email_bucket TEXT;
  v_ip_bucket TEXT;
  v_email_row public.otp_rate_limits;
  v_ip_row public.otp_rate_limits;
  v_otp public.otp_codes;
BEGIN
  IF p_purpose NOT IN ('login', 'new_device', 'withdrawal', 'join_qr') THEN
    RAISE EXCEPTION 'INVALID_OTP_PURPOSE' USING ERRCODE = '22023';
  END IF;

  v_norm_email := lower(btrim(p_email));
  v_email_bucket := 'otp:email:' || encode(sha256(v_norm_email::bytea), 'hex') || ':' || p_purpose;
  v_ip_bucket := 'otp:ip:' || COALESCE(host(p_client_ip), '127.0.0.1');

  -- Email + Purpose bucket: max 3 sends / 10 minutes
  SELECT * INTO v_email_row
  FROM public.otp_rate_limits
  WHERE bucket_key = v_email_bucket
  FOR UPDATE;

  IF NOT FOUND OR v_email_row.window_started_at < now() - interval '10 minutes' THEN
    INSERT INTO public.otp_rate_limits (bucket_key, request_count, window_started_at)
    VALUES (v_email_bucket, 1, now())
    ON CONFLICT (bucket_key) DO UPDATE SET request_count = 1, window_started_at = now();
  ELSIF v_email_row.request_count >= 3 THEN
    RAISE EXCEPTION 'RATE_LIMITED_EMAIL: Too many OTP requests for this email' USING ERRCODE = 'P0001';
  ELSE
    UPDATE public.otp_rate_limits SET request_count = request_count + 1 WHERE bucket_key = v_email_bucket;
  END IF;

  -- IP bucket: max 10 sends / 1 hour
  SELECT * INTO v_ip_row
  FROM public.otp_rate_limits
  WHERE bucket_key = v_ip_bucket
  FOR UPDATE;

  IF NOT FOUND OR v_ip_row.window_started_at < now() - interval '1 hour' THEN
    INSERT INTO public.otp_rate_limits (bucket_key, request_count, window_started_at)
    VALUES (v_ip_bucket, 1, now())
    ON CONFLICT (bucket_key) DO UPDATE SET request_count = 1, window_started_at = now();
  ELSIF v_ip_row.request_count >= 10 THEN
    RAISE EXCEPTION 'RATE_LIMITED_IP: Too many OTP requests from this IP' USING ERRCODE = 'P0001';
  ELSE
    UPDATE public.otp_rate_limits SET request_count = request_count + 1 WHERE bucket_key = v_ip_bucket;
  END IF;

  -- Invalidate prior unconsumed OTPs for (email, purpose)
  UPDATE public.otp_codes
  SET consumed_at = now()
  WHERE lower(email) = v_norm_email
    AND purpose = p_purpose
    AND consumed_at IS NULL;

  INSERT INTO public.otp_codes (email, hashed_code, purpose, attempts, expires_at)
  VALUES (v_norm_email, p_hashed_code, p_purpose, 0, now() + interval '10 minutes')
  RETURNING * INTO v_otp;

  RETURN jsonb_build_object(
    'otpId', v_otp.id,
    'expiresAt', v_otp.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_hashed_otp_with_rate_limit(TEXT, TEXT, INET, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.verify_hashed_otp_and_trust_device(
  p_email TEXT,
  p_purpose TEXT,
  p_submitted_hash TEXT,
  p_trust_device BOOLEAN DEFAULT false,
  p_auth_user_id UUID DEFAULT NULL,
  p_device_token_hash TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_ip INET DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_email TEXT;
  v_otp public.otp_codes;
BEGIN
  v_norm_email := lower(btrim(p_email));

  SELECT * INTO v_otp
  FROM public.otp_codes
  WHERE lower(email) = v_norm_email
    AND purpose = p_purpose
    AND consumed_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('verified', false, 'reason', 'OTP_NOT_FOUND');
  END IF;

  IF v_otp.expires_at <= now() THEN
    UPDATE public.otp_codes SET consumed_at = now() WHERE id = v_otp.id;
    RETURN jsonb_build_object('verified', false, 'reason', 'OTP_EXPIRED');
  END IF;

  IF v_otp.attempts >= 5 THEN
    UPDATE public.otp_codes SET consumed_at = now() WHERE id = v_otp.id;
    RETURN jsonb_build_object('verified', false, 'reason', 'OTP_MAX_ATTEMPTS');
  END IF;

  IF v_otp.hashed_code <> p_submitted_hash THEN
    UPDATE public.otp_codes
    SET
      attempts = attempts + 1,
      consumed_at = CASE WHEN attempts + 1 >= 5 THEN now() ELSE NULL END
    WHERE id = v_otp.id;
    RETURN jsonb_build_object(
      'verified', false,
      'reason', CASE WHEN v_otp.attempts + 1 >= 5 THEN 'OTP_MAX_ATTEMPTS' ELSE 'OTP_INVALID' END,
      'attemptsRemaining', GREATEST(0, 5 - (v_otp.attempts + 1))
    );
  END IF;

  UPDATE public.otp_codes SET consumed_at = now() WHERE id = v_otp.id;

  IF p_trust_device AND p_auth_user_id IS NOT NULL AND p_device_token_hash IS NOT NULL THEN
    INSERT INTO public.trusted_devices (
      auth_user_id, device_token_hash, user_agent, last_ip, expires_at
    ) VALUES (
      p_auth_user_id,
      p_device_token_hash,
      p_user_agent,
      COALESCE(p_ip, '127.0.0.1'::INET),
      now() + interval '30 days'
    )
    ON CONFLICT (device_token_hash)
    DO UPDATE SET
      last_seen_at = now(),
      expires_at = now() + interval '30 days',
      revoked = false;
  END IF;

  RETURN jsonb_build_object('verified', true);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_hashed_otp_and_trust_device(TEXT, TEXT, TEXT, BOOLEAN, UUID, TEXT, TEXT, INET) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.check_trusted_device(
  p_auth_user_id UUID,
  p_device_token_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_auth_user_id IS NULL OR NULLIF(p_device_token_hash, '') IS NULL THEN
    RETURN false;
  END IF;

  SELECT id INTO v_id
  FROM public.trusted_devices
  WHERE auth_user_id = p_auth_user_id
    AND device_token_hash = p_device_token_hash
    AND revoked = false
    AND expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.trusted_devices SET last_seen_at = now() WHERE id = v_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.check_trusted_device(UUID, TEXT) FROM PUBLIC;

-- 3. Join QR Unclaimed Staff Directory & Onboarding Claim RPCs (FT-23)
CREATE OR REPLACE FUNCTION public.list_joinable_staff(p_property_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prop public.properties;
  v_ft23 BOOLEAN;
  v_staff JSONB;
BEGIN
  SELECT * INTO v_prop FROM public.properties WHERE id = p_property_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PROPERTY_NOT_FOUND');
  END IF;

  IF v_prop.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PROPERTY_RESTRICTED', 'propertyName', v_prop.name);
  END IF;

  SELECT enabled INTO v_ft23
  FROM public.property_features
  WHERE property_id = p_property_id AND feature_key = 'join_qr';

  IF NOT COALESCE(v_ft23, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FEATURE_DISABLED', 'propertyName', v_prop.name);
  END IF;

  -- Strictly unclaimed active frontline staff ONLY; zero emails exposed
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'personId', pe.id,
      'displayName', pe.name,
      'departmentName', d.name
    )
    ORDER BY d.name ASC, pe.name ASC
  ), '[]'::JSONB)
  INTO v_staff
  FROM public.people pe
  LEFT JOIN public.departments d ON d.id = pe.department_id
  WHERE pe.property_id = p_property_id
    AND pe.status = 'active'
    AND pe.auth_user_id IS NULL
    AND pe.role = 'staff';

  RETURN jsonb_build_object(
    'ok', true,
    'propertyId', v_prop.id,
    'propertyName', v_prop.name,
    'staff', v_staff
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_joinable_staff(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_joinable_staff(UUID) TO anon, authenticated;

-- Server-only lookup for Join QR OTP dispatch (never granted to anon/authenticated)
CREATE OR REPLACE FUNCTION public.get_joinable_staff_server_record(
  p_property_id UUID,
  p_person_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prop public.properties;
  v_pe public.people;
  v_ft23 BOOLEAN;
BEGIN
  SELECT * INTO v_prop FROM public.properties WHERE id = p_property_id;
  IF NOT FOUND OR v_prop.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PROPERTY_UNAVAILABLE');
  END IF;

  SELECT enabled INTO v_ft23
  FROM public.property_features
  WHERE property_id = p_property_id AND feature_key = 'join_qr';
  IF NOT COALESCE(v_ft23, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FEATURE_DISABLED');
  END IF;

  SELECT * INTO v_pe
  FROM public.people
  WHERE id = p_person_id AND property_id = p_property_id;

  IF NOT FOUND OR v_pe.status <> 'active' OR v_pe.role <> 'staff' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PERSON_UNAVAILABLE');
  END IF;

  IF v_pe.auth_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_ONBOARDED');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'personId', v_pe.id,
    'name', v_pe.name,
    'email', v_pe.email,
    'propertyName', v_prop.name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_joinable_staff_server_record(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.complete_join_by_qr(
  p_property_id UUID,
  p_person_id UUID,
  p_auth_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_pe public.people;
BEGIN
  SELECT * INTO v_pe
  FROM public.people
  WHERE id = p_person_id AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND OR v_pe.status <> 'active' OR v_pe.role <> 'staff' THEN
    RAISE EXCEPTION 'PERSON_UNAVAILABLE' USING ERRCODE = 'P0002';
  END IF;

  IF v_pe.auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_ONBOARDED' USING ERRCODE = '23505';
  END IF;

  UPDATE public.people
  SET auth_user_id = p_auth_user_id
  WHERE id = p_person_id
  RETURNING * INTO v_pe;

  INSERT INTO public.audit_logs (
    property_id, actor_user_id, actor_role, action, target_type, target_id
  ) VALUES (
    p_property_id, p_auth_user_id, 'staff', 'join_qr_completed', 'person', p_person_id::TEXT
  );

  RETURN to_jsonb(v_pe);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_join_by_qr(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

-- 4. Login Account Context (First-Login Agreement Gate Check)
CREATE OR REPLACE FUNCTION public.get_login_account_context()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID;
  v_pe public.people;
  v_prop public.properties;
  v_prop_signed BOOLEAN;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('authenticated', false);
  END IF;

  IF EXISTS (SELECT 1 FROM public.super_admins WHERE auth_user_id = v_uid) THEN
    RETURN jsonb_build_object(
      'authenticated', true,
      'role', 'super_admin',
      'needsPropertyAgreement', false,
      'needsStaffAgreement', false
    );
  END IF;

  SELECT * INTO v_pe FROM public.people WHERE auth_user_id = v_uid LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('authenticated', false);
  END IF;

  SELECT * INTO v_prop FROM public.properties WHERE id = v_pe.property_id;
  SELECT EXISTS (
    SELECT 1 FROM public.agreements
    WHERE property_id = v_prop.id AND signer_type = 'property' AND checkbox_confirmed = true
  ) INTO v_prop_signed;

  RETURN jsonb_build_object(
    'authenticated', true,
    'role', v_pe.role,
    'personId', v_pe.id,
    'personName', v_pe.name,
    'personStatus', v_pe.status,
    'propertyId', v_prop.id,
    'propertyName', v_prop.name,
    'propertyStatus', v_prop.status,
    'contractTermMonths', v_prop.contract_term_months,
    'noticeDays', v_prop.notice_days,
    'needsPropertyAgreement', (v_pe.role = 'property_admin' AND v_prop.status = 'pending' AND NOT v_prop_signed),
    'needsStaffAgreement', (v_pe.role IN ('staff', 'dept_manager') AND v_pe.agreement_signed_at IS NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_login_account_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_login_account_context() TO authenticated;

-- 5. JSONB Wrappers for People Creation & Update (with FT-24 Email Invite Flag)
CREATE OR REPLACE FUNCTION public.create_admin_person(
  p_property_id UUID,
  p_name TEXT,
  p_email TEXT,
  p_role TEXT,
  p_department_id UUID,
  p_photo_path TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_person public.people;
  v_prop_name TEXT;
  v_invite_enabled BOOLEAN;
BEGIN
  v_person := public.create_person_record(
    p_property_id, p_name, p_email, p_role, p_department_id, p_photo_path
  );

  SELECT name INTO v_prop_name FROM public.properties WHERE id = p_property_id;
  SELECT enabled INTO v_invite_enabled
  FROM public.property_features
  WHERE property_id = p_property_id AND feature_key = 'email_invites';

  RETURN jsonb_build_object(
    'person', to_jsonb(v_person),
    'propertyName', v_prop_name,
    'emailInviteEnabled', COALESCE(v_invite_enabled, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_admin_person(UUID, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_admin_person(UUID, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_admin_person(
  p_person_id UUID,
  p_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_role TEXT DEFAULT NULL,
  p_department_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_photo_path TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_person public.people;
BEGIN
  v_person := public.update_person_record(
    p_person_id, p_name, p_email, p_role, p_department_id, p_status, p_photo_path
  );
  RETURN to_jsonb(v_person);
END;
$$;

REVOKE ALL ON FUNCTION public.update_admin_person(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_admin_person(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT) TO authenticated;

