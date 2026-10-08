# PRD: CarrierOS MVP
**Product:** CarrierOS
**Date:** July 2026
**Author:** ShipmentX Product Team
**Status:** Ready for Development

---

## Changelog

| Version | Date | Summary |
|---------|------|---------|
| v2.6 | Oct 2026 | Public developer API marked built (read-only scope listed under Platform / Internal); added `carrieros-mcp`, the separate MCP server that exposes the public API to AI assistants, as its first real consumer. See tech-spec.md §5.7. |
| v2.5 | Sep 2026 | Opened product discovery for a CarrierOS one-stop load marketplace: unified search, provider-aware pursuit (contact/offer/bid/book), application tracking and confirmed-award conversion. Added provider ranking, partner diligence and Mockup 28. This is a design/discovery proposal, not a committed feature, tier, provider contract, or delivery date. |
| v2.4 | Sep 2026 | Accounting integration (decisions.md T19): the live QuickBooks/NetSuite connector stays deferred, but the ledger-shaped export/event data model underneath it is now in-scope groundwork, not deferred with it. EDI integration with shippers/brokers (decisions.md T20) reverses P1's original Phase 1 "EDI" exclusion — inbound 204/outbound 990/214/210 now on the Pro roadmap; build-vs-provider choice still open. Also removed stale Vercel deployment references (project runs on AWS ECS Express Mode; corrected in tech-spec.md/decisions.md the same day). |
| v2.3 | Sep 2026 | Apple/Google sign-in specified as standard OAuth 2.0 via Supabase Auth (decisions.md T18, new requirement, not yet built). Reversed T15's "passkey mandatory for every role" — passkey is now an opt-in login option, not required; matches what actually shipped 2026-09-21. Reopens the SuperAdmin mandatory-2FA gate (production-gates.md Gate 2→3) as unresolved, since mandatory passkey was its proposed closing mechanism. |
| v2.2 | Sep 2026 | Reversed v2.0's "in-app support ticketing" exclusion (decisions.md T16): AI-triaged ticket submission is now all-tiers baseline, with an org's own support desk (`org_support` queue) as the Enterprise-gated capability — resolves the "dedicated support" half of PR1's Enterprise line (branding resolved the other half, v2.1). |
| v2.1 | Sep 2026 | Public developer API auth changed from API keys to OAuth 2.0 client-credentials (decisions.md T14). Added passkey/WebAuthn as a login option for every role and platform staff, on top of password auth (decisions.md T15) — web via Supabase Auth's passkey API, mobile needs a separate native-bridge effort. Corrected the Super Admin roadmap line, which had gone stale against SA1's 2026-07-23 amendment (actual auth is `profiles.role`-based, not the originally-specified separate `platform_admins` table). |
| v1.1 | Jun 2026 | Added accept/decline, AI extraction spec, driver settlement (P1), notifications, offline mode, role permissions (P1), data export, edge cases |
| v1.2 | Jun 2026 | Added Customer Intelligence module |
| v1.3 | Jun 2026 | Added bulk CSV customer import (P0); Capacitor for iOS/Android; native GPS via Capacitor plugin |
| v1.4 | Jul 2026 | Architecture change: Capacitor replaced with Expo (React Native); two-app architecture — carrieros-mobile/ (Expo) + carrieros-web/ (Next.js); tech-spec v2.3 |
| v1.4 | Jun 2026 | Added DVIR inspections + maintenance tracking (P0, all tiers); per-truck pricing with monthly minimums; Enterprise tier renamed |
| v1.8 | Jul 2026 | Per-role home screen content fully specified for all 5 roles (Owner, Solo, Driver, Dispatcher, Finance) |
| v1.9 | Jul 2026 | Urdu/اردو (ur) added as 4th supported language; RTL required for Urdu (`dir="rtl"` on root layout); Noto Nastaliq Urdu font; mockup-16 built |
| v1.7 | Jul 2026 | Full i18n scope documented: date/time formatting via Intl, USD-only currency, US-only units/address, RTL required for Urdu only (Punjabi Gurmukhi is LTR) |
| v1.6 | Jul 2026 | App-wide i18n: English, Spanish, Punjabi (P0 for CA pilot); `preferred_language` on profiles table (all roles, not driver-only) |
| v2.0 | Jul 2026 | **Full 4-tier feature scope defined** (Starter → Growth → Pro → Enterprise); Starter adds fuel stop logging + single-truck calendar; Growth adds driver in-app chat, IFTA mileage log (auto via GPS), desktop command center views (Owner/Dispatcher/Finance), live dispatch map; Pro fully defined: full IFTA tax reporting hub, fuel card analytics, driver performance dashboard, revenue analytics desktop, advanced customer portal, carrier public profile, load board posting (DAT/Truckstop), banking/ACH autopay, finance desktop command center; Enterprise adds AI smart dispatch, HOS safety alerts, enterprise safety risk dashboard, driver training + certification tracking, custom user permissions, DOT audit readiness; scope exclusions documented (AI voice, lumper negotiation, support ticketing); tier-pricing-structure.md updated to v4.0 |
| v1.5 | Jul 2026 | **Role model expanded to 5 roles** (Owner, Solo, Driver, Dispatcher, Finance); Finance role added (Growth+); driver compliance requirements added (CDL, medical cert, endorsements); company-level document storage added (COI, MC authority, W-9); signup/trial flow with CC collection documented; Non-Goals updated; Appendix B (version history) removed |

---

## Problem Statement

Owner-operators and small carriers with 1–5 trucks have no purpose-built software to manage their business. Today they cobble together spreadsheets for load tracking, email for receiving and communicating orders, and Quicken or basic accounting tools for invoicing. This fragmentation means critical information is scattered, invoices are delayed or lost, customers have no visibility into their shipments, and the carrier has no clear picture of profitability per load. The cost of not solving this is real: missed invoices, late payments, lost customers who want shipment visibility, and hours of administrative overhead each week that the owner-operator (who is often also driving) cannot afford.

---

## Goals

1. **Replace 3 tools with 1** — a carrier can fully manage their business (orders, dispatch, invoicing, customer visibility) without spreadsheets, email threads, or Quicken.
2. **Onboarding under 60 minutes** — a carrier with zero software training can go from signup to first live load with no support call.
3. **Invoice sent within 2 minutes of load completion** — the workflow from marking a load delivered to sending the customer an invoice takes no more than 2 minutes.
4. **Pilot validation:** 8 of 10 pilot carriers actively using the product after 30 days (80% retention).
5. **Customer visibility adoption:** 70% of pilot carriers share a visibility link with at least one customer within their first week.

---

## Non-Goals (MVP)

The following are out of scope for MVP (Starter + Growth launch). Features marked "Pro" or "Enterprise" are in-scope for those tiers post-MVP.

1. **ELD / HOS compliance** — not building for MVP; ELD integration and HOS alerts are Enterprise tier. Will integrate with Motive/Samsara after pilot validation.
2. **IFTA tax computation** — Growth includes IFTA mileage logging only (state crossings auto-recorded via GPS). Full IFTA quarterly filing prep and tax computation are Pro tier.
3. **Load board integration** — posting loads to DAT/Truckstop is Pro tier. Bi-directional load board integration is Enterprise tier. Neither is in MVP.
4. **Customer login portal** — the tracking link (no login) is all tiers and MVP. A full customer login portal (invoice download, rate agreements) is Pro tier.
5. **Finance role depth** — MVP Finance role covers invoices, reports, and customer accounts. Full accounting (P&L, bookkeeping, bank reconciliation) is out of scope at all tiers. QuickBooks export is Growth; direct sync is Pro. **The live QuickBooks/NetSuite connector itself is deferred** (decisions.md T19) — but the underlying ledger-shaped export/event data model it depends on is in-scope groundwork now, not deferred with it.
6. **Factoring company integration** — Pro tier, post-MVP.
7. **Driver in-app chat** — Growth tier, post-MVP. MVP uses push notifications and external SMS for driver communication.
8. **AI smart dispatch / HOS alerts / enterprise safety dashboard** — Enterprise tier, post-MVP.
9. **Fuel card integration + analytics** — Pro tier, post-MVP. Growth includes manual fuel stop logging only.
10. **Desktop command center views** — Growth tier, post-MVP. MVP is mobile-first; desktop is responsive but not purpose-built.
11. **Route optimization, payroll** — explicitly deferred, no planned tier.
12. **AI voice assistant, AI lumper fee negotiation** — excluded from all tiers; see scope exclusions in tier-pricing-structure.md. In-app support ticketing was also excluded here through v2.1 — reversed 2026-09-21, `decisions.md` T16; it is now all-tiers baseline (submit + AI-triaged/human tech support), with the Enterprise-only piece being an org's own support desk, not the mechanism itself.

---

## User Personas

### Primary: The Driver-Owner (Sam)
- Owns 1–2 trucks, drives one of them
- Uses a spreadsheet + email + Quicken today
- Not tech-savvy; uses iPhone daily but has never used business software
- **Operates in Solo mode** — simultaneously dispatcher, driver, and billing. The app must handle all roles for a single user without friction or mode-switching.
- Core need: stop losing track of loads and invoices, look professional to customers

### Secondary: The Small Fleet Owner (Maria)
- Owns 3–5 trucks, has 1–2 drivers, does not drive herself
- Needs to dispatch drivers, track multiple loads simultaneously, and bill customers
- May hire a dispatcher or office manager as the fleet grows
- Core need: visibility across all trucks, fast invoicing, customer trust

### Tertiary: The Employed Driver
- Does not own the truck or business
- Receives load assignments from the owner or dispatcher
- Only needs: current load details, status update controls, DVIR inspection, POD capture
- Must never see rates, invoice amounts, or other drivers' load data

---

## Role Model

CarrierOS uses five roles enforced at the database layer (Supabase RLS). UI visibility reflects permissions but is not the enforcement mechanism.

| Role | Tier | Who | Key Access |
|------|------|-----|------------|
| Owner | All | Account holder / carrier | Full access to all features |
| Solo | All | Owner who is also the driver | Owner view + driver actions combined; no role-switching needed |
| Driver | All | Employed driver | Assigned loads, status updates, DVIR, POD capture. No rates, invoices, or other drivers' data |
| Dispatcher | Growth+ | Office staff managing loads | All load/dispatch/fleet ops. No invoices, reports, or billing |
| Finance | Growth+ | Billing / accounting person | Invoices, payments, reports, customer accounts. No dispatch or driver ops |

**Key rules:**
- Solo mode is the default for all new accounts. Team features unlock when the first driver is invited.
- Driver accounts are subordinate to the owner's subscription. If the subscription lapses or the driver is removed, driver access is immediately revoked.
- Only the Owner can invite/remove team members or change the subscription plan.
- Rates and invoice amounts are excluded from all driver-visible API responses — not just hidden in the UI. This is enforced via a `loads_driver_view` database view that omits rate columns.
- Pilot carriers provide a card at onboarding like every other carrier, but are billed nothing until
  their 90-day free period ends (amended 2026-07-20, decisions.md P4/PR2 — supersedes the original
  "exempt from credit card collection" wording; see decisions.md for why).

---

## User Stories

### Signup & Trial
- As Sam, I want to choose my plan (Starter or Growth) before creating an account so that I understand what I'm signing up for.
- As Sam, I want to create my account using email/password or Apple/Google SSO so that signup is fast.
- As Sam, I want to add my credit card at the end of onboarding — after I've set up my company, truck, and seen the product — so that I'm not asked for payment before I've decided it's worth it.
- As Sam, I want to see a clear trial end date ("30 days free, first charge Aug 3") so that I know exactly when billing starts.
- As a pilot carrier, I want to complete onboarding without entering a credit card so that I can evaluate the product without commitment.

### Onboarding
- As Sam, I want to set up my account (company name, logo, tax ID, payment terms, first truck, first customer) in under 60 minutes so that I can start running loads on day one.
- As Sam, I want a guided setup checklist on first login so that I know exactly what to complete before I'm ready.
- As Sam, I want smart defaults (Net 30, standard invoice template) so that I don't have to configure everything from scratch.

### Load Intake
- As Sam, I want to upload a rate confirmation PDF and have the app extract the load details automatically so that I don't have to type everything in.
- As Sam, I want to review and correct any extracted fields before saving so that I catch AI errors before they cause problems.
- As Sam, I want to create a load manually in under 2 minutes so that I can enter loads received by phone call.
- As Sam, I want to accept or decline a load so that my load list only shows work I've committed to.
- As Maria, I want to see all active loads across my trucks on one screen so that I always know what every driver is doing.
- As Maria, I want to assign a load to a specific truck and driver so that each driver knows their assignment.

### Dispatch & Load Tracking
- As Sam, I want to update a load's status (Scheduled → In Transit → Delivered) from my phone so that my records stay current on the road.
- As Sam, I want my customer to automatically receive a notification when their load status changes so that I don't have to call or text them manually.
- As a driver, I want to receive a push notification when a load is assigned to me so that I don't miss an assignment.
- As a driver, I want to see all my load details (pickup, delivery, customer contact, instructions) on one screen so that I don't need to call the dispatcher.

### Customer Visibility
- As Sam, I want to share a tracking link with my customer so that they can see the load status without calling me.
- As a shipper/customer, I want to open a link and see status, ETA, and carrier contact — no login needed.

### Document Capture & Delivery
- As a driver, I want to take a photo of the POD/BOL from my phone and attach it to the load so that delivery is confirmed on the spot.
- As Sam, I want to send POD/BOL documents to my broker/customer directly from the app so that I don't email them separately.
- As Sam, I want explicit confirmation that my document uploaded successfully so that it doesn't fail silently.

### Invoicing & Billing
- As Sam, I want to generate an invoice from a completed load in one tap so that I don't re-enter data.
- As Sam, I want to review and edit the invoice before sending so that I catch any errors.
- As Sam, I want to send the invoice from within the app so that I don't switch to email.
- As Sam, I want to see unpaid, paid, and overdue invoices at a glance.
- As Sam, I want to download a PDF of any invoice for filing or printing.
- As Priya (Finance), I want to access invoices, mark payments received, and run reports without having access to dispatch or driver management.

### Per-Load Expense Tracking *(Growth tier)*
- As Sam, I want to log per-load expenses (fuel, tolls, trailer rental, lumper fees) so that I can see my actual net margin per load.

### Driver Settlement *(Growth tier)*
- As Maria, I want to generate a driver settlement statement per pay period so that each driver sees their earnings and deductions.
- As a driver, I want to see a breakdown of my settlement (loads, gross, deductions, net) so that I understand my pay.

### Team Management
- As Maria, I want to invite a driver by phone number or email so that they receive a text/email to create their account and join my fleet.
- As Maria, I want to invite a dispatcher so that someone else can manage load assignments without accessing billing.
- As Maria, I want to invite a Finance user so that my accountant can handle invoicing without touching operations.
- As Maria, I want to see which team members have completed their profiles and which have outstanding compliance items so that I stay on top of fleet readiness.
- As Maria, I want to remove a team member and immediately revoke their access so that ex-employees cannot reach company data.

### Driver Compliance (all tiers)
- As a driver, I want to enter my CDL number, class, issuing state, and expiry during account setup so that my employer has my credentials on file.
- As a driver, I want to enter my DOT medical certificate expiry and upload the certificate so that I'm compliant without paper.
- As a driver, I want to record my endorsements (HazMat, Tanker, Double/Triple) so that dispatchers know what I'm qualified to haul.
- As Maria, I want to see a compliance dashboard showing each driver's CDL expiry, medical cert status, and inspection history so that I know who is road-ready at a glance.
- As Maria, I want to receive an alert 60 days before any driver's CDL or medical cert expires so that I can prompt renewal before it becomes a compliance issue.
- As Maria, I want to send a reminder to a driver whose profile is incomplete so that I'm not chasing them manually.

### Company Documents (all tiers)
- As Sam, I want to upload and store my cargo insurance COI so that I can pull it up instantly when a broker requests it.
- As Sam, I want to store my MC authority letter, DOT operating certificate, and UCR so that all operating authority docs are in one place.
- As Sam, I want to store my W-9 and EIN confirmation so that I can share them with brokers and customers without searching my email.
- As Sam, I want an alert 30 days before any company document expires (insurance renewal, UCR) so that I never lapse without knowing.
- As Sam, I want to distinguish between per-truck documents (registration, annual inspection) and company-wide documents (cargo insurance, MC authority) so that the right docs are associated with the right level.

### Compliance & Maintenance (all tiers)
- As Sam, I want to complete a pre-trip and post-trip inspection on my phone so that I stay compliant with FMCSA requirements without paper forms.
- As Sam, I want the inspection form to already have all required items pre-loaded so that I don't have to build it from scratch.
- As a driver, I want to flag a defect during an inspection so that my dispatcher knows immediately that something needs attention before the next run.
- As Sam, I want to set a mileage-based reminder for an oil change so that I never miss a service interval again.
- As Sam, I want to see all my truck documents (registration, insurance, DOT cert) in one place so that I can pull them up instantly at a roadside inspection.
- As Maria, I want a DVIR defect to automatically create a maintenance reminder so that nothing falls through the cracks.

### Customer Intelligence
- As Sam, I want to see all loads I've completed for a specific customer in one place so that I have context when they call.
- As Sam, I want to see notes I've saved about a customer (e.g., "pays slow", "prefers flatbed") so that I remember important details without relying on memory.
- As Maria, I want to see which customers generate the most revenue so that I know who my best relationships are.
- As Maria, I want to see how quickly each customer pays their invoices on average so that I can prioritize fast-paying customers and avoid cash flow problems.
- As Sam, I want to see the last rate I was paid on a specific lane by a specific broker so that I can negotiate from a position of knowledge.
- As Sam, I want to see when I last hauled a load for each customer so that I can identify relationships going cold.

### Data & Reporting
- As Sam, I want to export a CSV of all loads and revenue for a date range so that I can give my accountant what they need at tax time.
- As Maria, I want a dashboard showing loads, revenue, outstanding invoices, and on-time delivery rate this month.

---

## Requirements

### P0 — Must-Have (MVP cannot ship without these)

**Signup & Free Trial**
- [ ] Plan selection at signup: Starter ($29/mo, up to 2 trucks) or Growth ($79/mo, up to 5 trucks)
- [ ] Account creation via email/password, or Apple/Google sign-in via OAuth (`decisions.md` T18, 2026-09-22 — standard OAuth 2.0 via Supabase Auth's built-in provider support, not a bespoke integration; not yet built)
- [ ] **Passkey (WebAuthn) is available as an opt-in login option, not required** — reversed 2026-09-22, see `decisions.md` T15's amendment (supersedes the original 2026-09-21 "mandatory across the board" resolution). A user may add a passkey from Settings; there is no forced registration step after signup, and no role is required to have one. Password/magic-link/OAuth remain the primary credentials for everyone. Web build already matches this (opt-in only, shipped 2026-09-21). Mobile passkey support is optional future work, not MVP-blocking. **Open, not resolved by this reversal:** the SuperAdmin mandatory-2FA requirement (`production-gates.md` Gate 2→3) was specifically meant to close via *mandatory* passkey — with passkey optional again, that gate has no proposed mechanism to close it; needs a real decision next time SuperAdmin security is scoped.
- [ ] Onboarding flow: company setup → first truck → first customer → credit card → trial confirmation
- [ ] Credit card collected at the end of onboarding, after the user has completed setup — not at the start
- [ ] Trial messaging: "30 days free — no charge until [date]". First charge date and trial end date displayed on confirmation screen
- [ ] Pilot carrier flag: accounts marked as pilot skip the CC step entirely
- [ ] Trust signals on CC screen: Stripe badge, PCI DSS compliance, SSL lock, "No charge today" sub-note
- [ ] Reminder email 3 days before trial ends

**Onboarding**
- [ ] Account setup: company name, logo (optional), address, tax ID/EIN, default payment terms
- [ ] Truck directory: add truck (plate, VIN, DOT number) — max 2 in Starter tier
- [ ] Customer directory: add/manage customers (name, contact, email, address)
- [ ] Guided onboarding checklist on first login with progress indicator
- [ ] Smart defaults: Net 30 payment terms, standard invoice template pre-loaded
- [ ] Dedicated inbound email address provisioned at signup (e.g., loads@[company].carrierosapp.com)

**Load Intake — AI Extraction**
- [ ] Upload rate confirmation PDF or image; AI extracts: pickup address, delivery address, agreed rate, commodity, pickup/delivery windows, broker name and contact, reference numbers
- [ ] Review screen highlights all extracted fields; user must explicitly confirm rate and addresses before saving
- [ ] Inline field editing on review screen (tap any field to correct)
- [ ] Confidence indicator on extracted fields (low confidence = flagged in amber)
- [ ] Manual load entry as fallback: create load from scratch with required fields only (for phone-received loads)
- [ ] Paste-to-extract: carrier pastes any text (SMS, WhatsApp, broker portal copy) into AI extraction field — same extraction pipeline as PDF
- [ ] Email forwarding: forwarded broker emails parsed by AI and create a draft load automatically
- [ ] Accept / Decline load action — declined loads removed from active list; broker notified via email if contact on file

**Load Management**
- [ ] Load status workflow: Draft → Scheduled → In Transit → Delivered → Invoiced
- [ ] Update load status from mobile (iOS and Android)
- [ ] Load list view with filter by status and date
- [ ] Assign load to truck and driver
- [ ] Solo mode: if only one truck/driver exists, assignment is automatic — user is not prompted
- [ ] Driver login: each driver gets unique credentials; driver mode shows only their assigned load, status update, and document capture — no rates, invoices, or other drivers' loads visible. Enforced at DB layer, not just UI.
- [ ] Driver receives push notification on load assignment

**Notifications**
- [ ] Push notification to driver when load is assigned
- [ ] Push/SMS notification to carrier when load status updated by driver
- [ ] Email notification to customer when load status changes (opt-in per load)
- [ ] Email notification to carrier when invoice is viewed by customer
- [ ] In-app notification for overdue invoices (7 days past due)

**Customer Visibility**
- [ ] Generate shareable tracking link per load (no login required for recipient)
- [ ] Tracking page: load status, origin/destination, estimated delivery, carrier contact
- [ ] Link auto-updates when status changes
- [ ] Share link via SMS or email in one tap

**Document Capture & Delivery**
- [ ] Photo capture of POD/BOL from phone camera; attached to load
- [ ] Upload confirmation screen with explicit success/failure state
- [ ] Documents stored per load and accessible from load detail
- [ ] Send POD/BOL to broker/customer email directly from app

**Invoicing**
- [ ] Auto-populate invoice from completed load
- [ ] Invoice review screen with edit capability before sending
- [ ] Send invoice via email from within app
- [ ] Invoice includes: company name/logo, load details, amount due, payment terms, due date, tax ID
- [ ] Invoice status: Draft → Sent → Paid → Overdue
- [ ] Mark invoice as paid (manual for MVP)
- [ ] Invoice PDF download/print

**Customer Intelligence (Starter — basic)**
- [ ] Customer directory: name, contact, email, address, notes field, custom tags (e.g., "fast pay", "preferred", "avoid")
- [ ] Load history per customer: all loads completed for that customer, accessible from customer profile
- [ ] Last load date visible on customer list view
- [ ] Bulk customer import via CSV or XLS — available at onboarding AND from Customer Directory
  - Fields mapped: Company Name (required), Contact Name, Email, Phone
  - Preview table shown before import; user can review and confirm
  - Rows missing Company Name are skipped with a count shown
  - Duplicate company names flagged; user chooses skip or overwrite per row
  - Max 50 customers per import for MVP
  - Template CSV downloadable from the import screen

**Home Screen — Per-Role Content (all tiers)**

The home screen is role-specific. Each role lands on a different view after login. All home screens share the same navy header and bottom tab bar (role-appropriate tabs only).

*Owner / Solo home:*
- [ ] Exceptions banner at top: red with count if items exist; green "All Clear" if none — taps through to Exceptions Inbox
- [ ] Revenue card: revenue this month vs. last month with trend arrow (up/down/flat)
- [ ] Active loads strip: all loads currently in-transit or out-for-delivery; each shows driver name, route (origin → dest), and status; taps to load detail
- [ ] Outstanding invoices summary: total $ owed + count overdue (shown in red if any overdue)
- [ ] Fleet status row: X Active / X Idle / X In Shop — taps to fleet list
- [ ] Driver compliance row: X All Clear / X Due Soon / X Incomplete — taps to compliance dashboard
- [ ] Quick action bar: + New Load · + Invoice · Assign (contextual — only Assign shows if unassigned loads exist)
- [ ] Solo variant: if owner is also driving today, "My Load" card appears above the fleet strip

*Driver home:*
- [ ] Current load card (full-width, prominent): load number, customer name, origin → destination, commodity, next required action button (Start DVIR / En Route / At Pickup / Update Status / Upload POD)
- [ ] If no active load: "No load assigned" state with last 3 completed loads listed below
- [ ] Pre-trip DVIR reminder banner: shown if it is before noon and no pre-trip DVIR logged today
- [ ] Next assigned load (if any): compact card showing upcoming load date, customer, route
- [ ] My compliance chips: CDL expiry status + med cert status (green/amber/red pill)
- [ ] Driver tab bar: My Load · DVIR · History · Profile (4 items only — never shows owner nav)

*Dispatcher home:*
- [ ] Active loads board: all loads in-transit or pending pickup, each showing driver, route, last status update time, and a flag if status hasn't been updated in >4 hours
- [ ] Exceptions strip: missing PODs, overdue status updates, unassigned loads — count badge
- [ ] Available section: idle trucks (with license plate) and unassigned drivers (with name)
- [ ] Quick actions: + New Load · Assign Driver
- [ ] No financial data anywhere on this screen (no revenue, no invoice amounts)

*Finance home:*
- [ ] Revenue this month: large number + simple 6-month sparkline trend
- [ ] Invoice aging buckets: 0–30 days / 31–60 days / 60+ days — each showing $ total and count; 60+ shown in red
- [ ] Action queue: invoices ready to generate (POD received, not yet invoiced) + overdue invoices needing a reminder
- [ ] Recent payments: last 5 payments received with customer name, amount, date
- [ ] Quick actions: Generate Invoice · Send Reminder
- [ ] No operational data (no load assignments, no driver details, no DVIR)

**Team Management (all tiers)**
- [ ] Owner can invite team members via phone number or email
- [ ] Invite flow: select role → enter name + contact → send SMS/email invite link
- [ ] Driver invite: driver receives SMS/email link, creates account, lands in driver-scoped view. No plan selection, no CC, no company setup required.
- [ ] Driver account is subordinate to owner's subscription. Revoked immediately on removal or subscription lapse.
- [ ] Owner can view all team members, their role, and invite status (Active / Pending / Incomplete profile)
- [ ] Owner can change a member's role or remove them at any time
- [ ] Dispatcher and Finance roles available on Growth plan and above; shown but locked (with upgrade prompt) on Starter

**Internationalisation — All Users (all tiers — P0 for CA pilot)**

*Language:*
- [ ] All users (owner, driver, dispatcher, finance) can select preferred language
- [ ] Language picker available in Account Settings for all roles; also shown as first step of driver profile setup
- [ ] Supported languages at launch: English (en), Spanish (es), Punjabi/ਪੰਜਾਬੀ (pa), Urdu/اردو (ur)
- [ ] Language preference stored on `profiles.preferred_language` — applies to any role
- [ ] Priority translation: driver-facing screens (DVIR form, status updates, POD capture, load detail, my-loads list); owner/dispatcher/finance screens translated at parity where feasible
- [ ] Punjabi requires Noto Sans Gurmukhi font — loaded conditionally
- [ ] Urdu requires Noto Nastaliq Urdu font + `dir="rtl"` on root layout — loaded conditionally
- [ ] RTL layout (Urdu): all driver screens must be validated in RTL; route display must explicitly reverse origin/destination order
- [ ] Language preference persists in AsyncStorage for offline use (Expo mobile) / localStorage (web)
- [ ] Language picker shows each option in its own script: "English / Español / ਪੰਜਾਬੀ / اردو"

*Date/Time:*
- [ ] All dates and times displayed using `intl.formatDate()` / `intl.formatDateTime()` — no hardcoded format strings
- [ ] US locale (MM/DD/YYYY, 12-hour clock) for MVP — handled automatically by `next-intl` wrapping `Intl.DateTimeFormat`

*Units, Currency, Address (MVP — US-only):*
- [ ] Units: miles, lbs, gallons — US only; no conversion needed for CA pilot
- [ ] Currency: USD only; all amounts formatted with `Intl.NumberFormat` (never hardcode `$`)
- [ ] Address format: US-only (street, city, state, zip); no address adaptation needed
- [ ] Multi-currency and metric units are explicitly **post-MVP** (relevant for Canada/Mexico expansion)

*RTL Layout:*
- [ ] RTL layout is **not required** — none of the three supported languages use right-to-left script. Punjabi in Gurmukhi is LTR. No `dir="rtl"` or layout mirroring work needed.

*Rationale: Spanish-speaking and Punjabi-speaking (Sikh) drivers represent a large share of the CA trucking workforce, but owner-operators in these communities also manage the admin side. No competitor at this price point offers Punjabi. Making i18n available to all roles serves the whole carrier business.*

**Driver Profile & Compliance (all tiers)**
- [ ] Driver completes compliance profile during account setup (after accepting invite)
- [ ] Required fields: CDL number, issuing state, license class (A / B / C), expiry date
- [ ] Optional: DOT medical certificate expiry + PDF/photo upload; endorsements (HazMat, Tanker, Double/Triple); emergency contact name + phone + relationship; profile photo
- [ ] Owner sees fleet compliance dashboard: per-driver status (All Clear / Due Soon / Incomplete), CDL expiry, medical cert expiry, last DVIR
- [ ] System sends alert to owner 60 days before any driver's CDL or medical cert expires
- [ ] Owner can send a "complete your profile" reminder to drivers with incomplete records
- [ ] Driver compliance data is never visible to other drivers

**Company Documents (all tiers)**
- [ ] Company-level document storage, separate from per-truck documents
- [ ] Supported types: Cargo Insurance (COI), General Liability, Workers' Comp, MC Authority Letter, DOT Operating Certificate, UCR (Unified Carrier Registration), W-9/EIN Confirmation, Business License
- [ ] Each document: upload PDF/photo, enter policy/reference number (optional), coverage amount (optional), expiry date (optional)
- [ ] System sends alert 30 days before any company document expires
- [ ] Owner can share/email any document directly from the app
- [ ] Documents marked as "Permanent" (MC authority, W-9) do not require expiry
- [ ] Finance role users have read access to company documents; cannot upload or replace

**Compliance & Maintenance (all tiers — P0)**
- [ ] Pre-trip DVIR: driver initiates from mobile before trip; FMCSA-compliant checklist (brakes, lights, tires, steering, horn, mirrors, coupling devices, emergency equipment)
- [ ] Post-trip DVIR: driver completes after trip; both inspections stored with timestamp + driver ID
- [ ] Defect flagging: driver marks any item as defective with note and optional photo; owner receives in-app + push notification immediately
- [ ] Digital signature on each inspection (tap to sign on mobile)
- [ ] Inspection records retained for minimum 3 months (FMCSA 49 CFR 396.11)
- [ ] Owner can view all inspection reports per truck, sorted by date
- [ ] Truck service log: add service entry (date, mileage, service type, cost, notes, shop name)
- [ ] Mileage-based reminders: set threshold (e.g., oil change every 5,000 miles); alert fires when due
- [ ] Time-based reminders: set reminder by date (e.g., annual DOT inspection); alert at 30 days and 7 days before
- [ ] Per-truck document storage: registration, insurance certificate, DOT operating authority — stored per truck, not company-wide

**Core Platform**
- [ ] Native iOS/Android app built with Expo (carrieros-mobile/) — true React Native, not a web wrapper
- [ ] Native GPS via expo-location (Growth tier continuous state crossing tracking; Starter manual location share at status updates)
- [ ] Driver shares location manually via "Share Location" button at key status updates — no background GPS in MVP
- [ ] Tracking link shows last-known location + status (not continuous real-time movement)
- [ ] Session persistence — user stays logged in on mobile
- [ ] CSV export of all loads + revenue for a selected date range

---

### P1 — Nice-to-Have (Growth tier or fast follow)

**Dispatch & Fleet**
- [ ] Truck calendar / availability view — see assigned vs. free trucks by day
- [ ] Fleet map — current location and status of all trucks (Maria persona)
- [ ] Recurring load templates for common lanes
- [ ] Load reassignment workflow with driver notification

**Driver Experience**
- [ ] Offline mode: status updates and photo capture queue locally; sync when connectivity returns; "Offline — syncing" indicator shown
- [ ] GPS real-time continuous location sharing (native app, background location) — Growth tier
- [ ] Driver receives settlement statement PDF in-app

**Financials**
- [ ] Per-load expense tracking: fuel, tolls, trailer rental, lumper fees — net margin display per load
- [ ] Invoice auto-reminders: at due date and 7 days overdue
- [ ] QuickBooks-compatible CSV export (Growth tier)
- [ ] Driver settlement: loads completed, gross pay, deductions, net pay per pay period
  - Settlement model configurable per driver: % of load rate / per-mile flat / per-load flat
  - Settlement auto-calculated when load marked Delivered; owner can override before issuing
  - Driver advance recording and auto-deduction from next settlement

**Documents**
- [ ] Document attachments per load: rate confirmation, BOL, POD, other files
- [ ] Bulk document send: all load docs attached to invoice email in one action

**Customer Intelligence (Growth — revenue insights)**
- [ ] Revenue per customer: total revenue, load count, and % of total business
- [ ] Average days-to-pay per customer: calculated from invoice sent → paid timestamps
- [ ] Rate history per lane per customer: last 5 rates paid by a broker on a given origin-destination pair
- [ ] Relationship health indicator: flag customers with no load in 30/60/90 days
- [ ] Customer ranking: sort by revenue, load count, or payment speed
- [ ] Invoice aging by customer: outstanding balance and oldest unpaid invoice

**Reporting**
- [ ] Dashboard: loads this month, total revenue, outstanding invoices, on-time delivery %
- [ ] Fleet compliance report: all driver CDL/med cert expiries, all truck and company doc expiries in one view (Growth+)

---

### P2 — Future Considerations

- [ ] Customer self-service portal (login, view loads, download invoices)
- [ ] Factoring company integration (OTR Capital, RTS, Triumph)
- [ ] ELD integration (Motive, Samsara) for automated status updates
- [ ] Bi-directional load board integration (DAT, Truckstop) — Enterprise tier
- [ ] IFTA mileage reporting
- [ ] Consolidated billing (multiple loads, one invoice to same broker)
- [ ] Full advances-against-future-loads system
- [ ] Shipper portal (login for shippers to submit load requests)
- [ ] Payment rail (ACH/card) — MVP is manual mark-as-paid only
- [ ] NHTSA recall alerts (Pro tier)
- [ ] Cost per mile + truck profitability report (Pro tier)
- [ ] ELD/telematics integration (Enterprise tier)

---

## Success Metrics

### Leading Indicators (30 days post-pilot launch)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Pilot activation rate | 10/10 complete onboarding | Checklist completion event |
| 30-day retention | 8/10 active at day 30 | Weekly active user |
| Loads per carrier/week | ≥ 3 average | Load creation events |
| Invoice sent within 24h of delivery | ≥ 80% | Delivered → Sent timestamp delta |
| Visibility link shared rate | ≥ 70% share ≥1 link | Link generation events |
| Onboarding time | Median ≤ 60 min | Signup → first load timestamp |
| AI extraction acceptance rate | ≥ 85% accepted without major edits | Edit events on review screen |

### Lagging Indicators (90 days)

| Metric | Target |
|--------|--------|
| Paid conversion (pilot → paid) | ≥ 7/10 |
| NPS | ≥ 40 |
| Support tickets per carrier/month | ≤ 2 |
| ARPU | ≥ $49/mo |

---

## Edge Cases

| # | Edge Case | Feature | Priority |
|---|-----------|---------|---------|
| 1 | AI extracts wrong rate or address — user doesn't catch it | Load intake | Critical |
| 2 | Rate confirmation PDF is password-protected or image-only | AI extraction | Critical |
| 3 | Solo owner-operator is the driver — auto-assign, no prompt | Dispatch | Critical |
| 4 | Driver goes offline mid-transit — status updates must queue | Status tracking | Critical |
| 5 | Driver submits blurry or incomplete POD photo | Document capture | Critical |
| 6 | Driver assigned to load becomes unavailable | Dispatch | High |
| 7 | Broker sends amended rate confirmation after load accepted | Load intake | High |
| 8 | Carrier wants to cancel an accepted load | Accept/decline | High |
| 9 | Same load entered twice (email + manual) | Load intake | High |
| 10 | Invoice disputed or partially paid | Invoicing | High |
| 11 | Invoice sent, then rate corrected — must re-issue | Invoicing | High |
| 12 | App used in poor rural connectivity | All | High |
| 13 | Driver's CDL or medical cert expires mid-employment | Driver compliance | High |
| 14 | Driver invited but never completes profile setup | Team management | High |
| 15 | Owner removes a driver who is currently on an active load | Team management | High |
| 16 | Load delivered but delivery refused (damaged, wrong address) | Delivery | Medium |
| 17 | Carrier is sole proprietor with SSN, not EIN — invoice format | Onboarding/Invoice | Medium |
| 18 | Driver updates status on wrong load | Driver app | Medium |
| 19 | Customer pays by check — no digital confirmation | Payment tracking | Medium |
| 20 | Tracking link accessed after delivery — show completed state, not error | Visibility | Medium |
| 21 | Multiple invoices to same broker in one billing period | Invoicing | Medium |
| 22 | Finance user tries to access dispatch or driver screens | Role enforcement | Medium |

---

## Open Questions

| # | Question | Owner | Blocking? |
|---|----------|-------|-----------|
| 1 | Does POD/BOL need to go to broker from app, or just stored for carrier? | Pilot interviews | No |
| 2 | Should tracking link expire after delivery or remain accessible? | Product / Legal | No |
| 3 | Tax ID format: EIN vs SSN for sole proprietors — invoice display rules | Legal | No |
| 4 | Driver settlement: does MVP need to handle garnishments or tax withholding? | Legal / Pilots | No |

*(Questions 1–6 from prior versions resolved and closed. See v1.1–v1.4 changelog.)*

---

## Pricing

| Tier | Monthly Minimum | Per Truck | Trucks Covered at Min | Key Limits |
|------|-----------------|-----------|-----------------------|------------|
| Starter | $29/mo | $10/truck | 2 trucks | Up to 2 trucks |
| Growth | $79/mo | $15/truck | 5 trucks | Up to 5 trucks; Dispatcher + Finance roles |
| Pro | $149/mo | $22/truck | ~6 trucks | Fleet compliance reports, cost-per-mile analytics |
| Enterprise | $249/mo | $30/truck | ~8 trucks | ELD integration, dedicated support |

---

## Tech Stack (locked)

| Layer | Choice |
|-------|--------|
| Web app | Next.js 14 (App Router), Tailwind CSS — Owner/Finance/Dispatcher desktop, public tracking, onboarding |
| Backend | Supabase (Postgres + Auth + Storage) |
| Mobile app | Expo (React Native) — carrieros-mobile/; true native iOS/Android; EAS Build; expo-location, expo-camera, expo-notifications, expo-secure-store |
| AI extraction | claude-haiku-4-5 via Next.js API route |
| Email | Resend (invoices + inbound email forwarding webhook) |
| Deploy | AWS ECS Express Mode |

**Supabase notes:**
- `publishable key` = `NEXT_PUBLIC_SUPABASE_ANON_KEY`; `secret key` = `SUPABASE_SERVICE_ROLE_KEY`
- Use `@supabase/ssr` with `createBrowserClient` / `createServerClient` (not legacy client)
- Role permissions enforced via Row Level Security — never trust the client for role checks
- `loads_driver_view`: a view that excludes rate/revenue columns, used for all driver-scoped load queries

---

## Build Order (recommended)

1. **Supabase setup** — schema SQL, `user_roles` table, RLS policies, storage buckets, TypeScript type generation
2. **Auth + role routing** — login, middleware, owner/driver/dispatcher/finance routing, driver invite link flow
3. **Load intake** — method picker, `/api/extract-load`, ExtractionReview component
4. **Load list + detail** — owner views, status timeline
5. **Dispatch** — assign driver + truck
6. **Driver app** — `/my-loads`, status update, POD photo upload
7. **Invoice** — generate, `/api/send-invoice`, dashboard
8. **Tracking page** — `/track/[token]` public page (no auth)
9. **Customer directory** — list, profile, CSV import
10. **Onboarding + signup** — multi-step setup flow, CC collection, trial activation
11. **Super admin** — platform-operator command center (separate auth, triage queue, customer health board, billing, sales pipeline, audit log — see `design/mockups/mockup-23-super-admin.html` and `decisions.md` SA1–SA6)
12. **Public developer API** — OAuth 2.0 client-credentials grant (amended 2026-09-21, see `decisions.md` T14 — supersedes the original "API key auth (not OAuth)" wording), `/api/public/v1/...` versioning, `has_feature()` gated

---

## Happy Path Workflow

```
1. Carrier signs up → selects plan → creates account → sets up company + truck + customer
   → enters CC at end of onboarding → 30-day trial activated

2. Carrier receives rate confirmation (email/PDF/phone)
   → Uploads to app → AI extracts → Reviews & confirms → Load created

3. Carrier accepts load
   → Assigns to truck + driver (or auto-assigns if solo)
   → Driver notified via push

4. Driver completes pre-trip DVIR → picks up load
   → Updates status to "In Transit"
   → Carrier shares tracking link with customer (1 tap)

5. Customer opens tracking link
   → Sees live status + ETA (no login needed)

6. Load delivered
   → Driver snaps POD/BOL → uploads → completes post-trip DVIR
   → Carrier marks "Delivered"
   → App prompts: "Ready to invoice?"
   → Invoice auto-populated → reviewed → sent in 2 taps

7. Customer pays
   → Carrier marks invoice paid → load record closes
```

---

## Post-MVP Roadmap (Tier-Gated)

Full feature specifications for Growth+, Pro, and Enterprise features will be added as individual PRD appendices when each tier enters active development. Reference tier-pricing-structure.md v4.0 for the complete feature classification.

### Growth (post-pilot — build after 30-day pilot retention validated)
- Desktop command center: Owner + Dispatcher + Finance responsive web views
- Driver in-app messaging: load-specific chat threads, BOL sharing in-thread
- IFTA mileage log: auto-record state crossings via GPS; quarterly summary by state per truck
- Live dispatch map: all trucks + active loads on one screen

### Pro (post-MVP — build after Growth is stable)
- **Load marketplace discovery (proposed, tier TBD)** — compare DAT One, Truckstop, and 123Loadboard partner APIs for carrier-side search and provider-specific pursuit/book actions from CarrierOS. See [`loadboard-marketplace-prd.md`](loadboard-marketplace-prd.md) and [Mockup 28](../design/mockups/mockup-28-loadboard-marketplace.html). This supersedes neither the existing posting-only Pro note nor the older Enterprise bi-directional classification until Product resolves tier/packaging.
- Full IFTA tax reporting hub: quarterly filing prep, state-mile breakdown, estimated tax due, export for CPA
- Fuel card integration + analytics: WEX/Comdata/Fleetone import, cost-per-mile by truck/driver, anomaly detection
- Driver performance dashboard: on-time %, fuel efficiency, empty miles ratio, safety score
- Revenue analytics desktop: revenue/mile by lane, customer profitability, capacity utilization
- Finance desktop command center: full-width IFTA + invoices + settlements + analytics canvas
- Advanced customer portal: login, invoice download, rate agreements, recurring lane setup
- Carrier public profile: `carrieros.app/carrier/[mc-number]`
- Load board posting: DAT + Truckstop.com from within CarrierOS (one-way posting)
- Banking/ACH autopay: driver settlements, recurring vendor payments
- **EDI integration with shippers/brokers** (decisions.md T20, added 2026-09-23 — reverses P1's original
  Phase 1 EDI exclusion): inbound 204 (load tender) creates a load a dispatcher can accept/decline;
  outbound 990 (tender response), 214 (real-time shipment status, sourced from the same milestone data
  driving `/track/[token]`), and 210 (invoice, paired with T19's invoice-export work). Approach decided:
  EDI-as-a-service (REST/JSON, not hand-rolled X12) — Orderful is the lead vendor candidate, Zenbridge a
  second quote; final vendor pick still needs real (not publicly-advertised) pricing confirmed before
  any spend (decisions.md T20 amendment, 2026-09-23).
### Platform / Internal (Phase 8 — build after pilot retention validated)
- **Super admin command center** — platform-operator team workspace (support / sales / billing roles). 7 screens: Triage Queue, Customer Health Board, Org Detail, Billing & Payments, Sales Pipeline, Audit & Activity, Feature Flags. Built and shipped 2026-07-23 (see `decisions.md` SA1's 2026-07-23 amendment): actual auth is `profiles.role IN ('sx_owner','sx_finance','sx_support')` in a `type='platform'` org, reusing ordinary Supabase Auth — this line's original "separate `platform_admins` table, never Supabase Auth" wording is superseded, kept here only for history. The mandatory-2FA requirement was never formally dropped and is still genuinely unmet (`production-gates.md` Gate 2→3) — passkey support (see `decisions.md` T15, 2026-09-21) is the now-planned path to closing it, since WebAuthn credentials are inherently phishing-resistant multi-factor. See `design/mockups/mockup-23-super-admin.html` for the full design and `decisions.md` SA1–SA6 for locked architecture decisions.
- **Public developer API** — OAuth 2.0 client-credentials grant (amended 2026-09-21, `decisions.md` T14 — supersedes this line's original "API key auth, not OAuth"), `/api/public/v1/...` versioning, reuses `{error_code, error}` response convention, gated via `has_feature()`.
  - **Built** (read-only: loads, invoices, vehicles, exceptions, financial events; drivers routed but
    refused pending an authorization decision). Its first real consumer is **`carrieros-mcp`**, a
    separate repo and service that exposes the public API as read-only tools for AI assistants (MCP
    clients such as Claude Desktop, or ChatGPT remote connectors). A carrier connects it with the same
    Developer API OAuth client it would use for any integration, so it can see no more than the public
    API allows. Hosted on staging only; no production deployment yet. Details: `tech-spec.md` §5.7.


### Enterprise (post-Pro — build after Pro is validated at scale)
- **Branding customization** (scoped 2026-09-21, `decisions.md` PR1 amendment — resolves the original
  undefined "white-label" pricing-tier line): logo + a limited set of overridable brand colors within
  the existing design-token system, so the product feels like the Enterprise customer's own to their
  drivers/customers. Explicitly NOT a custom domain, NOT hiding the CarrierOS name, NOT a full re-skin
  — deliberately narrower than "white-label" implied. Gated via `has_feature('branding_customization')`.
- **Dedicated support — an org's own AI-triaged support desk** (scoped 2026-09-21, `decisions.md` T16
  — resolves the other, previously-undefined half of "dedicated support" on this same pricing line):
  in-app ticket submission is baseline on every tier (AI-triaged, routes to CarrierOS's own support
  team or an above-confidence AI auto-answer with a mandatory human-escalation path). What Enterprise
  actually buys is the `org_support` queue existing at all — the carrier's own staff fielding their own
  drivers'/customers' tickets through the same mechanism, instead of a separate helpdesk tool. Gated
  via `has_feature('support_desk')`. Also reverses this PRD's own prior Non-Goals exclusion of in-app
  support ticketing (see Non-Goals #12).
- AI smart dispatch: driver + truck matching based on HOS, location, endorsements, lane history
- HOS safety alerts: violation risk warnings, rest suggestions (requires ELD integration)
- Enterprise safety risk dashboard: fleet safety score, incident history, predictive risk
- Driver training + certification tracking: mandatory courses, endorsement renewals, coaching flags
- ELD/telematics integration: Samsara, Motive — auto-import location + HOS data
- Custom user permissions: granular access beyond 5-role model
- Admin audit log, DOT audit readiness package
- Full API access + webhooks, custom scheduled reporting

---

*CarrierOS PRD v2.4 — September 2026. Supersedes all prior versions.*
