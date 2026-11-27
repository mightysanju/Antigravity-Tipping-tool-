-- Hospitality Tipping Platform — Initial 24-Table Relational Schema & 6 Private Storage Buckets
-- Uses PostgreSQL 13+ core gen_random_uuid() and sha256() with zero external extension dependencies.

-- 1. properties
CREATE TABLE public.properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'restricted', 'cancelled')) DEFAULT 'pending',
  plan_type TEXT NOT NULL CHECK (plan_type IN ('monthly', 'yearly')),
  plan_price_cents BIGINT NOT NULL CHECK (plan_price_cents >= 0),
  contract_term_months INT NOT NULL DEFAULT 12 CHECK (contract_term_months > 0),
  notice_days INT NOT NULL DEFAULT 30 CHECK (notice_days >= 0),
  contract_renews_at TIMESTAMPTZ,
  payment_fee_paid_by TEXT NOT NULL CHECK (payment_fee_paid_by IN ('property', 'guest', 'staff')),
  payout_fee_paid_by TEXT NOT NULL CHECK (payout_fee_paid_by IN ('property', 'staff')),
  payout_weekday SMALLINT NOT NULL DEFAULT 4 CHECK (payout_weekday BETWEEN 0 AND 6),
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  min_withdrawal_cents BIGINT NOT NULL DEFAULT 1000 CHECK (min_withdrawal_cents >= 100),
  template_path TEXT,
  hero_photo_path TEXT,
  qr_position JSONB,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  stripe_subscription_status TEXT,
  tip_min_cents BIGINT NOT NULL DEFAULT 100 CHECK (tip_min_cents >= 100),
  tip_max_cents BIGINT NOT NULL DEFAULT 20000 CHECK (tip_max_cents >= tip_min_cents AND tip_max_cents <= 50000),
  tip_presets_cents BIGINT[] NOT NULL DEFAULT '{300,500,1000,2000}',
  accent_color_hex TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_property_timezone()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'INVALID_TIMEZONE: %', NEW.timezone USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_property_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_property_timezone();

-- 2. property_features (27 Section 19 toggles)
CREATE TABLE public.property_features (
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL CHECK (feature_key IN (
    'guest_notes',
    'email_receipts',
    'tip_specific_housekeeper',
    'department_pool_tips',
    'tip_specific_person_in_dept',
    'department_qr_codes',
    'personal_staff_qr_codes',
    'room_qr_codes',
    'qr_templates',
    'pdf_assignment_upload',
    'camera_photo_ocr',
    'manual_assignment',
    'api_assignment_push',
    'mid_day_reassignment',
    'department_manager_role',
    'in_app_notifications',
    'staff_wallet_and_withdrawals',
    'instant_payouts',
    'weekly_batch_payouts',
    'refunds',
    'pool_distribution',
    'guest_paid_fee_option',
    'join_qr',
    'email_invites',
    'external_api',
    'single_sign_on',
    'tips_overview_export'
  )),
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  PRIMARY KEY (property_id, feature_key)
);

CREATE OR REPLACE FUNCTION public.seed_default_property_features()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.property_features (property_id, feature_key, enabled)
  SELECT NEW.id, k, true
  FROM unnest(ARRAY[
    'guest_notes',
    'email_receipts',
    'tip_specific_housekeeper',
    'department_pool_tips',
    'tip_specific_person_in_dept',
    'department_qr_codes',
    'personal_staff_qr_codes',
    'room_qr_codes',
    'qr_templates',
    'pdf_assignment_upload',
    'camera_photo_ocr',
    'manual_assignment',
    'api_assignment_push',
    'mid_day_reassignment',
    'department_manager_role',
    'in_app_notifications',
    'staff_wallet_and_withdrawals',
    'instant_payouts',
    'weekly_batch_payouts',
    'refunds',
    'pool_distribution',
    'guest_paid_fee_option',
    'join_qr',
    'email_invites',
    'external_api',
    'single_sign_on',
    'tips_overview_export'
  ]) AS k
  ON CONFLICT (property_id, feature_key) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seed_property_features
  AFTER INSERT ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_default_property_features();

-- 3. departments
CREATE TABLE public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_housekeeping BOOLEAN NOT NULL DEFAULT false,
  default_distribution TEXT NOT NULL CHECK (default_distribution IN ('split', 'individual')) DEFAULT 'split',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, id)
);

CREATE UNIQUE INDEX idx_departments_property_lower_name
  ON public.departments (property_id, lower(name));

-- 4. people
CREATE TABLE public.people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  auth_user_id UUID UNIQUE REFERENCES auth.users(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('property_admin', 'dept_manager', 'staff')),
  department_id UUID,
  photo_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
  wallet_balance_cents BIGINT NOT NULL DEFAULT 0,
  stripe_connect_account_id TEXT,
  agreement_signed_at TIMESTAMPTZ,
  last_activity_or_credit_at TIMESTAMPTZ,
  last_reminder_milestone SMALLINT CHECK (last_reminder_milestone IN (30, 60, 90)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, id),
  FOREIGN KEY (property_id, department_id)
    REFERENCES public.departments(property_id, id)
    ON DELETE RESTRICT,
  CHECK ((role = 'property_admin') OR (department_id IS NOT NULL))
);

CREATE UNIQUE INDEX idx_people_property_lower_email
  ON public.people (property_id, lower(email));

-- 5. rooms
CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  room_number TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, id),
  UNIQUE (property_id, room_number)
);

-- 6. assignments
CREATE TABLE public.assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  assignment_date DATE NOT NULL,
  room_number TEXT NOT NULL,
  person_id UUID NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('pdf', 'photo', 'manual', 'api')),
  reassigned_from_person_id UUID,
  assigned_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (property_id, room_number) REFERENCES public.rooms(property_id, room_number),
  FOREIGN KEY (property_id, person_id) REFERENCES public.people(property_id, id),
  FOREIGN KEY (property_id, reassigned_from_person_id) REFERENCES public.people(property_id, id),
  UNIQUE (property_id, assignment_date, room_number)
);

-- 7. checkout_intents (pre-webhook unpaid intents)
CREATE TABLE public.checkout_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id),
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('person', 'department_pool')),
  person_id UUID,
  department_id UUID NOT NULL,
  room_number TEXT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  fee_cents BIGINT NOT NULL CHECK (fee_cents >= 0),
  guest_fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (guest_fee_cents >= 0),
  net_cents BIGINT NOT NULL CHECK (net_cents >= 0),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 150),
  guest_email TEXT,
  stripe_payment_intent_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('created', 'succeeded', 'failed', 'expired')) DEFAULT 'created',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (property_id, department_id) REFERENCES public.departments(property_id, id),
  FOREIGN KEY (property_id, person_id) REFERENCES public.people(property_id, id),
  CHECK ((recipient_type = 'person' AND person_id IS NOT NULL) OR (recipient_type = 'department_pool' AND person_id IS NULL))
);

-- 8. tips (webhook-confirmed only)
CREATE TABLE public.tips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id),
  checkout_intent_id UUID UNIQUE REFERENCES public.checkout_intents(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  fee_cents BIGINT NOT NULL CHECK (fee_cents >= 0),
  guest_fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (guest_fee_cents >= 0),
  net_cents BIGINT NOT NULL CHECK (net_cents >= 0),
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('person', 'department_pool')),
  person_id UUID,
  department_id UUID NOT NULL,
  room_number TEXT,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 150),
  guest_email TEXT,
  stripe_payment_intent_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('paid', 'refund_pending', 'refunded', 'disputed')) DEFAULT 'paid',
  active_refund_attempt_id UUID,
  refund_pending_started_at TIMESTAMPTZ,
  refund_attempt_count INT NOT NULL DEFAULT 0,
  paid_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (property_id, department_id) REFERENCES public.departments(property_id, id),
  FOREIGN KEY (property_id, person_id) REFERENCES public.people(property_id, id),
  CHECK ((recipient_type = 'person' AND person_id IS NOT NULL) OR (recipient_type = 'department_pool' AND person_id IS NULL))
);

-- 9. pool_distributions
CREATE TABLE public.pool_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id),
  department_id UUID NOT NULL,
  distribution_date DATE NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('split', 'individual')),
  total_cents BIGINT NOT NULL CHECK (total_cents > 0),
  allocations JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (property_id, department_id) REFERENCES public.departments(property_id, id)
);

-- 10. payout_batches
CREATE TABLE public.payout_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id),
  payout_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'partial_failure', 'failed')),
  total_cents BIGINT NOT NULL DEFAULT 0,
  withdrawal_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, payout_date)
);

-- 11. withdrawals
CREATE TABLE public.withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id),
  person_id UUID NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL CHECK (method IN ('standard', 'instant')),
  fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  net_payout_cents BIGINT NOT NULL GENERATED ALWAYS AS (amount_cents - fee_cents) STORED CHECK (net_payout_cents > 0),
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'paid', 'failed')),
  stripe_idempotency_key TEXT UNIQUE,
  stripe_payout_id TEXT UNIQUE,
  processing_started_at TIMESTAMPTZ,
  failure_reason TEXT,
  batch_id UUID REFERENCES public.payout_batches(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  FOREIGN KEY (property_id, person_id) REFERENCES public.people(property_id, id)
);

-- 12. ledger (append-only immutable journal)
CREATE TABLE public.ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id),
  person_id UUID,
  department_id UUID,
  type TEXT NOT NULL CHECK (type IN (
    'tip_credit', 'pool_credit', 'pool_debit', 'fee',
    'refund', 'refund_reversal', 'chargeback', 'chargeback_reversal',
    'payout', 'payout_reversal'
  )),
  amount_cents BIGINT NOT NULL,
  ref_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (property_id, person_id) REFERENCES public.people(property_id, id),
  FOREIGN KEY (property_id, department_id) REFERENCES public.departments(property_id, id)
);

CREATE OR REPLACE FUNCTION public.prevent_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LEDGER_IMMUTABLE: UPDATE and DELETE are forbidden on public.ledger'
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_prevent_ledger_mutation
  BEFORE UPDATE OR DELETE ON public.ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_ledger_mutation();

-- 13. notifications
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id),
  person_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('tip_received', 'pool_distributed', 'payout_paid', 'payout_failed', 'chargeback')),
  message TEXT NOT NULL,
  tip_id UUID REFERENCES public.tips(id),
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (property_id, person_id) REFERENCES public.people(property_id, id)
);

-- 14. agreements
CREATE TABLE public.agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signer_type TEXT NOT NULL CHECK (signer_type IN ('property', 'staff')),
  signer_id UUID NOT NULL,
  signer_auth_user_id UUID NOT NULL REFERENCES auth.users(id),
  property_id UUID NOT NULL REFERENCES public.properties(id),
  version TEXT NOT NULL,
  typed_name TEXT NOT NULL,
  checkbox_confirmed BOOLEAN NOT NULL CHECK (checkbox_confirmed = true),
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address INET NOT NULL,
  user_agent TEXT,
  pdf_storage_path TEXT NOT NULL
);

-- 15. api_keys
CREATE TABLE public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  hashed_key TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['assignments:write','people:read','tips:read','people:write']),
  revoked BOOLEAN NOT NULL DEFAULT false,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 16. otp_codes
CREATE TABLE public.otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  hashed_code TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'new_device', 'withdrawal', 'join_qr')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts <= 5),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 17. trusted_devices
CREATE TABLE public.trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  last_ip INET,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false
);

-- 18. stripe_events
CREATE TABLE public.stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 19. audit_logs
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES public.properties(id),
  actor_user_id UUID,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20. invoices
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id),
  stripe_invoice_id TEXT NOT NULL UNIQUE,
  amount_cents BIGINT NOT NULL,
  status TEXT NOT NULL,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 21. otp_rate_limits
CREATE TABLE public.otp_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  request_count INT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL
);

-- 22. sso_jti_nonces
CREATE TABLE public.sso_jti_nonces (
  jti UUID PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES public.properties(id),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 23. super_admins
CREATE TABLE public.super_admins (
  auth_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 24. sso_providers
CREATE TABLE public.sso_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL UNIQUE REFERENCES public.properties(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL UNIQUE,
  auth_mode TEXT NOT NULL CHECK (auth_mode IN ('server_minted', 'partner_asymmetric')) DEFAULT 'server_minted',
  hashed_client_secret TEXT,
  public_key_pem TEXT,
  jwks_url TEXT,
  allowed_origins TEXT[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (auth_mode = 'server_minted' AND hashed_client_secret IS NOT NULL)
    OR (auth_mode = 'partner_asymmetric' AND (public_key_pem IS NOT NULL OR jwks_url IS NOT NULL))
  )
);

-- 6 Private Storage Buckets
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('staff-photos', 'staff-photos', false),
  ('property-backdrops', 'property-backdrops', false),
  ('qr-templates', 'qr-templates', false),
  ('qr-exports', 'qr-exports', false),
  ('assignment-sheets', 'assignment-sheets', false),
  ('signed-agreements', 'signed-agreements', false)
ON CONFLICT (id) DO NOTHING;
