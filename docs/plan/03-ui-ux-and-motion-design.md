# 03 — Animated UI/UX & Motion Design Plan (Requirement R3)

> **Status:** Signed-Off Pre-Implementation Visual, Interaction & Motion Specification (Approved Nov 25, 2026)  
> **Scope:** Requirement `R3` — Cohesive Two-Mode Design System pairing **Boutique Resort Glassmorphism** (Tipper & Tip Receiver) with **Precision Operate** (Manager / Admin / Super Admin); Screen-by-Screen States & Motion Choreography for **all 16 Section 15 Routes (`RT-1`..`RT-16`)**; In-Route Handling of Agreements & SSO (`L203`); `motion/react` Physics Tokens; and 3-Tier `prefers-reduced-motion` + `prefers-reduced-transparency` Accessibility + Zero-CLS Budget.  
> **Methodologies Applied:** `impeccable` (Experience/Persuade vs. Operate mode discipline), `glassmorphism` (4-ingredient frosted glass over resort photography, non-nested `backdrop-filter`, masked specular rim, anti-banding grain), `micro-interaction` (100–250ms GPU-composited feedback, `AnimatePresence`, `layoutId`, continuous button state morphing), and `accessible-animation` (3-tier WCAG 2.3.3 reduced-motion + reduced-transparency degradation).

---

## 1. Two-Mode Aesthetic Architecture & Anti-Slop Guardrails

Rather than forcing one generic SaaS template onto hotel guests and shift supervisors alike, the UI separates **Experience / Hospitality Concierge** (Guest QR & Staff Companion) from **Precision Operate** (Admin & Super Admin consoles) while sharing one underlying currency-formatting and security kernel:

| Surface | Design Mode | Aesthetic Direction | Core Design Priority |
|---|---|---|---|
| **1. Tipper (Guest QR Flow)** `RT-1`..`RT-3` | **Experience / Persuade** *(Mobile-First, Zero Login)* | **"Boutique Resort Glassmorphism"** *(Signed Off Nov 25, 2026)* | Quiet, personal concierge card over full-bleed resort photography (`heroPhotoSignedUrl` or bundled golden-hour wooden lodge/palm/pool/deck photo) with warm dark-brown scrim and floating 4-layer frosted glass controls; instant warmth in `< 2s` after QR scan; zero purple gradients or heavy opaque boxes blocking the property. |
| **2. Tip Receiver (Staff Portal)** `RT-4`..`RT-6` | **Warm Hospitality + Micro-Delight** *(Mobile-First, Shift Ergonomics)* | **"Warm Resort Glass — Staff Companion"** *(Signed Off Nov 25, 2026)* | Cohesive sibling resort-glass surface using the property's hero backdrop under a deeper shift-legible warm espresso scrim (`0.56`→`0.90`); non-nested frosted wallet & tip feed panels; quiet live-tip chime celebration; 1-tap Stripe Connect Express bank/debit linking & crystal-clear withdraw-only states. |
| **3. Manager, Property Admin & Super Admin** `RT-7`..`RT-16` | **Precision Operate** *(Desktop-First Responsive)* | **"Precision Operate"** | Earned familiarity, dense scannable tables, keyboard-friendly workflows, skeleton table states, slide-over drawers over stacked modals, 150–200ms state-only motion. |

---

## 2. Design Tokens, Glassmorphism Spec, Typography & Copy

### 2.1 Surface 1 — Tipper Experience (*"Boutique Resort Glassmorphism"*, Signed Off `OI-6`)

- **Full-Bleed Photography & Warm Dark-Brown Scrim:**
  - Base backdrop uses the property's uploaded photo (`heroPhotoSignedUrl` from `property-backdrops`) or the bundled golden-hour teak lodge / palm / pool / deck resort photograph over a `#1C110A` base fill (`fetchpriority="high"`).
  - Warm dark-brown scrim ensures white/ivory text (`>= 7:1` contrast) without obscuring the resort scene:
    `linear-gradient(180deg, rgba(28, 17, 10, 0.14) 0%, rgba(36, 22, 13, 0.46) 38%, rgba(26, 16, 9, 0.78) 72%, rgba(18, 11, 6, 0.90) 100%)`.
- **4-Ingredient Non-Nested Frosted Glass Controls (`.glass-surface` / `.glass-card-heavy`):**
  - *Frost:* `backdrop-filter: blur(16px) saturate(165%)` + `-webkit-backdrop-filter: blur(16px) saturate(165%)` (modals/thank-you card/drawers: `blur(24px) saturate(160%)`, `rgba(30, 19, 12, 0.58)`). **Never nest `backdrop-filter` inside `backdrop-filter`** (child pills/inputs inside a glass container use crisp translucent/solid fills without duplicate blur).
  - *Translucency:* `background: rgba(255, 248, 240, 0.13)`.
  - *Specular Edge Rim & Anti-Banding Grain:* `1px solid rgba(255, 248, 240, 0.24)` + masked `1px` `135deg` lit-corner `::before` ring (`mask-composite: exclude`) + inline `feTurbulence` SVG noise `::after` (`opacity: 0.04; mix-blend-mode: overlay`) to eliminate blur gradient banding.
  - *Depth & Contrast:* `box-shadow: 0 10px 28px rgba(10, 6, 3, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.30), inset 0 -1px 0 rgba(0, 0, 0, 0.14)` + subtle `text-shadow: 0 1px 2px rgba(12, 7, 4, 0.45)`.
- **Palette & Champagne CTA:** Primary ink `#FAF6F0` (Warm Ivory), secondary ink `rgba(245, 235, 224, 0.90)`, luminous champagne primary CTA & active preset glide pill `rgba(250, 243, 232, 0.94)` with `#21150E` Espresso ink (`> 11:1` contrast), success green `#15803D` / `#F5E1BE` badge, warm amber error/notice `#92400E` on `#FEF3C7` (or `#241710` notice card). Optional per-property `accent_color_hex` (`OI-6`) may tint subtle highlight accents with automatic WCAG AA (`>= 4.5:1`) luminance clamping.
- **Typography:** Display greeting & thank-you headline in self-hosted **`Fraunces`** (`600`, `-0.02em` tracking); labels, presets, and Stripe Payment Element in **`Plus Jakarta Sans`** with **`font-variant-numeric: tabular-nums`** on all amounts.
- **Signed-Off Guest Gesture Micro-Copy (`OI-6`):**
  - *Assigned Room:* `"A warm thank-you for {Name}"` · `"Caring for Room {RoomNumber} today · 100% goes to {Name}"`
  - *Department / Unassigned:* `"Thank our {DepartmentName} Team"` · `"Room {RoomNumber} · Shared equally across today’s team"`
  - *Note Input:* `"Write a personal note (optional)..."` (`0/150`)
  - *Primary CTA:* `"Send ${amount} Thank-You"` → `"Sent with thanks"`
  - *Short Terms:* `"Secured by Stripe · Non-refundable after 24 hours"`

### 2.2 Surface 2 — Tip Receiver (*"Warm Resort Glass — Staff Companion"*, Signed Off)

- **Backdrop & Scrim:** Shares the property's `heroPhotoSignedUrl` (or bundled boutique resort photo) beneath a deeper shift-legible warm espresso scrim: `linear-gradient(180deg, rgba(24, 15, 9, 0.56) 0%, rgba(26, 16, 10, 0.72) 45%, rgba(18, 11, 6, 0.90) 100%)`.
- **Frosted Sibling Panels:** Notification bell button, Available Wallet card, Today's Rooms pills, and Recent Gestures list items sit as sibling `.glass-surface` elements over the photo; live incoming tip toast uses `.glass-toast` (`rgba(24, 15, 9, 0.84)`, `blur(18px)`); primary **Withdraw** CTA uses luminous champagne `rgba(250, 243, 232, 0.94)` with `#21150E` ink; negative-balance chargeback alert uses `#FEF2F2` / `#991B1B`; slide-up Withdraw drawer uses `.glass-card-heavy` (`blur(24px)`, `rgba(30, 19, 12, 0.58)`).
- **Typography:** **`Fraunces`** on hero wallet balance + **`Inter`** / **`Plus Jakarta Sans`** (`tabular-nums`) for ledger credits, debits, OTP digits, and fee breakdowns.

### 2.3 Surface 3 — Admin & Super Admin (*"Precision Operate"*)

- **Palette (Restrained per `impeccable/reference/operate.md`):** `#F4F5F7` app shell, `#EAECEF` sidebar neutral layer, `#FFFFFF` table/card surfaces, `#111827` primary ink, `#4B5563` secondary ink, `#1D4ED8` crisp slate-cobalt primary action, `#047857` active/paid badge, `#B45309` pending/ambiguous highlight, `#B91C1C` overdue/restricted/revoke badge.
- **Typography:** **`Inter`** fixed `rem` scale (`1.125–1.2` step ratio—no fluid `clamp()` headings in sidebars/tables), `tabular-nums` on every financial column and room count.

---

## 3. Motion Physics Tokens & Core Animation Kernel (`motion/react`)

All animations animate **only GPU-composited `transform` and `opacity`** (`60fps`, zero layout thrashing). Continuous decorative loops (floating blobs, pulsing badges) are strictly prohibited.

```ts
// Architectural Motion Token Blueprint (for src/ui/motionTokens.ts during implementation)
export const MOTION = {
  easeOutEnter: [0.16, 1, 0.3, 1] as const,     // Graceful entrance
  easeInExit:   [0.4, 0, 1, 1] as const,        // Prompt exit (asymmetric timing)
  springSnappy: { type: "spring", stiffness: 400, damping: 30 } as const, // Tap & pill glide
  springLayout: { type: "spring", stiffness: 500, damping: 40 } as const, // List/card reorder
  tapScale:     0.96,
  hoverScale:   1.02,
  fadeReduced:  { duration: 0.15, ease: "easeOut" } as const,
};
```

### Signature Motion Patterns Used Across Surfaces
1. **Continuous Button State Morphing:** Submit/Pay/Withdraw buttons stay mounted and morph smoothly (`"Tip $10.00"` → inline spinner → `"Paid ✓"` checkmark) rather than unmounting into a jump cut.
2. **Shared-Element Pill Glide (`layoutId`):** Guest preset tip pills (`$3`, `$5`, `$10`, `$20`, `Custom`), Staff tab underline (`/staff`), and Join QR stepper progress bar share `layoutId` for tactile continuity.
3. **`AnimatePresence mode="popLayout"`:** Used for live tip notification toasts, department-to-staff list swaps, and expandable table rows so exiting items never leave dead layout gaps.
4. **Zero-CLS Skeletons:** Card/table skeletons match exact final heights (`min-height` reserved on photo avatar + 4 preset buttons + checkout area) so Cumulative Layout Shift stays `0.00`.

---

## 4. Complete Screen-by-Screen & Motion Blueprint for All 16 Section 15 Routes

> **Spec Route Rule (`L203`):** *"Agents must not add screens that are not listed."* First-login Staff Agreement signing, Property Onboarding Agreement signing, and SSO token landing execute **inside** the 16 listed routes (`RT-4`, `RT-5`, `RT-6`, `RT-13`) as inline/step views. Out-of-role navigation redirects immediately to the user's home route (`L224`).

### 4.1 Guest Tipping Routes (`RT-1`..`RT-3` — Unauthenticated)

| ID | Route & Access | Toggles Checked | UI States (Happy / Empty / Loading / Error-Restricted) | Micro-Interactions & Motion Spec |
|---|---|---|---|---|
| **`RT-1`** | **`/tip/room/:roomId`** Guest (no login) | `FT-1, 2, 3, 4, 5, 8, 22` | **Loading:** Warm espresso (`#1C110A`) resort backdrop + reserved-height frosted card skeleton.<br>**Happy (Assigned, `AC-1`):** Open concierge hero over full-bleed resort photo + warm dark-brown scrim (circular portrait of assigned `role='staff'` attendant, `"A warm thank-you for Maria"`, frosted presets `$3/$5/$10/$20` + Custom), followed below by frosted Department accordion (`Housekeeping`, `Front Desk`, `Maintenance`, etc.).<br>**Empty (Unassigned, `AC-2`):** No housekeeper hero; frosted Departments list first; expanding `Housekeeping` reveals `"Thank our Housekeeping Team"` pool (`FT-4`) + active housekeepers (`FT-5`, `role='staff'`).<br>**Error/Restricted/Stale Assignment:** Invalid `roomId` (`L183`) or `restricted` property (`L187`) renders frosted concierge notice with checkout disabled. If `create-tip-checkout` returns `409 ASSIGNMENT_CHANGED` (`AC-4`), UI swaps in the refreshed housekeeper cleanly before payment. | **Arrival:** Single `180ms` `opacity: 0→1, y: 6→0` (`easeOutEnter`).<br>**Presets:** `whileTap={{ scale: 0.96 }}` (`springSnappy`), luminous champagne `layoutId="tipPresetActive"` pill glide inside frosted bar.<br>**Custom Amount:** Inline frosted dollar input expands smoothly without shifting Pay CTA.<br>**Note & Fee:** Frosted 150-char counter (`0/150` tabular); fee line (`+$0.61 card fee` → `$10.61` total via Stripe gross-up) fades in (`150ms`) when `guest_paid_fee_option` applies.<br>**Pay → Thank-You:** Champagne CTA morphs (`"Send $10.00 Thank-You"` → spinner → `"Sent with thanks"`) → transitions (`220ms`) to heavy-frost Thank-You card (`320ms` SVG `stroke-dashoffset` checkmark + 14-particle champagne-gold shimmer `<750ms`, non-nested inner receipt input morphing to `"Receipt Sent"`). |
| **`RT-2`** | **`/tip/dept/:departmentId`** Guest (no login) | `FT-1, 2, 4, 5, 6, 22` | **Loading:** Resort photo + frosted dept header & 4-row staff skeleton.<br>**Happy:** Pre-scoped to target Department; frosted segmented switch between `"Thank our [Dept] Team"` (`FT-4`) and `"Choose a team member"` (`FT-5`, `role='staff'` photo + name).<br>**Empty:** Dept has 0 active staff → shows Pool option only.<br>**Error/Restricted:** `FT-6` disabled, unknown `departmentId`, or `restricted` property renders frosted blocked notice. | Switching between **Team Pool** and **Specific Staff** uses `AnimatePresence mode="popLayout"` (`160ms`) + `layoutId="recipientRing"` on selected portrait; checkout & frosted thank-you morphs match `RT-1`. |
| **`RT-3`** | **`/tip/person/:personId`** Guest (no login) | `FT-1, 2, 4, 7, 22` | **Loading:** Portrait + name skeleton over resort backdrop.<br>**Happy:** Open concierge spotlight over resort photography (name, portrait, department badge, frosted presets + Custom, note, fee line, Stripe checkout, terms).<br>**Inactive Fallback (`L186`):** If person is `inactive` or deleted and **`FT-4` is enabled**, renders calm frosted banner (*"Tips for this role support the [Dept] team pool"*) and routes tip to `department_pool`.<br>**Unavailable (`422 RECIPIENT_UNAVAILABLE`) / Error:** If person is `inactive` and **`FT-4` is `false`**, renders frosted unavailable concierge notice (`422 RECIPIENT_UNAVAILABLE`); `FT-7` disabled or `restricted` property likewise blocks checkout. | `180ms` card settle + champagne `layoutId="tipPresetActive"` pill glide + continuous Pay button morph + SVG checkmark shimmer. |

### 4.2 Staff Auth, Join & Portal Routes (`RT-4`..`RT-6`)

| ID | Route & Access | Toggles Checked | UI States & In-Route Sub-Flows (`L203`) | Micro-Interactions & Motion Spec |
|---|---|---|---|---|
| **`RT-4`** | **`/login`** All staff roles (pre-auth + SSO landing) | `FT-26` (SSO) | **Default:** Heavy-frost concierge login card over resort photo (Email + Password).<br>**New Device OTP Step (inline):** Transitions in-place to 6-digit frosted OTP box array + `"Trust this browser for 30 days"` checkbox (`L87`).<br>**SSO Landing (`#sso=<token>`, `L97`):** Verifies fragment token immediately with quiet frosted loading card (confirming session swap if another user is signed in) → redirects to role home.<br>**First-Login Agreement Gate (`L93`):** Renders inline Click-to-Accept **Property Service Agreement** (`property_admin`, `pending` property) or **Staff Agreement** (`staff` / `dept_manager` when `agreement_signed_at IS NULL`) inside the route.<br>**Error:** Wrong password, expired/rate-limited OTP (`429` cooldown timer). | Form ↔ OTP step transition via `AnimatePresence mode="wait"` (`180ms` opacity + `10px` subtle horizontal shift).<br>6-digit OTP cells feature instant focus-advance, paste-split, and `±4px` `180ms` horizontal shake on invalid code (`Tier 1` stripped under reduced motion). |
| **`RT-5`** | **`/join/:propertyId`** Unauthenticated Staff via Join QR | `FT-23` | **Step 1:** Pick your name from unclaimed active `role='staff'` directory (`auth_user_id IS NULL`, emails hidden!).<br>**Step 2:** Turnstile/CAPTCHA + enter 6-digit OTP sent to admin-entered email.<br>**Step 3:** Set initial password + sign Click-to-Accept Staff Agreement (typed name + checkbox) inside frosted resort card.<br>**Disabled/Error:** `FT-23` disabled, already-onboarded (`409` → `/login`), or invalid/restricted property shows clear notice. | 3-step horizontal progress indicator using `layoutId="joinStepFill"` (`springSnappy`); typed-name input renders live serif signature preview (`150ms` opacity settle). |
| **`RT-6`** | **`/staff`** Staff (`role='staff'`; out-of-role redirected `L224`) | `FT-7, 16, 17, 18, 19` (`L270` invariant!) | **Happy (Active Staff in Active Property — "Warm Resort Glass"):** Property hero photo + deeper warm espresso scrim (`0.56→0.90`); sibling frosted cards for: (1) **Available Wallet Card** (`Fraunces` balance, negative-balance chargeback banner if disputed `L77`, `"Next weekly batch: Thursday"`, champagne **Withdraw** CTA); (2) **Connect Express Setup Banner** (`"Link Bank or Debit Card"` via `create-connect-onboarding-link` when `stripe_connect_account_id IS NULL`); (3) **Today's Rooms** pills; (4) **Recent Gestures** feed with guest notes (`FT-1`); (5) **Notification Bell** (`FT-16`); (6) **Personal QR Card** (`FT-7`) on property template (`FT-9`).<br>**Toggle-Off Preservation (`L270`):** If `FT-17` or `FT-19` is disabled for an **active** staff member in an **active** property with `balance > 0`, **preserve Today's Rooms & Personal QR** (`FT-7`) while keeping the existing-balance withdrawal section enabled.<br>**Withdraw-Only State (`L79, L270`):** **Only** when `people.status = 'inactive'` or `properties.status = 'cancelled'` does `/staff` hide Today's Rooms & Personal QR and render **Withdraw-Only View** (unless `properties.status = 'restricted'` for non-payment, which disables Withdraw with support notice `L270`).<br>**Empty:** Helpful first-shift prompt ("Share your Personal QR or wait for your room assignment"). | **Realtime Tip Toast:** Webhook-confirmed credit triggers single `260ms` bell chime-tilt (`±12deg`, never infinite), `AnimatePresence mode="popLayout"` `.glass-toast` (`"+$10.00 · Room 412"`), and smooth `350ms` numeric balance roll-up.<br>**Withdraw Heavy-Frost Drawer:** Slides up (`200ms`, `easeOutEnter`); Weekly Batch vs. Instant Debit (`FT-18`) toggle with live dynamic fee display from `properties.payout_fee_paid_by` (`ST-3`) and Stripe Connect Express bank/debit destination; inline 6-digit Email OTP step; continuous champagne button morph (`"Confirm Withdrawal"` → spinner → `"Queued for Thursday"` / `"Sent to Debit Card"`).<br>**Tabs:** `layoutId="staffTabUnderline"`. |

### 4.3 Property Admin & Department Manager Routes (`RT-7`..`RT-11`)

| ID | Route & Access | Toggles Checked | UI States & Workflows | Micro-Interactions & Motion Spec |
|---|---|---|---|---|
| **`RT-7`** | **`/admin/departments`** Property Admin (Super Admin via switcher) | `FT-21` | **Happy:** Table/list of departments with default pool distribution pill (`Split Evenly` / `Individual`), inline add/rename.<br>**Forced Reassignment (`AC-8`, `L44, L198`):** Clicking Delete on a department with assigned people opens an inline/drawer prompt listing affected people count and requiring target department selection before `Confirm Reassign & Delete` enables.<br>**Empty:** Onboarding nudge to create Housekeeping / Front Desk. | `150ms` inline row edit morph; slide-over reassignment drawer (`200ms`); `AnimatePresence mode="popLayout"` row removal after server confirmation. |
| **`RT-8`** | **`/admin/people`** Property Admin (Super Admin via switcher) | `FT-15, 23, 24` | **Happy:** Search bar + department filter + Join QR download button (`FT-23`); dense table showing Avatar, Name, Email, Role (`dept_manager` gated by `FT-15`), inline Department move dropdown, Active/Inactive switch (`L25, L46`). Add Person slide-over drawer triggers `create-person` + invite (`FT-24`).<br>**Loading:** 6-row table skeleton.<br>**Error:** Duplicate email validation, `dept_manager` blocked if `FT-15` off. | Inline department dropdown save shows crisp `140ms` subtle green `"Saved"` pill; Active/Inactive switch uses `springSnappy` thumb glide; avatar upload shows instant circular preview. |
| **`RT-9`** | **`/admin/rooms`** Property Admin (Super Admin via switcher) | `FT-6, 7, 8, 9` | **Happy:** Room list + `"Add Single / Range (e.g. 101–140)"` inline bar showing live room preview count (`40 rooms will be added`); Tabs for **Room QRs** (`FT-8`), **Department QRs** (`FT-6`), and **Personal QRs** (`FT-7`) stamped onto property template (`FT-9`); Single view/print/download + Bulk printable sheet / PDF / ZIP export; **Property Resort Backdrop Photo Upload** drawer (`property-backdrops` with live frosted-card preview).<br>**Loading/Progress:** Determinate progress bar during bulk PDF/ZIP generation. | Smooth tab indicator (`layoutId="qrTab"`); bulk generation button morphs to determinate `%` progress → `"Download ZIP ✓"`. |
| **`RT-10`** | **`/admin/assignments`** Property Admin & Dept Manager (dept-scoped) | `FT-10, 11, 12, 13, 14` | **Happy:** Date picker + 4 gated input tabs (`PDF Upload` `FT-10`, `Camera Photo OCR` `FT-11`, `Manual` `FT-12`, `API Feed` `FT-13`).<br>**Mandatory 2-Column Review Workbench (`L50, L165, L245–246`):** Left column shows extracted PDF/OCR lines; Right column shows matched `(Room → Housekeeper)` rows with **unmatched or ambiguous shared-first-name collisions** (e.g. `"Maria"`) highlighted in amber with 1-click manual dropdowns. Nothing persists until `Confirm & Save` (`L245`).<br>**Post-Save:** Summary bar of room counts per housekeeper + inline **Mid-Day Reassign** dropdown (`FT-14`, `AC-4`). | Tab switch (`150ms`); unresolved-row filter pill glides (`layoutId`); resolving an amber ambiguous row smoothly transitions row border amber → neutral/green (`180ms`) and decrements the `"3 to review"` counter badge. |
| **`RT-11`** | **`/admin/tips`** Property Admin & Dept Manager *(dept-scoped; NO refunds/payments `L15, L56`)* | `FT-1, 20, 21, 27` | **Happy:** 3 KPI cards (Total Tips, Tip Count, Avg Tip); filter bar (Date Range, Dept, Person); **Person Tips** & **Department Pools** tabs; expandable rows showing room number, timestamp, guest note (no guest name unless given `L52`); CSV/PDF export (`FT-27`); **Distribute Pool** drawer (`FT-21` — `Split Evenly` among day's active dept staff or `Individual` custom cents summing to pool total); **24h Refund** action (`FT-20`, Property Admin only) showing live `< 24h` eligibility or `"Expired (>24h)"` disabled state (`AC-9`).<br>**Error:** Refund blocked if >24h or recipient balance insufficient (`L75`). | Accordion row expansion via `AnimatePresence` (`160ms`, `opacity + y`); Pool Distribution drawer auto-calculates remainder cents cleanly without input jump; Refund confirmation inline within row/drawer. |

### 4.4 Super Admin Routes (`RT-12`..`RT-16` — `role='super_admin'` Only)

| ID | Route & Access | Toggles Checked | UI States & Workflows | Micro-Interactions & Motion Spec |
|---|---|---|---|---|
| **`RT-12`** | **`/super/dashboard`** Super Admin | Platform-wide | Cross-property KPI strip (Total Tips, Fees Collected, Total Wallet Liability, Paid vs. Overdue Subscriptions), property health table with status pills (`active`, `pending`, `restricted`, `cancelled`), and persistent **Property Switcher** in top header (`L89`) allowing drill-in to `/admin/*`. | Restrained `Operate` mode: zero decorative entrance; instant table skeleton → crisp data; Property Switcher dropdown uses `<dialog>`/popover portal (`150ms` fade) with visible `"Viewing: [Property Name]"` context banner. |
| **`RT-13`** | **`/super/properties`** Super Admin | `FT-9, 22` + manages all `FT-1`..`FT-27` | **7-Step Onboarding Wizard (Drawer/Stepper):** (1) Basics & Property Admin Contact (`department_id = NULL` until Step 7), (2) Plan & Price, (3) Contract Term (`12m`) & Notice (`30d`) + Send/Track Service Agreement (`L93`), (4) Fee Policy (`payment_fee_paid_by` + `payout_fee_paid_by` `property|staff`), (5) Payout Weekday, Property Timezone (`IANA TZ`), & Min Withdrawal, (6) **Interactive QR Template Placer & Resort Backdrop Upload** (upload QR card template + drag/resize `{x, y, size}` box `L91`, plus optional `hero_photo_path` upload into `property-backdrops` with live Resort Glassmorphism preview), (7) Starting Departments + Default Split.<br>**Property Detail View:** Edit status/deactivate, inspect stored **Signed Agreements** (`L93`), and manage the **27-Toggle Feature Matrix** grouped by module (`Guest`, `QR`, `Assignments`, `Payouts`, `Integrations`). | Wizard step bar (`layoutId`); QR coordinate overlay uses smooth `transform` drag/scale handles (`60fps`) snapping to clean ratios; 27-toggle switches use `springSnappy` with instant optimistic lock + rollback on error. |
| **`RT-14`** | **`/super/payments`** Super Admin | Platform-wide | Stripe connection health card (`mock | stripe_test | stripe_live` status, webhook endpoint health), global default Payout Weekday selector (default `Thursday`), global default Minimum Withdrawal (`$10.00` / `1000` cents), recent `payout_batches` status log. | Crisp `150ms` save-state confirmation pill; zero gratuitous motion. |
| **`RT-15`** | **`/super/admins`** Super Admin | `FT-24` | Property Admins directory grouped/filterable by property; Invite Property Admin drawer (sends invite email `FT-24`), Remove Property Admin confirmation with audit log warning. | Inline invite drawer (`200ms`); `AnimatePresence mode="popLayout"` row removal. |
| **`RT-16`** | **`/super/integrations`** Super Admin | `FT-13, 25, 26` | Per-property **External API Keys** table (`label`, `key_prefix`, `scopes[]`, `last_used_at`, `Revoke` button) + Create Key drawer (displays plaintext key **once** with 1-click Copy & security warning); **Single Sign-On** configuration panel (`FT-26`, per-property `sso_providers` `auth_mode` [`server_minted` `client_id` + one-time `client_secret` vs. `partner_asymmetric` `RS256`/`EdDSA` `public_key_pem` / `jwks_url`] / `allowed_origins` & test token generator `L97, L176`). | Copy-to-clipboard button morphs `"Copy Key"` → `"Copied ✓"` (`150ms`); Revoke button prompts inline confirmation before flipping status badge to `Revoked`. |

---

## 5. Tiered `prefers-reduced-motion`, `prefers-reduced-transparency` & Performance Budget

Following `accessible-animation` (`WCAG 2.3.3` & `C39`) and `glassmorphism`, both reduced motion and reduced transparency are explicitly handled without breaking essential loading or state feedback:

| Tier | Animation Category | Standard Motion | Under `prefers-reduced-motion: reduce` |
|---|---|---|---|
| **Tier 1 (Remove)** | Vestibular / large movement | Thank-you 14-particle champagne burst, OTP horizontal shake (`±4px`), numeric wallet balance roll-up, bell chime-tilt, slide distances `> 8px`. | **Removed completely** (`0` particles, instant value update, static bell, `transform: none`). |
| **Tier 2 (Soften)** | State transitions & drawers | Bottom sheets, slide-over drawers, `AnimatePresence mode="popLayout"` toasts, multi-step `/login` & `/join` transitions, `layoutId` tab/pill glides (`160–220ms`). | **Softened to `<= 150ms` opacity cross-fade** (`initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}`). |
| **Tier 3 (Always Keep)** | Essential orientation & feedback | Focus rings, button tap/hover color & border shifts, loading spinners, determinate bulk-QR progress bars, SVG checkmark visibility. | **Preserved** (`opacity`/`color` transitions `<= 150ms`; loading spinners remain visible as essential feedback). |

### Glassmorphism Accessibility, Fallback & Performance Enforcement
1. **Reduced Transparency & Unsupported Blur Fallbacks:**
   ```css
   @media (prefers-reduced-transparency: reduce) {
     .glass-surface, .glass-card-heavy, .glass-toast {
       background: #241710;
       backdrop-filter: none;
       -webkit-backdrop-filter: none;
     }
     .glass-surface::after { display: none; }
   }
   @supports not (backdrop-filter: blur(1px)) {
     .glass-surface, .glass-card-heavy, .glass-toast {
       background: rgba(32, 20, 13, 0.86);
     }
   }
   ```
2. **Non-Nested `backdrop-filter` Guardrail:** Never stack blurred glass elements inside other blurred glass elements (avoids quadratic GPU blur cost and mobile scroll stutter). Animate `transform`/`box-shadow`/`background`—never animate `backdrop-filter` radius across continuous frames.
3. **Root Provider & Custom `useReducedMotion()` Hook:** Wrap app root in `<MotionConfig reducedMotion="user">` from `motion/react`, and use `window.matchMedia('(prefers-reduced-motion: reduce)')` to strip Tier 1 JS animations (confetti canvas particles, count-up interpolation).
4. **Scoped CSS Reduced-Motion Safety Net (`0.01ms` for Tier 1, Preserving Tier 2 & Tier 3):**
   ```css
   @media (prefers-reduced-motion: reduce) {
     [data-motion="decorative"],
     *:not([data-motion="essential"]):not([data-motion="fade"]) {
       animation-duration: 0.01ms !important;
       animation-iteration-count: 1 !important;
       transition-duration: 0.01ms !important;
       scroll-behavior: auto !important;
     }
     [data-motion="fade"] {
       transition-property: opacity !important;
       transition-duration: 150ms !important;
     }
     [data-motion="essential"] {
       animation-duration: 900ms !important;
       animation-iteration-count: infinite !important;
     }
   }
   ```
5. **Core Web Vitals Budget:** Guest QR landing (`/tip/*`) renders `#1C110A` warm base fill immediately, preloads compressed WebP/AVIF resort backdrop (`fetchpriority="high"`, `< 180 KB` mobile variant), and sets explicit avatar + preset bar dimensions targeting **LCP `< 1.2s`** on mobile 4G, **INP `< 100ms`**, and **CLS `0.00`**.
