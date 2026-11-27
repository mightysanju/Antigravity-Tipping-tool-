# Hospitality Tipping Platform: Product Spec for AI Agents

*Status: living document. Built as a module of FrontDesk Pro (Vite + React web app, hosted on Netlify). Web app only; no native mobile app.*

## 1. Purpose and scope

A multi-property web platform that lets hotel guests tip staff by scanning a QR code. Guests need no account. Tips go into each staff member's in-app wallet and are paid out through Stripe. The platform has a super admin who onboards and bills properties, property admins who run each property, department managers, and staff.

**Out of scope:** native mobile apps, SMS notifications (in-app only), percentage fees taken from tips, paying staff directly into their bank accounts per tip.

## 2. Roles and permissions

- **Super admin:** onboards properties, uploads or builds QR templates, sets fee policy, plan and contract terms per property, manages Stripe connection, payout day, minimum withdrawal, API keys and single sign-on. Can open any property via a property switcher and view and edit everything in it.
- **Property admin:** full control inside their own property only: departments, people, rooms, QR codes, daily assignments, tips overview, pool distribution, refunds. Cannot see other properties.
- **Department manager:** manages their own department only: uploads the daily sheet, assigns rooms, sees team tips and room counts, distributes the pool. No access to payments, templates or other departments.
- **Staff (housekeeping, front desk, maintenance, others):** own login; sees own tips, wallet, today's rooms, notifications; generates a personal QR; requests withdrawals.
- **Guest:** no account. Scans a QR, tips, optionally leaves a note and gets an email receipt.

Each property's staff, tips and data are kept separate from other properties.

## 3. Core data model

Property, Department, Person (name, photo, department, email, role, active or inactive), User account, Room, Daily Assignment (date, room, housekeeper), Tip (amount, room, recipient or department pool, note, timestamp, status), Pool Distribution, Wallet Ledger entry (credit, debit, fee, refund, chargeback, payout), Withdrawal Request, Payout Batch, QR Template, Fee Policy, Contract and Signature (signer, timestamp, IP), Subscription, API Key, Notification.

Inactive people are hidden from the guest page and assignments but stay in tip history and reports. Wallet balances are tracked as a ledger.

## 4. Guest tipping flow

All room QR codes point to one page; only the room identifier in the link differs. The page reads the room, looks up today's housekeeper assignment, and renders:

1. **Housekeeper assigned:** show that housekeeper first (name, photo, tip amount buttons and custom amount), then the department options below (housekeeping, front desk, maintenance, and any others).
2. **No assignment:** show only the department options.
3. **Choosing a department:** the guest can tip the whole department (goes to the shared pool) or pick a specific person from a list with names and photos. For housekeeping with no assignment, the full housekeeper list is shown.
4. **Department QR codes** (front desk, maintenance, etc.) open the same page already set to that department. **Personal QR codes** open a page for just that person (name and photo). Both use the property template.
5. Guest can add an optional short note (about 150 characters), pays by card, Apple Pay or Google Pay, then sees a thank-you screen with amount and recipient and an optional email receipt. A short terms line is shown on the page.
6. Fees: depending on the property's fee policy, the guest may see an added line to cover the payment fee.

When a room is reassigned mid-day, tips made afterward go to the new housekeeper; earlier tips stay with the original.

## 5. Admin and staff screens

Build order for the property admin side: departments, people, rooms with QR generator, daily assignments, then tips overview.

**Departments page.** List with add, rename and delete. Each department has a default pool distribution method (split evenly or individual), editable by the admin and overridable at distribution time. Deleting a department that has people opens a prompt to reassign them to another department on the spot, then deletes on confirm.

**People page.** Photo, name, email, role, department, status (active or inactive). Search and department filter. Add form creates the account and sends an email notification. Moving a person means changing the department on their row. Inactive people disappear from the guest page and assignments but stay in tip history and reports.

**Rooms page.** Rooms are added one by one or as a range (for example 101 to 140). QR codes are generated in bulk (all rooms or a range, as a printable sheet, PDF or zip) and individually per room (view, download, print). Department QR codes and staff personal QR codes are generated the same way. Every QR is stamped onto the property's QR template.

**Daily assignments page.** Pick a date, then provide the housekeeping sheet in one of four ways: PDF upload, camera photo (OCR), manual dropdown per room, or API push. The PDF is read as text, and the app finds room numbers and matches names against the housekeeper list with no fixed column format (rule-based first; an AI model is optional). A review screen is always shown before saving. After saving, the page lists each housekeeper with their room count. Rooms can be reassigned mid-day; later tips follow the new housekeeper, earlier tips stay.

**Tips overview page.** Summary cards (total tips, number of tips, average). A list by person and by department pool. Date range filter and department or person filter. Rows expand to show each tip with room number, time and note (no guest name unless given). Export to CSV or PDF for payroll. Pool tips are distributed either by splitting evenly among that day's active staff in the department or by assigning specific amounts to specific people, using the department default. Refunds are done here (section 6).

**Staff view.** Each staff member logs in and sees only their own tips, today's rooms (housekeepers), wallet balance, withdraw button with the next payout day, personal QR generator, and an in-app notification bell that shows new tips with the guest's note. Notifications are in-app only, no text messages.

**Department manager view.** Same as the property admin screens but limited to their own department: daily sheet upload, room assignments, team tips and room counts, pool distribution. No payments, templates or other departments.

## 6. Payments, wallets and payouts

**Money flow.** All guest payments land in one Stripe account, the super admin's platform account, shared by every property. The app keeps a ledger that tracks each person's and each property's balance. Staff never receive per-tip bank transfers; each tip credits their in-app wallet.

**Guest payment.** Card, Apple Pay and Google Pay through Stripe on the tipping page. Stripe's public US rate for online cards is 2.9% plus 30 cents per transaction; confirm current rates with Stripe before launch.

**Fee policy (set by the super admin per property).** Two independent settings, one for the guest-side payment fee and one for the payout fee. Each can be absorbed by the property, paid by the guest as an added line at checkout, or paid by the staff member (deducted from their tip or wallet).

**Withdrawals.**

1. Staff tap Withdraw at any time. The request is queued, and the screen shows the next payout day.
2. Standard payouts (bank) are processed together in one weekly batch on a payout day set by the super admin (default Thursday). Only staff who requested are paid. No admin approval is needed.
3. Instant payouts (debit card) are available on demand; the extra fee is paid by the staff member from their wallet.
4. A configurable minimum withdrawal applies, starting at $10, set in admin settings.
5. Stripe collects bank or card details and identity verification through its own forms. The app never stores them.
6. OTP by email is required at withdrawal.

**Refunds.** The property admin can refund a tip from the tips overview within about 24 hours, if the recipient's balance still covers it.

**Chargebacks.** The amount is deducted from the staff member's wallet. If they already withdrew it, the balance goes negative and is recovered from future tips. The property does not cover chargebacks.

**Unclaimed balances.** A balance always stays the staff member's until withdrawn. Inactive staff, or staff of a cancelled property, keep a withdraw-only view. Email reminders go out at 30, 60 and 90 days. Unclaimed-funds laws vary, so the legal handling needs a lawyer's review.

**Compliance note.** Holding funds for other people may be regulated. Confirm the Stripe account structure (Connect or otherwise) and licensing requirements with Stripe and a lawyer before launch.

## 7. Accounts, contracts, billing and integrations

**Account creation.** The admin enters name, email and role. This creates the account and sends an email notification. There is no admin approval step. A join QR also lets staff scan, pick their own name from the people list, receive an OTP at the email the admin entered, and log in. Staff then set a password.

**Login security.** Password plus email OTP. OTP is required on new devices and at withdrawal. Trusted devices stay signed in.

**Super admin panel.** Dashboard (total tips, fees collected, wallet balances across properties, paid and overdue subscriptions). Properties page (onboard, edit, deactivate, template upload). Per-property fee policy. Platform payments page (Stripe connection, payout day, minimum withdrawal). Property admins page (invite and remove). A property switcher opens any property, where the super admin can view and edit. Property admins have full control only inside their own property.

**Onboarding a property (super admin).** Steps: property basics and property admin contact; subscription plan and price; contract term and notice period, then send the agreement for signing; fee policy; payout day and minimum withdrawal; QR template upload with the QR position marked; starting departments and each department's default split method. The property admin then adds rooms and staff.

**Contracts.** Everyone signs their own agreement in the app by click-to-accept: typed name, checkbox, logged timestamp and IP. The property admin signs the service agreement at onboarding, and the property cannot go live until it is signed. Each staff member signs a staff agreement at first login, covering payouts, fees and chargeback deductions, before receiving tips or withdrawing. Signed copies are stored and viewable by the super admin. Guests only see a short terms line. The property agreement defaults to a 12-month auto-renewing term with 30 days' notice, and the super admin can edit the term and notice period per property. Staff agreements stay in force while the person is active. Contract terms cover legal and money terms (price, billing cycle, term, fees, payout rules, refunds and chargebacks, unclaimed balances); the QR template, departments and split methods are setup choices that can change without re-signing. DocuSign may be added later for property agreements. A lawyer should draft the actual agreements.

**Property billing.** Flat subscription only, monthly or yearly, billed through Stripe. No percentage is taken from tips. The super admin sets the plan per property. Failed payments are retried for a few days, then the property is restricted (no new tips) until paid.

**Integrations.** The app is a standalone product that connects to a property's other software (property management, housekeeping, payroll) through an API, for example to push daily room assignments. Only the super admin creates and manages API keys and single sign-on. Each key is tied to one property, limited to specific actions, and revocable. Single sign-on lets users already signed into the other software land in the tipping app without logging in again, using short-lived signed tokens; an API key alone never grants access to the admin interface. Two options remain open: embedding the dashboard inside the other software, or offering a data API only.

## 8. Rules for AI agents building this

- Build only what this document states. If something is not specified, stop and ask Sanju instead of guessing.
- Web app only; no native mobile app.
- In-app notifications only; no SMS.
- Keep each property's data separate; only the super admin crosses properties.
- Never store bank or card details; Stripe collects them.
- Open items: embed versus data API for integrations, payment compliance review, legal drafting of agreements, and PDF layout testing with a real sample sheet.

## 9. Technical stack

- **Frontend:** Vite + React with TypeScript, inside the existing FrontDesk Pro codebase, hosted on Netlify. Web app only.
- **Database:** Firebase Firestore.
- **Auth:** Firebase Authentication (email and password), with custom claims for role and propertyId. Email OTP is implemented through a Cloud Function that sends a one-time code and stores a hashed copy with an expiry.
- **Backend logic:** Firebase Cloud Functions (Node.js, TypeScript). All money movement and all Stripe calls run only in Cloud Functions, never in the browser.
- **Files:** Firebase Storage for staff photos, QR templates, generated QR cards, signed agreement copies and uploaded sheets.
- **Payments:** Stripe, one platform account. The Stripe secret key lives only in Cloud Functions config. Guests pay through Stripe Checkout or Payment Element, and a webhook Cloud Function confirms payment before any tip is credited.
- **Email:** Resend, called from Cloud Functions, for invites, one-time codes, receipts and reminders. The sending domain must be verified. The free plan caps at 100 emails a day, so a paid plan is expected at launch.
- **QR generation:** a client-side QR library, stamped onto the template image in the browser or a Cloud Function.
- **PDF reading:** extract text from the uploaded PDF, then run rule-based matching. OCR is used only for camera photos.

If a library or service is not listed here, an agent must ask before adding it.

## 10. Firestore data model

All amounts are stored as integers in cents. All timestamps are Firestore timestamps. Every document except platform-level ones carries a propertyId so rules can isolate properties.

| Collection | Fields |
| --- | --- |
| properties | name, address, contactName, contactEmail, status (pending, active, restricted, cancelled), planType (monthly or yearly), planPriceCents, contractTermMonths (default 12), noticeDays (default 30), contractRenewsAt, feePolicy (paymentFeePaidBy, payoutFeePaidBy: property, guest or staff), payoutWeekday (default Thursday), minWithdrawalCents (default 1000), templateUrl, qrPosition (x, y, size), stripeSubscriptionStatus, createdAt |
| departments | propertyId, name, defaultDistribution (split or individual), createdAt |
| people | propertyId, name, email, role (property\_admin, dept\_manager, staff), departmentId, photoUrl, status (active or inactive), uid, walletBalanceCents, agreementSignedAt, createdAt |
| rooms | propertyId, roomNumber, createdAt |
| assignments | propertyId, date, roomNumber, personId, source (pdf, photo, manual, api), reassignedFromPersonId, createdAt |
| tips | propertyId, amountCents, feeCents, netCents, recipientType (person or department\_pool), personId, departmentId, roomNumber, note, guestEmail, stripePaymentIntentId, status (paid, refunded, disputed), createdAt |
| poolDistributions | propertyId, departmentId, date, method, allocations (list of personId and amountCents), createdBy, createdAt |
| ledger | propertyId, personId, type (tip\_credit, pool\_credit, fee, refund, chargeback, payout), amountCents, refId, createdAt |
| withdrawals | propertyId, personId, amountCents, method (standard or instant), feeCents, status (queued, processing, paid, failed), requestedAt, batchId, paidAt |
| payoutBatches | payoutDate, status, withdrawalIds |
| notifications | personId, type, message, tipId, read, createdAt |
| agreements | signerType (property or staff), signerId, propertyId, version, typedName, signedAt, ip |
| apiKeys | propertyId, label, hashedKey, scopes, revoked, createdAt |
| otpCodes | email, hashedCode, expiresAt, purpose (login, new\_device, withdrawal) |

Only the super admin has no propertyId; super admin is identified by a custom claim. The wallet balance on a person is always derived from the ledger and updated only by Cloud Functions.

## 11. Access rules (Firestore security)

1. Every request must be signed in, except the guest tipping page, which reads only a public view of the room: housekeeper name and photo, department names and people names and photos. It never exposes emails, balances or other tips.
2. Role and propertyId come from custom claims set only by Cloud Functions.
3. Super admin: read and write everywhere.
4. Property admin: read and write only documents with their own propertyId. Cannot change payment settings, fee policy, contract terms, template or API keys.
5. Department manager: read and write assignments, and read people and tips, only for their own department inside their own property.
6. Staff: read only their own person document, ledger, withdrawals, notifications and tips. Cannot write balances.
7. No client can write to ledger, tips, withdrawals status, walletBalanceCents, agreements or otpCodes. Only Cloud Functions write these.

## 12. Cloud Functions

| Function | What it does |
| --- | --- |
| createTipCheckout | Validates room, recipient and amount, applies the property's fee policy, creates the Stripe payment, and returns the checkout details |
| stripeWebhook | Verifies the Stripe signature, then marks the tip paid, writes ledger credits and creates a notification. Credits nothing until payment is confirmed |
| resolveRoomView | Returns today's assigned housekeeper (or none) plus department lists for a room, publicly and read-only |
| createPerson | Creates the Firebase user and people document, sets claims, sends the invite email |
| joinByQr | Lists names for the join QR, sends an email OTP for the chosen person, and signs them in when the code matches |
| sendOtp and verifyOtp | Email codes for login, new devices and withdrawals; hashed, expiring, rate limited |
| parseAssignmentSheet | Extracts text from a PDF or OCR from a photo, matches room numbers and names, and returns proposed assignments for the review screen. Saves nothing until the admin confirms |
| saveAssignments | Writes confirmed assignments and handles mid-day reassignment |
| distributePool | Splits a department pool evenly or by specified amounts, writes ledger entries |
| refundTip | Allowed within 24 hours if the balance covers it; calls Stripe, writes ledger |
| handleDispute | On a Stripe dispute event, deducts from the wallet, allowing a negative balance |
| requestWithdrawal | Checks minimum and balance, requires OTP, queues the request or runs an instant payout |
| runWeeklyPayouts | Scheduled on each property's payout day; pays all queued standard withdrawals |
| unclaimedReminders | Scheduled; emails at 30, 60 and 90 days of an unwithdrawn balance |
| generateQrCards | Stamps QR codes onto the property template for rooms, departments or people |
| billingSync | Syncs the Stripe subscription status; restricts or restores the property |
| apiGateway | Serves the external API using hashed API keys and scopes |
| ssoToken | Issues short-lived signed single sign-on tokens |

## 13. Validation and error states

- Tip amounts: positive whole cents; the preset buttons and a custom amount. The minimum and maximum amounts are open items for Sanju.
- Notes: up to 150 characters, plain text only.
- Withdrawal: below the minimum or above the balance is rejected with a clear message.
- Invalid or expired room link: show a friendly page and do not allow payment.
- Payment failure: show the Stripe error, create no tip.
- Assignment sheet that cannot be read or has unmatched names: the review screen flags each unmatched line for manual fix.
- Inactive or deleted recipient: the tip goes to the department pool instead.
- Restricted property (unpaid subscription): the guest page shows a notice and accepts no tips.

## 14. Acceptance checks

- A guest scanning a room QR with an assigned housekeeper sees that person first, then all departments.
- With no assignment, only departments are shown, and housekeeping lists all housekeepers.
- A paid tip appears in the recipient's wallet and notification only after the Stripe webhook confirms it.
- A tip after a mid-day reassignment goes to the new housekeeper.
- A property admin cannot read another property's data.
- A staff member cannot change their own balance.
- A withdrawal request shows the next payout day and is paid in the weekly batch.
- Deleting a department with people forces reassignment first.
- A refund after 24 hours is blocked.

## 15. Screens and routes

Each route lists who may open it and what it shows. Agents must not add screens that are not listed.

| Route | Who | Content |
| --- | --- | --- |
| /tip/room/:roomId | Guest | Tipping page for a room: assigned housekeeper first, then department options |
| /tip/dept/:departmentId | Guest | Tipping page for one department: whole-department option and people list |
| /tip/person/:personId | Guest | Tipping page for one person |
| /login | All staff | Email and password, then OTP on a new device |
| /join/:propertyId | Staff | Join QR: pick name, email OTP, set password, sign staff agreement |
| /staff | Staff | Own tips, wallet, withdraw button with next payout day, notifications, personal QR |
| /admin/departments | Property admin | Departments list, add, rename, delete with reassign prompt, default split method |
| /admin/people | Property admin | People list, add, edit, move, active or inactive, photo upload |
| /admin/rooms | Property admin | Room list, add one or a range, QR generation (bulk and single) |
| /admin/assignments | Property admin and department manager | Date picker, PDF, photo or manual input, review screen, room counts per housekeeper |
| /admin/tips | Property admin and department manager | Tips overview, filters, pool distribution, refunds, export |
| /super/dashboard | Super admin | Totals across properties, paid and overdue subscriptions |
| /super/properties | Super admin | Onboarding wizard, edit, deactivate, template upload, fee policy, contract terms, plan |
| /super/payments | Super admin | Stripe connection, payout day, minimum withdrawal |
| /super/admins | Super admin | Invite and remove property admins |
| /super/integrations | Super admin | API keys and single sign-on per property |

Guest pages need no login. All other routes require login and the right role. A signed-in user who opens a route outside their role is sent to their own home screen.

## 16. External API

The API is served by one Cloud Function (apiGateway) and secured by a hashed API key sent in a request header. Each key belongs to one property and carries scopes. Only the super admin creates or revokes keys.

| Endpoint | Scope | Purpose |
| --- | --- | --- |
| POST /assignments | assignments:write | Push the daily room-to-housekeeper assignments for a date |
| GET /people | people:read | List staff and departments |
| GET /tips | tips:read | List tips for a date range |
| POST /people | people:write | Create or update a person |

Requests with a missing, wrong or revoked key return 401. A key used outside its scope returns 403. The exact request and response formats are an open item to be defined with the first integration partner; agents must not invent them.

## 17. Assignment sheet matching rules

1. Extract all text from the PDF. For a camera photo, run OCR first.
2. Find room numbers: tokens that equal a room number in the property's room list.
3. Find names: match text against the active housekeepers in the people list, ignoring case and extra spaces. Match on full name first, then on first name only if it is unique among housekeepers.
4. Pair a room with a housekeeper when both appear on the same line or in the same block of text.
5. Anything not matched confidently goes to the review screen as unmatched, with a dropdown for manual fix. Nothing is saved before the admin confirms.
6. If two housekeepers share a first name and only the first name appears, flag it for manual fix instead of guessing.
7. The matching must work without a fixed column layout.

## 18. Build order for agents

1. Firebase project, auth with roles and claims, security rules, and the data model.
2. Super admin shell with property onboarding, template upload and contracts.
3. Departments, people and account creation with invites, OTP and agreements.
4. Rooms and QR generation.
5. Daily assignments with manual entry, then PDF, then photo OCR.
6. Guest tipping page and Stripe checkout with the webhook.
7. Wallet ledger, notifications, tips overview and pool distribution.
8. Withdrawals, weekly payout batch, instant payouts, refunds, chargebacks and reminders.
9. Property billing and restrictions.
10. External API and single sign-on.

After each step, an agent must run the matching acceptance checks from section 14 before moving on.

## 19. Feature toggles

Every feature can be enabled or disabled per property by the super admin. Property admins cannot change toggles. Each property stores a features map of true or false values, and every screen, route and Cloud Function must check its toggle before running. A disabled feature is hidden in the interface and rejected by the backend.

Toggles to build, one per feature: guest notes, email receipts, tipping a specific housekeeper, department pool tips, tipping a specific person within a department, department QR codes, personal staff QR codes, room QR codes, QR templates, PDF assignment upload, camera photo with OCR, manual assignment, API assignment push, mid-day reassignment, department manager role, in-app notifications, staff wallet and withdrawals, instant payouts, weekly batch payouts, refunds, pool distribution (split and individual), guest-paid fee option, join QR, email invites, external API, single sign-on, and tips overview export.

Rules for agents: new features must ship with a toggle; the default for a new property is configurable by the super admin; turning a feature off never deletes data; money already in wallets stays withdrawable even if tipping or payouts features are later turned off, except where the super admin has restricted the property for non-payment.

## 20. Open items (ask Sanju, never guess)

- Minimum and maximum tip amounts, and the preset tip buttons.
- Whether to embed the dashboard in other software or offer a data API only.
- Exact external API request and response formats.
- Legal review of payments, unclaimed funds and the agreements.
- Real sample housekeeping sheet to test the matching.
- Branding, colors and wording for the guest page.
