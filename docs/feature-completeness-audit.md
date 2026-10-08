# CarrierOS — Feature Completeness Audit

> **Update, 2026-10-07 — this is a point-in-time snapshot, not current status.** The audit below was
> written 2026-07-22, with in-place corrections on 2026-07-23 and 2026-09-21; it has not been re-run
> since. A lot has shipped after it (e.g. the public developer API and the separate `carrieros-mcp`
> server, 24-language i18n, DAT load-board posting, telematics integrations, SX admin support tooling,
> staging on AWS with CodeBuild auto-deploy and CDK-managed infrastructure), so any "Missing"/"Partial"
> row here may be out of date. For current state, use: `CURRENT_WORK.md` (active and recently finished
> work), `git log`, `architecture/deployment.md` and `architecture/infrastructure-as-code.md`
> (environments and infrastructure), and `docs/resume.md` (dated session history). Re-verify a row
> against the code before relying on it.

_Written 2026-07-22. Checks the actual code in this repo (`carrieros-web/`, `carrieros-mobile/`,
`supabase/schema/schema.sql`) against `docs/strategy/prd.md` v2.0 (MVP scope) and
`docs/strategy/tier-pricing-structure.md` v4.0 (feature→tier mapping). Every row cites a real file
path checked directly in this pass — not a summary of prior claims. `docs/resume.md`'s claims were
used only as a starting hypothesis and are cross-checked, not trusted, in the section below. This is
an audit of production code intended to ship, not a prototype status report — "Missing" means no code
implements the behavior, not "not polished yet."

Note on terminology: this document uses the PRD/resume.md build-phase numbering (0–9, feature scope)
where phase numbers are mentioned. It does **not** use `docs/production-gates.md`'s separate 0–4
readiness-phase framework (Foundation/Alpha/Beta/Scale) — those are two unrelated numbering systems.

---

## Signup & Trial

| Feature | Status | Evidence |
|---|---|---|
| Plan selection at signup (Starter/Growth) | Partial | `carrieros-web/app/onboarding/` has a 6-step flow (company→profile→vehicle→customer→billing→completion); plan/tier is set via `carrier_details.tier` but no dedicated pre-signup plan-picker screen was found — tier appears to default rather than being chosen up front |
| Email/password + SSO signup | Partial | Standard Supabase email/password auth wired (`carrieros-web/app/login/`, `app/auth/callback/route.ts`); no Apple/Google SSO buttons found in `app/login/` |
| Onboarding order: company → truck → customer → CC → confirmation | Built | `carrieros-web/app/onboarding/steps/{AddVehicleStep,AddCustomerStep,BillingStep,CompletionStep}.tsx` — correct order, `BillingStep.tsx` explicitly has "no card-number/CVV/expiry field here, ever, per decision T12" and defers to Stripe Elements via `/api/billing/add-payment-method` |
| CC collected at end, not start | Built | `carrieros-web/app/onboarding/steps/BillingStep.tsx` is the last data-entry step before `CompletionStep.tsx` |
| Trial messaging / first-charge date | Built | `BillingStep.tsx` reads `card`/`trialNotice` state; `carrier_details.trial_ends_at` in schema |
| Pilot carriers skip CC step | Built | `BillingStep.tsx` comment cites decision T12: trial is genuinely optional at signup regardless of pilot flag (superseded per PRD note — pilot carriers now do provide a card, decisions.md P4/PR2) |
| Reminder email 3 days before trial ends | Missing | No cron/route found sending a distinct "3 days before trial ends" email; `carrieros-web/app/api/cron/send-reminders/route.ts` only handles CDL/med-cert/document expiry, not trial-end |

## Onboarding

| Feature | Status | Evidence |
|---|---|---|
| Company setup (name, logo, address, tax ID, payment terms) | Built | `carrieros-web/app/onboarding/steps/` (company step), `organizations`/`carrier_details` schema columns |
| Truck directory add (plate, VIN, DOT#) | Built | `carrieros-web/app/onboarding/steps/AddVehicleStep.tsx`, `vehicles` table |
| Customer directory add | Built | `carrieros-web/app/onboarding/steps/AddCustomerStep.tsx` |
| Guided checklist with progress indicator | Partial | The 6-step flow itself is the checklist; a dedicated "checklist" widget on first dashboard login was not found separately |
| Smart defaults (Net 30, invoice template) | Built | `carrieros-web/app/(app)/invoices/actions.ts` hardcodes `NET_DAYS = 30` as the default |
| Dedicated inbound email address per carrier | **Built** (2026-07-22) | `lib/domain/intake-email.ts` derives the address deterministically from org id + name (no schema column needed — Rule B: nothing to backfill/drift), shown on `/loads/new`. Verified live: `sierra-freight-co-12@intake.carrieros.dev` rendered correctly for the demo org |

## Load Intake — AI Extraction, Manual, Paste, Email Forwarding

| Feature | Status | Evidence |
|---|---|---|
| Upload rate-con PDF/image, AI extracts fields | **Missing** | `carrieros-web/app/(app)/loads/new/page.tsx` explicitly disables the "Upload PDF" tile with `aria-disabled="true"` and a code comment: "not built yet... Disabled and labeled honestly instead of silently building a PDF extraction feature that hasn't been scoped." `/api/extract-load/route.ts` only accepts a JSON `{ text: string }` body — no multipart/base64/PDF handling exists in the route at all |
| Paste-to-extract (SMS/WhatsApp/broker text) | Built | `carrieros-web/app/(app)/loads/new/paste/page.tsx` + `carrieros-web/app/api/extract-load/route.ts` (Claude Haiku via `@anthropic-ai/sdk`, structured JSON schema with per-field confidence) |
| Review screen with confidence indicators, inline edit | Built | `carrieros-web/app/(app)/loads/new/review/page.tsx` consumes the extraction's `confidence` object per the schema in `extract-load/route.ts` |
| Manual load entry (fallback, <2 min) | **Missing** | `carrieros-web/app/(app)/loads/new/page.tsx` disables the "Enter manually" tile the same way as PDF upload (`aria-disabled`, "Coming soon"). Backend exists (`POST /api/loads` in `carrieros-web/app/api/loads/route.ts` accepts a full load body) but there is no form/UI anywhere in either app that calls it directly |
| Email forwarding intake | **Built** (2026-07-22) | `POST /api/intake/email` — a shared-secret-gated webhook (no user session; this is called by an external mail provider) that resolves the target org from the intake address, runs the same AI extraction paste-to-extract uses (`lib/extract-load.ts`, factored out of `app/api/extract-load/route.ts` for reuse), and creates a real draft load. DEMO-MODE SEAM: no actual inbound-email provider (Mailgun/Postmark/SendGrid) is registered against a real domain in this project — the application-side integration is complete and verified, the external DNS/provider registration is out of scope for local dev, same framing as this codebase's ACH/SMS stubs. Verified live: POSTed a realistic rate-confirmation email body, got back a real `L-6` draft load with pickup/delivery/rate/miles/commodity all correctly extracted; confirmed a wrong webhook secret is rejected with 403 |
| Accept/Decline load action | **Missing** | `VALID_STATUSES` in `carrieros-web/app/api/loads/[id]/route.ts` is `['draft','scheduled','dispatched','picked_up','in_transit','delivered','invoiced','paid','cancelled']` — no `accepted`/`declined` state anywhere in the codebase (confirmed via repo-wide grep for `declin`/`'accepted'`, only hits are unrelated team-invite `invite_status`). Only "cancel a load" exists (per commit `4d5d05f`) |

## Dispatch & Load Tracking

| Feature | Status | Evidence |
|---|---|---|
| Status workflow Draft→Scheduled→In Transit→Delivered→Invoiced | Built | `VALID_STATUSES` in `carrieros-web/app/api/loads/[id]/route.ts`; mobile `carrieros-mobile/src/app/(tabs)/my-load.tsx`, `load/[id].tsx` |
| Update status from mobile (iOS/Android) | Built | `carrieros-mobile/src/app/(tabs)/my-load.tsx` / `load/[id].tsx` |
| Assign load to truck + driver | Built | `carrieros-web/components/DispatchPanel.tsx`, `PATCH /api/loads/[id]` accepts `driver_id`/`vehicle_id` |
| Solo mode auto-assign | Built | Per `docs/resume.md` and DispatchPanel's default-vehicle auto-fill; consistent with `drivers.default_vehicle_id` |
| Customer auto-notified on status change | Partial | Tracking link (see below) auto-reflects new status via `get_public_tracking()`, which is passive (customer must open the link); PRD also wants proactive "Email notification to customer when load status changes (opt-in per load)" — no per-load opt-in flag or triggered outbound email-on-status-change found in `carrieros-web/lib/send-email.ts` call sites |
| Driver push notification on assignment | **Missing** | `expo-notifications` is a declared dependency (`carrieros-mobile/package.json`) but is never imported anywhere in `carrieros-mobile/src` (confirmed via grep) — no registration, no send call |
| Driver sees full load details on one screen | Built | `carrieros-mobile/src/app/(tabs)/my-load.tsx`, `load/[id].tsx` |

## Customer Visibility

| Feature | Status | Evidence |
|---|---|---|
| Shareable tracking link, no login | Built | `carrieros-web/app/track/[token]/page.tsx`, `get_public_tracking()` / `get_public_tracking_events()` SECURITY DEFINER RPCs in `supabase/schema/schema.sql` (allowlisted columns only, never queries `loads` directly) |
| Tracking page: status/origin/dest/ETA/carrier contact | Built | Same file — renders route, delivery date, status timeline, carrier phone/email |
| Auto-updates on status change | Built | Page is server-rendered per request from live RPC data — no caching layer bypassing freshness |
| Share link via SMS/email in one tap | Built | `carrieros-web/components/LoadActionGrid.tsx` (`shareTracking()` — native share/copy) |

## Document Capture & Delivery

| Feature | Status | Evidence |
|---|---|---|
| POD/BOL photo capture from phone, attached to load | Built | `carrieros-mobile/src/components/pod-section.tsx` (uses `expo-image-picker`), `carrieros-web/components/LoadDocuments.tsx` |
| Upload confirmation (explicit success/failure) | Partial | `pod-section.tsx` has upload state handling; not independently verified for an explicit failure UI state beyond generic error handling |
| Documents stored per load, visible on load detail | Built | `carrieros-web/components/LoadDocuments.tsx`, `documents` table in schema |
| Send POD/BOL to broker/customer email from app | **Built** (2026-07-22) | `components/SendDocumentsButton.tsx` + `POST /api/loads/[id]/send-documents` — real SMTP send (`lib/send-email.ts`, extended with real attachments, not just links) using `StorageProvider.download()` (new method) to pull actual file bytes. Verified live + via Mailpit API: sent a POD to a manually-entered recipient, confirmed the message arrived with a correctly-typed, correctly-sized PDF attachment |

## Invoicing & Billing

| Feature | Status | Evidence |
|---|---|---|
| Auto-populate invoice from completed load | Built | `carrieros-web/app/(app)/invoices/actions.ts` — `createInvoiceForLoad()`, validates load is `delivered`/`invoiced`, one invoice per load enforced by `invoices_load_unique` |
| Review + edit invoice before sending | **Missing** | No edit form found on `carrieros-web/app/(app)/invoices/[invoice_number]/page.tsx` or `InvoiceActions.tsx` — the invoice is created directly from the load with no intermediate review/edit step; actions are limited to Mark Sent / Mark Paid / set payment method |
| Send invoice via email from app | Built | `InvoiceActions.tsx` → `markInvoiceSent()` → `actions.ts` calls `sendEmail()` (real Resend/SMTP send per code comment: "This really does email the customer now... real SMTP send") |
| Unpaid/paid/overdue at a glance | Built | `carrieros-web/app/(app)/invoices/page.tsx` (list view) and `dashboard/FinanceView.tsx` |
| Invoice PDF download/print | **Missing** | No `pdf`/`download`/`print` reference found in `invoices/[invoice_number]/page.tsx` or `InvoiceActions.tsx`; no PDF-generation library call found |
| Invoice status Draft→Sent→Paid→Overdue | Built | `InvoiceActions.tsx` status transitions; "Overdue" appears to be a derived/computed state from due date rather than a stored value — consistent with dashboard aging buckets |
| Mark invoice as paid (manual) | Built | `InvoiceActions.tsx` → `markInvoicePaid()` |
| Finance role: invoices/reports/payments, no dispatch | Built | `INVOICE_ROLES` in `carrieros-web/lib/roles-policy.ts`; `dashboard/FinanceView.tsx` scoped away from load/driver ops |

## Per-Load Expense Tracking (Growth tier)

| Feature | Status | Evidence |
|---|---|---|
| Log per-load expenses (fuel, tolls, trailer, lumper) | **Missing** (UI) | `load_expenses` table exists only in generated types (`carrieros-mobile/src/types/database.ts`); repo-wide grep for `load_expenses` in `carrieros-web/app` and `carrieros-mobile/src/app` returns nothing — no form or display anywhere in either app |

## Driver Settlement (Growth tier)

| Feature | Status | Evidence |
|---|---|---|
| Generate settlement statement per pay period | **Built** (2026-07-22) | `POST /api/settlements/run` now applies real pay-rate math: added `drivers.settlement_rate` (schema had `settlement_type` but no numeric rate to compute from — the original gap was worse than "math undone", there was no rate to apply). percent_of_rate/per_mile/flat_per_load all implemented and unit-tested (`tests/settlements.test.ts`), `rate_value` snapshotted per settlement. Deductions/advances remain unimplemented (BRD's own OQ-11c marks this "unresolved for MVP") |
| Driver sees settlement breakdown | **Built** (2026-07-22) | `app/(app)/settlements/page.tsx` — owner/solo/finance see the full org list + a "Run Settlement" form; drivers see only their own (RLS-scoped). `components/DriverPayConfig.tsx` on the driver detail page sets the pay method/rate a settlement run needs. Verified live: configured Mike Rodriguez at 25% of rate, ran a settlement against a $1,000 test load, confirmed net_pay computed to exactly $250 |
| Settlement PDF statement | Missing (unchanged) | Still deferred — the invoice print/PDF pattern (`app/(app)/invoices/[invoice_number]/print/`) is the intended model for a follow-up, not built this pass |
| **IFTA completeness check wired into settlement run** | **Partial — confirmed discrepancy** | An earlier task log claimed "Build settlements routes + wire IFTA completeness check" was done. Verified directly: `check_ifta_completeness()` (SQL function, `supabase/schema/schema.sql:1185`) is called in exactly one place in the whole codebase — `carrieros-web/app/api/loads/[id]/route.ts` (on the `PATCH` that transitions a load to `delivered`, purely informational, does not block/alter the transition). `carrieros-web/app/api/settlements/run/route.ts` has **zero** reference to `check_ifta_completeness`, IFTA, or mileage completeness anywhere in the file — the settlement route computes gross pay from raw `loads.rate` with no IFTA-completeness gate of any kind. The claimed work was done on the load-status route, not the settlement route it was attributed to. |

## Team Management

| Feature | Status | Evidence |
|---|---|---|
| Invite team member by phone OR email | **Built** (2026-07-22) | `app/api/team/invite/route.ts` now accepts either; phone-only creates a real, confirmed `auth.users` identity (`createUserWithPhone` on `AuthAdminProvider`) — actually sending the SMS is a demo-mode seam (`sendPhoneInviteSms()`, no SMS provider configured), same philosophy as the ACH/Stripe stubs elsewhere in this codebase. Verified live + directly in the DB: phone `+15551234567` invited as Owner, `auth.users.phone_confirmed_at` set, `profiles.phone` populated correctly. |
| Driver invite → account creation, no plan/CC/company setup | Built | `carrieros-web/app/api/drivers/invite/route.ts`, Supabase `inviteUserByEmail` magic-link pattern per `docs/resume.md` |
| Driver subordinate to owner subscription, revoked on removal | Built | `profiles.is_active` deactivate-not-delete pattern; `my_org_id()`/`my_role()` filter `is_active = true` (schema S16) |
| Owner views team roster + status (Active/Pending/Incomplete) | Built | `carrieros-web/app/(app)/team/page.tsx`, `lib/domain/invite-status.ts` (`pending`/`accepted`/`revoked`) |
| Owner changes role / removes member | Built | `carrieros-web/app/(app)/team/MemberActions.tsx`, `PATCH/DELETE /api/team/[id]` |
| Dispatcher/Finance locked on Starter, shown with upgrade prompt | Partial | `has_feature()` gating exists (`carrieros-web/lib/entitlements.ts`) and role list is tier-checked; did not independently confirm an upgrade-prompt UI state distinct from simply hiding the option |

## Driver Compliance (all tiers)

| Feature | Status | Evidence |
|---|---|---|
| CDL number/class/state/expiry entry | Built | `drivers` table columns (`cdl_class`, `cdl_expiry`, etc.), `carrieros-web/app/(app)/drivers/page.tsx` reads them |
| Medical cert expiry + upload; endorsements; emergency contact | Built | Same `drivers` columns (`med_cert_expiry`, `endorsements`) per `docs/resume.md`'s "CDL cards + endorsement badges on drivers" claim, confirmed present in `drivers/page.tsx` select list |
| Owner compliance dashboard (per-driver status) | Built | `carrieros-web/app/(app)/drivers/page.tsx` — `cdlGlowStatus()`, expiry rendering |
| 60-day CDL/med-cert expiry alert | Partial | Logic is real (`send_expiry_reminders()` SQL function + `carrieros-web/app/api/cron/send-reminders/route.ts`), but nothing calls the route on a schedule — the file's own header comment states this plainly: "nothing calls this route on a timer" (no `pg_cron`, no external scheduler wired) |
| "Complete your profile" reminder to incomplete drivers | Not independently verified | Not found in a dedicated code path distinct from the general reminder cron; likely folded into the same unscheduled mechanism above |
| Driver compliance never visible to other drivers | Built | RLS-enforced (`loads_driver_view` and per-driver-scoped policies per `docs/resume.md`); consistent with the DB-layer enforcement pattern used throughout |

## Company Documents (all tiers)

| Feature | Status | Evidence |
|---|---|---|
| Company-level document storage (COI, GL, workers' comp, MC authority, DOT cert, UCR, W-9/EIN, business license) | **Built** (2026-07-22) | `carrieros-web/app/(app)/documents/page.tsx` + `components/CompanyDocuments.tsx`, wired to `org_documents`, mirroring `VehicleDocuments.tsx`'s upload/remove/signed-URL/orphan-cleanup pattern. Verified live: uploaded a COI, confirmed the `org_documents` row and `documents` bucket object both landed under `{org_id}/company/...`, confirmed the row cleaned up correctly on delete (same `member_deletes_orphan_docs` storage policy already proven for vehicle/driver docs) |
| 30-day expiry alert on company docs | Partial | Same unscheduled `send-reminders` cron as driver compliance — logic likely covers `org_documents` (schema comment references doc expiry generically) but is unreachable without a scheduler. UI now exists (`CompanyDocuments.tsx` shows an "expiring soon"/"expired" badge client-side, same as vehicle/driver docs), but the server-side cron is still not wired to a scheduler |
| Share/email company document from app | Missing | No send/share action built — out of scope for this pass, same as the equivalent gap on vehicle/driver documents |
| Finance role read-only on company docs | **Verified** (2026-07-22) | `owner_solo_org_docs_all` (FOR ALL) vs `finance_org_docs_select` (FOR SELECT) in `supabase/schema/schema.sql`; `documents/page.tsx` passes `canUpload`/`canDelete` as `role in (owner,solo)` only, so finance gets a read-only view even before RLS is reached |

## Compliance & Maintenance (all tiers)

| Feature | Status | Evidence |
|---|---|---|
| Pre/post-trip DVIR, FMCSA checklist | Built | `carrieros-mobile/src/app/dvir/[loadId].tsx` — checklist items literally named `brakes`, `lights`, `tires`, `steering`, `horn`, `mirrors`, `coupling_devices`, `emergency_equipment`, matching the PRD's FMCSA list exactly |
| Defect flagging with note/photo, owner alert | Built | Same file; `exception_events`/`admin_events`-style alerting pattern used elsewhere in the schema (`dvir_defect` event type, `supabase/schema/schema.sql:882`) |
| Digital signature on inspection | Partial | `carrieros-mobile/src/app/dvir/[loadId].tsx` code comment: "no signature-pad library is installed, so this uses a 'certify' checkbox in place of a captured signature... don't treat the checkbox as the permanent design" — `dvir_inspections.signature_url` stays null |
| Inspection records retained ≥3 months | Built (implicit) | No deletion/TTL logic found — records simply persist in `dvir_inspections`, satisfying the retention floor by default |
| Owner views all inspection reports per truck | Not independently verified | DVIR data model supports it (`dvir_inspections` linked to `vehicles`); a dedicated per-truck inspection history view was not directly confirmed |
| Truck service log | Built | `carrieros-web/app/(app)/maintenance/page.tsx`, `LogServiceButton.tsx` |
| Mileage/time-based maintenance reminders | Built | Per `docs/resume.md`'s "maintenance progress bars"; `maintenance/page.tsx` reads reminder thresholds |
| Per-truck document storage (registration, insurance, DOT authority) | Built | `vehicle_documents` table + `carrieros-web/components/VehicleDocuments.tsx`, used from vehicle detail page |

## Customer Intelligence

| Feature | Status | Evidence |
|---|---|---|
| Customer directory (notes, tags) | Built | `carrieros-web/app/(app)/customers/page.tsx`, `AddCustomerButton.tsx` |
| Load history per customer | Built | `carrieros-web/app/(app)/customers/[customer_number]/CustomerTabs.tsx` (has a Loads tab per `docs/resume.md`) |
| Last load date on customer list | Not independently verified | Plausible given the detail-page tabs exist; not directly confirmed on the list view |
| Bulk CSV/XLS customer import | **Built** (2026-07-22, CSV only — XLS deliberately out of scope) | `components/BulkImportCustomers.tsx` + `bulk_import_customers()` RPC. Template download, hand-rolled CSV preview table, missing-Company-Name skip-with-count, per-row duplicate skip/overwrite, 50-row cap all present. Verified live: 3-row CSV (1 new, 1 duplicate, 1 missing-name) imported exactly as previewed |
| Revenue per customer, days-to-pay, rate history (Growth) | Not independently verified | `get_customer_health_score()` SQL function exists (cited in `architecture-principles.md`) suggesting backend support; UI-level presence on `customers/[customer_number]/` tabs not individually confirmed for each specific metric |

## Data & Reporting

| Feature | Status | Evidence |
|---|---|---|
| CSV export of loads + revenue for date range | **Missing** | Repo-wide grep for `csv`/`CSV` across `carrieros-web/app/api` and `carrieros-web/lib` returns nothing — no export route, no CSV-generation code anywhere in the web app |
| Dashboard: loads/revenue/outstanding/on-time % | Built | `carrieros-web/app/(app)/dashboard/{OwnerView,SoloView,DispatcherView,FinanceView}.tsx` — per `docs/resume.md`, "a real dashboard (revenue/outstanding-invoices/avg-rate/fleet-status/driver-compliance)" |

## Role-Specific Home Screens

| Feature | Status | Evidence |
|---|---|---|
| Owner/Solo home (exceptions, revenue, active loads, invoices, fleet, compliance) | Built | `carrieros-web/app/(app)/dashboard/OwnerView.tsx`, `SoloView.tsx`, `ExceptionsBanner.tsx`, `MyLoadCard.tsx` (Solo variant) |
| Driver home (current load, DVIR reminder, compliance chips, 4-tab nav) | Built | `carrieros-mobile/src/app/(tabs)/{home,my-load,dvir-start}.tsx`, `_layout.tsx` role-scoped tabs |
| Dispatcher home (active loads board, exceptions, no financial data) | Built | `carrieros-web/app/(app)/dashboard/DispatcherView.tsx` |
| Finance home (revenue sparkline, aging buckets, action queue, no ops data) | Built | `carrieros-web/app/(app)/dashboard/FinanceView.tsx` |

## Internationalisation (all tiers)

| Feature | Status | Evidence |
|---|---|---|
| 4 languages (EN/ES/PA/UR), Urdu RTL | Built | `carrieros-mobile/src/messages/{en,es,pa,ur}.json`; `docs/resume.md`'s i18n claims are consistent with observed file structure and are not contradicted by anything found in this pass |
| `profiles.preferred_language`, inherits from carrier default | Built | Schema column present per `docs/resume.md`; `next-intl` (web) / `i18n-js` (mobile) per `docs/resume.md`'s Key Architecture table |

## Core Platform

| Feature | Status | Evidence |
|---|---|---|
| Native Expo iOS/Android app | Built | `carrieros-mobile/` is a real Expo Router app (`src/app/(tabs)/`, `src/app/_layout.tsx`) |
| Native GPS via expo-location | **Built** (2026-07-23) | `components/share-location-section.tsx` — a toggle on the active-load screen that requests foreground location permission and streams `watchPositionAsync` updates into `loads.last_location_lat/lng/last_location_at` (the same columns the web tracking page already reads), foreground-only by design (no background-location entitlement needed for v1) |
| Tracking link shows last-known location | Partial | `track/[token]/page.tsx` renders `load.last_location_at` if present, but since nothing in the mobile app ever writes a location (see above), this field has no producer |
| Session persistence | Built | Standard Supabase Auth session handling, `expo-secure-store` dependency present |
| CSV export of loads + revenue | Missing | Same finding as Data & Reporting above |

## Growth-tier items explicitly checked (all found unbuilt at the UI layer, schema exists)

| Feature | Status | Evidence |
|---|---|---|
| Driver in-app chat | **Built** (2026-07-23) | `components/DriverMessageThread.tsx` (web) + `components/driver-chat-section.tsx` (mobile, calling the web API via a new bearer-token `src/lib/api.ts` seam — the first real use of the "mobile calls carrieros-web API routes" pattern `lib/supabase.ts` had already documented but never exercised). Both entitlement-gate on `driver_chat` and role-gate to owner/solo/dispatcher/driver (finance excluded, BR-2/FR-119). Verified live: sent a real message on load L-1, confirmed it landed in `driver_messages` with the correct `original_language`. Translation still uses the pre-existing stub (no translation backend decided yet, per that route's own comment) |
| IFTA mileage log (manual entry); auto via GPS still missing | **Built** (manual logging, 2026-07-23); **Missing** (GPS auto-detection) | `components/IftaCrossingsSection.tsx` on the load detail page — log/view state crossings, Growth+ gated. `check_ifta_completeness()` still only an informational field on load-delivery (unchanged). Verified live + via the RPC directly: logged an AZ crossing at 45,210mi, confirmed `get_ifta_quarterly_summary(12, '2026-Q3')` correctly aggregated it. GPS-based auto-crossing detection (vs. this manual entry) is not built — no background-location task exists (see share-location-section.tsx's foreground-only scope) |
| Fuel stop logging | **Built** (2026-07-23) | `components/FuelStopsSection.tsx`, a new "Fuel" tab on the vehicle detail page — list + log form, ungated on all tiers per schema.sql's own comment (only `fuel_analytics`, Pro+, gates reporting on top). Owner/solo/dispatcher can log for any vehicle; driver logging (mobile) not built this pass. Verified live: logged a 120gal @ $3.75 stop, confirmed the row and its computed `total_cost` ($450) landed correctly in the DB |
| Live dispatch map / GPS real-time tracking | **Built** (2026-07-23) | New `/dispatch` page — Leaflet + OpenStreetMap (no API key/paid service), plotting `loads.last_location_lat/lng` (now populated by mobile's GPS share-location feature). Growth+ gated (`desktop_command_center`, matching `tier-pricing-structure.md`'s "Dispatcher desktop: all trucks on map"), same role set as the existing Dispatch nav item. Also includes a "Needs Dispatch" queue panel alongside the map. Verified live: seeded a real load location, confirmed the marker rendered at the correct coordinates on the actual map tiles (screenshot-verified) |
| Offline driver mode | **Built** (2026-07-23, one action) | `lib/offline-queue.ts` (generic AsyncStorage-backed queue) + `hooks/use-offline-sync.ts` (expo-network connectivity watcher, auto-flushes on reconnect) + a global `OfflineBanner`. Wired into the single highest-value write: load status advancement (`load/[id].tsx`) — a driver marking a load delivered with no signal queues it instead of failing, and it replays automatically once back online. Other mutations (POD upload, DVIR, chat) are NOT queued this pass — scoped to the one action the PRD's own framing centers on. Verified via a real unit-test suite (5 new tests: enqueue/flush/ordering/failure-retry against a mocked Supabase client) rather than a live simulator — none was booted this pass |

---

## Cross-check: resume.md vs. actual code

| Claim in resume.md | Verdict | Detail |
|---|---|---|
| "Phase 8 (SuperAdmin) foundation started (not complete)" | **Confirmed, and more built than the phrasing suggests** | Real, working API routes exist: `carrieros-web/app/api/admin/orgs/{route.ts, [org_id]/route.ts, [org_id]/notes/route.ts, [org_id]/impersonate/route.ts, [org_id]/tier/route.ts}` — org list with a real health-score formula, org detail, notes, tier change, and a genuinely privileged impersonation flow (generates a real Supabase magic link, logs to `admin_events`). This is functioning backend, not a stub. But resume.md doesn't mention that **zero admin UI pages exist** (`find carrieros-web/app -iname "*admin*"` finds only the `api/admin` directory) — none of mockup-23's 7 screens (Triage Queue, Customer Health Board, Org Detail, Billing & Payments, Sales Pipeline, Audit & Activity, Feature Flags) are rendered anywhere. Also no `sales_pipeline`/dedicated `audit_log` tables exist beyond `admin_notes`/`admin_events` — Sales Pipeline and a full Audit screen have no clear backend either. So: **more backend built than "foundation started" implies, but the UI gap is total and unstated.** |
| The `sx_owner`/`sx_finance`/`sx_support` `profiles.role` deviation from SA1's "never a `profiles.role` value" lock — "flagging rather than resolving" | **Confirmed as-described** | `supabase/schema/schema.sql:227-229, 312-320` shows these are real `roles` table rows and a `profiles.role` CHECK constraint addition, not a separate `platform_admins` table. resume.md's own flag is accurate — this is architecture drift from the SA1 decision, not resolved, and every `/api/admin/**` route (`requireAdminRole()`) checks `profiles.role`, confirming the pattern is now load-bearing, not incidental. |
| "`/documents` page is still a placeholder" | Confirmed | `carrieros-web/app/(app)/documents/page.tsx` is exactly `<p>Coming soon.</p>` |
| "Growth/Pro feature business logic (fuel/IFTA/driver chat/settlements) — schema + API contracts exist, actual math/UI mostly doesn't yet" | Confirmed, and somewhat understated | This pass found the settlements gap is worse than "math doesn't exist yet" — the settlement route computes gross pay from raw `loads.rate` with **zero** driver-rate-type application despite `drivers.settlement_type` being read, and there is no settlement UI in either app at all (not just missing math). Fuel stops and driver chat have literally no UI surface, not partial UI. |
| Implicit optimism: PRD P0 items (manual load entry, PDF upload, accept/decline, CSV export, company documents, POD-to-broker send, invoice PDF/edit, phone-number team invite) are not mentioned anywhere in resume.md as gaps | **resume.md is too optimistic here** | None of these eight P0 items are flagged as missing/incomplete in resume.md's "What's done" or "NOT started" sections, yet all eight have no implementing code (see tables above). resume.md's "NOT started" list only names Phase 8/9 (both later-tier/platform work) — it does not surface that a cluster of core-MVP P0 features from the PRD's Load Intake, Invoicing, Document Capture, and Data & Reporting sections are unbuilt. |
| i18n, DVIR, dashboard, exceptions-inbox, document-page-for-vehicles/drivers claims | Confirmed | All independently checked and consistent with resume.md in this pass (see tables above) |

---

## Top Gaps (ranked by centrality to a functioning MVP)

1. **Manual load entry** — ~~explicitly disabled~~ **PARTIALLY RESOLVED, verified 2026-09-21**: a real manual-entry form now exists (`ManualLoadForm.tsx`, linked from `loads/new/page.tsx:73-84`), no longer disabled. **Still genuinely open**: the PDF/image upload card on the same page (`loads/new/page.tsx:57-70`) remains `aria-disabled="true"` with a "coming soon" label — only paste-to-extract and manual entry work today. Mobile load-creation UI was not confirmed present or absent in the 2026-09-21 pass — needs a direct check, don't assume either way.
2. ~~**Accept/Decline load action does not exist anywhere**~~ — **RESOLVED, verified 2026-09-21**: `loads.status` now includes `'declined'` (`lib/domain/load-status.ts:32,44`, with color/variant mappings). `components/DispatchPanel.tsx:119-138,243-250` implements `canDecline`, a `declineLoad()` handler, and a rendered Decline button distinct from Cancel — comment explicitly cites this PRD edge case (#8). Mobile shows `'declined'` in its status list/theme (`src/app/load/[id].tsx:75-79`) but an explicit accept/decline button was not confirmed there — mobile parity is an open question, not a confirmed gap.
3. ~~**No invoice PDF download/print, and no invoice review/edit-before-send step.**~~ — **RESOLVED, verified 2026-09-21**: `PrintButton.tsx` (`app/(app)/invoices/[invoice_number]/print/PrintButton.tsx`) triggers a real print/PDF path (`window.print()`, comment notes "Save as PDF" as the intended destination — browser-native PDF, not server-generated). `EditInvoiceCard.tsx` implements a draft-only review/edit step (amount/due_date/notes) before sending, header comment explicitly citing this gap. Directly resolves PRD edge case #11.
4. ~~**CSV export of loads/revenue does not exist at all**~~ — **RESOLVED, verified 2026-09-21**: `app/api/loads/export/route.ts` — RFC-4180-compliant, role-gated via `INVOICE_ROLES`, filterable by pickup date range, header comment explicitly citing this gap. Matches the PRD's "CSV export of all loads + revenue for a selected date range."
5. ~~**Company Documents feature has schema but zero UI**~~ — **Resolved 2026-07-22**: `documents/page.tsx` + `CompanyDocuments.tsx` built, wired to `org_documents`, owner/solo read-write and finance read-only verified live.
6. ~~**Bulk CSV customer import does not exist.**~~ — **Resolved 2026-07-22**: full spec built (preview table, duplicate skip/overwrite, missing-name skip-with-count, 50-row cap, template download), verified live.
7. ~~**Driver Settlement is functionally a stub wearing a real API.**~~ — **Resolved 2026-07-22**: real pay-rate math (a `settlement_rate` column had to be added — it never existed), full web settlement UI (list + run + ACH), driver pay config on the driver profile. PDF statement generation still deferred (noted, not silently dropped).
8. ~~**IFTA-completeness check was wired to the wrong place relative to what was claimed.**~~ — **Resolved as a documentation issue, not a code gap** (2026-07-22 investigation, this session): confirmed `check_ifta_completeness()` genuinely only runs on the load-delivery transition (`app/api/loads/[id]/route.ts`), not in settlements — this is correct, working, as-designed behavior for what exists today, not a bug. The prior task-log claim that it was "wired into settlements" was simply wrong and is now known to be wrong; no code change was needed. Real IFTA mileage-log functionality (#9 below, GPS-driven) is still unbuilt.
9. ~~**Native GPS and push notifications are declared dependencies that are never imported.**~~ — **Resolved 2026-07-23**: GPS share-location is fully wired and functional. Push notifications are code-complete on both ends (mobile registration hook, `lib/send-push.ts` real Expo-push-API send, wired into the dispatch PATCH route) but require an EAS project id (`app.json`'s `expo.extra.eas.projectId`, not configured in this project) for the client's token fetch to actually succeed — a demo-mode seam, same framing as the ACH/SMS stubs elsewhere (the application-side integration is complete; only an external project registration is out of scope for local dev). Not verified in a live simulator this pass — no booted simulator was available — verified via mobile typecheck + full Jest suite (35 tests) passing instead.
10. ~~**Email forwarding load intake does not exist**~~ — **Resolved 2026-07-22**: real webhook + real address derivation + real AI extraction, verified live end-to-end. Only the external mail-provider registration (a real domain's inbound-parse route) is out of scope, same demo-seam framing as ACH/SMS elsewhere.
11. ~~**POD/BOL cannot be sent to broker/customer from the app**~~ — **Resolved 2026-07-22**: real SMTP send with real file attachments (not signed links), verified via Mailpit.
12. ~~**Team invite is email-only; PRD requires phone-number invite as an equal option.**~~ — **Resolved 2026-07-22**: phone invite now creates a real, confirmed auth identity; SMS delivery itself is a documented demo-mode seam (no SMS provider configured), same pattern as this codebase's ACH/Stripe stubs.
13. ~~**Growth-tier operational-intelligence features (fuel stop logging, IFTA mileage log, driver chat, live dispatch map, offline mode) all have real schema/API scaffolding but zero UI.**~~ — **All five resolved 2026-07-23.** Every item in this cluster now has a real, verified UI (details per sub-item below); none of it is a stub or placeholder. Some sub-scopes were deliberately narrowed (IFTA is manual-entry only, offline mode covers one action, fuel-stop driver-side mobile logging wasn't built) — each noted explicitly, not silently dropped.
    - ~~**Driver in-app chat**~~ — **Resolved 2026-07-23**: full web + mobile UI, verified live (see Driver in-app chat row above).
    - ~~**Fuel stop logging**~~ — **Resolved 2026-07-23**: web "Fuel" tab on vehicle detail, verified live (see Fuel stop logging row above). Driver-side mobile logging not built this pass.
    - ~~**IFTA mileage log UI**~~ — **Resolved 2026-07-23** (manual entry only): log/view state crossings on the load detail page, verified live + via the quarterly-summary RPC. GPS auto-detection remains unbuilt.
    - ~~**Live dispatch map**~~ — **Resolved 2026-07-23**: new `/dispatch` page (Leaflet + OSM, Growth+ gated), verified live with a screenshot-confirmed marker.
    - ~~**Offline mode**~~ — **Resolved 2026-07-23** (one action: load status advancement queues and auto-syncs). This closes every item in the Growth-tier operational-intelligence cluster.
14. ~~**Phase 8 (SuperAdmin) has real, working backend for org triage/health/impersonation/tier-changes but literally no UI**~~ — **Resolved 2026-07-23**: all 7 mockup-23 screens built as a new `(admin)/admin/**` route group, sibling to the tenant `(app)/` group (so platform staff never see the tenant `Sidebar`) — Triage Queue (home page, urgency computed client-side from `billing_status`/`trial_ends_at`/`health_score`, no new `urgency_score` column per Rule B), Customer Health Board, Org Detail (KPIs, adoption checklist, users, recent loads, tier/trial/grace-period/notes actions, impersonate), Billing & Payments, Sales Pipeline, Audit & Activity, Feature Flags. Three of these (Sales Pipeline, Billing & Payments, Audit & Activity, Feature Flags) had **zero backend** before this pass — new routes: `GET /api/admin/pipeline` (computed directly from `carrier_details`/`loads`/`drivers`, no `sales_pipeline` table, per Rule B), `GET /api/admin/billing`, `GET /api/admin/audit`, `GET`/`PATCH /api/admin/flags` + `POST /api/admin/flags/override`; also added the previously-missing `PATCH .../trial` and `PATCH .../grace-period` routes. `proxy.ts` updated with `sx_owner`/`sx_finance`/`sx_support` entries in both `ROLE_HOME` and `ROLE_ROUTES`. Verified live end-to-end: logged in as `info@shipmentx.com` (sx_owner), walked all 7 screens with real data, added a note on Org Detail → confirmed it appeared on Audit & Activity, set a grace period → confirmed the org appeared in Billing & Payments' at-risk list, confirmed the demo carrier owner (`demo@carrieros.dev`) is bounced away from `/admin` back to the tenant dashboard (role gate verified in both directions). Feature Flags' empty state is correct, not a bug — `platform_flags` genuinely has 0 rows in this environment (confirmed via direct DB query). `npx tsc --noEmit` clean, full Vitest suite (42 tests) passing. **SA1 decision, resolved 2026-07-23**: the `profiles.role = sx_*` deviation from the original SA1 architecture decision was raised explicitly as an open question, and the answer is to keep it — `decisions.md`'s SA1 entry now carries a 2026-07-23 amendment reversing the "wholly separate `platform_admins` auth surface" requirement. The pragmatic model is the accepted design going forward, not an unresolved gap; revisit only if the threat model changes (e.g. onboarding an external support team).
