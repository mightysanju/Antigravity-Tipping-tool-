-- Deterministic Seed Data for Local Development & Automated Security Verification
-- Fixed UUIDs allow Playwright, Vitest, and Supabase local testing to reference entities reliably.

-- Auth Users (for Super Admin, Property Admins A & B, Dept Manager A, Staff Maria/Elena/Carlos)
INSERT INTO auth.users (id, email)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'superadmin@frontdesktip.test'),
  ('00000000-0000-0000-0000-000000000010', 'admin.paloma@frontdesktip.test'),
  ('00000000-0000-0000-0000-000000000011', 'manager.hk@frontdesktip.test'),
  ('00000000-0000-0000-0000-000000000012', 'maria.garcia@frontdesktip.test'),
  ('00000000-0000-0000-0000-000000000013', 'elena.rostova@frontdesktip.test'),
  ('00000000-0000-0000-0000-000000000014', 'carlos.vega@frontdesktip.test'),
  ('00000000-0000-0000-0000-000000000020', 'admin.harbor@frontdesktip.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.super_admins (auth_user_id, email, name)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'superadmin@frontdesktip.test',
  'Platform Super Admin'
)
ON CONFLICT (auth_user_id) DO NOTHING;

-- Properties (A: active resort, B: active peer property for AC-5 isolation, C: restricted)
INSERT INTO public.properties (
  id, name, address, contact_name, contact_email, status,
  plan_type, plan_price_cents, payment_fee_paid_by, payout_fee_paid_by,
  payout_weekday, timezone, min_withdrawal_cents,
  stripe_customer_id, stripe_subscription_id, stripe_subscription_status,
  tip_min_cents, tip_max_cents, tip_presets_cents
)
VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    'Casa Paloma Boutique Resort',
    '420 Teak Courtyard Way, Austin, TX',
    'Clara Mendez',
    'admin.paloma@frontdesktip.test',
    'active',
    'monthly',
    19900,
    'guest',
    'property',
    4,
    'America/Chicago',
    1000,
    'cus_mock_paloma',
    'sub_mock_paloma',
    'active',
    100,
    20000,
    '{300,500,1000,2000}'
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'Harborline Hotel',
    '88 Bayfront Pier, Seattle, WA',
    'Marcus Vance',
    'admin.harbor@frontdesktip.test',
    'active',
    'yearly',
    199000,
    'property',
    'staff',
    4,
    'America/Los_Angeles',
    1000,
    'cus_mock_harbor',
    'sub_mock_harbor',
    'active',
    200,
    20000,
    '{300,500,1000,2000}'
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    'Timberline Lodge (Restricted)',
    '19 Ridgeview Rd, Denver, CO',
    'Nora Reid',
    'admin.timber@frontdesktip.test',
    'restricted',
    'monthly',
    19900,
    'guest',
    'property',
    4,
    'America/Denver',
    1000,
    'cus_mock_timber',
    'sub_mock_timber',
    'unpaid',
    100,
    20000,
    '{300,500,1000,2000}'
  )
ON CONFLICT (id) DO NOTHING;

-- Departments
INSERT INTO public.departments (id, property_id, name, is_housekeeping, default_distribution)
VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Housekeeping', true, 'split'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Front Desk', false, 'split'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Valet', false, 'individual'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'Housekeeping', true, 'split')
ON CONFLICT (id) DO NOTHING;

-- People
INSERT INTO public.people (
  id, property_id, auth_user_id, name, email, role, department_id,
  status, wallet_balance_cents, agreement_signed_at, last_activity_or_credit_at
)
VALUES
  -- Property A Admin (nullable department_id)
  (
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000010',
    'Clara Mendez',
    'admin.paloma@frontdesktip.test',
    'property_admin',
    NULL,
    'active',
    0,
    now(),
    now()
  ),
  -- Property A Housekeeping Dept Manager (excluded from guest tip lists per Sign-Off 4/6)
  (
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000011',
    'Sophia Alvarez',
    'manager.hk@frontdesktip.test',
    'dept_manager',
    '20000000-0000-0000-0000-000000000001',
    'active',
    0,
    now(),
    now()
  ),
  -- Property A Staff: Maria Garcia (active, signed, balance $142.00)
  (
    '30000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000012',
    'Maria Garcia',
    'maria.garcia@frontdesktip.test',
    'staff',
    '20000000-0000-0000-0000-000000000001',
    'active',
    14200,
    now(),
    now()
  ),
  -- Property A Staff: Elena Rostova (active, signed)
  (
    '30000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000013',
    'Elena Rostova',
    'elena.rostova@frontdesktip.test',
    'staff',
    '20000000-0000-0000-0000-000000000001',
    'active',
    0,
    now(),
    now()
  ),
  -- Property A Staff: Carlos Vega (inactive, withdraw-only balance $25.00)
  (
    '30000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000014',
    'Carlos Vega',
    'carlos.vega@frontdesktip.test',
    'staff',
    '20000000-0000-0000-0000-000000000002',
    'inactive',
    2500,
    now() - interval '40 days',
    now() - interval '40 days'
  ),
  -- Property A Unclaimed Staff: Liam Patel (auth_user_id = NULL for Join QR)
  (
    '30000000-0000-0000-0000-000000000006',
    '10000000-0000-0000-0000-000000000001',
    NULL,
    'Liam Patel',
    'liam.patel@frontdesktip.test',
    'staff',
    '20000000-0000-0000-0000-000000000003',
    'active',
    0,
    NULL,
    NULL
  ),
  -- Property B Admin (for AC-5 cross-property isolation verification)
  (
    '30000000-0000-0000-0000-000000000007',
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000020',
    'Marcus Vance',
    'admin.harbor@frontdesktip.test',
    'property_admin',
    NULL,
    'active',
    0,
    now(),
    now()
  ),
  -- Property B Staff
  (
    '30000000-0000-0000-0000-000000000008',
    '10000000-0000-0000-0000-000000000002',
    NULL,
    'Hannah Kim',
    'hannah.kim@frontdesktip.test',
    'staff',
    '20000000-0000-0000-0000-000000000004',
    'active',
    5000,
    now(),
    now()
  )
ON CONFLICT (id) DO NOTHING;

-- Rooms
INSERT INTO public.rooms (id, property_id, room_number)
VALUES
  ('40000000-0000-0000-0000-000000000101', '10000000-0000-0000-0000-000000000001', '101'),
  ('40000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000001', '102'),
  ('40000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000001', '103'),
  ('40000000-0000-0000-0000-000000000412', '10000000-0000-0000-0000-000000000001', '412'),
  ('40000000-0000-0000-0000-000000000414', '10000000-0000-0000-0000-000000000001', '414'),
  ('40000000-0000-0000-0000-000000000418', '10000000-0000-0000-0000-000000000001', '418'),
  ('40000000-0000-0000-0000-000000000201', '10000000-0000-0000-0000-000000000002', '201')
ON CONFLICT (id) DO NOTHING;

-- Today's Room Assignment (Room 412 -> Maria Garcia in Casa Paloma local date)
INSERT INTO public.assignments (
  id, property_id, assignment_date, room_number, person_id, source, assigned_by
)
VALUES (
  '50000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  (now() AT TIME ZONE 'America/Chicago')::DATE,
  '412',
  '30000000-0000-0000-0000-000000000003',
  'manual',
  '00000000-0000-0000-0000-000000000010'
)
ON CONFLICT (id) DO NOTHING;

-- Confirmed Checkout Intents, Tips, Ledger & Pool Distribution for Security & Balance Reconciliation Verification
INSERT INTO public.checkout_intents (
  id, property_id, recipient_type, person_id, department_id, room_number,
  amount_cents, fee_cents, guest_fee_cents, net_cents, note,
  stripe_payment_intent_id, status
)
VALUES
  (
    '60000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'person',
    '30000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000001',
    '412',
    14200,
    442,
    442,
    14200,
    'Thank you for the warm care!',
    'pi_seed_maria_14200',
    'succeeded'
  ),
  (
    '60000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'person',
    '30000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000002',
    NULL,
    2500,
    103,
    103,
    2500,
    'Helpful check-in',
    'pi_seed_carlos_2500',
    'succeeded'
  ),
  (
    '60000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000002',
    'person',
    '30000000-0000-0000-0000-000000000008',
    '20000000-0000-0000-0000-000000000004',
    '201',
    5000,
    175,
    0,
    5000,
    'Harbor view room spotless',
    'pi_seed_hannah_5000',
    'succeeded'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tips (
  id, property_id, checkout_intent_id, amount_cents, fee_cents, guest_fee_cents,
  net_cents, recipient_type, person_id, department_id, room_number, note,
  stripe_payment_intent_id, status, paid_at
)
VALUES
  (
    '70000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    14200, 442, 442, 14200, 'person',
    '30000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000001',
    '412', 'Thank you for the warm care!',
    'pi_seed_maria_14200', 'paid', now() - interval '2 hours'
  ),
  (
    '70000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000002',
    2500, 103, 103, 2500, 'person',
    '30000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000002',
    NULL, 'Helpful check-in',
    'pi_seed_carlos_2500', 'paid', now() - interval '40 days'
  ),
  (
    '70000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000002',
    '60000000-0000-0000-0000-000000000003',
    5000, 175, 0, 5000, 'person',
    '30000000-0000-0000-0000-000000000008',
    '20000000-0000-0000-0000-000000000004',
    '201', 'Harbor view room spotless',
    'pi_seed_hannah_5000', 'paid', now() - interval '1 hour'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ledger (
  id, property_id, person_id, department_id, type, amount_cents, ref_id, idempotency_key
)
VALUES
  (
    '80000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000001',
    'tip_credit',
    14200,
    '70000000-0000-0000-0000-000000000001',
    'tip_credit:70000000-0000-0000-0000-000000000001'
  ),
  (
    '80000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000002',
    'tip_credit',
    2500,
    '70000000-0000-0000-0000-000000000002',
    'tip_credit:70000000-0000-0000-0000-000000000002'
  ),
  (
    '80000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000008',
    '20000000-0000-0000-0000-000000000004',
    'tip_credit',
    5000,
    '70000000-0000-0000-0000-000000000003',
    'tip_credit:70000000-0000-0000-0000-000000000003'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pool_distributions (
  id, property_id, department_id, distribution_date, method, total_cents, allocations, created_by
)
VALUES (
  '81000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  (now() AT TIME ZONE 'America/Chicago')::DATE,
  'split',
  2000,
  '[{"person_id":"30000000-0000-0000-0000-000000000003","amount_cents":1000},{"person_id":"30000000-0000-0000-0000-000000000004","amount_cents":1000}]'::JSONB,
  '00000000-0000-0000-0000-000000000010'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.agreements (
  id, signer_type, signer_id, signer_auth_user_id, property_id, version,
  typed_name, checkbox_confirmed, signed_at, ip_address, pdf_storage_path
)
VALUES
  (
    '90000000-0000-0000-0000-000000000001',
    'property',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000010',
    '10000000-0000-0000-0000-000000000001',
    '2026.1',
    'Clara Mendez',
    true,
    now(),
    '127.0.0.1'::INET,
    '10000000-0000-0000-0000-000000000001/property_10000000-0000-0000-0000-000000000001_v2026.1.pdf'
  ),
  (
    '90000000-0000-0000-0000-000000000002',
    'property',
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000020',
    '10000000-0000-0000-0000-000000000002',
    '2026.1',
    'Marcus Vance',
    true,
    now(),
    '127.0.0.1'::INET,
    '10000000-0000-0000-0000-000000000002/property_10000000-0000-0000-0000-000000000002_v2026.1.pdf'
  )
ON CONFLICT (id) DO NOTHING;

-- Pre-hashed test API key (plaintext: fdp_test_seed_key_property_a)
INSERT INTO public.api_keys (
  id, property_id, label, key_prefix, hashed_key, scopes, created_by
)
VALUES (
  '95000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Seed PMS Integration Key',
  'fdp_test_see',
  encode(sha256('fdp_test_seed_key_property_a'::bytea), 'hex'),
  ARRAY['assignments:write', 'people:read', 'tips:read', 'people:write'],
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO NOTHING;
