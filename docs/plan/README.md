# Hospitality Tipping Platform (`FrontDesk Pro` Module) — Architecture, Security & Animated UI/UX Plan

> **Purpose:** Pre-implementation review package covering Requirements `R1`–`R4`, all **16 Section 15 routes**, all **27 Section 19 feature toggles**, all **9 Section 14 acceptance checks**, and all **6 Section 20 open items**—produced strictly prior to writing application code and without modifying `/Volumes/MIGHTY DATA/Tipping App /Resources /Hospitality Tipping Platform Product Spec for AI Agents.md`.

---

## 1. Executive Summary & Review Guide

| Audience | What to Review / Status | Decisions & Sign-Off Summary |
|---|---|---|
| **Sanju (Product Owner)** | [Stack Decision Callout](#2-stack-decision-callout-spec-section-8--9-governance) + [`04-open-items-and-verification.md`](./04-open-items-and-verification.md) §1 + [`03-ui-ux-and-motion-design.md`](./03-ui-ux-and-motion-design.md) §2 | **Signed Off (Nov 25, 2026):** **Supabase + Netlify Functions**, Tip Bounds & `[$3,$5,$10,$20]` presets (`OI-1`), Phase 1 Standalone SSO + REST API (`OI-2`), Stripe Connect Express (`OI-4`), **Boutique Resort Glassmorphism** + **Warm Resort Glass** Staff UI + hero photo upload (`OI-6`), and `role='staff'` + Whole Dept Pool (`FT-4`). *Pending when ready:* real sample hotel sheets (`OI-5`). |
| **Engineering & Security Reviewers** | [`01-stack-comparison-and-architecture.md`](./01-stack-comparison-and-architecture.md) + [`02-security-and-compliance.md`](./02-security-and-compliance.md) + [`04-open-items-and-verification.md`](./04-open-items-and-verification.md) §3 | Verify Postgres `FORCE ROW LEVEL SECURITY` isolation, `SELECT ... FOR UPDATE` ledger serialization, guest projection minimization (`role='staff'`), 6 private Storage buckets, Stripe webhook idempotency, OTP/API key hashing, and zero-credential local dev (`Mailpit` + `stripe listen` + `mock` adapters). |
| **Legal & Stripe Compliance** | [`02-security-and-compliance.md`](./02-security-and-compliance.md) §8 + [`04-open-items-and-verification.md`](./04-open-items-and-verification.md) (`OI-4`) | **Stripe Connect Express** (`Separate Charges and Transfers`) signed off; pre-live legal still confirms state escheatment deadlines post-90-day reminders (`L79`), 1099-K rules, and lawyer-drafted Property/Staff/Guest terms (`L93`). |

### Document Suite Index

1. **`README.md`** *(this document)* — Executive summary, Stack Decision Callout, and Master Traceability Index.
2. **[`01-stack-comparison-and-architecture.md`](./01-stack-comparison-and-architecture.md)** *(`R1`)* — 7-dimension Supabase vs. Firebase evaluation, 1-to-1 Firebase fallback mapping, normalized 24-table Postgres schema (15 spec-mapped + 9 operational incl. `checkout_intents`, `sso_providers`, & `properties.hero_photo_path`) & state machines, resolution of 5 spec tensions (`ST-1`..`ST-5`), all 7 actors, 10 modules, 20 server function rows (19 spec functions + `export-tips`, plus `sign-agreement`, `delete-department`, & `create-connect-onboarding-link`, with Netlify Background Functions for heavy/cron jobs), PDF/OCR pipeline, Stripe Connect Express flows, 27 feature toggles (`FT-1`..`FT-27`), and zero-credential local dev + fail-closed production guards.
3. **[`02-security-and-compliance.md`](./02-security-and-compliance.md)** *(`R2`)* — Unauthenticated guest data minimization (`role='staff'`), `FORCE ROW LEVEL SECURITY` & live `people.status` isolation, 6 private Storage buckets (incl. `property-backdrops`), Auth/OTP/Join-QR/SSO security, Stripe webhook signature verification & ACID ledger integrity, 24h refund & negative-balance chargeback controls, scoped/hashed/revocable API keys, immutable contract logs, and Stripe Connect Express / unclaimed-funds boundaries.
4. **[`03-ui-ux-and-motion-design.md`](./03-ui-ux-and-motion-design.md)** *(`R3`)* — Two-mode design architecture (*"Boutique Resort Glassmorphism"* over full-bleed resort photography for Tipper, *"Warm Resort Glass — Staff Companion"* for Staff, *"Precision Operate"* for Admins), glass tokens, typography, screen-by-screen choreography & states for all 16 Section 15 routes (`RT-1`..`RT-16`), `motion/react` physics, and 3-tier `prefers-reduced-motion` + `prefers-reduced-transparency` accessibility.
5. **[`04-open-items-and-verification.md`](./04-open-items-and-verification.md)** *(`R4` & Verification)* — Signed-off vs. pending external breakdown for `OI-1`..`OI-6` + pre-launch Stripe/Resend confirmations, adapted 10-step Section 18 build order, and full Section 14 (`AC-1`..`AC-9`) + security rubric verification matrix.

---

## 2. Stack Decision Callout (Spec Section 8 & 9 Governance)

Spec Section 9 (`L110–L120`) drafts **Vite + React + TS (hosted on Netlify)** with **Firebase** (Firestore, Firebase Auth, Cloud Functions, Firebase Storage, Stripe, Resend) and states (`L120`): *"If a library or service is not listed here, an agent must ask before adding it."*

Following **Requirement `R1`**'s 7-dimension evaluation in [`01-stack-comparison-and-architecture.md`](./01-stack-comparison-and-architecture.md) §2:

- **Signed-Off Primary Stack (Approved Nov 25, 2026):** **Supabase (`Postgres 15+` with `FORCE ROW LEVEL SECURITY`, GoTrue Auth + Custom Access Token Hook, Storage, Realtime, `pg_cron`) + Netlify Functions (`Node.js 20+ TypeScript`)** alongside the Vite + React SPA on Netlify.
- **Why:** Engine-enforced ACID row locks (`SELECT ... FOR UPDATE`) prevent concurrent withdrawal/refund/chargeback races; `FORCE RLS` + live `people.status` checks eliminate 1-hour JWT claim lag and column-projection leaks; unified DB+Storage permissions replace disconnected rules DSLs; Node.js on Netlify runs `pdf-parse`/`tesseract.js`/`pdfkit` without Deno friction; and `supabase start` includes Docker Postgres + **Mailpit** local email UI with zero external keys.
- **Fallback Reference:** [`01-stack-comparison-and-architecture.md`](./01-stack-comparison-and-architecture.md) §2.3 retains the exact **1-to-1 Firebase fallback mapping** for architectural traceability.

---

## 3. Master Traceability Index

### 3.1 Requirements `R1`–`R4`

| Requirement | Description | Primary Plan Document & Sections |
|---|---|---|
| **`R1`** | Backend Comparison (Supabase vs. Firebase) & Full-Spec Architecture + Local Dev / Stripe Test / Stubbed Email | [`01-stack-comparison-and-architecture.md`](./01-stack-comparison-and-architecture.md) §1–§8 |
| **`R2`** | End-to-End Security, Auth/OTP/Join/SSO, Tenant Isolation, Ledger Integrity, API Keys, Contracts & Compliance | [`02-security-and-compliance.md`](./02-security-and-compliance.md) §1–§8 |
| **`R3`** | Animated Tipper & Tip Receiver UI/UX Design Covering All 16 Section 15 Routes & Accessibility | [`03-ui-ux-and-motion-design.md`](./03-ui-ux-and-motion-design.md) §1–§5 |
| **`R4`** | Concrete Proposals & Sensible Defaults for Section 20 Open Items (Settled vs. Proposed) | [`04-open-items-and-verification.md`](./04-open-items-and-verification.md) §1 |

### 3.2 Section 14 Acceptance Checks (`AC-1`..`AC-9`)

| ID | Spec Check (`L191–L199`) | Architecture & Security Design | UI / Route Coverage | Verification Spec |
|---|---|---|---|---|
| **`AC-1`** | Assigned housekeeper shown first, then departments | `01` §5.3 (`resolveRoomView`); `02` §2.1 | `03` §4.1 (`RT-1`) | `04` §3 (`AC-1`) |
| **`AC-2`** | No assignment → departments only; housekeeping lists all active housekeepers | `01` §5.3; `02` §2.1 | `03` §4.1 (`RT-1`) | `04` §3 (`AC-2`) |
| **`AC-3`** | Paid tip appears in wallet & notification only after Stripe webhook confirms | `01` §3.3, §5.3; `02` §5.1 | `03` §4.1 (`RT-1`), §4.2 (`RT-6`) | `04` §3 (`AC-3`) |
| **`AC-4`** | Tip after mid-day reassignment goes to new housekeeper | `01` §3.1 (`assignments`), §6.1; `02` §5 | `03` §4.3 (`RT-10`) | `04` §3 (`AC-4`) |
| **`AC-5`** | Property admin cannot read another property's data | `01` §5.1; `02` §3.1–§3.3 | `03` §4.3 (`RT-7`..`RT-11`) | `04` §3 (`AC-5`) |
| **`AC-6`** | Staff member cannot change their own balance | `01` §3.1 (`ledger`, `people`); `02` §1, §3.2, §5.2 | `03` §4.2 (`RT-6`) | `04` §3 (`AC-6`) |
| **`AC-7`** | Withdrawal shows next payout day and is paid in weekly batch | `01` §3.3, §4 (`ST-2`), §5.3; `02` §5.2 | `03` §4.2 (`RT-6`) | `04` §3 (`AC-7`) |
| **`AC-8`** | Deleting a department with people forces reassignment first | `01` §3.1 (`ON DELETE RESTRICT`), §5.3 | `03` §4.3 (`RT-7`) | `04` §3 (`AC-8`) |
| **`AC-9`** | Refund after 24 hours is blocked | `01` §3.3, §5.3; `02` §6 | `03` §4.3 (`RT-11`) | `04` §3 (`AC-9`) |

### 3.3 All 16 Section 15 Routes (`RT-1`..`RT-16`)

| ID | Route (`L207–L222`) | Role Access | Architecture / Security Reference | UI & Motion Spec |
|---|---|---|---|---|
| `RT-1` | `/tip/room/:roomId` | Guest (unauthenticated) | `01` §5.3 (`resolveRoomView`); `02` §2 | `03` §4.1 (`RT-1`) |
| `RT-2` | `/tip/dept/:departmentId` | Guest (unauthenticated) | `01` §5.3; `02` §2 | `03` §4.1 (`RT-2`) |
| `RT-3` | `/tip/person/:personId` | Guest (unauthenticated) | `01` §5.3; `02` §2.2 (inactive fallback) | `03` §4.1 (`RT-3`) |
| `RT-4` | `/login` | All staff (+ inline Property/Staff agreements & `#sso=` landing) | `01` §5.1; `02` §4.1, §4.3, §8.1 | `03` §4.2 (`RT-4`) |
| `RT-5` | `/join/:propertyId` | Staff (Join QR onboarding) | `01` §5.3; `02` §4.2 | `03` §4.2 (`RT-5`) |
| `RT-6` | `/staff` | Staff (+ withdraw-only view) | `01` §5.3, §7; `02` §3.1–§3.2, §8.2 | `03` §4.2 (`RT-6`) |
| `RT-7` | `/admin/departments` | Property Admin (+ Super Admin) | `01` §3.1, §5.3; `02` §3.2 | `03` §4.3 (`RT-7`) |
| `RT-8` | `/admin/people` | Property Admin (+ Super Admin) | `01` §3.1, §5.3; `02` §3.2 | `03` §4.3 (`RT-8`) |
| `RT-9` | `/admin/rooms` | Property Admin (+ Super Admin) | `01` §3.1, §5.3; `02` §3.3 | `03` §4.3 (`RT-9`) |
| `RT-10` | `/admin/assignments` | Property Admin & Dept Manager | `01` §6.1; `02` §3.2 | `03` §4.3 (`RT-10`) |
| `RT-11` | `/admin/tips` | Property Admin & Dept Manager (no refunds) | `01` §5.3; `02` §3.2, §6 | `03` §4.3 (`RT-11`) |
| `RT-12` | `/super/dashboard` | Super Admin | `01` §5.2; `02` §3.3 | `03` §4.4 (`RT-12`) |
| `RT-13` | `/super/properties` | Super Admin | `01` §3.1, §6.3, §7; `02` §8.1 | `03` §4.4 (`RT-13`) |
| `RT-14` | `/super/payments` | Super Admin | `01` §4 (`ST-2`), §6.2; `02` §5 | `03` §4.4 (`RT-14`) |
| `RT-15` | `/super/admins` | Super Admin | `01` §5.3; `02` §3.2 | `03` §4.4 (`RT-15`) |
| `RT-16` | `/super/integrations` | Super Admin | `01` §5.3; `02` §4.3, §7; `04` (`OI-2, OI-3`) | `03` §4.4 (`RT-16`) |

### 3.4 All 27 Section 19 Feature Toggles (`FT-1`..`FT-27`)

- **Complete 27-Row Specification Matrix (`FT-1`..`FT-27`):** [`01-stack-comparison-and-architecture.md`](./01-stack-comparison-and-architecture.md) §7 (covering storage in `property_features`, UI hiding, backend `403 FEATURE_DISABLED` enforcement, data preservation, and the `L270` wallet withdrawal invariant).
- **Per-Route Toggle Gating:** [`03-ui-ux-and-motion-design.md`](./03-ui-ux-and-motion-design.md) §4.1–§4.4.
- **Toggle-Off vs. Non-Payment Restriction Verification:** [`04-open-items-and-verification.md`](./04-open-items-and-verification.md) §3.

### 3.5 All 6 Section 20 Open Items (`OI-1`..`OI-6`) + Pre-Launch Confirmations

| ID | Open Item (`L274–L279`) | Primary Proposal Location | Supporting Design Reference |
|---|---|---|---|
| `OI-1` | Min/Max tip amounts & presets *(Signed Off)* | [`04-open-items-and-verification.md`](./04-open-items-and-verification.md) §1 (`OI-1`) | `01` §3.1 (`properties`), `03` §4.1 |
| `OI-2` | Standalone SSO + Data API *(Signed Off)* | [`04-open-items-and-verification.md`](./04-open-items-and-verification.md) §1 (`OI-2`) | `02` §4.3 (`sso-token`), `03` §4.4 |
| `OI-3` | Exact external API request/response formats | [`04-open-items-and-verification.md`](./04-open-items-and-verification.md) §1 (`OI-3`) | `01` §5.3 (`apiGateway`), `02` §7 |
| `OI-4` | Stripe Connect Express *(Signed Off)* & pre-live legal review | [`04-open-items-and-verification.md`](./04-open-items-and-verification.md) §1 (`OI-4`) | `01` §6.2, `02` §8.1–§8.2 |
| `OI-5` | Real sample housekeeping sheet for matching tests | [`04-open-items-and-verification.md`](./04-open-items-and-verification.md) §1 (`OI-5`) | `01` §6.1, `03` §4.3 (`RT-10`) |
| `OI-6` | Guest & Staff UI: Boutique Resort Glassmorphism *(Signed Off)* | [`04-open-items-and-verification.md`](./04-open-items-and-verification.md) §1 (`OI-6`) | `03` §2.1–§2.2 (*Boutique Resort Glassmorphism* & *Warm Resort Glass*) |
| *Pre-Launch* | Stripe US card rate (`L62`) & Resend domain/tier (`L116`) | [`04-open-items-and-verification.md`](./04-open-items-and-verification.md) §1 (Pre-Launch) | `01` §6.2, §8.2 |
