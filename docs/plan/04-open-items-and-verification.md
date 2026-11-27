# 04 — Section 20 Open Item Proposals, Build Order & Verification Plan (Requirement R4)

> **Status:** Signed-Off Decisions & Pre-Live Verification Blueprint (Core Sign-Offs Locked Nov 25, 2026)  
> **Scope:** Requirement `R4` & Verification — Signed-Off vs. Pending External Items across Section 20 Open Items (`OI-1`..`OI-6`) + 2 Pre-Launch Confirmations, Adapted 10-Step Build Order (Spec Section 18), and Complete Section 14 Acceptance Check (`AC-1`..`AC-9`) & Security Rubric Verification Matrix.

---

## 1. Section 20 Open Items: Settled Requirements vs. Signed-Off & Pending Items (`OI-1`..`OI-6`)

Per **Spec Section 8 (`L101`)** and **Section 20 (`L272`)**, settled requirements are separated from the product decisions signed off on Nov 25, 2026 and the remaining external/legal items required before live production launch.

### `OI-1`: Minimum & Maximum Tip Amounts and Preset Tip Buttons (`L274`) — **Signed Off (Nov 25, 2026)**

- **Settled Spec Constraints:**
  - All amounts stored as **positive whole integer cents** (`L124, L180`).
  - Tip UI must present **preset buttons plus a custom amount input** (`L31, L180`).
- **Signed-Off Configuration:**
  - **Minimum Tip:** **`$1.00` (`100` cents)** when `payment_fee_paid_by = 'guest'` (guest pays Stripe fee), OR **`$2.00` (`200` cents)** floor when `property` or `staff` absorbs Stripe's `$0.30 + 2.9%` fee.
  - **Maximum Tip:** **`$200.00` (`20000` cents)** default ceiling per transaction; configurable per property by Super Admin up to **`$500.00` (`50000` cents)** with standard Stripe Radar velocity/3DS checks.
  - **Preset Buttons:** **`[$3, $5, $10, $20]`** (`[300, 500, 1000, 2000]`) + `Custom` stored per property (`properties.tip_min_cents`, `tip_max_cents`, `tip_presets_cents`).

### `OI-2`: Embed Dashboard in Partner Software vs. Data API Only (`L275`) — **Signed Off (Nov 25, 2026)**

- **Settled Spec Constraints:**
  - Standalone web app connecting to PMS/housekeeping/payroll via `apiGateway` (`L97`).
  - Super-admin-configured SSO uses short-lived signed tokens so partner-authenticated users land without re-logging; an API key alone never grants admin UI access (`L97, L176`).
  - Must not add unlisted screens (`L203`).
- **Signed-Off Phase 1 Approach:**
  - **Phase 1 Launch (Signed Off): Standalone SSO Redirect/Popup (`/login#sso=<token>`) + v1 REST Data API (`api-gateway`).** Partner software calls `sso-token` (via per-property `sso_providers`), opens `/login#sso=<token>` (`Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`), and consumes `api-gateway` for data sync.
  - **Deferred to Phase 2 (If Requested by Partner):** Hardened Iframe Embed Mode (`?embed=1`) with per-property `allowed_frame_origins`, CSP `frame-ancestors`, and in-memory token exchange.

### `OI-3`: Exact External API Request & Response Formats (`L276`)

- **Settled Spec Constraints (`L228–L237`):**
  - Served by `apiGateway` (`/.netlify/functions/api-gateway/*`).
  - Secured by hashed per-property API key sent in a request header (`L140, L228`).
  - Four endpoints + scopes: `POST /assignments` (`assignments:write`), `GET /people` (`people:read`), `GET /tips` (`tips:read`), `POST /people` (`people:write`).
  - Missing/wrong/revoked key → `401`; wrong scope → `403`. Exact JSON payloads must not be invented without partner alignment (`L237`).
- **Proposed v1 Contract Draft (For First Partner Review — Explicitly Marked Proposed):**
  - **Auth & Headers:** `X-API-Key: fdp_live_...` (also accept `Authorization: Bearer fdp_live_...`), `Content-Type: application/json`, optional `Idempotency-Key: <uuid>` on `POST` routes.
  - **Conventions:** All money in integer cents (`amountCents`), dates in `YYYY-MM-DD`, timestamps in ISO-8601 UTC (`...Z`), cursor/offset pagination (`limit` max `100`, `cursor`), rate limit `120 req/min` (`429 TOO_MANY_REQUESTS`).
  - **Canonical Error Envelope:** `{ "error": { "code": "INSUFFICIENT_SCOPE", "message": "...", "requestId": "req_..." } }`.
  - **Proposed Endpoint Shapes:**
    - `POST /assignments`: `{ "date": "2026-11-26", "assignments": [{ "roomNumber": "101", "personId": "uuid" /* or "externalEmail" */ }] }` → `200 { "savedCount": 12, "reassignedCount": 1, "unmatchedRooms": [] }` (gated by `FT-25` & `FT-13`).
    - `GET /people?status=active&departmentId=...&cursor=...`: `{ "departments": [...], "people": [{ "id", "name", "email", "role", "departmentId", "status" }], "nextCursor": null }`.
    - `GET /tips?from=2026-11-01&to=2026-11-26&cursor=...`: `{ "tips": [{ "id", "amountCents", "feeCents", "netCents", "recipientType", "personId", "departmentId", "roomNumber", "status", "createdAt" }], "nextCursor": null }` *(omits guest email/PII)*.
    - `POST /people`: `{ "id"?: "uuid", "name", "email", "role", "departmentId", "status"?: "active"|"inactive" }` → `201/200 { "person": { ... } }`.
- **Sign-Off Question:** *Review this v1 API draft with the first PMS/housekeeping integration partner before locking OpenAPI schema.*

### `OI-4`: Payment Architecture (Signed Off) & Remaining Pre-Live Legal Checks (`L81, L93, L277`)

- **Settled Spec Constraints:**
  - App never stores bank/card/identity docs (`L72, L105`).
  - Unclaimed balances stay staff's until withdrawn; inactive/cancelled retain withdraw-only view; 30/60/90-day reminders sent (`L79`).
  - Click-to-accept `agreements` (`typedName`, checkbox, timestamp, IP, version, stored copy); Property Agreement defaults 12m/30d (`L93, L139`).
- **Signed-Off Payout Architecture (Nov 25, 2026):**
  1. **Stripe Connect Express (`Separate Charges and Transfers`, `L81`):** Signed off behind `PayoutExecutor`. Staff link bank accounts/debit cards and complete KYC via Stripe-hosted Express onboarding (`create-connect-onboarding-link`), keeping custodial money-transmitter liability off the platform and storing zero bank/card/SSN fields locally (using `mock` / `stripe_test` locally).
- **Remaining Pre-Live Legal Sign-Offs (Before `PAYMENT_MODE=stripe_live`):**
  2. **Unclaimed Funds / State Escheatment (`L79`):** After the 30/60/90-day email reminders, counsel confirms state-specific dormancy cutoff (typically 1–5 years depending on state wage/property law) and manual compliance export procedure for escheatment reporting.
  3. **Lawyer-Drafted Agreement Templates (`L93`):** Counsel supplies final text for (a) Property Service Agreement (12m auto-renew, 30d notice, flat SaaS billing, no tip %, non-payment restriction clause), (b) Staff Terms (payout fees, instant debit fee, negative-balance chargeback recovery, unclaimed balance policy), and (c) Guest Short Terms line. Keep `external_envelope_id` column ready for optional DocuSign later (`L93`).
  4. **Tax / 1099-K Reporting:** Confirm with CPA/Stripe Connect Express whether Express accounts trigger Stripe-handled 1099-K / payroll reporting responsibilities.

### `OI-5`: Real Sample Housekeeping Sheet & Matching Test Plan (`L278`)

- **Settled Spec Constraints (`L118, L239–L247`):**
  - PDFs use **text extraction** (no OCR); camera photos use **OCR** (`L118, L241`).
  - 7 rules: exact property room-number token matching; case/whitespace-insensitive active housekeeper matching (full name first, unique first name second); shared first name flagged for manual dropdown; same line/block pairing; **no fixed column layout**; **mandatory review screen before saving** (`L241–L247`).
- **Proposed Synthetic Corpus & Pre-Launch Validation Plan:**
  - Until Sanju supplies 3–5 anonymized real hotel PDFs/photos, build a **7-case synthetic test suite**:
    1. Clean 2-column digital PDF (`Room | Attendant`).
    2. Landscape multi-section PMS export (Floor headers + Check-out/Stayover notes + Room + Full Name).
    3. Messy whitespace/comma-inverted format (`"104 - Garcia, Maria"`).
    4. Shared first-name collision (`"105 Maria"` when Maria Garcia & Maria Lopez are both active → must flag `ambiguous`, never guess `L246`).
    5. Unlisted room (`"999"`) or unknown name (`"Temp Agency"` → must flag `unmatched`).
    6. Skewed/low-light smartphone camera photo (`OcrAdapter` `sharp` + `tesseract.js`).
    7. Scanned image-only PDF (0 extracted text characters → clear UX message routing user to Photo OCR).
  - *Decision:* Ship purely rule-based matching first (`L50`); add optional LLM fallback only if real hotel sheets fail rule matching >10% of lines.

### `OI-6`: Branding, Visual Theme, Copy & Recipient Eligibility (`L279`) — **Signed Off (Nov 25, 2026)**

- **Settled Spec Constraints:** Room/dept/person flow (`L29–L36`), ~150-char plain-text note, optional guest-paid fee line, optional email receipt, short terms line, friendly invalid-link & restricted-property notices (`L183, L187`).
- **Signed-Off Visual Direction, Copy & Recipient Rules (Detailed in `03-ui-ux-and-motion-design.md` §2):**
  - **Tipper & Receiver Visual Theme:** **Boutique Resort Glassmorphism** for Tipper (`RT-1`..`RT-3`) paired with **Warm Resort Glass** for Staff Receiver (`RT-4`..`RT-6`)—full-bleed resort photography (`properties.hero_photo_path` in `property-backdrops`, falling back to bundled golden-hour boutique resort photograph), warm dark-brown gradient scrim (`rgba(28,17,10,0.14)` → `rgba(18,11,6,0.90)`), non-nested 4-layer frosted glass controls, warm ivory ink (`#FAF6F0`), luminous champagne CTA, and self-hosted `Fraunces` + `Plus Jakarta Sans`.
  - **Signed-Off Recipient Eligibility:** Frontline **`role = 'staff'`** only for individual guest tipping and pool payouts (`dept_manager` excluded from guest tip lists and pool splits), with **Whole Department Pool (`FT-4`)** enabled for guests.
  - **Signed-Off Gesture Copy Pack:**
    - *Assigned greeting:* `"A warm thank-you for {Name}"` · `"Caring for Room {RoomNumber} today · 100% goes to {Name}"`
    - *Unassigned / Dept greeting:* `"Thank our {DepartmentName} Team"` · `"Room {RoomNumber} · Shared equally across today’s team"`
    - *Fee line (`guest` paid):* `"Include processing fee (+${fee})"` · `"Total ${total}"`
    - *Primary CTA / Thank-you:* `"Send ${amount} Thank-You"` → `"Sent with thanks"` → `"Thank you — ${amount} sent"`
    - *Short terms line:* `"Secured by Stripe · Non-refundable after 24 hours"`
    - *Invalid link (`L183`):* `"We couldn't find this tipping link. Please ask the front desk for an updated QR code."`
    - *Restricted property (`L187`):* `"Tipping is temporarily unavailable for this property."`

### Pre-Launch Operational Confirmations (Outside Section 20)
1. **Stripe Card Rate (`L62`):** Confirm live Stripe US online card + Apple/Google Pay rate (`2.9% + $0.30` baseline) and Instant Payout debit card fee with Stripe before enabling `PAYMENT_MODE=stripe_live`.
2. **Resend Domain & Plan (`L116`):** Verify DNS (SPF/DKIM/DMARC) for the production sending domain and upgrade past Resend's 100 emails/day free tier before launch.

---

## 2. Adapted 10-Step Build Order (Spec Section 18 Mapped to Supabase + Netlify)

Per **Spec Section 18 (`L249–L262`)**, implementation proceeds in 10 gated steps, running matching Section 14 checks (`AC-1`..`AC-9`) after each step:

| Step | Spec Section 18 Scope | Supabase + Netlify Implementation Deliverables | Gating Acceptance Checks |
|---|---|---|---|
| **1** | Project, Auth, Roles, Security Rules & Data Model | Initialize `supabase/` migrations (24 tables incl. `checkout_intents`, `sso_providers`, & `properties.hero_photo_path` + composite tenant-safe FKs + triggers + `FORCE RLS` + Custom Access Token Hook + **6 private Storage buckets** incl. `property-backdrops`) + `seed.sql` + `PaymentAdapter`/`EmailAdapter` stubs + fail-closed prod boot guards. | `AC-5`, `AC-6` (RLS isolation, `people` column protection & ledger immutability tests) |
| **2** | Super Admin Shell, Onboarding, Templates & Contracts | Build `/super/dashboard`, `/super/properties` (7-step wizard w/ `timezone`, `(x,y,size)` QR placer, `hero_photo_path` Resort Glassmorphism preview upload, & 27-toggle matrix), `/super/payments`, `/super/admins`, `sign-agreement` (`agreements` + `signed-agreements` PDF). | Property `pending -> active` gate + `FT-1..27` toggle unit tests |
| **3** | Departments, People, Invites, OTP & Staff Agreements | Build `/admin/departments` (`delete-department` reassign RPC), `/admin/people` (`create-person` / `update-person` w/ nullable `property_admin` `department_id`), `/login` (OTP + `trusted_devices` + inline Property/Staff agreements), `/join/:propertyId` (`join-by-qr` unclaimed `role='staff'` only). | `AC-8` (forced dept reassignment), OTP `FOR UPDATE` rate-limit & Join QR email-hiding tests |
| **4** | Rooms & Bulk/Single QR Generation | Build `/admin/rooms` (single + range `101–140` + property backdrop upload) + `generate-qr-cards` / `generate-qr-cards-background` (template-stamped PNG/PDF/ZIP for rooms, depts, staff). | `FT-6,7,8,9` toggle gates + QR output verification |
| **5** | Daily Assignments (Manual, PDF, Photo OCR, Mid-Day) | Build `/admin/assignments` + `parse-assignment-sheet` / `parse-assignment-sheet-background` (`pdf-parse`, `OcrAdapter`, 7 matching rules filtered to `role='staff'`, 2-col review workbench) + `save-assignments` (property `timezone`). | `AC-4` prep + 7-case `OI-5` matching suite |
| **6** | Guest Tipping Pages & Stripe Checkout + Webhook | Build `/tip/room/:roomId`, `/tip/dept/:departmentId`, `/tip/person/:personId` (*Boutique Resort Glassmorphism*), `resolve-room-view` (signed `staff-photos` & `property-backdrops` URLs, `role='staff'` + `FT-4` pool, `422 RECIPIENT_UNAVAILABLE`), `create-tip-checkout` (`checkout_intents` + `409 ASSIGNMENT_CHANGED`), `stripe-webhook`. | `AC-1`, `AC-2`, `AC-3`, `AC-4` + guest PII minimization tests |
| **7** | Wallet Ledger, Notifications, Tips Overview & Pool Split | Build `/staff` (*Warm Resort Glass*, wallet, rooms, Realtime bell/toasts, personal QR) & `/admin/tips` (KPIs, filters, `distribute-pool` `split`/`individual` across `role='staff'` w/ `departments` lock, `export-tips` CSV/PDF export). | `AC-3`, `AC-6` + pool sum conservation & `pool_distributions` staff-deny tests |
| **8** | Withdrawals, Connect Express Weekly/Instant Payouts, Refunds, Chargebacks & Reminders | Implement `create-connect-onboarding-link` + `request-withdrawal` (OTP + min check + `net_payout_cents`), `pg_cron` `run-weekly-payouts-background` (`CRON_SECRET` auth + `DOW = payout_weekday AND HOUR = 9` in `p.timezone` + `UNIQUE (property_id, payout_date)` + `LIMIT 20` chunks via Stripe Connect Express transfers), hourly `reconcile-stale-payouts-background` (>15m stale `processing` withdrawals & `refund_pending` tips), instant debit payout (`payout_reversal`), two-phase `refund-tip` (`refund:<tip_id>:<attempt_uuid>` + `charge.refunded`), `handleDispute` (`person` & `department_pool` + `chargeback_reversal`), `unclaimed-reminders-background` (30/60/90d). | `AC-7`, `AC-9` + negative balance recovery & `L270` invariant tests |
| **9** | Property Billing & Non-Payment Restrictions | Implement `billing-sync` (Stripe subscription webhooks, retries, `restricted` <-> `active`, `invoices` mirror). | Restricted property guest-block (`L187`) & withdrawal-block (`L270`) tests |
| **10** | External API & Single Sign-On | Build `/super/integrations`, `api-gateway` (hashed scoped keys, `401`/`403`/`429`, `pending`/`restricted`/`cancelled` block), and `sso-token` (per-property `sso_providers` + `#sso=` fragment + `sso_jti_nonces`). | `401`/`403` scope matrix + cross-property SSO block & API-key UI rejection test |

---

## 3. Complete Verification Matrix: Section 14 Acceptance Checks (`AC-1`..`AC-9`) & Security Rubric

| Check ID | Spec Requirement (`L191–L199`) | Test Setup & Execution Steps | Expected Verified DB / API / UI Outcome | Automation Target |
|---|---|---|---|---|
| **`AC-1`** | *Guest scanning room QR with assigned housekeeper sees that person first, then all departments.* | Seed active Property A, Room `101` assigned today to active Housekeeper Maria, plus 3 departments. Unauthenticated Playwright visits `/tip/room/<room101_id>`. | `resolve-room-view` returns `assignedHousekeeper` (name + photo only) + `departments[]`; **zero** emails/balances in JSON; UI renders Maria card above department accordion. | Playwright E2E + API contract test |
| **`AC-2`** | *With no assignment, only departments are shown, and housekeeping lists all housekeepers.* | Seed Room `102` with **no** today assignment; Housekeeping has 2 active + 1 `inactive` housekeeper. Visit `/tip/room/<room102_id>` and expand Housekeeping. | `assignedHousekeeper === null`; UI shows Departments only; expanding Housekeeping shows Whole Pool (`FT-4`) + 2 active housekeepers (**inactive hidden** `L25`). | Playwright E2E + API contract test |
| **`AC-3`** | *Paid tip appears in recipient's wallet and notification only after Stripe webhook confirms it.* | Initiate `$10.00` tip on `/tip/room/<room101_id>` (`create-tip-checkout`). Inspect DB (`checkout_intents` vs `tips`) & `/staff` **before** webhook; then POST signed `payment_intent.succeeded` (and replay twice) to `stripe-webhook`. | Before webhook: `0` `tips` rows (`L184`), `wallet_balance_cents = 0`, 0 `ledger` rows, 0 `notifications`. Invalid webhook signature → `400`. After signed webhook: `checkout_intents.status = 'succeeded'`, `tips` inserted with `status = 'paid'`, 1 `ledger` credit (`+1000`), `wallet_balance_cents = 1000`, Realtime toast/bell on `/staff`. Replay → deduplicated (`stripe_events`). | Vitest integration + Playwright |
| **`AC-4`** | *Tip after a mid-day reassignment goes to the new housekeeper.* | Guest loads Room `101` at T0 (Maria assigned); Admin reassigns Room `101` to Elena in `/admin/assignments` (`FT-14`). Verify: (a) guest submitting stale T0 checkout hits `409 ASSIGNMENT_CHANGED` and refreshes to Elena; (b) in-flight `checkout_intents` started pre-reassignment still credits Maria; (c) post-reassignment checkout (`$8`) credits Elena. | Maria keeps pre-reassignment tips; post-reassignment checkout credits Elena (`800¢`); `assignments.reassigned_from_person_id = maria.id`. | Vitest + Playwright E2E |
| **`AC-5`** | *Property admin cannot read another property's data.* | Authenticate as Property Admin A (`property_id = A`). Attempt direct Supabase SDK `SELECT`, cross-property FK injection, and Netlify Function requests (`x-active-property-id = B`) against Property B's `people`, `rooms`, `tips`, `ledger`, `agreements`, and `signed-agreements` Storage paths. | Postgres `FORCE RLS` returns **0 rows** on `SELECT` and rejects cross-property `INSERT/UPDATE` (`42501` / composite FK `23503`); Netlify Functions return `403 CROSS_PROPERTY_FORBIDDEN`. | Automated RLS security test (`pgTAP` / Vitest) |
| **`AC-6`** | *Staff member cannot change their own balance.* | Authenticate as Staff user (plus test Property Admin attempting direct client `UPDATE people` on `wallet_balance_cents`, `auth_user_id`, `stripe_connect_account_id`, or `agreement_signed_at`, and Staff attempting `SELECT` on `pool_distributions`). | All unauthorized client mutations are **rejected by Postgres RLS & revoked writes** (`42501`); Staff `SELECT` on `pool_distributions` is **denied**; `wallet_balance_cents` remains equal to `SUM(ledger.amount_cents)`. | Automated RLS security test |
| **`AC-7`** | *Withdrawal request shows the next payout day and is paid in the weekly batch.* | Staff has `$25.00` balance; `min_withdrawal_cents = 1000`, `payout_weekday = 4` (Thursday in `properties.timezone`). Request OTP (`stub`/`Mailpit`), submit `$25.00` Standard withdrawal on `/staff`, test unauthenticated `run-weekly-payouts-background` call (`401`), invoke with `CRON_SECRET` across multiple Thursday hours (e.g. `09:00` and `11:00` local), plus a post-9 AM Thursday withdrawal and a simulated mid-batch crash (`reconcile-stale-payouts-background`). | `/staff` shows `"Next payout: Thursday"`; `withdrawals.status = 'queued'` with `ledger` debit; unauthenticated cron call returns `401`; `run-weekly-payouts-background` creates **at most one** `payout_batches` row (`UNIQUE (property_id, payout_date)`) at `09:00` local, ignores `11:00` local so post-9 AM requests queue for next Thursday, marks withdrawal `paid` via `stripe_idempotency_key`, and `reconcile-stale-payouts-background` recovers >15m `processing` rows cleanly. (Also test `< $10` & `> balance` rejected `422`.) | Vitest + Playwright |
| **`AC-8`** | *Deleting a department with people forces reassignment first.* | Create Dept `"Valet"` with 1 active person. Attempt direct `DELETE` / RPC without target dept, then use `/admin/departments` delete prompt selecting `"Front Desk"`. | Direct delete fails (`23503` composite FK `ON DELETE RESTRICT`); UI opens reassignment drawer; confirming atomically moves person to `"Front Desk"` and deletes `"Valet"`. (Admin `property_admin` with `department_id = NULL` never blocks department deletion.) | Vitest + Playwright |
| **`AC-9`** | *Refund after 24 hours is blocked.* | Seed two paid tips: Tip 1 (`paid_at = now() - 2h`, staff balance sufficient) and Tip 2 (`paid_at = now() - 25h`). Property Admin invokes two-phase `refund-tip` on both (plus `dept_manager` attempting Tip 1, simulated deterministic Stripe error triggering `refund_reversal` followed by a **second retry** on Tip 1, and a simulated Phase 2 timeout reconciled via `charge.refunded` / `reconcile-stale-payouts-background`). | Tip 1 (`<24h`, Property Admin) transitions `paid` → `refund_pending` → `refunded` (`ledger` `refund:<tip_id>:<attempt_uuid>` debit). Simulated Stripe error restores `'paid'` via `refund_rev:<tip_id>:<attempt_uuid>`, and the second retry succeeds with a fresh `attempt_uuid` (zero `23505` collision); timed-out `refund_pending` rows reconcile via `charge.refunded` or hourly sweep. Tip 2 (`>24h` from `paid_at`) returns `422 REFUND_WINDOW_EXPIRED` and UI disables button. Dept Manager returns `403`. | Vitest integration test |

### Additional Rubric Security & Compliance Checks Verified
- **Negative-Balance Chargeback (`L77`, Person & Pool):** Staff withdraws full `$20`, then `stripe-webhook` receives `charge.dispute.created` → `wallet_balance_cents = -2000`; next `$25` tip leaves `wallet_balance_cents = +500`; Property wallet unaffected. Verify `department_pool` dispute debits unallocated pool (or distributed recipients via `pool_distributions`) and `charge.dispute.closed` (`won`) inserts `chargeback_reversal`.
- **OTP, Join QR, SSO & API Key Security (`L164, L176, L237`):** Verify `FOR UPDATE` locking on 5 wrong OTP attempts; >3 sends/10min per `(email, purpose)` returns `429`; `create-person` leaves `auth_user_id = NULL` so Join QR always lists unclaimed staff (`property_admin` escalation & post-claim `email` drift blocked on `update-person`); cross-property / `super_admin` SSO rejected and `server_minted` vs `partner_asymmetric` (`RS256`/`EdDSA`) verified cleanly; revoked/missing API key returns `401`; wrong scope or `restricted`/`pending`/`cancelled` property returns `403`.
- **Toggle-Off vs. Non-Payment Restriction (`L270`), Inactive Webhook & Production Boot Guards:** Disable `FT-17`/`FT-19` on active property → active staff keeps Today's Rooms & Personal QR and can withdraw `$15` (with `payout_fee_paid_by` readable via `properties_staff_view`); mark property `restricted` → guest tipping AND withdrawals are blocked; inactive `/tip/person/*` with `FT-4 = false` returns `422 RECIPIENT_UNAVAILABLE` (while an already-captured in-flight `stripe-webhook` credits the `inactive` recipient's withdraw-only wallet + logs `audit_logs`); booting `CONTEXT=production` with `PAYMENT_MODE=stripe_test`, unset `PAYMENT_MODE`, `sk_test_`, or `whsec_mock_dev` throws fatal startup error while `CONTEXT=deploy-preview` + `NODE_ENV=production` + `PAYMENT_MODE=stripe_test` + `EMAIL_MODE=stub` boots cleanly.
