-- Steps 9 & 10: Property Billing Sync, External API Gateway & Single Sign-On (SSO)

-- 1. Step 9: Property Billing & Non-Payment Restrictions
CREATE OR REPLACE FUNCTION public.sync_property_billing_webhook(
  p_event_id TEXT,
  p_event_type TEXT,
  p_stripe_customer_id TEXT,
  p_stripe_subscription_id TEXT DEFAULT NULL,
  p_subscription_status TEXT DEFAULT NULL,
  p_invoice_id TEXT DEFAULT NULL,
  p_amount_cents BIGINT DEFAULT NULL,
  p_invoice_status TEXT DEFAULT NULL,
  p_period_start TIMESTAMPTZ DEFAULT NULL,
  p_period_end TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_event TEXT;
  v_prop public.properties;
  v_new_status TEXT;
  v_sub_status TEXT;
BEGIN
  INSERT INTO public.stripe_events (event_id, event_type)
  VALUES (p_event_id, p_event_type)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO v_inserted_event;

  IF v_inserted_event IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'deduplicated', true);
  END IF;

  SELECT * INTO v_prop
  FROM public.properties
  WHERE (p_stripe_subscription_id IS NOT NULL AND stripe_subscription_id = p_stripe_subscription_id)
     OR (p_stripe_customer_id IS NOT NULL AND stripe_customer_id = p_stripe_customer_id)
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'ignored', true, 'reason', 'PROPERTY_NOT_FOUND');
  END IF;

  IF p_invoice_id IS NOT NULL AND p_amount_cents IS NOT NULL THEN
    INSERT INTO public.invoices (
      property_id, stripe_invoice_id, amount_cents, status, period_start, period_end, paid_at
    )
    VALUES (
      v_prop.id, p_invoice_id, p_amount_cents, COALESCE(p_invoice_status, 'open'),
      p_period_start, p_period_end,
      CASE WHEN p_invoice_status = 'paid' THEN now() ELSE NULL END
    )
    ON CONFLICT (stripe_invoice_id) DO UPDATE
    SET status = EXCLUDED.status,
        paid_at = COALESCE(EXCLUDED.paid_at, public.invoices.paid_at);
  END IF;

  v_sub_status := COALESCE(p_subscription_status, v_prop.stripe_subscription_status);
  v_new_status := v_prop.status;

  IF p_event_type = 'customer.subscription.deleted' OR v_sub_status = 'canceled' THEN
    v_new_status := 'cancelled';
    v_sub_status := 'canceled';
  ELSIF p_event_type = 'invoice.paid' THEN
    IF v_prop.status = 'restricted' THEN
      v_new_status := 'active';
    END IF;
    v_sub_status := 'active';
  ELSIF p_event_type = 'invoice.payment_failed' OR v_sub_status IN ('past_due', 'unpaid') THEN
    IF v_prop.status = 'active' THEN
      v_new_status := 'restricted';
    END IF;
    v_sub_status := COALESCE(p_subscription_status, 'past_due');
  ELSIF v_sub_status = 'active' THEN
    IF v_prop.status = 'restricted' THEN
      v_new_status := 'active';
    END IF;
    v_sub_status := 'active';
  END IF;

  UPDATE public.properties
  SET status = v_new_status,
      stripe_subscription_status = v_sub_status
  WHERE id = v_prop.id;

  IF v_new_status IS DISTINCT FROM v_prop.status THEN
    INSERT INTO public.audit_logs (
      property_id, actor_role, action, target_type, target_id, metadata
    )
    VALUES (
      v_prop.id, 'system', 'BILLING_STATUS_CHANGED', 'property', v_prop.id::TEXT,
      jsonb_build_object('from', v_prop.status, 'to', v_new_status, 'eventType', p_event_type)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'propertyId', v_prop.id,
    'previousStatus', v_prop.status,
    'status', v_new_status,
    'stripeSubscriptionStatus', v_sub_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_property_billing_webhook(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- 2. Step 10: Super Admin Integrations Management
CREATE OR REPLACE FUNCTION public.get_super_integrations(p_property_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_prop public.properties;
  v_toggles JSONB;
  v_keys JSONB;
  v_sso JSONB := NULL;
  v_provider public.sso_providers;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prop FROM public.properties WHERE id = p_property_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROPERTY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_object_agg(f.feature_key, f.enabled), '{}'::JSONB)
  INTO v_toggles
  FROM public.property_features f
  WHERE f.property_id = p_property_id
    AND f.feature_key IN ('external_api', 'single_sign_on', 'api_assignment_push');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', k.id,
    'label', k.label,
    'keyPrefix', k.key_prefix,
    'scopes', k.scopes,
    'revoked', k.revoked,
    'revokedAt', k.revoked_at,
    'lastUsedAt', k.last_used_at,
    'createdAt', k.created_at
  ) ORDER BY k.created_at DESC), '[]'::JSONB)
  INTO v_keys
  FROM public.api_keys k
  WHERE k.property_id = p_property_id;

  SELECT * INTO v_provider FROM public.sso_providers WHERE property_id = p_property_id;
  IF FOUND THEN
    v_sso := jsonb_build_object(
      'id', v_provider.id,
      'clientId', v_provider.client_id,
      'authMode', v_provider.auth_mode,
      'hasClientSecret', v_provider.hashed_client_secret IS NOT NULL,
      'publicKeyPem', v_provider.public_key_pem,
      'jwksUrl', v_provider.jwks_url,
      'allowedOrigins', v_provider.allowed_origins,
      'enabled', v_provider.enabled
    );
  END IF;

  RETURN jsonb_build_object(
    'propertyId', v_prop.id,
    'propertyName', v_prop.name,
    'propertyStatus', v_prop.status,
    'toggles', v_toggles,
    'apiKeys', v_keys,
    'ssoProvider', v_sso
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_super_integrations(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_super_integrations(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_property_api_key(
  p_property_id UUID,
  p_label TEXT,
  p_key_prefix TEXT,
  p_hashed_key TEXT,
  p_scopes TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row public.api_keys;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.api_keys (
    property_id, label, key_prefix, hashed_key, scopes, created_by
  )
  VALUES (
    p_property_id, btrim(p_label), p_key_prefix, p_hashed_key, p_scopes,
    COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000001'::UUID)
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'label', v_row.label,
    'keyPrefix', v_row.key_prefix,
    'scopes', v_row.scopes,
    'createdAt', v_row.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_property_api_key(UUID, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_property_api_key(UUID, TEXT, TEXT, TEXT, TEXT[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_property_api_key(p_key_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  UPDATE public.api_keys
  SET revoked = true,
      revoked_at = now()
  WHERE id = p_key_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'API_KEY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('revoked', true, 'keyId', p_key_id);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_property_api_key(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_property_api_key(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_sso_provider(
  p_property_id UUID,
  p_client_id TEXT,
  p_auth_mode TEXT,
  p_hashed_client_secret TEXT DEFAULT NULL,
  p_public_key_pem TEXT DEFAULT NULL,
  p_jwks_url TEXT DEFAULT NULL,
  p_allowed_origins TEXT[] DEFAULT '{}',
  p_enabled BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row public.sso_providers;
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.sso_providers (
    property_id, client_id, auth_mode, hashed_client_secret, public_key_pem, jwks_url, allowed_origins, enabled
  )
  VALUES (
    p_property_id, btrim(p_client_id), p_auth_mode,
    NULLIF(p_hashed_client_secret, ''), NULLIF(p_public_key_pem, ''), NULLIF(p_jwks_url, ''),
    COALESCE(p_allowed_origins, '{}'), COALESCE(p_enabled, false)
  )
  ON CONFLICT (property_id) DO UPDATE
  SET client_id = EXCLUDED.client_id,
      auth_mode = EXCLUDED.auth_mode,
      hashed_client_secret = COALESCE(EXCLUDED.hashed_client_secret, public.sso_providers.hashed_client_secret),
      public_key_pem = COALESCE(EXCLUDED.public_key_pem, public.sso_providers.public_key_pem),
      jwks_url = COALESCE(EXCLUDED.jwks_url, public.sso_providers.jwks_url),
      allowed_origins = EXCLUDED.allowed_origins,
      enabled = EXCLUDED.enabled
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'propertyId', v_row.property_id,
    'clientId', v_row.client_id,
    'authMode', v_row.auth_mode,
    'enabled', v_row.enabled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_sso_provider(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_sso_provider(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], BOOLEAN) TO authenticated;

-- 3. External API Gateway RPCs (service-only)
CREATE OR REPLACE FUNCTION public.authenticate_api_key_and_rate_limit(
  p_hashed_key TEXT,
  p_required_scope TEXT,
  p_require_assignment_push BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key public.api_keys;
  v_prop public.properties;
  v_ft25 BOOLEAN;
  v_ft13 BOOLEAN;
  v_bucket TEXT;
  v_rl public.otp_rate_limits;
BEGIN
  SELECT * INTO v_key FROM public.api_keys WHERE hashed_key = p_hashed_key;
  IF NOT FOUND OR v_key.revoked THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'code', 'INVALID_OR_REVOKED_API_KEY');
  END IF;

  SELECT * INTO v_prop FROM public.properties WHERE id = v_key.property_id;
  IF NOT FOUND OR v_prop.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'code', 'PROPERTY_INACTIVE');
  END IF;

  SELECT enabled INTO v_ft25 FROM public.property_features
  WHERE property_id = v_prop.id AND feature_key = 'external_api';
  IF NOT COALESCE(v_ft25, false) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'code', 'FEATURE_DISABLED');
  END IF;

  IF p_require_assignment_push THEN
    SELECT enabled INTO v_ft13 FROM public.property_features
    WHERE property_id = v_prop.id AND feature_key = 'api_assignment_push';
    IF NOT COALESCE(v_ft13, false) THEN
      RETURN jsonb_build_object('ok', false, 'status', 403, 'code', 'FEATURE_DISABLED');
    END IF;
  END IF;

  IF NOT (p_required_scope = ANY (v_key.scopes)) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'code', 'INSUFFICIENT_SCOPE');
  END IF;

  -- 120 req/min per API key
  v_bucket := 'api_key:' || v_key.id::TEXT;
  INSERT INTO public.otp_rate_limits (bucket_key, request_count, window_started_at)
  VALUES (v_bucket, 1, now())
  ON CONFLICT (bucket_key) DO UPDATE
  SET request_count = CASE
        WHEN public.otp_rate_limits.window_started_at < now() - interval '1 minute' THEN 1
        ELSE public.otp_rate_limits.request_count + 1
      END,
      window_started_at = CASE
        WHEN public.otp_rate_limits.window_started_at < now() - interval '1 minute' THEN now()
        ELSE public.otp_rate_limits.window_started_at
      END
  RETURNING * INTO v_rl;

  IF v_rl.request_count > 120 THEN
    RETURN jsonb_build_object('ok', false, 'status', 429, 'code', 'TOO_MANY_REQUESTS');
  END IF;

  UPDATE public.api_keys SET last_used_at = now() WHERE id = v_key.id;

  RETURN jsonb_build_object(
    'ok', true,
    'propertyId', v_prop.id,
    'keyId', v_key.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.authenticate_api_key_and_rate_limit(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.api_push_assignments(
  p_property_id UUID,
  p_date DATE,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_room TEXT;
  v_person_id UUID;
  v_ext_email TEXT;
  v_existing RECORD;
  v_saved INT := 0;
  v_reassigned INT := 0;
  v_unmatched TEXT[] := ARRAY[]::TEXT[];
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_room := btrim(COALESCE(v_item->>'roomNumber', ''));
    IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE property_id = p_property_id AND room_number = v_room) THEN
      v_unmatched := array_append(v_unmatched, v_room);
      CONTINUE;
    END IF;

    v_person_id := NULL;
    IF NULLIF(v_item->>'personId', '') IS NOT NULL THEN
      v_person_id := (v_item->>'personId')::UUID;
    ELSIF NULLIF(v_item->>'externalEmail', '') IS NOT NULL THEN
      v_ext_email := lower(btrim(v_item->>'externalEmail'));
      SELECT id INTO v_person_id FROM public.people
      WHERE property_id = p_property_id AND lower(email) = v_ext_email LIMIT 1;
    END IF;

    IF v_person_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.people pe
      JOIN public.departments d ON d.property_id = pe.property_id AND d.id = pe.department_id
      WHERE pe.id = v_person_id AND pe.property_id = p_property_id
        AND pe.role = 'staff' AND pe.status = 'active' AND d.is_housekeeping
    ) THEN
      v_unmatched := array_append(v_unmatched, v_room);
      CONTINUE;
    END IF;

    SELECT * INTO v_existing FROM public.assignments
    WHERE property_id = p_property_id AND assignment_date = p_date AND room_number = v_room
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.assignments (property_id, assignment_date, room_number, person_id, source)
      VALUES (p_property_id, p_date, v_room, v_person_id, 'api');
      v_saved := v_saved + 1;
    ELSIF v_existing.person_id <> v_person_id THEN
      UPDATE public.assignments
      SET person_id = v_person_id,
          reassigned_from_person_id = v_existing.person_id,
          source = 'api',
          updated_at = now()
      WHERE id = v_existing.id;
      v_saved := v_saved + 1;
      v_reassigned := v_reassigned + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'savedCount', v_saved,
    'reassignedCount', v_reassigned,
    'unmatchedRooms', to_jsonb(v_unmatched)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.api_push_assignments(UUID, DATE, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.api_list_people(
  p_property_id UUID,
  p_status TEXT DEFAULT NULL,
  p_department_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_depts JSONB;
  v_people JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.name), '[]'::JSONB)
  INTO v_depts
  FROM public.departments d WHERE d.property_id = p_property_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', pe.id,
    'name', pe.name,
    'email', pe.email,
    'role', pe.role,
    'departmentId', pe.department_id,
    'status', pe.status
  ) ORDER BY pe.name), '[]'::JSONB)
  INTO v_people
  FROM public.people pe
  WHERE pe.property_id = p_property_id
    AND (p_status IS NULL OR pe.status = p_status)
    AND (p_department_id IS NULL OR pe.department_id = p_department_id);

  RETURN jsonb_build_object('departments', v_depts, 'people', v_people, 'nextCursor', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.api_list_people(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.api_list_tips(
  p_property_id UUID,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
  v_tips JSONB;
BEGIN
  SELECT timezone INTO v_tz FROM public.properties WHERE id = p_property_id;

  -- Strictly omits guest_email PII
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'amountCents', t.amount_cents,
    'feeCents', t.fee_cents,
    'netCents', t.net_cents,
    'recipientType', t.recipient_type,
    'personId', t.person_id,
    'departmentId', t.department_id,
    'roomNumber', t.room_number,
    'status', t.status,
    'createdAt', t.created_at
  ) ORDER BY t.created_at DESC), '[]'::JSONB)
  INTO v_tips
  FROM public.tips t
  WHERE t.property_id = p_property_id
    AND (p_from_date IS NULL OR (t.paid_at AT TIME ZONE v_tz)::DATE >= p_from_date)
    AND (p_to_date IS NULL OR (t.paid_at AT TIME ZONE v_tz)::DATE <= p_to_date);

  RETURN jsonb_build_object('tips', v_tips, 'nextCursor', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.api_list_tips(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;

-- 4. SSO Authentication & Replay-Safe Exchange RPCs (service-only)
CREATE OR REPLACE FUNCTION public.get_sso_provider_for_auth(p_client_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prov public.sso_providers;
  v_prop public.properties;
  v_ft26 BOOLEAN;
BEGIN
  SELECT * INTO v_prov FROM public.sso_providers WHERE client_id = p_client_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SSO_PROVIDER_NOT_FOUND');
  END IF;

  SELECT * INTO v_prop FROM public.properties WHERE id = v_prov.property_id;
  SELECT enabled INTO v_ft26 FROM public.property_features
  WHERE property_id = v_prop.id AND feature_key = 'single_sign_on';

  RETURN jsonb_build_object(
    'ok', true,
    'propertyId', v_prop.id,
    'propertyStatus', v_prop.status,
    'ft26Enabled', COALESCE(v_ft26, false),
    'authMode', v_prov.auth_mode,
    'hashedClientSecret', v_prov.hashed_client_secret,
    'publicKeyPem', v_prov.public_key_pem,
    'enabled', v_prov.enabled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_sso_provider_for_auth(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_and_consume_sso_user(
  p_property_id UUID,
  p_email TEXT,
  p_jti UUID,
  p_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(btrim(p_email));
  v_inserted UUID;
  v_person public.people;
BEGIN
  -- Reject Super Admin SSO unconditionally
  IF EXISTS (SELECT 1 FROM public.super_admins WHERE lower(email) = v_email) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SUPER_ADMIN_SSO_FORBIDDEN');
  END IF;

  -- Enforce active user belonging strictly to p_property_id
  SELECT * INTO v_person FROM public.people
  WHERE property_id = p_property_id AND lower(email) = v_email AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CROSS_PROPERTY_OR_INACTIVE_SSO_FORBIDDEN');
  END IF;

  -- Replay protection via sso_jti_nonces
  INSERT INTO public.sso_jti_nonces (jti, property_id, expires_at)
  VALUES (p_jti, p_property_id, p_expires_at)
  ON CONFLICT (jti) DO NOTHING
  RETURNING jti INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SSO_TOKEN_REPLAYED');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'personId', v_person.id,
    'authUserId', v_person.auth_user_id,
    'name', v_person.name,
    'email', v_person.email,
    'role', v_person.role,
    'propertyId', v_person.property_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_and_consume_sso_user(UUID, TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
