# 01 — Backend Stack Comparison & Full-Spec System Architecture (Requirement R1)

> **Status:** Comprehensive Pre-Implementation Architecture Plan (Core Decisions Signed Off Nov 25, 2026)  
> **Scope:** Requirement `R1` — Supabase vs. Firebase 7-Dimension Evaluation, Signed-Off Stack Recommendation, 1-to-1 Firebase Fallback Mapping, Complete Relational Schema & State Machines, Spec Tension Resolutions (`ST-1`..`ST-5`), All 7 Actor Types, All 10 Product Modules, All 19 Cloud Function Equivalents, Daily PDF/OCR Assignment Pipeline, Stripe Connect Express Payment/Payout Architecture, Contracts/Billing/External API/SSO, All 27 Section 19 Feature Toggles (`FT-1`..`FT-27`), and Zero-Credential Local Dev / Stripe Test Mode / Stubbed Email Architecture.  
> **Spec Authority:** `/Volumes/MIGHTY DATA/Tipping App /Resources /Hospitality Tipping Platform Product Spec for AI Agents.md` (Sections 1–20, lines 1–279).

---

## 1. Stack Decision Callout (Spec Section 8 & 9 Governance)

Per **Spec Section 9 (L110–L120)**, the draft specification outlines **Vite + React + TypeScript (hosted on Netlify)** paired with **Firebase** (Firestore, Firebase Auth, Cloud Functions, Firebase Storage, Resend, Stripe), and **Section 9 L120** states: *"If a library or service is not listed here, an agent must ask before adding it."*

Per **Requirement R1**, this plan evaluates **Supabase (Postgres + Auth + Storage + Realtime + `pg_cron`) paired with Netlify Functions (Node.js 20+ / TypeScript)** against the drafted **Firebase** baseline.

> **Signed-Off Primary Stack (Approved Nov 25, 2026):** **Supabase (Postgres 15+ + `FORCE ROW LEVEL SECURITY` + GoTrue Auth + Storage + Realtime + `pg_cron`) + Netlify Functions (Node.js 20+ TypeScript)** alongside the spec's Vite + React + Netlify SPA.  
> **Fallback Reference:** Section 2.3 preserves the 1-to-1 mapping back to the spec's Firebase baseline for architectural traceability.

---

## 2. Supabase vs. Firebase Deep Comparison (7 Dimensions)

### 2.1 Evaluation Matrix

| # | Dimension | Firebase Baseline (Spec Draft, Sec 9–12) | Supabase + Netlify Functions (Recommended) | Winner & Architectural Rationale |
|---|---|---|---|---|
| **1** | **Relational vs. Document Modeling** *(ledger, multi-property joins, OCR assignments, audit logs)* | Firestore is document-oriented. `walletBalanceCents` on `people` must be manually denormalized and synchronized with `ledger` (`L143`). No foreign-key `ON DELETE RESTRICT` exists—blocking department deletion when people exist (`AC-8`, `L198`) requires multi-query transaction code. Array fields (`payoutBatches.withdrawalIds`, `poolDistributions.allocations`) risk hitting the **1 MiB document ceiling** at scale. Dynamic multi-filter reporting on `/admin/tips` (`date range × department × person`) requires proliferating composite indexes. | PostgreSQL natively models the 14 spec entities + operational tables with strict composite tenant-safe foreign keys (`ON DELETE RESTRICT` on `people(property_id, department_id)` enforces `AC-8` for `dept_manager`/`staff` at the DB engine while keeping `department_id` nullable for `property_admin`), `CHECK` constraints (`amount_cents > 0`, `char_length(note) <= 150`), `UNIQUE` constraints (`stripe_payment_intent_id`), arbitrary relational `JOIN`s for `/admin/tips` payroll CSV/PDF exports, and exact `SUM(ledger.amount_cents)` verification against cached wallet balances. | **Supabase (Decisive)** — A double-entry financial ledger and multi-filter payroll reporting engine are fundamentally relational. |
| **2** | **Multi-Property Tenant Isolation** *(RLS vs. Security Rules)* | Firestore Security Rules cannot filter queries (queries fail unless client query clauses match rules), lack column-level projection (guests cannot read `people` docs directly without leaking `email` or `walletBalanceCents`, forcing every guest view through Cloud Functions `L147`), incur extra document-read billing on cross-doc `get()`/`exists()` checks, and rely on JWT custom claims that remain stale up to **60 minutes** after a staff member is deactivated or moved. | PostgreSQL **Row Level Security (`FORCE ROW LEVEL SECURITY`)** isolates every row by `property_id`, `department_id`, and `person_id` at the query-engine layer across SQL, PostgREST, and Realtime. Policies join directly to `people.status = 'active'` (instant revocation on deactivation, zero JWT staleness risk). Column-scoped `SECURITY DEFINER` RPC (`get_public_tip_target` / `resolveRoomView`) returns only `{name, photo_url, department_name}` to guests. | **Supabase (Decisive)** — Engine-enforced tenant isolation and instant deactivation checks prevent entire classes of multi-tenant data leaks. |
| **3** | **Auth & Email OTP Flows** *(password + 6-digit OTP, Join QR, SSO)* | Firebase Auth provides email/password and custom claims, but **cannot** natively issue purpose-bound withdrawal OTPs or Join-QR pick-name OTPs (`L85, L87`). The spec already requires custom Cloud Functions (`sendOtp`, `verifyOtp`, `joinByQr`, `ssoToken`) + `otpCodes` collection + `admin.auth().createCustomToken()`. | Supabase Auth (GoTrue) handles email/password, password resets, and native auth emails, while a **Postgres Custom Access Token Auth Hook** injects fresh `role`, `property_id`, `department_id`, and `person_id` claims on every token mint/refresh. Purpose-bound SHA-256 hashed 6-digit OTPs (`login`, `new_device`, `withdrawal`, `join_qr`) live in `otp_codes` + `otp_rate_limits`, and Join QR / SSO mint sessions securely via Supabase Admin API / magic-link/token exchange in Netlify Functions. | **Supabase (Edge)** — Both stacks need custom server endpoints for withdrawal OTPs, Join QR, and SSO, but Supabase's Auth Hook removes custom-claim sync drift. |
| **4** | **Server-Side Stripe Execution & Webhook Transactionality** | Firestore `runTransaction` uses optimistic concurrency (aborts/retries under contention), enforces a hard **500-write transaction limit** (risky for large `runWeeklyPayouts` batches or property-wide pool splits), and cannot aggregate `SUM(ledger)` across large histories inside one transaction without reading every ledger document. | PostgreSQL `BEGIN ... COMMIT` transactions inside `SECURITY DEFINER` RPCs use pessimistic row locking (`SELECT ... FOR UPDATE` on `people` wallet rows), serializing concurrent **tip credits + 24h refunds + withdrawals + chargebacks** with zero lost updates. `stripe_events` PK (`event_id`) + `UNIQUE (stripe_payment_intent_id)` guarantees exactly-once webhook processing; `FOR UPDATE SKIP LOCKED` cleanly batches weekly payouts. | **Supabase (Decisive)** — Pessimistic ACID row locks eliminate double-spend and refund/withdrawal race conditions. |
| **5** | **File Storage** *(staff photos, resort hero backdrops, QR templates/exports, PDF/OCR sheets, signed contracts)* | Firebase Storage uses a separate `storage.rules` DSL that cannot read Firestore documents (`people.status`, `properties.status`), relying exclusively on JWT custom claims. | Supabase Storage stores file metadata in Postgres `storage.objects`, governed by the **exact same Postgres RLS policies** and live DB joins as application tables. All 6 buckets are private (non-enumerable paths), using short-lived signed URLs for `staff-photos` (active staff only via `resolve-room-view`), `property-backdrops` (per-property guest/staff resort backdrop photography), `signed-agreements`, `assignment-sheets`, and `qr-exports`. | **Supabase (Clear)** — Unified DB + object storage access control in one SQL policy engine. |
| **6** | **Local Dev, Stripe Test Mode & Stubbed Email** *(zero live credentials)* | Firebase Emulator Suite runs Auth/Firestore/Functions/Storage locally (requires JVM for Firestore), uses ephemeral JSON exports rather than versioned SQL migrations, and includes **no local email inbox UI** (devs must inspect console logs or build custom stubs). | **Supabase CLI + Docker** runs Postgres, GoTrue, Storage, Realtime, Edge Functions, and **Mailpit** (`http://127.0.0.1:54324` local SMTP inbox UI) out of the box, initialized declaratively via `supabase/migrations/*.sql` and `supabase/seed.sql`. Pairs with Netlify Dev (`netlify dev`), `stripe listen --forward-to`, and clean `PaymentAdapter` / `EmailAdapter` / `OcrAdapter` interfaces requiring **zero live credentials**. | **Supabase (Decisive)** — Declarative migrations + built-in Mailpit SMTP inbox UI make local/CI verification deterministic. |
| **7** | **Operational, Cost & DX Trade-Offs** | Firestore bills per document read/write/delete—Security Rule `get()` calls, Realtime listeners, and ledger aggregations can cause unpredictable bill spikes. Node.js Cloud Functions support npm PDF/OCR libraries (`pdf-parse`, `tesseract.js`, `pdfkit`) natively. | Predictable flat Supabase pricing ($25/mo Pro; free tier for dev); zero proprietary NoSQL lock-in; standard SQL migrations & tests. **Runtime & Timeout Caveat:** Supabase Edge Functions run on **Deno** (friction with Node-native `pdf-parse`, `sharp`, `tesseract.js`, `pdfkit`), and synchronous Netlify Functions enforce a **10s free / 26s Pro timeout**. **Solution:** Run Node.js 20+ TS endpoints as **Netlify Functions** (`/.netlify/functions/*`), and designate long-running jobs (`run-weekly-payouts-background`, `unclaimed-reminders-background`, bulk `generate-qr-cards-background`, and photo-OCR `parse-assignment-sheet-background`) as **Netlify Background Functions** (15-min execution window returning `202 Accepted` + Storage/Realtime job status tracking) or bounded chunked queues (`LIMIT 20`). | **Supabase + Netlify Functions (Clear)** — Combines Postgres ACID rigor with full Node.js npm compatibility and 15-min background execution on Netlify. |

### 2.2 Recommended Architecture Topology

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Netlify CDN (Vite + React + TS SPA)                  │
│   Guest QR Pages (/tip/*)  │  Staff (/login,/join,/staff) │ Admin/Super │
└──────────────┬──────────────────────────────────┬───────────────────────┘
               │ HTTPS (JWT / Public / API Key)   │ Direct Supabase SDK
               ▼                                  │ (RLS-enforced reads +
┌───────────────────────────────────────────┐     │  Realtime subscriptions)
│   Netlify Functions (Node.js 20+ TS)      │     ▼
│  - create-tip-checkout / stripe-webhook   │   ┌─────────────────────────┐
│  - resolve-room-view / join-by-qr         │◄──┤  Supabase Platform      │
│  - send-otp / verify-otp / sso-token      │   │  - Postgres 15+ (FORCE  │
│  - parse-assignment-sheet(-background)    │   │    RLS + ACID RPCs)     │
│  - generate-qr-cards(-background)         │   │  - GoTrue Auth + Hook   │
│  - request-withdrawal / export-tips       │   │  - Storage (6 Private)  │
│  - run-weekly-payouts-background (CRON)   │   │  - Realtime (WS)        │
│  - reconcile-stale-payouts-background     │   │  - pg_cron + Vault/net  │
│  - unclaimed-reminders-background (CRON)  │   └─────────────────────────┘
│  - refund-tip / distribute-pool           │
│  - billing-sync / api-gateway             │
└───────┬──────────────────────────┬────────┘
        │                          │
        ▼                          ▼
┌───────────────────┐    ┌────────────────────────┐
│ Stripe Adapter    │    │ Email Adapter          │
│ mock | test | live│    │ stub | mailpit | resend│
└───────────────────┘    └────────────────────────┘
```

### 2.3 1-to-1 Firebase Fallback Mapping (If Sanju Mandates Spec Section 9 Firebase)

If Sanju requires keeping Firebase unchanged (e.g., to share an existing FrontDesk Pro Firebase project), every architectural control in this plan maps 1-to-1:

| Architectural Component | Recommended (Supabase + Netlify Functions) | Firebase Fallback (Spec Section 9–12) |
|---|---|---|
| Relational Entities (14 → 15 + 9 operational = 24 tables) | Postgres tables (`properties`, `property_features`, `departments`, ..., `audit_logs`, `invoices`, `otp_rate_limits`, `checkout_intents`, `sso_providers`) | Firestore collections (`properties` w/ `features` map + `trustedDevices`, `stripeEvents`, `auditLogs`, `invoices`, `otpRateLimits`, `checkoutIntents`, `ssoProviders`) |
| Tenant & Role Isolation | Postgres `FORCE ROW LEVEL SECURITY` + live `people.status` join | `firestore.rules` + Custom Claims (`role`, `propertyId`, `departmentId`) + `get()` checks for `people.status` |
| Auth & Claims | Supabase GoTrue + Postgres Custom Access Token Hook | Firebase Auth + Admin SDK `setCustomUserClaims()` |
| Server Functions (19 spec + 4 supporting) | Netlify Functions (Node.js/TS, incl. `-background` 15m workers) + Postgres `SECURITY DEFINER` RPCs | Firebase Cloud Functions v2 (Node.js/TS) + `runTransaction()` |
| Scheduled Jobs (`runWeeklyPayouts`, `reconcileStalePayouts`, `unclaimedReminders`) | `pg_cron` + `pg_net` calling `CRON_SECRET`-authenticated Netlify Background Function endpoints | Firebase Cloud Scheduler (`onSchedule`) |
| Live Staff Notifications & Assignment Updates | Supabase Realtime (Postgres Changes via RLS) | Firestore `onSnapshot()` listeners |
| File Storage | Supabase Storage (6 RLS-protected buckets) | Firebase Storage + `storage.rules` |
| Local Dev & Email Stub | `supabase start` (Docker + Mailpit `:54324`) + `netlify dev` + `stripe listen` | Firebase Emulator Suite (`auth`, `firestore`, `functions`, `storage`) + `EmailAdapter` (`stub` / local SMTP) + `stripe listen` |

---

## 3. Complete Normalized Relational Data Model & State Machines

All monetary columns use **`BIGINT` integer cents** (`L124`). All timestamps use **`TIMESTAMPTZ` (UTC)**. All tenant-scoped tables carry **`property_id UUID NOT NULL REFERENCES properties(id)`** and enforce **composite tenant-safe foreign keys** (`(property_id, department_id)` / `(property_id, person_id)` / `(property_id, room_number)`) so cross-property UUID injection is impossible at the DB engine layer.

### 3.1 Core Spec Tables (14 Spec Entities Normalized to 15 Tables)

1. **`properties`** *(Spec `properties`, `L128`)*
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `name TEXT NOT NULL`, `address TEXT NOT NULL`, `contact_name TEXT NOT NULL`, `contact_email TEXT NOT NULL`
   - `status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'restricted', 'cancelled')) DEFAULT 'pending'`
   - `plan_type TEXT NOT NULL CHECK (plan_type IN ('monthly', 'yearly'))`
   - `plan_price_cents BIGINT NOT NULL CHECK (plan_price_cents >= 0)`
   - `contract_term_months INT NOT NULL DEFAULT 12 CHECK (contract_term_months > 0)`
   - `notice_days INT NOT NULL DEFAULT 30 CHECK (notice_days >= 0)`
   - `contract_renews_at TIMESTAMPTZ`
   - `payment_fee_paid_by TEXT NOT NULL CHECK (payment_fee_paid_by IN ('property', 'guest', 'staff'))`
   - `payout_fee_paid_by TEXT NOT NULL CHECK (payout_fee_paid_by IN ('property', 'staff'))` *(see `ST-3`)*
   - `payout_weekday SMALLINT NOT NULL DEFAULT 4 CHECK (payout_weekday BETWEEN 0 AND 6)` *(0=Sun..6=Sat; 4=Thursday, evaluated in `properties.timezone`)*
   - `timezone TEXT NOT NULL DEFAULT 'America/Chicago'` *(Validated IANA timezone from `pg_timezone_names`; used as `(now() AT TIME ZONE p.timezone)::date` for `resolve-room-view`, `save-assignments`, and `run-weekly-payouts-background`)*
   - `min_withdrawal_cents BIGINT NOT NULL DEFAULT 1000 CHECK (min_withdrawal_cents >= 100)`
   - `template_path TEXT` *(Storage object key in `qr-templates`)*
   - `hero_photo_path TEXT` *(Storage object key in `property-backdrops` for per-property Resort Glassmorphism guest & staff backdrop photography; falls back to bundled boutique resort photo when `NULL`)*
   - `qr_position JSONB` *(`{"x": number, "y": number, "size": number}` normalized 0..1 or px)*
   - `stripe_customer_id TEXT UNIQUE`, `stripe_subscription_id TEXT UNIQUE`
   - `stripe_subscription_status TEXT` *(`trialing | active | past_due | unpaid | canceled`)*
   - `tip_min_cents BIGINT NOT NULL DEFAULT 100` *(Signed off per `OI-1`: `100` [$1.00] when `payment_fee_paid_by = 'guest'`, or `200` [$2.00] floor when `property` or `staff` absorbs the Stripe card fee)*
   - `tip_max_cents BIGINT NOT NULL DEFAULT 20000` *(Signed off per `OI-1`: `$200.00` default cap, configurable up to `50000` [$500.00] per property)*
   - `tip_presets_cents BIGINT[] NOT NULL DEFAULT '{300,500,1000,2000}'` *(Signed off per `OI-1`: `[$3, $5, $10, $20]` + Custom)*
   - `accent_color_hex TEXT` *(Optional subtle property accent override for frosted UI highlights per `OI-6`)*
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

2. **`property_features`** *(Spec `properties.features` map, `L266–L270`)*
   - `property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE`
   - `feature_key TEXT NOT NULL CHECK (feature_key IN ( /* 27 keys FT-1..FT-27 */ ))`
   - `enabled BOOLEAN NOT NULL DEFAULT true`
   - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_by UUID`
   - `PRIMARY KEY (property_id, feature_key)`

3. **`departments`** *(Spec `departments`, `L129`)*
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE`
   - `name TEXT NOT NULL`
   - `is_housekeeping BOOLEAN NOT NULL DEFAULT false` *(identifies the housekeeping dept for room-view fallback `L33`)*
   - `default_distribution TEXT NOT NULL CHECK (default_distribution IN ('split', 'individual')) DEFAULT 'split'`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - `UNIQUE (property_id, id)` *(composite target for tenant-safe FKs)*, `UNIQUE (property_id, lower(name))`

4. **`people`** *(Spec `people`, `L130`)*
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE`
   - `auth_user_id UUID UNIQUE REFERENCES auth.users(id)` *(Strictly **`NULL`** [unclaimed] when `create-person` creates an un-onboarded staff row; linked once only when the user redeems their email invite or completes `/join/:propertyId`)*
   - `name TEXT NOT NULL`, `email TEXT NOT NULL`
   - `role TEXT NOT NULL CHECK (role IN ('property_admin', 'dept_manager', 'staff'))`
   - `department_id UUID` *(Nullable **exclusively** for `role = 'property_admin'` so onboarding Step 1 precedes Step 7 and admin rows never block `AC-8` department deletion)*
   - `FOREIGN KEY (property_id, department_id) REFERENCES departments(property_id, id) ON DELETE RESTRICT` *(Engine-enforced `AC-8` for `dept_manager`/`staff` + cross-property FK protection)*
   - `CHECK ((role = 'property_admin') OR (department_id IS NOT NULL))`
   - `photo_path TEXT` *(Non-enumerable private object path `<property_id>/<person_id>/<uuid>.webp` in `staff-photos`)*
   - `status TEXT NOT NULL CHECK (status IN ('active', 'inactive')) DEFAULT 'active'`
   - `wallet_balance_cents BIGINT NOT NULL DEFAULT 0` *(Derived cache from `ledger`; mutated ONLY inside `SECURITY DEFINER` ledger RPCs; negative allowed ONLY via chargeback `L77`)*
   - `stripe_connect_account_id TEXT` *(Populated only if Stripe Connect Express/Custom is chosen after `OI-4` legal sign-off)*
   - `agreement_signed_at TIMESTAMPTZ`
   - `last_activity_or_credit_at TIMESTAMPTZ` *(Used for 30/60/90-day unclaimed balance reminders)*
   - `last_reminder_milestone SMALLINT CHECK (last_reminder_milestone IN (30, 60, 90))`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - `UNIQUE (property_id, id)` *(composite target for tenant-safe FKs)*, `UNIQUE (property_id, lower(email))`

5. **`rooms`** *(Spec `rooms`, `L131`)*
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE`
   - `room_number TEXT NOT NULL`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - `UNIQUE (property_id, id)`, `UNIQUE (property_id, room_number)`

6. **`assignments`** *(Spec `assignments`, `L132`)*
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE`
   - `assignment_date DATE NOT NULL` *(Computed in property-local timezone `(now() AT TIME ZONE p.timezone)::date`)*
   - `room_number TEXT NOT NULL`
   - `person_id UUID NOT NULL`
   - `source TEXT NOT NULL CHECK (source IN ('pdf', 'photo', 'manual', 'api'))`
   - `reassigned_from_person_id UUID`
   - `assigned_by UUID REFERENCES auth.users(id)`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - `FOREIGN KEY (property_id, room_number) REFERENCES rooms(property_id, room_number)`
   - `FOREIGN KEY (property_id, person_id) REFERENCES people(property_id, id)`
   - `FOREIGN KEY (property_id, reassigned_from_person_id) REFERENCES people(property_id, id)`
   - `UNIQUE (property_id, assignment_date, room_number)` *(One active assignee per room per date; mid-day reassignment updates `person_id` and records `reassigned_from_person_id` while prior `checkout_intents`/`tips` rows keep original `person_id`)*

7. **`tips`** *(Spec `tips`, `L133` — Webhook-Confirmed Tips Only)*
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `property_id UUID NOT NULL REFERENCES properties(id)`
   - `checkout_intent_id UUID UNIQUE REFERENCES checkout_intents(id)`
   - `amount_cents BIGINT NOT NULL CHECK (amount_cents > 0)` *(Tip principal)*
   - `fee_cents BIGINT NOT NULL CHECK (fee_cents >= 0)` *(Stripe processing fee)*
   - `guest_fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (guest_fee_cents >= 0)` *(Added checkout fee when `payment_fee_paid_by = 'guest'`)*
   - `net_cents BIGINT NOT NULL CHECK (net_cents >= 0)` *(Net amount credited to recipient/pool)*
   - `recipient_type TEXT NOT NULL CHECK (recipient_type IN ('person', 'department_pool'))`
   - `person_id UUID`
   - `department_id UUID NOT NULL`
   - `room_number TEXT`
   - `note TEXT CHECK (note IS NULL OR char_length(note) <= 150)`
   - `guest_email TEXT`
   - `stripe_payment_intent_id TEXT NOT NULL UNIQUE`
   - `status TEXT NOT NULL CHECK (status IN ('paid', 'refund_pending', 'refunded', 'disputed')) DEFAULT 'paid'` *(Unpaid/pre-webhook intents live exclusively in `checkout_intents`; `tips` rows are inserted ONLY inside `stripe-webhook` upon verified `payment_intent.succeeded`, literally satisfying `L184` "create no tip" & `AC-3`)*
   - `active_refund_attempt_id UUID` *(Generated per `refund-tip` attempt; cleared on finalize or `refund_reversal` so retries within 24h never collide)*
   - `refund_pending_started_at TIMESTAMPTZ` *(Used by `charge.refunded` webhook & >15 min stale-`refund_pending` reconciliation)*
   - `refund_attempt_count INT NOT NULL DEFAULT 0`
   - `paid_at TIMESTAMPTZ NOT NULL`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - `FOREIGN KEY (property_id, department_id) REFERENCES departments(property_id, id)`
   - `FOREIGN KEY (property_id, person_id) REFERENCES people(property_id, id)`
   - `CHECK ((recipient_type = 'person' AND person_id IS NOT NULL) OR (recipient_type = 'department_pool' AND person_id IS NULL))`

8. **`pool_distributions`** *(Spec `poolDistributions`, `L134`)*
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `property_id UUID NOT NULL REFERENCES properties(id)`
   - `department_id UUID NOT NULL`
   - `distribution_date DATE NOT NULL`
   - `method TEXT NOT NULL CHECK (method IN ('split', 'individual'))`
   - `total_cents BIGINT NOT NULL CHECK (total_cents > 0)`
   - `allocations JSONB NOT NULL` *(Array of `{"person_id": uuid, "amount_cents": int}` summing to `total_cents`)*
   - `created_by UUID NOT NULL REFERENCES auth.users(id)`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - `FOREIGN KEY (property_id, department_id) REFERENCES departments(property_id, id)`

9. **`ledger`** *(Spec `ledger`, `L135` — Append-Only Immutable Journal)*
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `property_id UUID NOT NULL REFERENCES properties(id)`
   - `person_id UUID` *(Nullable ONLY for unallocated `department_pool` credits/debits until `distribute_pool` moves funds from pool to staff wallets)*
   - `department_id UUID`
   - `type TEXT NOT NULL CHECK (type IN ('tip_credit', 'pool_credit', 'pool_debit', 'fee', 'refund', 'refund_reversal', 'chargeback', 'chargeback_reversal', 'payout', 'payout_reversal'))`
   - `amount_cents BIGINT NOT NULL` *(Signed integer: positive = credit, negative = debit)*
   - `ref_id UUID NOT NULL` *(FK-like reference to `tips.id`, `pool_distributions.id`, or `withdrawals.id`)*
   - `idempotency_key TEXT NOT NULL UNIQUE` *(e.g. `tip_credit:<tip_id>`, `refund:<tip_id>:<attempt_uuid>`, `refund_rev:<tip_id>:<attempt_uuid>`, `dispute:<dispute_id>:<target>`, `dispute_won:<dispute_id>:<target>`, `payout_rev:<withdrawal_id>`)*
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - `FOREIGN KEY (property_id, person_id) REFERENCES people(property_id, id)`
   - `FOREIGN KEY (property_id, department_id) REFERENCES departments(property_id, id)`
   - **Immutability Trigger:** `BEFORE UPDATE OR DELETE ON ledger` raises exception unconditionally.

10. **`withdrawals`** *(Spec `withdrawals`, `L136`)*
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
    - `property_id UUID NOT NULL REFERENCES properties(id)`
    - `person_id UUID NOT NULL`
    - `amount_cents BIGINT NOT NULL CHECK (amount_cents > 0)` *(Gross amount debited from staff wallet at `request-withdrawal`)*
    - `method TEXT NOT NULL CHECK (method IN ('standard', 'instant'))`
    - `fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (fee_cents >= 0)` *(Staff-borne payout fee deducted from gross withdrawal when `payout_fee_paid_by = 'staff'` or `method = 'instant'`)*
    - `net_payout_cents BIGINT NOT NULL GENERATED ALWAYS AS (amount_cents - fee_cents) STORED CHECK (net_payout_cents > 0)` *(Net amount transferred to staff via Stripe)*
    - `status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'paid', 'failed'))`
    - `stripe_idempotency_key TEXT UNIQUE` *(Populated as `'payout:' || id` so retries/reconciliation sweeps never double-pay)*
    - `stripe_payout_id TEXT UNIQUE`
    - `processing_started_at TIMESTAMPTZ` *(Used by stale-`processing` >15 min reconciliation sweep)*
    - `failure_reason TEXT`
    - `batch_id UUID REFERENCES payout_batches(id)`
    - `requested_at TIMESTAMPTZ NOT NULL DEFAULT now()`
    - `paid_at TIMESTAMPTZ`
    - `FOREIGN KEY (property_id, person_id) REFERENCES people(property_id, id)`

11. **`payout_batches`** *(Spec `payoutBatches`, `L137`)*
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
    - `property_id UUID NOT NULL REFERENCES properties(id)` *(See `ST-2`: one batch per property matching `payout_weekday` & 09:00 local hour in `properties.timezone`)*
    - `payout_date DATE NOT NULL` *(Property-local date `(now() AT TIME ZONE p.timezone)::date`)*
    - `status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'partial_failure', 'failed'))`
    - `total_cents BIGINT NOT NULL DEFAULT 0`
    - `withdrawal_count INT NOT NULL DEFAULT 0`
    - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
    - `UNIQUE (property_id, payout_date)` *(Guarantees at most one weekly batch per property per property-local payout day)*

12. **`notifications`** *(Spec `notifications`, `L138`)*
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
    - `property_id UUID NOT NULL REFERENCES properties(id)` *(Added per `ST-1` & `L124`)*
    - `person_id UUID NOT NULL`
    - `type TEXT NOT NULL CHECK (type IN ('tip_received', 'pool_distributed', 'payout_paid', 'payout_failed', 'chargeback'))`
    - `message TEXT NOT NULL`
    - `tip_id UUID REFERENCES tips(id)`
    - `read BOOLEAN NOT NULL DEFAULT false`
    - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
    - `FOREIGN KEY (property_id, person_id) REFERENCES people(property_id, id)`

13. **`agreements`** *(Spec `agreements`, `L139`)*
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
    - `signer_type TEXT NOT NULL CHECK (signer_type IN ('property', 'staff'))`
    - `signer_id UUID NOT NULL` *(`properties.id` or `people.id`)*
    - `signer_auth_user_id UUID NOT NULL REFERENCES auth.users(id)`
    - `property_id UUID NOT NULL REFERENCES properties(id)`
    - `version TEXT NOT NULL`
    - `typed_name TEXT NOT NULL`
    - `checkbox_confirmed BOOLEAN NOT NULL CHECK (checkbox_confirmed = true)`
    - `signed_at TIMESTAMPTZ NOT NULL DEFAULT now()`
    - `ip_address INET NOT NULL`
    - `user_agent TEXT`
    - `pdf_storage_path TEXT NOT NULL` *(Immutable copy in `signed-agreements` bucket)*

14. **`api_keys`** *(Spec `apiKeys`, `L140`)*
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
    - `property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE`
    - `label TEXT NOT NULL`
    - `key_prefix TEXT NOT NULL` *(First **12** chars e.g. `fdp_live_abc` for display without exposing secret — aligned with `02`)*
    - `hashed_key TEXT NOT NULL UNIQUE` *(SHA-256 hex digest)*
    - `scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['assignments:write','people:read','tips:read','people:write'])` *(Non-empty validated scopes)*
    - `revoked BOOLEAN NOT NULL DEFAULT false`
    - `revoked_at TIMESTAMPTZ`
    - `last_used_at TIMESTAMPTZ`
    - `created_by UUID NOT NULL REFERENCES auth.users(id)`
    - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

15. **`otp_codes`** *(Spec `otpCodes`, `L141`)*
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
    - `email TEXT NOT NULL`
    - `hashed_code TEXT NOT NULL` *(HMAC-SHA256 with server secret + per-row salt)*
    - `purpose TEXT NOT NULL CHECK (purpose IN ('login', 'new_device', 'withdrawal', 'join_qr'))`
    - `attempts INT NOT NULL DEFAULT 0 CHECK (attempts <= 5)`
    - `expires_at TIMESTAMPTZ NOT NULL`
    - `consumed_at TIMESTAMPTZ`
    - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

### 3.2 Operational Tables Required Beyond Section 10 (`ST-4`)

16. **`trusted_devices`** *(Required by `L87`: "Trusted devices stay signed in")*
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
    - `auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
    - `device_token_hash TEXT NOT NULL UNIQUE` *(SHA-256 of HttpOnly Secure cookie token)*
    - `user_agent TEXT`, `last_ip INET`, `last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `expires_at TIMESTAMPTZ NOT NULL`, `revoked BOOLEAN NOT NULL DEFAULT false`
17. **`stripe_events`** *(Idempotency table for `stripeWebhook` & `billingSync`)*
    - `event_id TEXT PRIMARY KEY`, `event_type TEXT NOT NULL`, `processed_at TIMESTAMPTZ NOT NULL DEFAULT now()`
18. **`audit_logs`** *(Super Admin / Admin / Security compliance trail)*
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `property_id UUID REFERENCES properties(id)`, `actor_user_id UUID`, `actor_role TEXT`, `action TEXT NOT NULL`, `target_type TEXT`, `target_id TEXT`, `metadata JSONB`, `ip_address INET`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
19. **`invoices`** *(Subscription billing mirror for `billingSync` & `/super/dashboard`)*
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `property_id UUID NOT NULL REFERENCES properties(id)`, `stripe_invoice_id TEXT NOT NULL UNIQUE`, `amount_cents BIGINT NOT NULL`, `status TEXT NOT NULL`, `period_start TIMESTAMPTZ`, `period_end TIMESTAMPTZ`, `paid_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
20. **`otp_rate_limits`** *(Enforces `L164` rate-limiting without Redis)*
    - `bucket_key TEXT PRIMARY KEY` *(e.g. `otp:email:<sha256>:<purpose>` or `otp:ip:<ip>`)*, `request_count INT NOT NULL`, `window_started_at TIMESTAMPTZ NOT NULL`
21. **`sso_jti_nonces`** *(Prevents replay of short-lived signed SSO tokens `L97, L176`)*
    - `jti UUID PRIMARY KEY`, `property_id UUID NOT NULL REFERENCES properties(id)`, `expires_at TIMESTAMPTZ NOT NULL`, `used_at TIMESTAMPTZ NOT NULL DEFAULT now()`
22. **`super_admins`** *(Identifies Super Admins cleanly in Postgres alongside Auth Hook)*
    - `auth_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`, `email TEXT NOT NULL UNIQUE`, `name TEXT NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
23. **`checkout_intents`** *(Separates unpaid pre-webhook Stripe Checkout PaymentIntents from confirmed `tips` per `L184` & `AC-3`)*
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `property_id UUID NOT NULL REFERENCES properties(id)`, `recipient_type TEXT NOT NULL CHECK (recipient_type IN ('person', 'department_pool'))`, `person_id UUID`, `department_id UUID NOT NULL`, `room_number TEXT`, `amount_cents BIGINT NOT NULL CHECK (amount_cents > 0)`, `fee_cents BIGINT NOT NULL CHECK (fee_cents >= 0)`, `guest_fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (guest_fee_cents >= 0)`, `net_cents BIGINT NOT NULL CHECK (net_cents >= 0)`, `note TEXT CHECK (note IS NULL OR char_length(note) <= 150)`, `guest_email TEXT`, `stripe_payment_intent_id TEXT NOT NULL UNIQUE`, `status TEXT NOT NULL CHECK (status IN ('created', 'succeeded', 'failed', 'expired')) DEFAULT 'created'`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
    - `FOREIGN KEY (property_id, department_id) REFERENCES departments(property_id, id)`, `FOREIGN KEY (property_id, person_id) REFERENCES people(property_id, id)`
    - `CHECK ((recipient_type = 'person' AND person_id IS NOT NULL) OR (recipient_type = 'department_pool' AND person_id IS NULL))`
24. **`sso_providers`** *(Per-property partner SSO configuration replacing any global shared secret)*
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `property_id UUID NOT NULL UNIQUE REFERENCES properties(id) ON DELETE CASCADE`, `client_id TEXT NOT NULL UNIQUE`, `auth_mode TEXT NOT NULL CHECK (auth_mode IN ('server_minted', 'partner_asymmetric')) DEFAULT 'server_minted'`, `hashed_client_secret TEXT` *(SHA-256 of partner `client_secret` authenticating `POST /sso-token` in `server_minted` mode)*, `public_key_pem TEXT`, `jwks_url TEXT` *(`RS256`/`EdDSA` verification keys in `partner_asymmetric` mode)*, `allowed_origins TEXT[] NOT NULL DEFAULT '{}'`, `enabled BOOLEAN NOT NULL DEFAULT false`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
    - `CHECK ((auth_mode = 'server_minted' AND hashed_client_secret IS NOT NULL) OR (auth_mode = 'partner_asymmetric' AND (public_key_pem IS NOT NULL OR jwks_url IS NOT NULL)))`

### 3.3 Core Entity State Machines

1. **Property Lifecycle (`properties.status`)** (`L91, L93, L95, L174, L187, L270`):
   - `pending` *(onboarded, awaiting Property Admin click-to-accept agreement)* → **`active`** *(agreement signed + Stripe subscription active)*.
   - `active` → **`restricted`** *(Stripe subscription past retry window; guest tipping blocked + wallet withdrawals blocked under non-payment exception `L270`)*.
   - `restricted` → **`active`** *(`billingSync` receives `invoice.paid` / active subscription)*.
   - `active | restricted` → **`cancelled`** *(Super Admin deactivates property; staff retain withdraw-only view `L79`)*.
2. **Person Lifecycle (`people.status`)** (`L25, L46, L79, L186`):
   - `active` ↔ `inactive` *(Inactive people hidden from guest UI & daily assignments; any stale QR tip targets route to `department_pool` if `FT-4` enabled, or if `FT-4` is `false`: `resolve-room-view`/`create-tip-checkout` return `422 RECIPIENT_UNAVAILABLE`, whereas an already-captured `stripe-webhook` for an in-flight checkout credits the `inactive` recipient's withdraw-only wallet + logs `audit_logs`; staff retain withdraw-only view on `/staff`)*.
3. **Tip Lifecycle (`checkout_intents` → `tips.status`)** (`L60, L75, L77, L184, L193, L199`):
   - `create-tip-checkout` inserts a `checkout_intents` row (`status = 'created'`) and creates the Stripe PaymentIntent (`pi_...`); **zero** `tips`, `ledger`, or `notifications` rows are created. If guest cancels/declines, no `tips` row is ever created (`L184`).
   - `stripe-webhook` (`payment_intent.succeeded` verified) marks `checkout_intents.status = 'succeeded'` and atomically inserts `tips` (`status = 'paid'`, `paid_at = now()`) + `ledger` credit + `notifications` (`AC-3`).
   - `paid` → **`refund_pending`** → **`refunded`** *(two-phase `refund-tip`, Property Admin only, `now() - tips.paid_at <= interval '24 hours'`, recipient/pool balance >= refund amount `L75, L199`; Phase 1 generates `attempt_uuid = gen_random_uuid()`, sets `active_refund_attempt_id = attempt_uuid`, `refund_pending_started_at = now()`, `refund_attempt_count = refund_attempt_count + 1`, and writes `ledger.idempotency_key = 'refund:' || tip_id || ':' || attempt_uuid`; Phase 2 calls Stripe with `idempotencyKey: 'refund:' + tipId + ':' + attemptUuid`; deterministic Stripe failure reverts to `'paid'`, clears `active_refund_attempt_id`, and writes `'refund_rev:' || tip_id || ':' || attempt_uuid` so subsequent retries allocate a fresh `attempt_uuid` without colliding; non-deterministic timeouts are reconciled by `stripe-webhook` `charge.refunded` or the hourly `reconcile-stale-payouts-background` >15 min `reconcile_stale_refunds()` sweep via `stripe.refunds.list({ payment_intent })`)*.
   - `paid` → **`disputed`** *(via `handle-dispute` on `charge.dispute.created`; deducts staff or pool/distributed wallets allowing negative balance `L77`; if `charge.dispute.closed` with `status = 'won'`, transitions back to `'paid'` + `chargeback_reversal` credit)*.
4. **Withdrawal Lifecycle (`withdrawals.status`)** (`L68–L73, L170–L171`):
   - **Standard (`bank`):** `queued` *(on `request-withdrawal`, gross `amount_cents` debited/reserved atomically in `ledger`)* → `processing` *(`processing_started_at = now()`, `stripe_idempotency_key = 'payout:' || id`, claimed once on the property-local payout day at 09:00 local hour by `run-weekly-payouts-background` looping `LIMIT 20` chunks)* → `paid` | `failed` *(on `failed`, compensating `payout_reversal` credit restores wallet)*.
   - **Instant (`debit`):** `processing` *(immediate on `request-withdrawal`, gross `amount_cents` debited from wallet, `net_payout_cents = amount_cents - fee_cents` sent via Stripe with `idempotencyKey = 'payout:' || id`)* → `paid` | `failed` *(on deterministic Stripe error, compensating `payout_reversal` credit restores wallet)*.
   - **Hourly Stale Reconciliation Sweep (`reconcile-stale-payouts-background`):** Runs hourly (`0 * * * *`) to execute `reconcile_stale_withdrawals()` (`withdrawals WHERE status = 'processing' AND processing_started_at < now() - interval '15 minutes'`, checking Stripe by `stripe_idempotency_key` / `stripe_payout_id`) and `reconcile_stale_refunds()` (`tips WHERE status = 'refund_pending' AND refund_pending_started_at < now() - interval '15 minutes'`, checking `stripe.refunds.list({ payment_intent })`), cleanly finalizing or reversing so mid-batch crashes/timeouts never orphan funds.

---

## 4. Explicit Resolution of All 5 Spec Tensions (`ST-1`..`ST-5`)

| ID | Spec Tension Found in Survey | Architectural Resolution |
|---|---|---|
| **`ST-1`** | `notifications` (`L138`) omits `propertyId` despite `L124` rule ("Every document except platform-level ones carries a `propertyId`"). | Add `property_id UUID NOT NULL REFERENCES properties(id)` to `notifications`, populated atomically from `tips.property_id` and enforced in Postgres RLS + composite FK. |
| **`ST-2`** | `payoutBatches` (`L137`) has no `propertyId`, while `properties.payoutWeekday` (`L128`) and `runWeeklyPayouts` (`L171`) say per-property payout day vs `L69` ("one weekly batch on a payout day set by the super admin"). | `run-weekly-payouts-background` runs via `pg_cron` (`0 * * * *`) and gates `claim_weekly_withdrawal_batch()` on **both** `EXTRACT(DOW FROM (now() AT TIME ZONE p.timezone))::smallint = p.payout_weekday` **AND** `EXTRACT(HOUR FROM (now() AT TIME ZONE p.timezone))::smallint = 9` (09:00 AM property-local payout cutoff), creating one `payout_batches` row per `(property_id, payout_date)` enforced by **`UNIQUE (property_id, payout_date)`** (never 24 batches/day; post-9 AM requests queue for next week). Hourly stale `processing`/`refund_pending` recovery runs separately in `reconcile-stale-payouts-background`. |
| **`ST-3`** | `feePolicy.payoutFeePaidBy` (`L128`) lists `'property' | 'guest' | 'staff'`, yet guests are not present at staff withdrawal, and `L70` requires instant payout extra fee to be paid by staff from wallet. | Schema constrains `payout_fee_paid_by IN ('property', 'staff')` (UI hides `'guest'` for payout fees). Standard payout fee honors `payout_fee_paid_by`; instant debit payout fee (`L70`) is always paid by `staff` (`net_payout_cents = amount_cents - fee_cents`). |
| **`ST-4`** | `trustedDevices`, `auditLogs`, `invoices`, `reminderSentAt`, `otpRateLimits`, `ssoNonces`, `stripeEvents`, `checkoutIntents`, and `ssoProviders` are functionally required (`L79, L87, L95, L160, L164, L176, L184`) but omitted from Section 10. | Explicitly modeled as tables #16–#24 in Section 3.2 with full `FORCE RLS`/server-only write enforcement. |
| **`ST-5`** | Local development, Stripe test mode, and stubbed email are required by `ORIGINAL_REQUEST.md` (`R1`) but absent from Section 9. | Resolved in Section 8 using `supabase start` (Docker + Mailpit), `stripe listen`, `PaymentAdapter` / `EmailAdapter` / `OcrAdapter`, and fail-closed production boot assertions. |

---

## 5. Complete Spec Mapping: Actors, Modules & 19 Server Functions

### 5.1 All 7 Actor Types Mapped to 5 UI Roles + Machine Actors

| # | Spec Actor | Auth Mechanism | JWT / Session Scope | Accessible Section 15 Routes |
|---|---|---|---|---|
| 1 | **Super Admin** | Supabase Auth + `super_admins` table + OTP | `role='super_admin'`, `property_id=NULL` | `/super/*` (`RT-12`..`RT-16`) + `/admin/*` via Property Switcher |
| 2 | **Property Admin** | Supabase Auth + `people` (`role='property_admin'`) + OTP | `role='property_admin'`, `property_id=<uuid>` | `/admin/departments`, `/admin/people`, `/admin/rooms`, `/admin/assignments`, `/admin/tips` (`RT-7`..`RT-11`) |
| 3 | **Department Manager** | Supabase Auth + `people` (`role='dept_manager'`) + OTP | `role='dept_manager'`, `property_id=<uuid>`, `department_id=<uuid>` | `/admin/assignments`, `/admin/tips` (`RT-10`..`RT-11`, dept-scoped, NO refunds/payments) |
| 4 | **Staff** | Supabase Auth (`createPerson` or Join QR) + OTP | `role='staff'`, `property_id=<uuid>`, `person_id=<uuid>` | `/staff` (`RT-6`; withdraw-only if `inactive` or `cancelled`) |
| 5 | **Guest** | Unauthenticated (`anon` key via `resolve-room-view`) | Zero DB table access; public projection RPC only | `/tip/room/:roomId`, `/tip/dept/:departmentId`, `/tip/person/:personId` (`RT-1`..`RT-3`) |
| 6 | **External API Consumer** | `X-API-Key` / `Authorization: Bearer` header (`api_keys`) | Single `property_id` + `scopes[]`; never accesses UI | `api-gateway` HTTP endpoints (`POST /assignments`, `GET /people`, `GET /tips`, `POST /people`) |
| 7 | **SSO User** | Short-lived signed `ssoToken` (`SSO_TOKEN_SIGNING_KEY` server-minted or partner `RS256`/`EdDSA` via per-property `sso_providers`) | Mints Supabase session scoped to user's `role` & `property_id` (non-`super_admin`) | Lands on `/login#sso=...` → redirected to role home screen |

### 5.2 All 10 Product Modules Mapped to Architecture Components

1. **Multi-Property Tenancy & Switcher:** `properties` + `FORCE ROW LEVEL SECURITY` + Super Admin context header (`x-active-property-id` validated strictly via `auth_is_super_admin()`).
2. **Super Admin Onboarding, Templates & Billing:** `/super/*` + `billing-sync` + `qr-templates` Storage bucket + `qr_position` JSONB.
3. **Property Setup & Directory:** `departments` (`ON DELETE RESTRICT` + atomic reassign RPC), `people`, `rooms`, `generate-qr-cards` / `generate-qr-cards-background`.
4. **Daily Housekeeping Assignments:** `parse-assignment-sheet` / `parse-assignment-sheet-background` (PDF text + photo OCR + 7 matching rules) + mandatory review UI + `save-assignments` (mid-day reassignment).
5. **Guest QR Tipping:** `resolve-room-view` + `create-tip-checkout` (`checkout_intents` + `409 ASSIGNMENT_CHANGED`) + Stripe Payment Element + Thank-You + `EmailAdapter` receipt.
6. **Staff Portal & Onboarding:** `create-person` / `update-person`, `join-by-qr`, `send-otp`/`verify-otp`, `trusted_devices`, Supabase Realtime `notifications`, `/staff` withdraw-only state.
7. **Payments, Wallets, Ledger & Payouts:** `stripe-webhook`, `ledger` append-only table, `request-withdrawal`, `run-weekly-payouts-background`, `refund-tip`, `handle-dispute`, `unclaimed-reminders-background`.
8. **Pool Distribution & Tips Overview:** `distribute-pool` (`split` / `individual` RPC), `export-tips` CSV/PDF export (`FT-27`).
9. **Legal Contracts & Click-to-Accept:** `agreements` table + immutable PDF copy in `signed-agreements` bucket + Property go-live & Staff first-login gates.
10. **External Integrations (API & SSO):** `api-gateway` (hashed scoped keys) + `sso-token` (per-property `sso_providers` + short-lived signed tokens + `sso_jti_nonces`).

### 5.3 All 19 Spec Cloud Functions (+ Supporting Endpoints) Mapped to Netlify Functions + Postgres RPCs + `pg_cron`

| # | Spec Function (Sec 12) | Recommended Implementation | Feature Toggle(s) Checked | Atomic DB RPC Used |
|---|---|---|---|---|
| 1 | `createTipCheckout` | `POST /.netlify/functions/create-tip-checkout` *(checks `expectedAssignedPersonId` → `409 ASSIGNMENT_CHANGED`; inserts `checkout_intents`)* | `FT-1,3,4,5,6,7,8,22` | `get_checkout_target_and_policy()` |
| 2 | `stripeWebhook` | `POST /.netlify/functions/stripe-webhook` *(verifies raw signature; inserts `tips` ONLY on verified `payment_intent.succeeded`; handles `charge.refunded`; credits `inactive` withdraw-only wallet if `FT-4=false`)* | `FT-2,16` (receipt/notif) | `record_verified_tip_payment()`, `finalize_tip_refund()` |
| 3 | `resolveRoomView` | `GET /.netlify/functions/resolve-room-view` *(filters `status='active' AND agreement_signed_at IS NOT NULL AND role='staff'` [excludes `dept_manager`]; signs `staff-photos` & `property-backdrops` URLs)* | `FT-3,4,5,6,7,8,22` | `get_public_tip_target()` |
| 4 | `createPerson` | `POST /.netlify/functions/create-person` *(leaves `auth_user_id = NULL` until invite/Join QR claim; plus `update-person` enforcing `FT-15`, blocking `property_admin` creation/escalation, requiring `department_id NOT NULL`, locking/syncing `email` once claimed, and locking server columns)* | `FT-15,24` | `create_person_record()`, `update_person_record()` |
| 5 | `joinByQr` | `GET/POST /.netlify/functions/join-by-qr` *(strictly `auth_user_id IS NULL AND status='active'`)* | `FT-23` | `list_joinable_staff()`, `complete_join_by_qr()` |
| 6 | `sendOtp` | `POST /.netlify/functions/send-otp` *(Turnstile/CAPTCHA + `(email, purpose)` & IP rate-limit on unauthenticated Join QR)* | *(Core security; `FT-23` for `join_qr`)* | `create_hashed_otp_with_rate_limit()` |
| 7 | `verifyOtp` | `POST /.netlify/functions/verify-otp` *(locks `otp_codes` `FOR UPDATE`)* | *(Core security)* | `verify_hashed_otp_and_trust_device()` |
| 8 | `parseAssignmentSheet` | `POST /.netlify/functions/parse-assignment-sheet` (PDF sync) / `parse-assignment-sheet-background` (`202` async 15m window for photo OCR) | `FT-10` (PDF), `FT-11` (OCR) | Read-only `rooms` + active signed `people` query |
| 9 | `saveAssignments` | `POST /.netlify/functions/save-assignments` *(uses `(now() AT TIME ZONE p.timezone)::date`)* | `FT-10,11,12,14` | `upsert_daily_assignments()` |
| 10 | `distributePool` | `POST /.netlify/functions/distribute-pool` *(locks `departments` → eligible `role='staff'` `people` in UUID order)* | `FT-21` | `execute_pool_distribution()` |
| 11 | `refundTip` | `POST /.netlify/functions/refund-tip` *(two-phase w/ attempt-scoped `refund:<tip_id>:<attempt_uuid>` & `refund_rev:<tip_id>:<attempt_uuid>`; `paid` → `refund_pending` → Stripe → `refunded` or `refund_reversal`)* | `FT-20` | `reserve_24h_tip_refund()`, `finalize_tip_refund()` |
| 12 | `handleDispute` | `POST /.netlify/functions/stripe-webhook` (`charge.dispute.created` / `closed`) *(handles `person` & `department_pool`)* | *(Mandatory compliance)* | `record_chargeback_dispute()`, `reverse_won_dispute()` |
| 13 | `requestWithdrawal` | `POST /.netlify/functions/request-withdrawal` *(checks `stripe_connect_account_id` / initiates `create-connect-onboarding-link` if unlinked; sets `stripe_idempotency_key='payout:'||id`)* | `FT-17,18,19` *(except `L270`)* | `create_withdrawal_and_reserve_ledger()` |
| 14 | `runWeeklyPayouts` | `pg_cron` (`0 * * * *`) + `pg_net` (`CRON_SECRET` from Vault) → `run-weekly-payouts-background` (gates `DOW = payout_weekday AND HOUR = 9` in `p.timezone` + `UNIQUE (property_id, payout_date)`, loops `LIMIT 20` chunks); separate hourly `reconcile-stale-payouts-background` reconciles >15m `processing` withdrawals & `refund_pending` tips | `FT-19` *(except `L270`)* | `claim_weekly_withdrawal_batch()`, `reconcile_stale_withdrawals()`, `reconcile_stale_refunds()` |
| 15 | `unclaimedReminders` | `pg_cron` (`0 14 * * *`) + `pg_net` (`Authorization: Bearer <CRON_SECRET>` from Vault) → `POST /.netlify/functions/unclaimed-reminders-background` | *(Mandatory compliance)* | `claim_due_unclaimed_reminders()` |
| 16 | `generateQrCards` | `POST /.netlify/functions/generate-qr-cards` (single) / `generate-qr-cards-background` (`202` async PDF/ZIP + Storage/Realtime progress) | `FT-6,7,8,9` | Read-only `rooms`/`departments`/`people` |
| 17 | `billingSync` | `POST /.netlify/functions/stripe-webhook` (`invoice.*` / `customer.subscription.*`) | *(Core billing)* | `sync_property_subscription_status()` |
| 18 | `apiGateway` | `ANY /.netlify/functions/api-gateway/*` *(blocks `pending`/`restricted`/`cancelled` properties)* | `FT-25`, `FT-13` | `verify_api_key()`, endpoint RPCs |
| 19 | `ssoToken` | `POST /.netlify/functions/sso-token` (issue via `sso_providers` `hashed_client_secret` + `SSO_TOKEN_SIGNING_KEY`, or verify partner `RS256`/`EdDSA` key & redeem non-`super_admin`) | `FT-26` | `verify_sso_provider()`, `consume_sso_jti_nonce()` |
| 20 | *(Supporting: `FT-27` Export)* | `POST /.netlify/functions/export-tips` *(CSV/PDF payroll export for `/admin/tips`)* | `FT-27` | Read-only scoped `tips`/`people`/`departments` query |

*(Plus `POST /.netlify/functions/sign-agreement` for server-timestamped click-to-accept contracts `L93, L139`, `POST /.netlify/functions/delete-department` enforcing `AC-8` atomic reassignment, and `POST /.netlify/functions/create-connect-onboarding-link` generating Stripe-hosted Express KYC/bank-linking sessions for `staff`.)*

---

## 6. Deep Dive: Key Subsystems

### 6.1 Daily PDF/OCR Assignment Pipeline & 7 Matching Rules (Section 17)

1. **Input Modes (`L50`):** Date picker (`YYYY-MM-DD`) + (a) PDF upload (`FT-10`), (b) camera photo OCR (`FT-11`), (c) manual dropdown per room (`FT-12`), or (d) External API push (`FT-13`).
2. **Extraction (`parse-assignment-sheet` / `parse-assignment-sheet-background`):**
   - **PDF path (`L118, L241`):** `pdf-parse` extracts raw text blocks/lines with Y-coordinates (no OCR used for digital PDFs). If PDF text yields 0 characters (scanned image-only PDF), return a clear prompt to use Camera Photo OCR (`L118`).
   - **Camera Photo path (`L118, L241`):** Invokes `parse-assignment-sheet-background` (`202 Accepted` + Storage/Realtime job completion to avoid 10s/26s Netlify timeouts); image pre-processed with `sharp` (grayscale, contrast normalize, deskew) → `OcrAdapter` (`tesseract.js` locally/Node or `mock` in unit tests).
3. **7 Rule-Based Matching Rules (`L241–L247`):**
   - **Rule 1–2:** Tokenize text into lines/blocks; extract room numbers matching `rooms.room_number` for `property_id` (word-boundary match so `"101"` in `"Room 101"` matches without matching `"$1010"`).
   - **Rule 3–4:** Normalize eligible housekeepers (`people` where `status = 'active' AND agreement_signed_at IS NOT NULL AND role = 'staff'` and department is Housekeeping — excluding `property_admin`, `dept_manager`, and unsigned staff): lowercase, collapse whitespace, strip punctuation. Match **full name first**, then **unique first name** on the same line or adjacent same-block token cluster—working with **zero fixed column layout** (`L247`).
   - **Rule 5–6:** Any line with a room number whose housekeeper is unmatched—or where **two active housekeepers share a first name** (e.g., `"Maria"` with Maria Garcia & Maria Lopez)—is flagged `status: 'ambiguous' | 'unmatched'` with candidate dropdown options (`L245–L246`). **Nothing is written to `assignments` until the admin clicks Confirm (`L185, L245`).**
4. **Mid-Day Reassignment & Checkout Snapshot (`L38, L50, L194`, `AC-4`):**
   - All "today" assignment queries use `(now() AT TIME ZONE p.timezone)::date`.
   - When `save-assignments` updates an existing `(property_id, assignment_date, room_number)` row (`FT-14` enabled), it sets `reassigned_from_person_id = old.person_id`, `person_id = new_person_id`.
   - When a guest tips the room's assigned housekeeper, `create-tip-checkout` accepts `expectedAssignedPersonId`: if `assignments.person_id` changed since `resolve-room-view` loaded, `create-tip-checkout` rejects with **`409 ASSIGNMENT_CHANGED`** (returning the refreshed target so the guest UI updates cleanly before payment). Once `create-tip-checkout` creates the `checkout_intents` row + Stripe PaymentIntent, `person_id` is snapshotted in `checkout_intents` and PI metadata so an already-in-flight payment credits the attendant shown to the guest while any post-reassignment checkout credits the new housekeeper (`AC-4`).

### 6.2 Stripe Payments, Wallets, Weekly/Instant Payouts & Connect Boundary

- **Payment Flow (`L60–L64`):** `create-tip-checkout` validates target (`status = 'active' AND agreement_signed_at IS NOT NULL AND role = 'staff'` for person targets, plus `department_pool` `FT-4`), amount bounds, toggle state, and property `status = 'active'`. Computes Stripe fee estimate (`2.9% + 30¢` configurable constant pending pre-launch confirmation) and applies `properties.payment_fee_paid_by`:
  - `property`: Guest pays `amount_cents`; staff receives `amount_cents`; property is billed/reconciled for `fee_cents`.
  - `guest`: Uses Stripe gross-up `guest_fee_cents = ceil((amount_cents + 30) / (1 - 0.029)) - amount_cents` (e.g., `$10.00` tip → `+$0.61` fee = `$10.61` total) so staff receives the full `amount_cents` after Stripe deducts `2.9% + 30¢` from the gross charge; line item shown on checkout.
  - `staff`: Guest pays `amount_cents`; `fee_cents` is recorded as a `fee` ledger debit so staff receives `amount_cents - fee_cents`.
- **Stripe Connect Express (`Separate Charges and Transfers`, Signed Off `OI-4`):** Architecture implements payout execution behind a `PayoutExecutor` interface inside `PaymentAdapter`, signed off on **Stripe Connect Express** (`Separate Charges and Transfers`):
  - Guests pay the platform via Stripe Payment Element (`PaymentIntent` settled on platform); `stripe-webhook` confirms and credits the recipient's in-app wallet (`ledger`).
  - Before first payout, staff tap **Link Bank or Debit Card** in `/staff`, calling `create-connect-onboarding-link` to open Stripe-hosted Express onboarding (storing only `stripe_connect_account_id` in `people`; **zero bank/card/SSN numbers ever touch our DB `L72, L105`**).
  - `run-weekly-payouts-background` and instant `request-withdrawal` execute `stripe.transfers.create` + payout to the staff member's Connect Express account (using `mock` / `stripe_test` modes locally with zero live credentials).

### 6.3 Agreements, Flat Subscription Billing, External API & SSO

- **Agreements:** Click-to-accept `sign-agreement` Netlify Function generates a timestamped PDF summary stored in `signed-agreements` bucket + inserts immutable `agreements` row (`typed_name`, `checkbox_confirmed`, `signed_at`, `ip_address`). Property status cannot transition `pending -> active` until a `signer_type='property'` agreement exists; Staff cannot receive tips or withdraw until `people.agreement_signed_at IS NOT NULL` (`L93`).
- **Billing (`billing-sync`):** Flat monthly/yearly Stripe Subscription (`plan_type`, `plan_price_cents`, zero % cut of tips `L95`). Stripe Smart Retries handle transient card failures (`past_due`); once subscription reaches `unpaid`, `billing-sync` sets `properties.status = 'restricted'`, blocking all guest tipping (`L187`) and invoking the non-payment withdrawal restriction (`L270`). Paying the invoice restores `properties.status = 'active'`.
- **External API (`api-gateway`) & SSO (`sso-token`):** Detailed security specifications in Document `02-security-and-compliance.md` and proposed v1 schemas in Document `04-open-items-and-verification.md`.

---

## 7. Complete Section 19 Feature Toggle Matrix (`FT-1`..`FT-27`)

Every property has 27 boolean flags in `property_features`, modifiable **only by Super Admin** (`L266`). Disabling a toggle **hides UI controls**, **rejects backend calls (`403 FEATURE_DISABLED`)**, and **never deletes historical data** (`L270`).

**Critical Non-Payment Invariant (`L270`):** Even if `FT-17` (`staff_wallet_and_withdrawals`) or `FT-19` (`weekly_batch_payouts`) is turned `false`—or if staff is `inactive` or property is `cancelled` (`L79`)—any staff member with `wallet_balance_cents > 0` **retains the ability to withdraw existing funds**, **EXCEPT** when `properties.status = 'restricted'` (unpaid subscription restriction).

| ID | Feature Key (`property_features`) | Spec Toggle Name (`L268`) | UI Hiding Surface | Backend RPC / Function Gate |
|---|---|---|---|---|
| `FT-1` | `guest_notes` | `guest notes` | Hides note input on `/tip/*`; historical notes stay on `/staff` & `/admin/tips` | `create-tip-checkout` strips/rejects non-empty `note` |
| `FT-2` | `email_receipts` | `email receipts` | Hides receipt email field on `/tip/*` thank-you | `stripe-webhook` skips sending receipt email |
| `FT-3` | `tip_specific_housekeeper` | `tipping a specific housekeeper` | Hides assigned housekeeper card on `/tip/room/:roomId` | `resolve-room-view` omits individual housekeeper; `create-tip-checkout` rejects `person` target in room flow |
| `FT-4` | `department_pool_tips` | `department pool tips` | Hides "Whole Department Pool" card on `/tip/room/*` & `/tip/dept/*` | `create-tip-checkout` rejects `recipient_type='department_pool'` |
| `FT-5` | `tip_specific_person_in_dept` | `tipping a specific person within a department` | Hides staff picker inside department expansion | `resolve-room-view` omits dept staff list; `create-tip-checkout` rejects dept-sourced `person` target |
| `FT-6` | `department_qr_codes` | `department QR codes` | Hides Dept QR tab/buttons on `/admin/rooms` | `generate-qr-cards` & `/tip/dept/*` reject `department` target |
| `FT-7` | `personal_staff_qr_codes` | `personal staff QR codes` | Hides Personal QR card on `/staff` & `/admin/rooms` | `generate-qr-cards` & `/tip/person/*` reject `person` target |
| `FT-8` | `room_qr_codes` | `room QR codes` | Hides Room QR generator on `/admin/rooms` | `generate-qr-cards` & `/tip/room/*` reject `room` target |
| `FT-9` | `qr_templates` | `QR templates` | Hides template upload on `/super/properties`; exports plain QR | `generate-qr-cards` skips template compositing / rejects template upload |
| `FT-10` | `pdf_assignment_upload` | `PDF assignment upload` | Hides PDF upload tab on `/admin/assignments` | `parse-assignment-sheet` (`mode='pdf'`) rejects `403` |
| `FT-11` | `camera_photo_ocr` | `camera photo with OCR` | Hides Camera/Photo OCR tab on `/admin/assignments` | `parse-assignment-sheet` (`mode='photo'`) rejects `403` |
| `FT-12` | `manual_assignment` | `manual assignment` | Disables manual room dropdowns on `/admin/assignments` | `save-assignments` rejects `source='manual'` |
| `FT-13` | `api_assignment_push` | `API assignment push` | Hides API push status badge on `/admin/assignments` | `api-gateway` rejects `POST /assignments` (`403`) |
| `FT-14` | `mid_day_reassignment` | `mid-day reassignment` | Disables edit on already-assigned rooms for today | `save-assignments` rejects overwrite when existing assignment exists |
| `FT-15` | `department_manager_role` | `department manager role` | Hides `dept_manager` role option in `/admin/people` | `create-person` / `update-person` reject `role='dept_manager'`; auth guard blocks dept manager actions |
| `FT-16` | `in_app_notifications` | `in-app notifications` | Hides notification bell & live toast on `/staff` | `stripe-webhook` skips inserting new `notifications` rows |
| `FT-17` | `staff_wallet_and_withdrawals` | `staff wallet and withdrawals` | Hides wallet when balance == 0; **keeps Today's Rooms & Personal QR active while preserving existing-balance withdrawal section when balance > 0** (`L270`) | `request-withdrawal` rejects ONLY if `balance <= 0` OR `property.status == 'restricted'` |
| `FT-18` | `instant_payouts` | `instant payouts` | Hides Instant Debit option in `/staff` withdraw drawer | `request-withdrawal` rejects `method='instant'` |
| `FT-19` | `weekly_batch_payouts` | `weekly batch payouts` | Hides Standard Weekly option if balance == 0 (**preserved if balance > 0 & not restricted**; Today's Rooms & Personal QR stay intact `L270`) | `request-withdrawal` (`standard`) & `run-weekly-payouts-background` honor `L270` invariant |
| `FT-20` | `refunds` | `refunds` | Hides Refund button on `/admin/tips` | `refund-tip` rejects `403 FEATURE_DISABLED` |
| `FT-21` | `pool_distribution` | `pool distribution (split and individual)` | Hides Distribute Pool drawer on `/admin/tips` | `distribute-pool` rejects `403 FEATURE_DISABLED` |
| `FT-22` | `guest_paid_fee_option` | `guest-paid fee option` | Disables `guest` option in `/super/properties` fee policy | `create-tip-checkout` rejects `guest_fee_cents > 0` |
| `FT-23` | `join_qr` | `join QR` | Hides Join QR download on `/admin/people` & blocks `/join/:propertyId` | `join-by-qr` & `send-otp(purpose='join_qr')` reject `403` |
| `FT-24` | `email_invites` | `email invites` | Shows "Invite email disabled" notice when adding staff | `create-person` creates `people` row (`auth_user_id = NULL`) without dispatching invite email |
| `FT-25` | `external_api` | `external API` | Hides API key panel on `/super/integrations` | `api-gateway` rejects all property endpoints (`403`) |
| `FT-26` | `single_sign_on` | `single sign-on` | Hides SSO config on `/super/integrations` & SSO entry on `/login` | `sso-token` rejects issue & redeem (`403`) |
| `FT-27` | `tips_overview_export` | `tips overview export` | Hides CSV/PDF export buttons on `/admin/tips` | `POST /.netlify/functions/export-tips` rejects `403 FEATURE_DISABLED` |

---

## 8. Zero-Credential Local Development, Stripe Test Mode & Stubbed Email

Per `ORIGINAL_REQUEST.md` (`R1`), the system must run and pass automated tests locally with **zero live Stripe, Resend, or cloud credentials**.

### 8.1 Local Runtime Stack

| Service | Local Tool | Port / Access | Purpose |
|---|---|---|---|
| **Database, Auth, Storage, Realtime** | `supabase start` (Docker CLI) | API `:54321`, DB `:54322`, Studio `:54323` | Runs real Postgres 15+ with `FORCE ROW LEVEL SECURITY`, GoTrue Auth, Storage, and Realtime locally. |
| **Email Inbox UI (Zero Resend Key)** | **Mailpit** (bundled in `supabase start`) | Web UI `:54324`, SMTP `:54325` | Captures all OTPs, invites, guest receipts, and 30/60/90d reminders in a browser inbox. |
| **Backend & SPA Host** | `netlify dev` | App + Functions `:8888` | Serves Vite+React SPA and executes all Netlify Functions (`/.netlify/functions/*`) locally. |
| **Database Seed** | `supabase/seed.sql` | Auto-loaded on `supabase db reset` | Seeds 2 properties (1 `active` w/ all 27 toggles `true`, 1 `restricted`), departments, active/inactive staff, rooms `101–120`, sample assignments, and pre-hashed test API key. |

### 8.2 Pluggable Environment Adapters (Zero Live Secrets Required)

All external side effects sit behind strict TypeScript interfaces configured via `.env.local`:

1. **`PaymentAdapter` (`PAYMENT_MODE=mock | stripe_test | stripe_live`)**:
   - **`mock` (CI & zero-key dev):** `createTipCheckout` returns a local test PaymentIntent ID (`pi_mock_...`); a dev-only test helper or local webhook script signs a synthetic webhook payload using a local `STRIPE_WEBHOOK_SECRET=whsec_mock_dev` so the **exact same signature verification code path** runs in `stripeWebhook`. Payouts & refunds immediately return deterministic mock Stripe IDs.
   - **`stripe_test` (Interactive Stripe testing):** Uses `sk_test_...` + `pk_test_...` + `stripe listen --forward-to http://localhost:8888/.netlify/functions/stripe-webhook` (`whsec_...`) with official Stripe test cards (`4242...` success, `4000...0002` decline, dispute test cards).
   - **`stripe_live` (Production):** Activated only in Netlify production environment variables after legal/Connect sign-off (`OI-4`).

2. **`EmailAdapter` (`EMAIL_MODE=stub | mailpit | resend`)**:
   - **`stub` (Automated tests / headless CI):** Writes `{to, subject, otpCodeOrBody, template, timestamp}` into an in-memory ring buffer or `.tmp/email-outbox.jsonl` (dev-only), allowing Playwright/Vitest tests to read exact 6-digit OTPs without touching external mail servers.
   - **`mailpit` (Local human testing):** Sends SMTP mail via `nodemailer` to `127.0.0.1:54325`; developers open `http://localhost:54324` to view formatted HTML OTPs, invites, and guest receipts.
   - **`resend` (Staging / Production):** Uses Resend REST API with verified sending domain (`L116`).

3. **`OcrAdapter` (`OCR_MODE=mock | tesseract`)**:
   - **`mock`:** Deterministic fixture text output for automated matching rule tests (`AC` / `OI-5` corpus).
   - **`tesseract`:** Local/Node `tesseract.js` OCR engine on pre-processed camera photos (`sharp`).

### 8.3 Mandatory Fail-Closed Production Boot Guards

Shared server configuration initialization detects strict production explicitly—never colliding with Netlify preview deploys that set `NODE_ENV=production`:

```ts
const deployContext = process.env.NETLIFY_CONTEXT ?? process.env.CONTEXT;
const isProd =
  deployContext === 'production' ||
  (!deployContext && process.env.NODE_ENV === 'production');
```

Inside `if (isProd)`, boot initialization **must enforce positive allowlists** and throw a fatal startup error if any assertion fails:
- `process.env.PAYMENT_MODE === 'stripe_live'` *(stops `'mock'`, `'stripe_test'`, or unset)*;
- `process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_')` *(prevents test keys in live production)*;
- `process.env.EMAIL_MODE === 'resend'` *(stops `'stub'`, `'mailpit'`, or unset)*;
- `process.env.OCR_MODE === 'tesseract'` *(stops `'mock'` or unset)*;
- `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, `OTP_SERVER_SECRET`, and `SSO_TOKEN_SIGNING_KEY` are each non-empty, `>= 32` characters, and not equal to `'whsec_mock_dev'` or any dev default value.

Conversely, when `CONTEXT === 'deploy-preview'` (or `'branch-deploy'`), `isProd` evaluates to `false` even when `NODE_ENV === 'production'`, allowing staging/preview builds to intentionally run `PAYMENT_MODE=stripe_test` and `EMAIL_MODE=stub`.

Additionally, **no mock-webhook signing helper or test-outbox reader endpoint may ever be placed inside `netlify/functions/`**—synthetic webhook signing lives strictly inside local dev/CI test scripts (`tests/` / `scripts/`).
