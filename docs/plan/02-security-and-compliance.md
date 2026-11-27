# 02 — Security & Compliance Architecture (Requirement R2)

> **Status:** Comprehensive Pre-Implementation Security & Compliance Specification  
> **Scope:** Requirement `R2` — Unauthenticated Guest View Data Minimization, Engine-Enforced Multi-Property & Role Isolation (`FORCE ROW LEVEL SECURITY`), Auth / Salted Hashed Email OTP / Join QR / SSO Token Security, Server-Side Stripe Verification & ACID Ledger Integrity, 24-Hour Refund & Negative-Balance Chargeback Controls, External API Key Scoping / Rotation / Revocation, Immutable Contract Signing Logs, and Payment / Unclaimed-Funds Compliance Boundaries.  
> **Cross-Reference:** Uses exact table names, RPCs, and Netlify Function endpoints defined in [`01-stack-comparison-and-architecture.md`](./01-stack-comparison-and-architecture.md).

---

## 1. Security Threat Model & Defense-in-Depth Principles

1. **Zero Trust at the Browser Boundary:** The Vite + React SPA holds only the Supabase `anon` key (public) and the signed-in user's short-lived JWT. It **never** holds the `service_role` key, Stripe secret key (`STRIPE_SECRET_KEY`), webhook secret (`STRIPE_WEBHOOK_SECRET`), OTP HMAC secret, `CRON_SECRET`, or Resend API key.
2. **Engine-Level Default Deny:** Every table in the `public` schema enables `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and **`ALTER TABLE ... FORCE ROW LEVEL SECURITY`**. Unauthenticated `anon` sessions have **zero** direct `SELECT/INSERT/UPDATE/DELETE` privileges on any tenant table (`L147`).
3. **Server-Exclusive Financial, Auth & Identity State:** No client role—not even `property_admin`—can directly write `ledger`, `tips`, `checkout_intents`, `withdrawals.status`, `payout_batches`, `wallet_balance_cents`, `people` auth/payout/agreement columns, `agreements`, `otp_codes`, `api_keys`, `sso_providers`, `invoices`, `stripe_events`, `audit_logs`, or `property_features` (`L153, L196, L266`).

---

## 2. Unauthenticated Guest View Data Minimization (`L147, L161, L183, L186–L187`)

### 2.1 Public Projection Boundary (`resolve-room-view` / `get_public_tip_target`)

Guest routes (`/tip/room/:roomId`, `/tip/dept/:departmentId`, `/tip/person/:personId`) execute via `GET /.netlify/functions/resolve-room-view?type=room|dept|person&id=<uuid>`, which calls the read-only Postgres `SECURITY DEFINER` RPC `get_public_tip_target(p_type, p_id)` and issues short-lived signed URLs for `staff-photos` and `property-backdrops`.

| Field Category | Explicitly Allowed in Public JSON | Explicitly Stripped / Never Queried or Returned |
|---|---|---|
| **Property State** | `propertyId`, `propertyName`, `status` (`active` vs `restricted`/`invalid`), `heroPhotoSignedUrl` *(short-lived signed URL from `property-backdrops` when set, else `null` for bundled resort photo)*, `accentColorHex`, `tipBounds` (`minCents`, `maxCents`, `presetsCents`), `guestFeePolicy` (`guest` vs absorbed/staff), `enabledGuestToggles` (`FT-1..FT-8, FT-22`), `shortTermsText` | `contactName`, `contactEmail`, `address`, `planPriceCents`, `stripeCustomerId`, `stripeSubscriptionId`, `contractTermMonths`, `apiKeys`, `ssoProviders` |
| **Assigned Housekeeper** *(if room assigned & eligible & `FT-3` enabled)* | `personId`, `firstName` / `displayName`, `photoSignedUrl` *(short-lived signed URL; `status = 'active' AND agreement_signed_at IS NOT NULL AND role = 'staff'`)* | `email`, `walletBalanceCents`, `role`, `authUserId`, `property_admin`, `dept_manager`, unsigned staff (`L93`), `agreementSignedAt`, `tips`, `ledger`, `withdrawals` |
| **Departments & Staff Lists** | Active `departments` (`id`, `name`, `isHousekeeping`) including Whole Department Pool (`FT-4`); eligible `people` (`id`, `name`, `photoSignedUrl`, `departmentId` where `status = 'active' AND agreement_signed_at IS NOT NULL AND role = 'staff'`) when `FT-5` enabled or Housekeeping unassigned (`L33`) | `inactive` people (`L25, L46`), `property_admin`, `dept_manager` *(Signed Off 4/6: frontline `staff` + Whole Department Pool only)*, unsigned staff, `email`, `walletBalanceCents`, `assignments` history, other guests' `tips` or `notes` (`L147`) |

### 2.2 Guest Edge-Case Enforcement
- **Invalid or expired room/dept/person link (`L183`):** Returns `404 { code: 'TARGET_NOT_FOUND' }`; guest page renders friendly concierge card with payment disabled.
- **Restricted or cancelled property (`L187`):** If `properties.status IN ('restricted', 'cancelled', 'pending')`, `resolve-room-view` returns `{ status: 'restricted', message: ... }` with **zero staff PII** and `create-tip-checkout` rejects any payment attempt with `403 PROPERTY_RESTRICTED`.
- **Inactive or deleted recipient (`L186`):**
  - If a scanned `/tip/person/:personId` or stale cached room target references a `people` row with `status = 'inactive'` **and `FT-4` (`department_pool_tips`) is `true`**, `resolve-room-view` and `create-tip-checkout` automatically fall back to that person's `department_id` with `recipientType: 'department_pool'` (and clear UI notice: *"Tips for this role go to the [Department] shared team pool"*).
  - If `/tip/person/:personId` targets an `inactive` person **and `FT-4` is `false`**, `resolve-room-view` returns a `422 RECIPIENT_UNAVAILABLE` state with checkout disabled, and `create-tip-checkout` rejects any payment attempt with `422 RECIPIENT_UNAVAILABLE`.

---

## 3. Multi-Property Tenant & Role Isolation (`L13–L19, L145–L153, L195, L224`)

### 3.1 Custom Access Token Auth Hook + Live Active Status Check

When GoTrue issues or refreshes a JWT, a Postgres `custom_access_token_hook(event JSONB)` queries `super_admins` and `people`:
- **Super Admin:** Injects `app_role = 'super_admin'`, `property_id = NULL`, `department_id = NULL`, `person_id = NULL`.
- **Property Admin / Dept Manager / Staff:** Injects `app_role = people.role`, `property_id = people.property_id`, `department_id = people.department_id`, `person_id = people.id`.

**Eliminating JWT Staleness:** Standard JWT claims can lag up to 1 hour if a user is deactivated or reassigned to another department. Every RLS helper function joins directly against live Postgres tables (`SECURITY DEFINER` with `SET search_path = public` so helpers evaluate cleanly under `FORCE RLS`):
- `auth_is_super_admin()` → `EXISTS (SELECT 1 FROM super_admins WHERE auth_user_id = auth.uid())` (`SECURITY DEFINER`, preventing recursion on `super_admins` under `FORCE RLS`)
- `auth_active_person()` → `SELECT id, property_id, department_id, role FROM people WHERE auth_user_id = auth.uid() AND status = 'active'`
- **Exception for Withdraw-Only View (`L79`):** An `inactive` person (or active person in a `cancelled` property) retains read-only `SELECT` access via `auth_person_including_inactive()` to their own `people`, `ledger`, `withdrawals`, `tips`, and minimal `properties` projection (`id, name, status, payout_weekday, min_withdrawal_cents, timezone, payout_fee_paid_by, hero_photo_path`) so `/staff` can render the Warm Resort Glass backdrop and withdraw-only view (including dynamic payout fee breakdown `RT-6`) and call `request-withdrawal`, while `notifications` `UPDATE (read)` and all operational writes are denied.

### 3.2 Engine-Enforced RLS Policy Matrix (`FORCE ROW LEVEL SECURITY` — All 24 Tables)

| Table | `super_admin` | `property_admin` | `dept_manager` (`FT-15`) | `staff` | `anon` (Guest) |
|---|---|---|---|---|---|
| `properties` | `ALL` | `SELECT` own `property_id` only | `SELECT` via `REVOKE ALL` + column-level `GRANT SELECT (id, name, status, payout_weekday, min_withdrawal_cents, timezone, payout_fee_paid_by, hero_photo_path, accent_color_hex)` (or `properties_staff_view`) — billing/Stripe columns never exposed | `SELECT` via same column-level `GRANT` / `properties_staff_view` (`status`, `payout_weekday`, `min_withdrawal_cents`, `timezone`, `payout_fee_paid_by`, `hero_photo_path`) | **DENY** |
| `property_features` | `ALL` | `SELECT` own `property_id` (read-only `L266`) | `SELECT` own `property_id` | `SELECT` own `property_id` | **DENY** |
| `departments` | `ALL` | `SELECT/INSERT/UPDATE` own `property_id`; `DELETE` via RPC (`AC-8`) | `SELECT` own `property_id` | `SELECT` own `property_id` | **DENY** |
| `people` | `ALL` | `SELECT` own `property_id` (incl. `wallet_balance_cents` for `/admin/tips` refund checks). **Direct client `INSERT/UPDATE` REVOKED** — mutations execute exclusively via `create-person` / `update-person` (`SECURITY DEFINER` RPCs enforcing `FT-15`, restricting `property_admin` callers to `role IN ('staff', 'dept_manager')` with `department_id IS NOT NULL` [forbidding `property_admin` creation/escalation reserved for Super Admin `RT-15`], leaving `auth_user_id = NULL` on `create-person`, locking `people.email` once `auth_user_id IS NOT NULL` [or syncing atomically via Supabase Auth Admin API + `audit_logs`], enforcing composite `(property_id, department_id)`, and locking `wallet_balance_cents`, `auth_user_id`, `stripe_connect_account_id`, `agreement_signed_at`, `property_id`, `last_activity_or_credit_at`, `last_reminder_milestone`). | `SELECT` own `property_id` AND `department_id` only (`L15, L151`) | `SELECT` **own row only** (`id = auth_person_id()`) (`L152`) | **DENY** |
| `rooms` | `ALL` | `SELECT/INSERT/UPDATE/DELETE` own `property_id` | `SELECT` own `property_id` (room counts `L15`) | `SELECT` own `property_id` (today's assigned rooms) | **DENY** |
| `assignments` | `ALL` | `SELECT` own `property_id` (writes via `save-assignments` RPC) | `SELECT` where `person.department_id = own_dept_id` (writes via `save-assignments`) | `SELECT` **own assignments only** (`person_id = auth_person_id()`) | **DENY** |
| `tips` | `ALL` | `SELECT` own `property_id` (webhook-confirmed tips only; unpaid intents live in `checkout_intents`; writes server-only `L153`) | `SELECT` own `property_id` AND `department_id` (`L151`; webhook-confirmed only) | `SELECT` **own tips only** (`person_id = auth_person_id()`; webhook-confirmed only `L152`) | **DENY** |
| `pool_distributions` | `ALL` | `SELECT` own `property_id` (writes via `distribute-pool`) | `SELECT` own `department_id` (writes via `distribute-pool`) | **DENY** *(reads own `ledger` `pool_credit` rows & `notifications`, never coworkers' `allocations` JSONB `L152`)* | **DENY** |
| `ledger` | `SELECT` (server `INSERT` only) | `SELECT` own `property_id` (**ZERO client write** `L153`) | **DENY** (`L15, L56`: no payments) | `SELECT` **own rows only** (`person_id = auth_person_id()`) | **DENY** |
| `withdrawals` | `SELECT` (server writes) | **DENY** or `SELECT` aggregate only (no approval needed `L69`) | **DENY** (`L15, L56`) | `SELECT` **own rows only** (writes via `request-withdrawal`) | **DENY** |
| `payout_batches` | `SELECT` (server writes) | `SELECT` own `property_id` (summary only) or **DENY** | **DENY** | **DENY** | **DENY** |
| `notifications` | `ALL` | `SELECT` own `property_id` (or own `person_id`) | `SELECT` own `person_id` | `SELECT` + `UPDATE (read)` **own rows only** (`active` staff; `property_id` matched per `ST-1`) | **DENY** |
| `agreements` | `SELECT` all | `SELECT` own `property_id` (direct writes **`DENY`**; click-to-accept writes go via `sign-agreement` `SECURITY DEFINER` RPC `L153`) | `SELECT` own `signer_id` (`signer_type='staff'`); direct writes **`DENY`** (click-to-accept writes go via `sign-agreement` `SECURITY DEFINER` RPC `L153`) | `SELECT` own `signer_id` (`signer_type='staff'`); direct writes **`DENY`** (click-to-accept writes go via `sign-agreement` `SECURITY DEFINER` RPC `L153`) | **DENY** |
| `api_keys` | `ALL` | **DENY** (`L150`) | **DENY** (`L150`) | **DENY** | **DENY** |
| `sso_providers` | `ALL` | **DENY** (`L97, L150`) | **DENY** | **DENY** | **DENY** |
| `audit_logs` | `SELECT` (server writes) | `SELECT` own `property_id` (non-secret operational logs) or **DENY** | **DENY** | **DENY** | **DENY** |
| `invoices` | `SELECT` (server writes) | `SELECT` own `property_id` | **DENY** | **DENY** | **DENY** |
| `super_admins` | `SELECT` own row (`auth_is_super_admin()` `SECURITY DEFINER`) | **DENY** | **DENY** | **DENY** | **DENY** |
| `checkout_intents` / `otp_codes` / `otp_rate_limits` / `trusted_devices` / `stripe_events` / `sso_jti_nonces` | **Server-only** (`service_role` / `SECURITY DEFINER` RPCs; zero client `SELECT/WRITE`) | **DENY** | **DENY** | **DENY** | **DENY** |

### 3.3 Storage Bucket RLS & Super Admin Property Switcher
- **6 Private Storage Buckets:**
  1. `staff-photos`: **Private bucket** with non-enumerable object paths (`<property_id>/<person_id>/<uuid>.webp`); short-lived signed URLs issued **only** by `resolve-room-view` (for `active` + agreement-signed `role = 'staff'`) or authenticated property queries—so `inactive` staff photos immediately stop resolving; write restricted to `property_admin` of matching `property_id` prefix.
  2. `property-backdrops`: **Private bucket** storing per-property Resort Glassmorphism hero photographs (`<property_id>/<uuid>.webp`); write restricted to `super_admin` and owning `property_admin` (own `property_id` prefix, `<= 5 MB` validated JPEG/WebP/PNG); short-lived signed URLs issued via `resolve-room-view` (when `properties.status = 'active'`) and authenticated `/staff` sessions.
  3. `qr-templates`: Private; read/write `super_admin` only (`L150`: property admin cannot edit templates).
  4. `qr-exports`: Private signed URLs (15-min TTL); read `property_admin` (own `property_id`) & `staff` (own `person_id` personal QR only).
  5. `assignment-sheets`: Private signed URLs; read/write `property_admin` & `dept_manager` (own `property_id` / `department_id`).
  6. `signed-agreements`: Private immutable bucket (`UPDATE/DELETE` blocked for all); `super_admin` reads all; `property_admin` reads own `property_id` agreement; `staff` reads own `person_id` agreement.
- **Super Admin Property Switcher Isolation (`L13, L89`):** Super Admin selects a `targetPropertyId` in UI state; backend functions accept `x-active-property-id` **only** when `auth_is_super_admin() = true`. If a `property_admin` sends `x-active-property-id != auth_active_person().property_id`, the backend returns `403 CROSS_PROPERTY_FORBIDDEN` (`AC-5`).
- **Route Guards (`L224`):** React Router wraps every non-guest route in `<RoleGuard allowedRoles={...}>`. Any authenticated user opening a route outside their role (e.g., Staff navigating to `/admin/tips` or Dept Manager to `/super/dashboard`) is immediately redirected to their canonical home route (`/staff`, `/admin/assignments`, `/admin/departments`, or `/super/dashboard`).

---

## 4. Authentication, Salted Hashed OTP, Join QR & SSO Security

### 4.1 Password + 6-Digit Email OTP + Trusted Devices (`L87, L141, L164`)

1. **OTP Generation (`send-otp`):**
   - Generates a cryptographically random 6-digit numeric code (`crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')`).
   - Computes `hashed_code = HMAC_SHA256(OTP_SERVER_SECRET, email.toLowerCase() + ':' + purpose + ':' + salt + ':' + code)` (stored as `salt:digest`), with `expires_at = now() + interval '10 minutes'` and `attempts = 0`.
   - Invalidates any prior unconsumed OTPs for `(email, purpose)` on re-send.
2. **Rate Limiting (`otp_rate_limits`) & Concurrency Locking:**
   - **Send limits:** Max **3 OTP sends per 10 minutes** per normalized `(email, purpose)` bucket AND max **10 sends per hour** per client IP (`429 RATE_LIMITED`). Unauthenticated Join QR OTP requests additionally require Cloudflare Turnstile/CAPTCHA verification so anonymous attackers cannot exhaust staff withdrawal/login OTP quotas.
   - **Verify limits:** `verify_hashed_otp_and_trust_device()` acquires `SELECT ... FOR UPDATE` on the matching `otp_codes` row before checking/incrementing `attempts`, preventing concurrent race crashes on `CHECK (attempts <= 5)`. Max **5 failed attempts** per OTP row (`attempts >= 5` immediately revokes the OTP and forces requesting a new code); constant-time comparison (`crypto.timingSafeEqual`).
3. **Trusted Device Persistence (`L87`):**
   - On `/login`, after valid email + password authentication, the client sends its `trusted_device` HttpOnly/Secure/SameSite=Lax cookie (`fdp_td`).
   - Server hashes the cookie token (`SHA-256`) and verifies an active row in `trusted_devices` (`auth_user_id`, `revoked = false`, `expires_at > now()`).
   - If unrecognized (`new_device`), login transitions to step 2 (`new_device` email OTP). On verification + optional "Trust this browser for 30 days" check, server sets a rotated `fdp_td` cookie and inserts `trusted_devices`.
   - **Withdrawal OTP (`L73`):** `request-withdrawal` **always** requires a fresh `purpose = 'withdrawal'` OTP regardless of trusted device status.

### 4.2 Join QR Onboarding Security (`/join/:propertyId`, `L85, L163`)

- **Information Disclosure & Takeover Control:** `GET /.netlify/functions/join-by-qr?propertyId=...` first checks `FT-23` (`join_qr`) and `properties.status = 'active'`. Because `create-person` strictly leaves `auth_user_id = NULL` on newly created un-onboarded staff rows, `/join/:propertyId` returns **only** `[{ personId, displayName, departmentName }]` for eligible staff restricted strictly to **`auth_user_id IS NULL AND status = 'active'`** (unclaimed onboarding only—**never** listing already-onboarded staff and **never** returning staff email addresses `L147`).
- When an unclaimed staff member selects their name, `POST /.netlify/functions/join-by-qr` verifies `auth_user_id IS NULL`, validates Turnstile/CAPTCHA + `(email, purpose='join_qr')` + IP rate limits, looks up `people.email` **server-side**, and dispatches a `purpose = 'join_qr'` 6-digit OTP to that admin-entered email. Upon OTP verification, the staff member sets their initial password (`auth_user_id` is linked once; subsequent `/join` attempts reject `409 ALREADY_ONBOARDED` and direct them to `/login`, blocking password-reset takeover) and signs the Staff Agreement (`sign-agreement`) before receiving tips or withdrawing.

### 4.3 Single Sign-On (`sso-token`, `L97, L176`)

- Enabled only when `FT-26` (`single_sign_on`) is `true` for the property, `properties.status = 'active'`, and an active row exists in `sso_providers` (`enabled = true`).
- Supports two explicit, cryptographically sound modes per property (`sso_providers.auth_mode`)—**never** verifying `HS256` against a one-way hashed secret and **never** using a single global `SSO_SIGNING_SECRET` to authenticate partners:
  1. **`server_minted` (Recommended Default):** Partner backend calls `POST /.netlify/functions/sso-token` authenticated server-to-server via its per-property `client_id` + `client_secret` (verified by SHA-256 against `sso_providers.hashed_client_secret`; never reusing a browser session). Server validates `credential.property_id === people.property_id` and rejects `role = 'super_admin'`, then mints a **60-second** token signed with platform `SSO_TOKEN_SIGNING_KEY` bound to `{ iss: 'fdp', aud: 'sso', sub: personId, property_id: credential.property_id, jti: uuid, exp: now + 60s }`.
  2. **`partner_asymmetric`:** Partner backend signs a **60-second** `RS256` or `EdDSA` JWT (`{ iss: client_id, aud: 'fdp:sso', sub: personId, property_id, jti, exp }`) with its own private key, and `sso-token/redeem` verifies it strictly against the property's stored `sso_providers.public_key_pem` or `jwks_url`.
- Partner delivers the token to `/login#sso=<token>` (URL fragment + `Referrer-Policy: no-referrer` + `X-Frame-Options: DENY`, or `POST` handoff—never query-string `?sso=` in server access logs); frontend immediately calls `POST /.netlify/functions/sso-token/redeem` (prompting confirmation before swapping if a different authenticated session is active), which:
  1. Verifies the token signature (`SSO_TOKEN_SIGNING_KEY` for `server_minted`, or `sso_providers.public_key_pem`/`jwks_url` `RS256`/`EdDSA` for `partner_asymmetric`), `iss`, `aud`, `exp`, `FT-26`, `sso_providers.enabled = true`, and `properties.status = 'active'`.
  2. Atomically inserts `jti` into `sso_jti_nonces` (`ON CONFLICT DO NOTHING` → single-use replay protection).
  3. Verifies `people.status = 'active'`, `people.property_id === token.property_id`, and non-`super_admin` role, mints a Supabase Auth session for that user, and redirects to their role home screen.
- **Explicit Spec Invariant (`L97`):** External API keys (`api_keys`) **never** grant access to `sso-token` redemption or any admin UI screen.

---

## 5. Server-Side Stripe Verification, Cron Auth & ACID Ledger Integrity (`L60, L143, L153, L160, L193, L196`)

### 5.1 Webhook Signature Verification, Checkout Snapshot & Scheduled Cron Auth (`AC-3`, `AC-4`)

1. `create-tip-checkout` validates `amount_cents` (integer within `[tip_min_cents, tip_max_cents]`), `note` (`<= 150` chars, plain text stripped of HTML/control chars), `properties.status = 'active'`, enabled feature toggles (`FT-1..FT-8, FT-22`), and target eligibility (`status = 'active' AND agreement_signed_at IS NOT NULL AND role = 'staff'` for person targets, plus `department_pool` `FT-4`). For room-assigned tips, it verifies `expectedAssignedPersonId === current assignment.person_id` (returning **`409 ASSIGNMENT_CHANGED`** with refreshed target if mid-day reassignment occurred before checkout `AC-4`). It then inserts a `checkout_intents` row (`status = 'created'`, snapshotting `person_id`/`department_id`) and creates a Stripe PaymentIntent. **Zero `tips`, `ledger`, or `notifications` rows are created here (`L184`).**
2. `stripe-webhook` reads the **raw request body** (`event.body` unparsed) and `Stripe-Signature` header, calling `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)` **before** any DB mutation. Invalid signatures immediately return `400 INVALID_SIGNATURE`.
3. **Exactly-Once Idempotency:** Inside a Postgres transaction (`record_verified_tip_payment`), the function inserts `stripe_events(event_id, event_type) ON CONFLICT (event_id) DO NOTHING`. If `0` rows inserted, it returns `200 { deduplicated: true }`.
4. **Atomic Wallet Credit:** On `payment_intent.succeeded`:
   - Marks `checkout_intents.status = 'succeeded'` and acquires row locks in deterministic order (`departments` → `people` in ascending UUID order) via `SELECT ... FOR UPDATE`.
   - Re-checks `people.status`: if the recipient became `inactive` between checkout creation and webhook arrival (`L186`):
     - If **`FT-4` (`department_pool_tips`) is `true`**: routes credit to `department_pool` seamlessly.
     - **Else (`FT-4` is `false`)**: credits the `inactive` recipient's own withdraw-only wallet (`ledger` `tip_credit` + `wallet_balance_cents`) and records an `audit_logs` entry (`action = 'tip_credited_inactive_recipient_no_pool'`)—honoring the guest's captured payment to the shown recipient without orphaned funds while the `inactive` person retains withdraw-only `/staff` access (`L79`).
   - **Inserts** the confirmed `tips` row (`status = 'paid'`, `paid_at = now()`) for the first time (`AC-3`, `L184`).
   - Appends `ledger` (`type = 'tip_credit'` or `'pool_credit'`, `+amount_cents`, `idempotency_key = 'tip_credit:' || tip_id`). If `payment_fee_paid_by = 'staff'`, appends `ledger` (`type = 'fee'`, `-fee_cents`).
   - Recomputes/updates `people.wallet_balance_cents = wallet_balance_cents + net_cents` (or pool ledger) and updates `last_activity_or_credit_at = now()`.
   - Inserts `notifications` (`property_id`, `person_id`, `type = 'tip_received'`, guest note snippet) if `FT-16` is enabled.
   - If `FT-2` is enabled and `guest_email` was provided, dispatches receipt email via `EmailAdapter` *after* DB commit.
   - **Webhook Refund Finalization (`charge.refunded`):** `stripe-webhook` also handles verified `charge.refunded` events to idempotently transition `tips.status = 'refund_pending'` → `'refunded'` (and clear `active_refund_attempt_id`) when a Phase 2 Stripe call succeeded asynchronously or after a network timeout.
5. **Cron Endpoint Authentication (`run-weekly-payouts-background`, `reconcile-stale-payouts-background`, `unclaimed-reminders-background`):** All `pg_cron`-invoked Netlify Background Functions validate `Authorization: Bearer <CRON_SECRET>` (or timestamped HMAC-SHA256 header stored in Supabase Vault for `pg_net`) using `crypto.timingSafeEqual`, immediately returning `401 UNAUTHORIZED` to any unauthenticated HTTP caller.

### 5.2 Double-Entry Ledger Invariants & Concurrency Serialization

- **Immutability:** A Postgres trigger blocks `UPDATE` and `DELETE` on `ledger`. Corrections (refunds, refund reversals, chargebacks, chargeback reversals, failed payout reversals) are strictly new signed rows.
- **Deterministic Lock Order & Serialization (`SELECT ... FOR UPDATE`):** Every balance-mutating RPC (`record_verified_tip_payment`, `execute_pool_distribution`, `create_withdrawal_and_reserve_ledger`, `reserve_24h_tip_refund`, `finalize_tip_refund`, `record_chargeback_dispute`, `reverse_won_dispute`) acquires row-level locks in strict canonical order—**`departments` → `tips` → `people` (sorted by ascending UUID)**—eliminating concurrent withdrawal/refund races, pool double-spends, and deadlocks.
- **Reconciliation Check:** A scheduled/diagnostic SQL invariant `SELECT person_id FROM people p WHERE p.wallet_balance_cents <> COALESCE((SELECT SUM(amount_cents) FROM ledger l WHERE l.person_id = p.id), 0)` must always return **0 rows** (and unallocated pool balance per department is strictly `SELECT COALESCE(SUM(amount_cents), 0) FROM ledger WHERE department_id = $1 AND person_id IS NULL`, never `< 0` except under unallocated pool chargeback).

---

## 6. 24-Hour Refund & Negative-Balance Chargeback Controls (`L75–L77, L168–L169, L199`)

| Control | 24-Hour Refund (`refund-tip`, `AC-9`) | Chargeback Dispute (`handle-dispute`) |
|---|---|---|
| **Trigger / Actor** | Property Admin only (`role = 'property_admin'` of owning `property_id`; `dept_manager` blocked `L15, L56`) via `/admin/tips` (`FT-20` enabled). | Automated via verified `stripe-webhook` (`charge.dispute.created` & `charge.dispute.closed`). |
| **Time Window** | **Strict server check:** `now() - tips.paid_at <= interval '24 hours'` (86,400 seconds). Expired requests rejected with `422 REFUND_WINDOW_EXPIRED` (`AC-9`). | No time limit (driven by card network dispute). |
| **Balance Rule** | **Must be covered (locked inside TX):** Locks `tips` (`status = 'paid'`) + recipient (`people` or `departments` for undistributed pool) `FOR UPDATE` in canonical order; requires `balance >= tip.net_cents`. If staff already withdrew funds (or pool already distributed below refund amount), rejected with `422 INSUFFICIENT_RECIPIENT_BALANCE` (`L75`). | **Negative balance allowed (`L77`):** For `recipient_type = 'person'`, locks `people` `FOR UPDATE` and deducts `amount_cents` allowing `wallet_balance_cents < 0`. For `recipient_type = 'department_pool'`, locks `departments` `FOR UPDATE` and debits unallocated pool ledger if sufficient; if already distributed via `pool_distributions`, locks allocated `people` rows in ascending UUID order and applies proportional `chargeback` debits (allowing negative balances). **Property is never debited (`L77`).** |
| **Two-Phase Execution & Ledger** | **Phase 1 (DB TX):** Generates `attempt_uuid = gen_random_uuid()`, sets `tips.status = 'refund_pending'`, `active_refund_attempt_id = attempt_uuid`, `refund_pending_started_at = now()`, `refund_attempt_count = refund_attempt_count + 1`, inserts reservation `ledger` (`type = 'refund'`, `-net_cents`, `idempotency_key = 'refund:' || tip_id || ':' || attempt_uuid`), and decrements cached balance.<br>**Phase 2 (Stripe):** Calls `stripe.refunds.create({ payment_intent, metadata: { tip_id, attempt_uuid } }, { idempotencyKey: 'refund:' + tipId + ':' + attemptUuid })` outside DB locks.<br>**Phase 3 (Finalize & Timeout Reconciliation):** Sets `tips.status = 'refunded'` and clears `active_refund_attempt_id = NULL`. On deterministic Stripe failure only, compensates `tips.status = 'paid'`, clears `active_refund_attempt_id = NULL`, inserts `ledger` (`type = 'refund_reversal'`, `+net_cents`, `idempotency_key = 'refund_rev:' || tip_id || ':' || attempt_uuid`), and restores balance—so retrying within 24h allocates a new `attempt_uuid` with zero `ledger.idempotency_key` collision. Network-timed-out `refund_pending` rows are reconciled by `stripe-webhook` (`charge.refunded`) and the hourly `reconcile-stale-payouts-background` job (`reconcile_stale_refunds()` for `>15m` via `stripe.refunds.list({ payment_intent })`). | Marks `tips.status = 'disputed'`, appends `ledger` (`type = 'chargeback'`, `-amount_cents`), updates balance(s), inserts `notifications` (`type = 'chargeback'`). Subsequent tips offset negative balance until `> 0`. On `charge.dispute.closed` (`status = 'won'`), reverts `tips.status = 'paid'` and appends `ledger` (`type = 'chargeback_reversal'`, `+amount_cents`). |

---

## 7. External API Key Scoping, Rotation, Revocation & Rate Limiting (`L97, L140, L175, L228–L237`)

- **Generation (Super Admin only, `/super/integrations`):** Generates `fdp_live_<32_random_bytes_base64url>`. Stores only `key_prefix` (first 12 chars) and `hashed_key = SHA-256(raw_key)` in `api_keys` bound to one `property_id` and non-empty `scopes[]` (`cardinality(scopes) > 0`) subset of `['assignments:write', 'people:read', 'tips:read', 'people:write']`. Plaintext key is displayed **once** at creation.
- **Request Auth & Tenant Validation (`api-gateway`):**
  1. Accepts `X-API-Key: <key>` or `Authorization: Bearer <key>`.
  2. Computes `SHA-256`, fetches `api_keys` + `properties.status` + `FT-25` (`external_api`).
  3. **Missing, malformed, unknown, or `revoked = true` key → `401 UNAUTHORIZED`** (`L237`).
  4. **Property unavailable (`properties.status IN ('pending', 'restricted', 'cancelled')`) → `403 PROPERTY_UNAVAILABLE`**.
  5. **Valid key lacking required scope** (or `POST /assignments` when `FT-13` `api_assignment_push` is `false`, or `FT-25` disabled) → **`403 FORBIDDEN`** (`L237`).
  6. **Composite ownership checks:** `POST /people` and `POST /assignments` strictly validate `(api_key.property_id, department_id)` and `(api_key.property_id, id)` ownership, preventing cross-property UUID writes.
  7. **Rate limiting:** 120 requests/minute per `api_key.id` (returns `429 TOO_MANY_REQUESTS` + `Retry-After`).
- **Zero-Downtime Rotation & Revocation:** Super Admin creates a second active key for the property (`label: "PMS Rotation Nov"`), updates the partner integration, then clicks **Revoke** (`revoked = true, revoked_at = now()`) on the old key—immediately returning `401` on any subsequent use and writing an `audit_logs` entry.

---

## 8. Contract Signing Logs & Compliance Boundaries (`L72, L79–L81, L93, L105, L139, L270`)

### 8.1 Immutable Click-to-Accept Contract Logs (`sign-agreement`)
- Both Property Service Agreements (`signer_type = 'property'`, signed by Property Admin before `properties.status` can become `'active'`) and Staff Agreements (`signer_type = 'staff'`, signed at first login/Join QR before receiving tips or withdrawing) flow through `POST /.netlify/functions/sign-agreement`.
- Server validates active authenticated session, captures `typed_name` (non-empty), `checkbox_confirmed = true`, server `signed_at = now()`, request `ip_address` (from trusted Netlify `x-nf-client-connection-ip` header), `user_agent`, and contract `version`.
- Renders a timestamped immutable PDF/HTML artifact containing full terms + signature block and uploads it to `signed-agreements/<property_id>/<signer_type>_<signer_id>_v<version>.pdf`, inserting the `agreements` row (`L93, L139`).
- **Property Term & Setup Mutability (`L93`):** Property agreements default to `contract_term_months = 12` (auto-renewing) and `notice_days = 30` (editable by Super Admin per property). Setup changes (QR template, departments, pool split method) do **not** require re-signing. DocuSign integration can later attach `external_envelope_id` to `agreements` without schema breakage.

### 8.2 Financial, KYC & Unclaimed-Funds Compliance Boundaries
1. **Zero Bank/Card/Identity Storage (`L72, L105`):** Card details (guest checkout), bank accounts, debit cards (staff withdrawals), and SSN/KYC verification are collected **exclusively by Stripe** (Stripe Payment Element / Checkout & **Stripe Connect Express** hosted payout onboarding forms). Our database stores only opaque Stripe IDs (`stripe_payment_intent_id`, `stripe_customer_id`, `stripe_connect_account_id`).
2. **Stripe Connect Express Settlement Boundary (`L81, OI-4`, Signed Off Nov 25, 2026):** Payout execution is signed off on **Stripe Connect Express** (`Separate Charges and Transfers` behind `PayoutExecutor`), so Stripe holds KYC/payout onboarding and removes state money-transmitter custodial liability from the platform operator. Pre-live counsel sign-off still validates lawyer-drafted agreement wording, tax 1099-K handling, and state-specific escheatment rules.
3. **Unclaimed Balances & 30/60/90-Day Reminders (`L79, L172, L270`):**
   - Wallet balances belong to staff until withdrawn.
   - `inactive` staff or staff of a `cancelled` property automatically retain a **withdraw-only `/staff` view** (`L79`).
   - Turning off tipping/payout feature toggles (`FT-17`, `FT-19`) **never** freezes existing balances—funds remain withdrawable **unless** the property is `status = 'restricted'` for unpaid subscription (`L270`).
   - `unclaimed-reminders-background` (`pg_cron` daily via Vault `CRON_SECRET`) finds `people` with `wallet_balance_cents > 0` whose `now() - last_activity_or_credit_at >= 30 | 60 | 90 days` (and `last_reminder_milestone` < current milestone), emails withdrawal instructions via `EmailAdapter`, and logs milestone completion. State escheatment timelines post-90 days are flagged for legal counsel (`OI-4`).
