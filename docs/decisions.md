# CarrierOS — Decisions Log
_Last updated: 2026-09-27 (latest dated entry: PR1's Enterprise branding implementation/product-boundary
update. September 2026 additions: T14 public API → OAuth 2.0 client-credentials; T15 passkeys (amended
2026-09-22 to available-not-required); T16 support ticketing; T17 LLM provider abstraction; T18 Apple/Google
sign-in; T19 accounting readiness and T20 EDI (2026-09-23); translation resolved 2026-09-24; avatar
amendments 2026-09-26. Earlier baseline 2026-07-21: S8-S11, V3-V5, L4, P2 amendment.)_

This file captures all locked product, pricing, schema, and technical decisions for CarrierOS. Each entry includes what was decided, why, and what it rules out.

---

## PRODUCT

### P1 — Target market: micro-carriers only (1–5 trucks)
**Decision:** Build exclusively for owner-operators and tiny fleets, not mid-market (6–20 trucks) or enterprise.
**Why:** 10 CA pilot carriers are all in this segment. Mid-market carriers already have options (McLeod, TMW). Micro-carriers are underserved and price-sensitive — they need simple, mobile-first tools, not feature-heavy TMS.
**Rules out:** Broker portals, factoring integrations, load boards (Phase 1).
**Amended 2026-09-23 — EDI removed from this exclusion list:** see T20. Real-time EDI data exchange
with shippers/brokers is now in scope; it is not the "enterprise feature micro-carriers don't need"
this line originally assumed.

### P2 — Gate operational intelligence, never safety
**Decision:** Dispatcher view, IFTA reports, and financial analytics are tier-gated. DVIR, HOS reminders, maintenance alerts, and load status are available on all tiers.
**Why:** Withholding safety features to force upgrades would be unethical and a liability. Intelligence features (who's most profitable, which lanes to bid) are genuine upsell value.
**Rules out:** Gating DVIR, HOS, or real-time load status behind paid tiers.
**Amended 2026-07-21 — exceptions system gating made concrete:** an architectural audit of the mockup-parity plan cross-checked the new "management by exception" feature (mockup-14) against this decision and the BRD directly. Result: exception *detection* (the underlying alerts, CDL/doc-expiry reminders, inline list flags) stays ungated on every tier — it's a safety/compliance signal. But the **full tiered inbox** (Starter sees top-3 items only, badge still shows the true count), **exception history timelines** on driver/vehicle/customer profile pages, and the **customer health score** are Growth+ — BRD FR-18.1/18.2/18.3 name these explicitly as gated "operational intelligence," not safety. This was caught before being built the wrong way, not retrofitted after — see S11.

### P3 — Solo role as default for new signups
**Decision:** New users who complete onboarding get role = 'solo' unless they explicitly select Owner.
**Why:** Most micro-carrier signups are owner-operators driving their own truck. Solo combines owner + driver access. Avoids confusion of "I'm an owner but I also drive."
**Rules out:** Asking users to pick from all 5 roles on signup.

### P4 — CC at end of onboarding, pilot carriers exempt
**Decision:** Credit card step is the last step in onboarding flow, after company setup and profile. CA pilot carriers (10 pre-identified) skip payment entirely for 90 days.
**Why:** Reduces abandonment — users see the product value before committing. Pilot carriers are doing us a favor; friction-free start builds goodwill.
**Amended 2026-07-20:** pilot carriers now provide a card at onboarding, not none at all — a Stripe subscription with `trial_end` set 90 days out, so no charge occurs until the trial ends but the card is on file for automatic billing afterward. Decided when scoping pilot-readiness: prospecting for free was never in question, but billing after the free period requires the card up front rather than asking for it at day 90. "Skip payment entirely" in the original wording is superseded; "friction-free start" still holds — card capture is one Stripe Checkout step, not a full billing conversation.
**Open (not yet decided):** whether the carrier's own shipper-invoicing (R1, factoring/Stripe) needs Stripe Connect for the pilot, or whether "mark as paid" plus a real emailed invoice is sufficient for 90 days. Recommendation on the table is to defer Connect — it is a materially larger scope (per-carrier KYC, payouts, payment-facilitator compliance) than the carrier-billing subscription above, and the two are easy to conflate because both say "Stripe."

### P5 — Driver tab bar: 4 items max
**Decision:** Mobile driver app bottom nav limited to: Home, Loads, DVIR, More.
**Why:** Thumb ergonomics on mobile. More than 4 tabs forces users to hunt. Less-used features (fuel log, chat) live inside "More."

### P6 — Rates hidden at DB layer from drivers
**Decision:** `loads_driver_view` excludes the `rate` column. All driver queries use this view, not the raw `loads` table.
**Why:** Drivers seeing load rates creates pay negotiation conflicts and is standard practice in the industry. Enforced at DB level so no accidental leak through any API route.

---

## PRICING

### PR1 — Four tiers: Starter $49 / Growth $99 / Pro $199 / Enterprise $349
**Decision:** Monthly per-org pricing. Annual discount available (not yet implemented).
**Why:** Starter covers solo operators who just need digital dispatch + DVIR. Growth unlocks team + dispatcher features. Pro adds financial intelligence. Enterprise adds white-label + dedicated support.
**Locked:** July 2026. Do not change without updating tier-pricing-structure.md, prd.md, sales website, and pilot deck.
**Both halves of "Enterprise adds white-label + dedicated support" are now resolved** — branding
customization (amendment directly below) and dedicated support (T16, TECHNICAL section) — neither was
functionally defined when this entry was originally written.

**Amendment (2026-09-21) — Enterprise "white-label" scoped, no longer undefined:** resolved as **branding
customization, not full white-label**. Enterprise orgs can customize their own logo and a limited set of
visual styling (brand colors within the existing design-token system) so the product feels like their
own to their end customers/drivers — not a custom domain, not hiding the CarrierOS name entirely, not a
mechanism to fully re-skin the UI. This is deliberately narrower than the original "white-label" wording
implied, chosen because full white-labeling (custom domain + DNS + cert provisioning per org, same
complexity class rejected for load tracking in R2) is disproportionate for what Enterprise customers
actually need — looking like *their* product to *their* customers, not operating an independently
branded SaaS product. At the time of this decision, implementation was still future work: per-org logo
and color storage plus a constrained, contrast-safe set of overridable tokens were required.

**Implementation and product boundary update (2026-09-27):** Enterprise branding is now implemented
for the carrier logo and limited primary/accent colors. The authenticated carrier shell and public
shipment-tracking page inherit those tokens; primary/accent foregrounds are contrast-resolved, while
operational status colors remain fixed semantic pairs. User appearance preference remains per-user,
not per-carrier. Keep carrier customization constrained to identity and presentation (logo, org name,
two brand colors); do not let branding recolor shipment status, exception severity, or action meaning.

**Next brandable candidates, not yet implemented:** an explicit tracking-page support contact/display
name and support message, then (if demanded by Enterprise customers) notification sender identity and
a custom tracking domain. Sharing permissions, expiry/revocation, which exception messages are
customer-visible, and tracking freshness are security/product controls, not branding settings. Avoid
custom fonts, arbitrary CSS, per-customer layouts, or status palettes: their accessibility and
maintenance cost outweigh the differentiation for small carriers.

### PR2 — CA pilot: Growth free for 90 days
**Decision:** All 10 CA pilot carriers get Growth tier at no cost for the first 90 days.
**Why:** Removes price objection during validation phase. Growth tier gives them enough features to stress-test real workflows. After 90 days they convert or we learn why they don't.
**Amended 2026-07-20:** "free" means no charge for 90 days, not no card — see P4. Conversion at day 90 is now an automatic Stripe trial-end charge against the card already on file, not a separate sales motion to collect payment for the first time.

### PR3 — Loss aversion upgrade messaging
**Decision:** Upgrade prompts frame the ask as "don't lose access to X" rather than "unlock X."
**Why:** Loss aversion is a stronger motivator than potential gain. Users who've been using a feature (during trial or grandfathered period) respond better to "keep it" messaging.

---

## SCHEMA

### S1 — Unified organizations model
**Decision:** One `organizations` table for both carriers (SaaS tenants) and customers (shippers/brokers). Subtables `carrier_details` and `customer_details` hold type-specific fields.
**Why:** A customer is also a company with potentially multiple users. Keeping separate tables creates duplication and makes cross-org queries awkward. Common fields (name, address, country, currency) live once.
**Rules out:** Separate `companies` and `customers` tables at the same level.

### S2 — BIGSERIAL PKs everywhere except profiles
**Decision:** All entity PKs (organizations, loads, drivers, trucks, customers, etc.) are BIGSERIAL integers (1, 2, 3...). `profiles.id` stays UUID.
**Why:** Human-readable IDs in URLs, support tickets, and printouts. Easier to reference in conversation ("load 47"). profiles.id must be UUID because it directly references `auth.users(id)` which Supabase Auth controls.
**Rules out:** UUID PKs on business entities.

### S3 — profiles is the single user table for all users
**Decision:** Every person in the system — carrier owner, driver, dispatcher, finance, and future customer portal users — has exactly one `profiles` row. No separate user tables per role.
**Why:** Simplifies auth (one lookup), one place for name/language/timezone, clean FK from any entity to a user. Customer portal users just get role = 'customer_admin' or 'customer_viewer'.
**Rules out:** Separate `drivers_users`, `customer_users` tables for auth.

### S4 — first_name + last_name (not full_name)
**Decision:** `profiles` has `first_name TEXT` and `last_name TEXT` as separate columns.
**Why:** Needed for proper salutation in emails/SMS ("Hi John"), sorting by last name, and locale-aware name display. full_name requires parsing which is error-prone.

### S5 — carrier_org_id as the universal FK pattern
**Decision:** All carrier-owned entities (loads, drivers, trucks, customers, etc.) use `carrier_org_id` as the FK column name referencing `organizations(id)`.
**Why:** Consistent pattern makes multi-tenant queries obvious and grep-friendly. `company_id` was the old name — fully replaced in v4.0.
**Rules out:** Mixed naming (company_id, org_id, carrier_id) across tables.

### S6 — Atomic entity number generation via org_sequences
**Decision:** Load numbers (LD-0001), driver numbers (DR-001), truck numbers (TR-01), customer numbers (CU-001), invoice numbers (INV-001) are generated by `next_entity_val(carrier_org_bigint, entity_name)` — a Postgres function with FOR UPDATE locking on `org_sequences`.
**Why:** MAX+1 has a race condition under concurrent inserts. Each carrier's sequences are independent (carrier A's LD-0001 ≠ carrier B's LD-0001).

### S7 — Locale auto-derived from country + state
**Decision:** `carrier_details.timezone` (IANA), `organizations.currency` (USD/CAD/MXN), and `carrier_details.uom_system` (imperial/metric) are auto-derived during onboarding from the carrier's country + state. User never selects timezone manually.
**Why:** Timezone selection dropdowns have 500+ options and users pick wrong ones. Country + state uniquely determines timezone for 99% of US/CA/MX carriers.

### S8 — `trucks` renamed to `vehicles`; vehicle types are region-neutral global master data
**Decision (2026-07-21):** The `trucks` table (and every `truck_id`/`truck_number`/`default_truck_id`
column/index/policy pointing at it) is renamed to `vehicles`/`vehicle_id`/`vehicle_number`/
`default_vehicle_id`. A new `vehicle_types` table (7 rows: semi/box_truck/flatbed/reefer/step_deck/
tanker/dump — icon, generic photo, typical specs) is the master-data definition a vehicle's
`vehicle_type_id` FK selects from. A separate `vehicle_classifications` table (24 rows across 11
regions — US/EU/GB/CA/MX/CN/IN/JP/KR/AU/BR, each region's own weight-class scheme) plus a
`vehicle_type_classifications` many-to-many join maps each type to its regional classification(s).
**Why:** CarrierOS is deploying US/EU/Asia-wide, and a fleet-entity table named after one region's
colloquial term for the vehicle, alongside a type taxonomy that needs to be region-neutral, was an
inconsistency worth fixing while the schema is still young rather than carrying it as permanent debt.
Classification is many-to-many (not a single column) because one vehicle type is legitimately "US
Class 8 AND EU N3 AND China Heavy Truck AND India HCV" simultaneously — every region has its own
scheme, codes, and weight bands.
**Rules out:** Keeping `trucks` as the table name once its type system needed to be international;
a single `gvwr_class` text column on the type (can't hold multiple regions' classifications at once).

### S9 — Roles and languages are reference/display tables, not foreign keys; language inherits carrier → user
**Decision (2026-07-21):** New `roles` (code/label/abbreviation/color_token, seeded with all 7
`profiles.role` values) and `languages` (code/label/native_name/flag_emoji, seeded with all 4
`profiles.preferred_language` values) tables exist purely so the UI has real seed data to render
consistent names/badges/pickers from. Neither is a foreign key — `profiles.role`/
`profiles.preferred_language` keep their existing `CHECK`-constrained `TEXT` columns as the actual
enforced value, since every RLS policy already keys off that exact value and converting to a real FK
would touch all of them for a display-only benefit. Separately: `carrier_details.default_language`
(new column) now gives language the same carrier→user inheritance `uom_system` already has (S7/L3) —
`profiles.preferred_language` is now nullable, and `NULL` means "inherit the carrier's default,"
identical semantics to `uom_system`, not a new pattern.
**Why:** `profiles.role`/`preferred_language` had zero reference/display data anywhere before this —
every screen either hardcoded a label/color or printed the raw value. And `preferred_language` never
had a carrier-level default to inherit from at all (unlike `uom_system`), so a Spanish-speaking
owner's own language preference had no way to become the default for new team members.
**Drift risk, noted explicitly:** adding a role or language means updating the `CHECK` list AND the
corresponding table row together, or the new value silently has no display data.
**Rules out:** Converting `role`/`preferred_language` to real foreign keys; rendering `roles.label`/
`vehicle_types.label` directly in UI (they're English-only dev/fallback data — actual rendering routes
through the locale-aware message catalog, keyed by `code`).

### S10 — Photo/document coverage extended to every entity, including compliance documents "as they'd appear physically"
**Decision (2026-07-21):** Every entity type now has a real photo path: `profiles.avatar_path`
(drivers, mobile-captured only), `vehicles.photo_path` (both mobile DVIR-flow capture and web upload),
`vehicle_types.generic_photo_path` (fallback stock photo), and `organizations.logo_path` (carrier +
customer org branding, web-only — invoices, public tracking page, customer directory). Separately,
compliance documents get real upload/display UI where the schema already existed but nothing was ever
built against it: `vehicle_documents` (registration/insurance/DOT authority/annual inspection) and
`org_documents` (COI/general liability/workers' comp/MC authority/DOT cert/UCR/W9/business license)
both had `storage_path`/`expiry_date` columns with zero UI anywhere until now. A new `driver_documents`
table (mirroring the same shape) adds an actual CDL/medical-cert photo scan, distinct from the
structured `drivers.cdl_expiry`/`cdl_class` fields a CDL-card UI already renders. `service_logs` gets
a `receipt_path` column for the shop's actual receipt/invoice.
**Why:** Found by directly auditing "do we have photos for people/vehicles/orgs, and do compliance
documents render as they'd physically appear (a scan/photo), not just re-typed data" — `org_documents`
specifically was a real functional gap, since the exceptions system (P2 amendment, S11) already
planned to alert on its expiry data with no way to ever create a row.
**Rules out:** Treating a stylized data-driven "CDL card" component as equivalent to an actual photo of
the physical license — they're different things and both are now built.

**Amendment (2026-09-26):** `profiles.avatar_path` is now self-service for every authenticated user on
both web and mobile. Capture may originate from the native camera/library or a web file picker; both
clients use the same `/api/v1/me/avatar/uploads` → direct signed PUT → `/api/v1/me/avatar` finalize
contract. The original "mobile-captured only" wording described the first UI, not a permanent product
restriction. Profile photos remain private and are still distinct from compliance-document scans.

### S11 — Tier entitlements: `tiers`/`features` master data + a real, RLS-usable `has_feature()` gate
**Decision (2026-07-21):** New `tiers` table (starter/growth/pro/enterprise, cumulative by `rank`, not
a many-to-many join — real pricing per BR-24/PR1: $49/$99/$199/$349 with included-truck counts) and
`features` table (`key`, `min_tier`) back a `has_feature(feature_key)` SQL function — `SECURITY
DEFINER`, callable from RLS policies directly (same idiom as `my_org_id()`/`my_role()`), not just an
app-layer JS helper. `carrier_details.tier` is unchanged; `tiers` is master data its values resolve
against.
**Why:** Found by directly asking "do we have a data model for tiers" mid-session — the honest answer
was no: `carrier_details.tier` was purely display data (`billing/page.tsx` renders a label, every new
org hardcodes to `'starter'` forever), with zero enforcement anywhere and no upgrade/downgrade flow.
Every Growth/Pro feature documented in the BRD (mockups 17-21, and now the exceptions system's gated
depth — P2 amendment) needs this to exist before being built, not retrofitted after. This was the
cheapest possible moment to add it: nothing built yet needs gating retroactively.
**Rules out:** Building any future Growth/Pro feature (IFTA hub, fuel logging, driver chat, desktop
command center, or the exceptions system's gated depth) without a `has_feature()` check from the
start.

**Amended 2026-07-21 — foundational gaps found and closed the same day, per explicit direction not to
defer them:**
- **Dispatcher/Finance role assignment was completely unenforced**, on BOTH paths that can set it —
  confirmed by reading the code directly: `app/api/team/invite/route.ts` (inviting a new member) and
  `app/api/team/[id]/route.ts` (re-roling an existing one) both offered `dispatcher`/`finance` with no
  tier check at all, contradicting BRD §9's "Dispatcher/Finance are Growth+" role table. Both now call
  `has_feature('dispatcher_finance_roles')` (new `features` row, `min_tier: 'growth'`) via RPC on the
  caller's own session client — verified live: blocked with `TIER_UPGRADE_REQUIRED` on a Starter org,
  allowed on Growth (confirmed both branches via a direct SQL simulation of `has_feature()`, not just
  code review).
- **`tiers.included_trucks`/`price_per_additional_truck` were stored but never surfaced anywhere.**
  `/billing` now shows fleet usage against the current tier's included-truck count and the resulting
  overage fee — informational only, matching BR-9's actual "included then billed per extra truck"
  model, not a hard block on adding vehicles past the included count.
- **No upgrade/downgrade flow existed at all.** Added a demo-mode tier-change flow (`/api/billing/
  change-tier`, same seam philosophy as T12's `createStripeCustomer()` stub) with a real tier-
  comparison UI on `/billing` showing all 4 tiers — verified live end-to-end (Starter → Growth →
  Starter round trip, fleet-usage figures updated correctly at each step).
- **A real, separate bug found during this pass, not a tier-model gap but caught while verifying
  one:** every table added this session (`vehicle_types`, `tiers`, `features`, `roles`, `languages`,
  `vehicle_classifications`, `vehicle_type_classifications`, `driver_documents`) had correct RLS
  policies but **no base `GRANT` for `authenticated`/`service_role`** — Postgres requires the table
  privilege before a role even reaches RLS, so every query on these tables was silently returning zero
  rows, no error. Fixed with a blanket `GRANT ... ON ALL TABLES IN SCHEMA public` in `schema.sql`
  (SECTION 8c) — see `supabase/schema/README.md` for the full account; this also makes a fresh
  `supabase db reset` self-sufficient, replacing a previously undocumented manual step.
- **Enterprise's "white-label + dedicated support" (PR1) has no functional definition anywhere** — no
  custom domain, no branding-removal mechanism, nothing. Explicitly NOT built this pass (confirmed with
  the user): inventing schema for an unspecified feature risked building the wrong thing. Moved to
  OPEN QUESTIONS below — needs real product scoping before any data model is added for it.

---

### S12 — Load cancellation, pill-shaped status badges, and closing out the truck→vehicle rename
**Decision (2026-07-21):** Three small, mechanical gaps closed together because they collided on the
same ~10 files (per the plan's own collision map — 1B/3A had to land before Phase 4 touched these
pages again):
- `'cancelled'` finished as a real load status. The DB `CHECK` constraint already allowed it, but the
  app layer didn't: `VALIDATION_ERROR`'s `VALID_STATUSES` array, every page's local `STATUS_COLOR` map,
  `DispatchPanel.tsx`'s status flow, and mobile's `STATUS_KEYS` all needed the value added. Cancelling
  is a terminal branch off the normal flow, not a pipeline step — `DispatchPanel` gets a separate
  "Cancel Load" action (muted rose, `window.confirm()`-gated, hidden once a load reaches a terminal
  status) rather than folding it into the forward `NEXT_STATUS` chain.
- Every status/invoice-status badge across dashboard/loads/invoices/drivers/maintenance/tracking
  switched from `rounded` to `rounded-full`, per `design-tokens.md`'s pill-badge spec (this had been
  documented since the original mockup pass but never actually applied).
- A repo-wide sweep of leftover **display text** still saying "Truck(s)" months after the underlying
  `trucks`→`vehicles` rename (S8) — sidebar nav label, dashboard KPI label, and ~30 message-catalog
  values across drivers/vehicles/billing/maintenance namespaces in all 4 web locales + 1 mobile locale.
  Deliberately left the JSON **keys** unchanged (`defaultTruck`, `truckCount`, etc.) — renaming those
  would mean touching every call site for a display-text-only fix.
**Why:** all three were genuine "planned but never executed" gaps, not new scope — found by directly
verifying the plan's own claims against the running app rather than assuming a completed-sounding
phase name meant the work was actually done.
**Verified:** live browser pass confirmed pill shape, cancel flow (including the confirm-dialog
cancel-out-safely path), and a final `grep -rli "truck"` across both apps returning only Material
Symbols icon keys (`fire_truck` — an immutable icon identifier, not this app's terminology) and the
general English word "trucking" (a domain term, e.g. "trucking company" in the load-extraction system
prompt) — both correctly left alone.

### S13 — Phase 4: structural UI rework across load detail, loads list, dispatch, dashboard, drivers, vehicles
**Decision (2026-07-21):** The single largest mechanical/visual pass this project has done in one
session, built as 8 parallel workstreams on non-overlapping files:
- **Load detail** (`loads/[load_number]/page.tsx`): rate pulled out into a large hero card (still
  gated to owner/solo/finance — never shown to dispatcher/driver, same confidentiality rule as
  everywhere else), a compact route-strip (pickup dot → line → delivery dot) replacing plain text, the
  existing status-pipeline stepper dimmed/greyed with a distinct terminal badge when a load is
  cancelled (rather than looking identical to an unstarted draft), and a new 2×2 action grid (Share
  Tracking — copies the existing-but-never-linked `/track/[token]` URL; Rate Confirmation — scrolls to
  the existing Documents section, no new doc-generation built; Edit Load — disabled with a "coming
  soon" tooltip, no load-edit UI exists yet; Cancel Load — same handler as the sidebar's existing
  button, not duplicated).
- **Loads list** (`loads/page.tsx`): rebuilt from a flat table into status-grouped cards (Needs
  Dispatch / In Progress / Completed / Cancelled, empty groups hidden) with filter chips
  (`?status=` param, real and shareable) and an inline "Dispatch →" action on cards needing it.
- **DispatchPanel**: the two plain `<select>`s replaced with avatar-card pickers (initials-only —
  `profiles.avatar_path` exists but has no upload UI on web yet, mobile-only per S10), plus a
  previously-dead capability wired up for the first time: selecting a driver with a
  `drivers.default_vehicle_id` set now auto-fills that driver's default vehicle (only if the vehicle
  field is still empty, never overwriting a manual pick).
- **Dashboard**: 4 KPI cards → Active Loads, Revenue MTD, Outstanding Invoices, Avg Rate/Load, plus 2
  breakdown cards (Fleet Active/Idle/In-Shop, Driver Compliance Clear/Due-Soon/Incomplete) replacing
  flat counts — the first real UI consumer of `vehicles.status` (S8) and the CDL/med-cert expiry
  columns for anything beyond raw display.
- **Drivers list**: a CDL-card element (class badge, expiry date, a glow-dot status indicator using
  new `--shadow-glow-danger` alongside the existing success/warning glow tokens) and bordered
  endorsement badges — the first UI for `drivers.cdl_class`/`endorsements`, which existed as columns
  with no rendering anywhere before this.
- **Vehicle type system, finally wired to the UI**: `vehicle_types`/`vehicle_type_id` had existed at
  the schema level since S8, but `AddVehicleButton.tsx` had no type picker and the API route silently
  ignored `vehicle_type_id`/`cab_type`/`color`/`dimensions`, hardcoding every new vehicle to `'semi'`
  — a real, load-bearing gap found by an agent explicitly told not to touch the route, then fixed by
  hand: `POST /api/vehicles` now validates `vehicle_type_id` as required *before* burning a sequence
  number (the same ordering bug already fixed once in `/api/loads`), and persists all four fields. 7
  new custom SVG vehicle-type icons + 5 maintenance service-type icons built (`components/icons/`) —
  the icon-system split from V4 (Material Symbols everywhere except these two contexts), implemented
  for the first time.
- **Maintenance list**: due-date progress bars on reminders — deliberately **omitted** for
  mileage-only reminders, since no live current-odometer feed exists anywhere in this schema to
  compute a real percentage against (flagged by the building agent rather than fabricating a fake
  number).
- **Language picker + role badge**: `LanguageSwitcher.tsx` rebuilt as a flag/native-name card picker
  sourced from the `languages` table (L1's `native_name`/`flag_emoji`, never the English `label`
  column); `Sidebar.tsx`'s role display now pulls `abbreviation`/`color_token` from the `roles` table
  (S9) with the label rendered via `t('roles.'+code)`, never the DB's English fallback column. Found
  and fixed a real gap while building this: the `languages` table's RLS policy only granted
  `authenticated`, so the logged-out `/login` page's picker (which needs to work before
  authentication, per L2) would have silently rendered empty — added an `anon` policy + base grant.
**Why:** every one of these had schema/data sitting unused (vehicle types, CDL fields, avatar paths,
default-vehicle FK, glow tokens, the languages/roles tables) — this phase was specifically about
connecting already-built data to a UI that had never been built for it, not new schema.
**Verified:** each workstream browser-tested live against the persistent demo account (and, for the
vehicle-type fix specifically, an actual end-to-end vehicle creation confirmed via direct SQL that
the chosen type/cab/color/dimensions all persisted correctly — not just that the form submitted).

### S14 — Phase 5: role-differentiated home screens, web and mobile
**Decision (2026-07-21):** Per-role home screens on both platforms, the single largest scoped item in
the whole plan (mockup-15's own five-phone-frame design, never reflected in the running app before
this).
- **Web** (`dashboard/`): split into `OwnerView`/`SoloView`/`DriverView`/`DispatcherView`/`FinanceView`,
  `page.tsx` reduced to a role router. Dispatcher/Finance omit content outside their existing
  visibility rules (no rate/revenue for dispatcher, no fleet-management cards for finance). Finance
  gained a real invoice-aging breakdown (current/30+/60+/90+ days past due) that didn't exist before.
  **Solo hybrid case:** a `solo` user is both owner-equivalent and often their own driver — if they
  currently have an active load assigned to their own `drivers` row, a compact "My Load Today" card
  renders above the normal owner dashboard; otherwise it's the owner dashboard alone.
- **Mobile**: replaced the single universal 2-tab layout (`Home` + a settings tab, every role
  identical) with a role-branched tab bar — Owner/Solo → Home/Loads/Alerts/Fleet/More; Dispatcher →
  Home/Loads/Alerts/Fleet/Customers; Finance → Home/Invoices/Customers/Reports/More; Driver → My
  Load/DVIR/History/Profile. New screens for all of Loads, Alerts (real `get_exceptions()` data, not a
  placeholder), Fleet, Customers, Invoices, Reports (a genuine "coming soon" — no reporting feature
  exists anywhere yet, not stubbed data), a DVIR-start landing page, History, and Profile/More
  (absorbing the old settings/language-picker screen). Dispatcher's "ops board" Home flags a load
  stale after 4+ hours with no status update — a real, if simple, business rule with no prior
  definition anywhere in the schema or docs, decided during this pass rather than left unscoped.
**Why:** mockup-15 turned out to be mobile-first (five 390×812 phone frames), not a web layout
reference as originally assumed — the web dashboard KPIs (S13) trace back to its Owner screen, but its
actual subject (per-role mobile navigation) had never been built.
**A real regression caught before it shipped:** removing the old universal `index.tsx` (its content
moved to become the new `Loads` tab) left the root `/` redirect pointing at a route that no longer
existed. Fixed with a new `index.tsx` that resolves the user's role and forwards to that role's first
tab. Also found and updated `app-tabs.web.tsx` — a second, Expo-web-preview tab-bar implementation
that would have silently kept pointing at the deleted route had it not been checked.
**Verified:** both Owner and Driver roles browser-tested live end-to-end on mobile (via the Expo web
preview) against real demo data; Dispatcher/Finance verified via code/RLS-policy review only, since no
demo account exists for either role and throwaway accounts weren't created for a mobile-only check.

### S15 — Phase 6: management by exception — detail pages, tiered inbox, health score, automated reminders
**Decision (2026-07-21):** The exceptions system, split into 6 parallel workstreams. Two real
foundational gaps were found and fixed as part of this pass, not deferred:
- `exception_events` (used by several of the pieces below) existed in `schema.sql` but had **never
  actually been applied to the live database** and was missing its base `GRANT` — the same class of
  bug T11/S11 already hit once, caught again here before it silently broke everything downstream.
- `get_exceptions()`'s own compliance-document branch mislabeled the carrier's own org documents as
  `entity_type = 'customer'` (a copy-paste leftover) instead of `'organization'` — harmless today (no
  page filters exceptions by that specific entity type, only the aggregate inbox/banner do, and those
  don't filter by type at all) but would have silently broken any future per-entity view for the
  carrier's own compliance docs. Fixed in the same function, verified via a full schema replay.

**What shipped:**
- **Vehicle/driver/customer detail pages** — none existed before this pass, only list pages. Vehicle:
  Details/Load History/Maintenance/DVIRs tabs + new `VehicleDocuments.tsx`. Driver: Profile/Doc
  History/Loads/DVIRs tabs + new `DriverDocuments.tsx` (rendered as a timeline, not a flat list —
  the point of that tab is showing CDL/med-cert scan history over time). Customer: Overview/Loads/
  Exceptions/Invoices tabs, plus `get_customer_health_score()` (70% on-time-payment rate + 30% inverse
  recent-exception-frequency, both 0–100) gated `Growth+` via `has_feature('customer_health_score')`
  with a locked upsell teaser on Starter (no `<FeatureGate>` component existed yet — built inline for
  this single usage rather than introducing a new shared component speculatively).
- **Tiered exceptions inbox** (`/exceptions`): grouped by tier (Today/This Week/Upcoming), each item
  with a real wired CTA where one exists (invoice-overdue → the invoice; missing-POD → the load;
  maintenance-due → `/maintenance`) and correctly no CTA for document-expiry types, since
  `/documents` is itself still a placeholder page — not a broken link. Starter truncates to the top 3
  items with an "N of M — upgrade" banner (M always the true count, per BRD FR-18.1's exact wording);
  Growth+ sees everything. Lightweight ungated summary banners (count + top item + link) added to the
  Owner/Solo/Dispatcher dashboards — detection stays visible at every tier, only the full inbox depth
  is gated, per this app's own "safety/compliance never gated" principle (P2).
- **Inline exception chips** on the vehicles/drivers/customers list pages (web) and Fleet/Customers
  tabs (mobile), plus wiring row-links to the new detail pages that didn't exist until this same pass.
- **Automated reminders**: `send_expiry_reminders()` (`SECURITY DEFINER`, `service_role`-only, reusing
  `get_exceptions()`'s own day-count thresholds for consistency) detects newly-expiring CDLs/med-certs/
  vehicle+org docs and writes `exception_events`, deduped 24h; `POST /api/cron/send-reminders` invokes
  it and emails each affected org's owner/solo users via the existing `send-email.ts` (T13) — verified
  against the real local SMTP relay (Mailpit), not a stub claim. **Explicitly NOT wired up**: no
  scheduler (`pg_cron` — confirmed not installed on this local instance — or an external scheduler like
  AWS EventBridge Scheduler, per architecture/deployment.md) actually calls this on a timer yet. That's a real, unmade deployment decision, flagged
  rather than silently assumed done just because the underlying logic works.
**Why:** `get_exceptions()` and the `features` gating rows already existed (S11) — this phase was
about building the actual front end and the surrounding detail-page infrastructure it needed, which
turned out to be substantially larger than "a function and a banner" (the original, narrower scope
this work replaced — see the old S-series note in the plan file for that correction).
**Verified:** every piece browser-tested live; the customer health score's locked/unlocked states were
both exercised by temporarily bumping the demo org's tier and restoring it afterward; the reminder
function's dedup behavior confirmed by calling it twice in a row and observing zero new rows the
second time.

### S16 — Customer contacts (`customer_contacts`) + a system-wide deactivate-not-delete rule
**Decision (2026-07-22):** A customer is one organization with one or more contacts; any contact may
optionally be granted portal login. New `customer_contacts` table (`org_id`, `carrier_org_id`, `name`,
`email`, `phone`, `title` — free text, not this app's own role enum — `is_primary`, nullable
`portal_profile_id` FK to `profiles`). Portal access is granted via a new carrier-initiated invite route
(`POST /api/customers/[org_id]/contacts/[contact_id]/invite`, mirroring `app/api/team/invite`'s
admin-client magic-link pattern exactly) that creates a real `profiles` row with role `customer_admin`
or `customer_viewer` — both real values in `profiles.role`'s `CHECK` list with real RLS policies
(`customer_loads_select`, `customer_invoices_select`) for a long time before this pass, but with
**zero code anywhere that ever created a profile with either role**. This closes that gap.

**Alongside it, a system-wide rule, not scoped to just this feature:** key entities (team members,
portal contacts, and — per the user's explicit generalization — drivers/vehicles/customers/companies)
are deactivated, never hard-deleted, so historical records stay intact. `profiles.is_active BOOLEAN
DEFAULT true` is new; `my_org_id()`/`my_role()` (the two SQL helpers nearly every RLS policy in this
schema is built on) now both filter `is_active = true`, so a deactivated user is transparently denied
by every policy that calls them — one change, cascades everywhere, no per-policy edits needed for the
majority of the schema. The two customer-portal policies above predate those helpers (they subquery
`profiles` directly), so they got the same `is_active = true` check added by hand. Revoking a contact's
portal access (`POST .../revoke`) deactivates the linked profile and nulls `portal_profile_id` — it
never deletes either row.

**Why:** `customer_details.contact_name`'s own pre-existing comment ("primary contact for non-portal
customers") already anticipated this exact split but nothing ever built the portal-login half. The
deactivate-not-delete rule was stated by the user specifically about portal users, then explicitly
generalized ("this applies to all key entities... company, customer, driver, etc.") — `is_active` is
added now, at the first point a real removal/revocation feature actually needed it, rather than
speculatively ahead of need.

**What this does NOT cover, flagged rather than silently assumed complete:** a handful of older RLS
policies (`owner_solo_loads_all`, `dispatcher_loads_select`/`_update`/`_insert`, `finance_loads_select`/
`_update`, `driver_own_loads_select`, `billing_invoices_all`) predate `my_org_id()`/`my_role()` entirely
and subquery `profiles` directly with no `is_active` check at all — deactivating an owner, dispatcher,
finance user, or driver today would NOT lock them out through these specific policies. If "deactivate a
team member" (as opposed to just a portal contact) is ever built as its own feature, these need the same
treatment first.

**Verified live end-to-end (not just code review):** invited a real contact, confirmed the `profiles`
row and `portal_profile_id` link were created correctly with `is_active = true`; revoked access;
confirmed via direct SQL that both the `customer_contacts` row and the `profiles` row still exist
(`portal_profile_id` nulled, `is_active = false`) and that `my_org_id()`/`my_role()` correctly return
nothing for that now-deactivated user.

**Rules out:** Hard-deleting a `profiles` row (or any other key-entity row) as the mechanism for
"removing" someone. Adding a `platform_admin`-style role by reusing `profiles.role` (that question
belongs to the SuperAdmin design pass, not this one — see OPEN QUESTIONS).

**Amends R4** below — the "same app, role-based" customer-portal decision was correct in principle but
had never actually been implemented; this is the pass that connects it to something.

---

## TECHNICAL

### T1 — Next.js 16 with proxy.ts (not middleware.ts)
**Decision:** carrieros-web runs Next.js 16.2.10. Middleware file is `proxy.ts` with `export async function proxy(...)` and `export const config = { matcher: [...] }`.
**Why:** Next.js 16 renamed middleware to proxy. Using `middleware.ts` silently does nothing — the old filename is ignored. This cost significant debugging time; it is now locked.
**Rules out:** Using `middleware.ts` or `export default function middleware`.

### T2 — Supabase local dev for all development
**Decision:** All development uses `supabase start` (Docker) with local Postgres, Auth, and Studio. No cloud project until production deployment.
**Why:** No cost, no network latency, full reset capability (`supabase db reset`), schema iteration without affecting real data.
**Gotcha:** After every `db reset`, must manually run GRANT statements and CREATE POLICY for profiles SELECT (local Supabase doesn't auto-grant).

### T3 — createAdminClient() for onboarding writes
**Decision:** `app/api/onboarding/route.ts` uses `createAdminClient()` (service role key, bypasses RLS) for all 3 DB writes: organizations, carrier_details, profiles.
**Why:** A user completing onboarding has no org_id yet. All membership-based RLS INSERT policies require org membership to pass — which creates a bootstrapping paradox. Admin client sidesteps this for the one-time setup only.
**Rules out:** RLS INSERT policies as a solution for onboarding writes.

### T4 — proxy.ts skips org_id check for /api/ routes
**Decision:** The new-user-without-org redirect in `proxy.ts` has a `!pathname.startsWith('/api/')` guard.
**Why:** Without this, POST /api/onboarding gets intercepted by the proxy, which sees no org_id, and redirects to GET /onboarding — so the API call never reaches its handler. API routes handle their own auth checks internally.

### T5 — @supabase/ssr for all server-side auth, @supabase/supabase-js for admin only
**Decision:** Server Components and Route Handlers use `createServerClient` from `@supabase/ssr` (cookie-based session). Only `createAdminClient()` uses `@supabase/supabase-js` directly with the service role key.
**Why:** `@supabase/ssr` handles cookie refresh automatically (required for Next.js App Router). The admin client never needs cookie management since it authenticates via API key.

### T6 — Claude Haiku for load extraction
**Decision:** `app/api/extract-load/route.ts` uses `claude-haiku-4-5` via `@anthropic-ai/sdk` to parse load details from pasted text (rate confirmations, emails, PDFs).
**Why:** Haiku is fast and cheap enough for per-keystroke or per-paste extraction. Structured output via system prompt with JSON schema. Extraction runs server-side so the API key is never exposed.

### T7 — Never scaffold with AI
**Decision:** New apps and projects are always scaffolded locally via Terminal (`npx create-next-app`, `npx create-expo-app`). AI writes individual files after scaffolding.
**Why:** AI-generated full codebases have subtle config errors (wrong tsconfig targets, missing postcss setup, wrong tailwind paths) that are hard to debug. The scaffold tools produce a known-good baseline.

### T8 — Expo for mobile driver app
**Decision:** Mobile driver app uses Expo (React Native) with Expo Router for file-based navigation.
**Why:** Shared codebase for iOS + Android. Expo Router mirrors Next.js App Router patterns, keeping mental model consistent across web and mobile. EAS Build handles distribution.

### T9 — Mobile RTL (Urdu) requires an app restart; web does not
**Decision:** `carrieros-mobile` calls `I18nManager.allowRTL/forceRTL` on locale switch, but this is a React Native platform limitation, not a bug: native iOS/Android only mirror layout after the app fully restarts, not on the next JS render. `carrieros-web` has no such limitation — `dir="rtl"` on `<html>` mirrors immediately.
**Why:** This is baked into React Native itself; no library or workaround changes it. Documented at the call site (`src/hooks/use-locale.tsx`) so it isn't "rediscovered" as a bug in a future session. The web preview target additionally flips `document.documentElement.dir` directly (react-native-web's own RTL flags are a no-op in a browser tab), purely so RTL is visually verifiable without an actual device restart.
**Implications:** Any UX copy or first-run flow for Urdu-preferring drivers on native should account for a restart prompt after language selection. Not yet built — currently just a code comment.

### T10 — i18n-js interpolation syntax is `%{name}`, not `{name}`
**Decision/gotcha:** `carrieros-mobile`'s i18n-js library only recognizes `%{name}` (or `{{name}}`) placeholders — a translation string written as `{name}` (the syntax `next-intl` uses on web) is left completely un-interpolated, silently, with no error.
**Why worth logging:** Cost a full debug cycle once (2026-07-20) — the string rendered as literal `{unit}` in the UI. Since both apps' `messages/*.json` files are maintained side by side and easy to copy-paste between, this is a likely recurrence point. Web (`next-intl`) uses single-brace `{name}`; mobile (`i18n-js`) needs `%{name}` — they are not interchangeable.

### T11 — Storage: one private `documents` bucket, org-id as the first path segment
**Decision (2026-07-20):** All uploaded files (POD photos, BOLs, rate cons, DVIR defect photos) live
in a single **private** bucket `documents`. Path convention is
`{carrier_org_id}/loads/{load_id}/{filename}` and `{carrier_org_id}/dvir/{inspection_id}/{filename}`
— the first path segment is **always** the carrier org id, and every `storage.objects` policy keys on
`(storage.foldername(name))[1] = my_org_id()::text`. Reads are signed URLs only, never public URLs.
**Why:** One bucket + a path convention means one set of policies to reason about instead of a bucket
per entity type. Keying on the first path segment makes tenant isolation a property of the path
itself, so a new file type only needs a new second segment, not new policy work. `my_org_id()` is the
existing SECURITY DEFINER helper — using it avoids the recursive-RLS trap that broke `profiles`
(see resume.md, 2026-07-19).
**Deliberate asymmetry:** INSERT/SELECT are open to any org member, but UPDATE/DELETE are restricted
to `owner`/`solo`. A driver must not be able to delete a POD after uploading it — that file is the
carrier's proof of delivery and its audit trail.
**Rollback path (resolved 2026-07-20):** because a driver cannot DELETE, a driver whose upload
succeeded but whose `documents` insert failed could not clean up its own orphan. Solved with a
fifth policy, `member_deletes_orphan_docs`: any org member may delete an object **only while no
`documents` row references it**. The moment the row exists, the object is filed proof and the policy
stops applying — so drivers still cannot delete a real POD.
**Why a policy and not a cleanup RPC** (the first attempt, discarded): `storage.protect_delete()`
blocks a direct `DELETE ON storage.objects` because removing the metadata row does **not** remove the
file bytes from the storage backend — it would orphan the actual blob. Deletes must go through the
Storage API, so the orphan condition has to live in a policy the API evaluates, not in
`SECURITY DEFINER` SQL that bypasses it. Verified all four paths: driver deletes orphan (200),
driver denied on a filed POD (403), owner deletes a filed POD (200), object row and bytes both gone.
**Rules out:** A public bucket with unguessable filenames; per-carrier or per-entity buckets; letting
drivers delete their own uploads.

**Amendment (2026-09-26):** Profile photos follow the same single-bucket rule. Their path is
`{carrier_org_id}/profiles/{profile_id}/avatar-{uuid}.{extension}` in the private `documents` bucket.
The API authorizes the path and verifies the upload before updating `profiles.avatar_path`; clients
never write the database or call storage for application state. A profile owner may replace/delete
their own avatar, while org members may receive only short-lived signed download URLs through the
existing application/API boundaries.

### T12 — Stripe billing built as a demo seam, no real Stripe account yet
**Decision (2026-07-20):** `lib/stripe.ts`'s `createStripeCustomer()` is the entire integration
surface. Today it makes no network call at all — it simulates success using Stripe's own published,
non-functional test constant (card `4242 4242 4242 4242`) and writes a masked "VISA •••• 4242" plus a
`demo_cus_...` id onto `carrier_details`. The `/billing` page and its API route are real and fully
built (auth, validation, DB write); only that one function's body is a stand-in.
**Why:** There is no Stripe account yet, and per decisions.md P4/PR2's amendment, carriers (including
CA pilot) now need a card on file before the app can bill them. Building the real flow around a stub
function — rather than waiting for an account to build anything — means swapping in the real
integration (a Stripe Customer + Checkout Session in `setup` mode, a webhook writing the real id) is a
change to one function body, not new architecture.
**Rules out:** Any UI field that could be mistaken for a real card-number/CVV/expiry input, demo or
not — "adding a card" is a single button, nothing is ever typed in.

### T13 — Invoice email sends for real, via local Supabase's SMTP relay
**Decision (2026-07-20):** `lib/send-email.ts` is a genuine SMTP send (via `nodemailer`), not a mock.
Locally it defaults to the Mailpit/Inbucket relay `supabase start` already runs for auth emails
(`SMTP_HOST`/`PORT` default to `127.0.0.1:54325`, that port newly published in `supabase/config.toml`).
`markInvoiceSent` calls it before flipping `invoices.status` — a failed send returns
`EMAIL_SEND_FAILED` and the invoice stays untouched, it does not silently mark itself sent.
**Why:** Given there's no email provider account yet either, mocking the send was the obvious option
— but local Supabase already runs a real mail relay, so an actually-real send (to a locally-captured
inbox, viewable at `http://127.0.0.1:54324`) cost no more effort than a fake success message would
have, and is honest rather than simulated. Production is `SMTP_HOST`/`PORT`/`USER`/`PASS` pointed at a
real provider (Resend suggested) — an env-var change, not a rewrite.
**Rules out:** A "Mark as Sent" that claims an email went out without actually sending one.

### T14 — Public developer API: OAuth 2.0 client-credentials, not API keys
**Decision (2026-09-21):** External developers authenticate to the public API as an organization via
an OAuth 2.0 client-credentials grant (`client_id`/`client_secret` → short-lived signed JWT), not a
static API key header. Supersedes `strategy/prd.md`'s original "API key auth (not OAuth)" line (v2.0),
which is amended, not silently overwritten — see that file's own v2.1 changelog entry.
**Why:** Asked directly when scoping Phase 9's first build pass; the choice was OAuth specifically for
rotatable/scoped credentials and closer alignment with how enterprise integrators expect a B2B API to
authenticate, accepting the extra implementation cost (a token endpoint, JWT signing, client secret
hashing) over an API key's simplicity. The PRD's original API-key call wasn't wrong when written — it
just wasn't revisited against this tradeoff until this decision.
**Rules out:** A bare `Authorization: Bearer <static-api-key>` scheme for the public API. Does not
affect internal `/api/v1` (web/mobile) or SuperAdmin auth — those remain session-based, unrelated to
this machine-to-machine grant.

### T15 — Passkey (WebAuthn) is mandatory, out-of-the-box, for every login, all roles
**Decision (2026-09-21, resolved same day as first raised):** Passkey/WebAuthn is **mandatory, across
the board** — every role (owner/solo/driver/dispatcher/finance, and platform staff/SuperAdmin), not an
opt-in discovered later in Settings. "Out of the box" means required as part of account setup, not a
separate feature a user has to find. One real technical constraint this bumps against: Supabase's
passkey registration API requires an already-confirmed, non-anonymous user — a passkey genuinely
cannot be the very first credential created during signup itself. Practical resolution: passkey
registration is a **forced step immediately after initial account confirmation, before the rest of
onboarding proceeds** — as close to "out of the box" as the underlying API allows, not silently
downgraded to "available in Settings" to dodge the constraint. Password/magic-link stays as the
fallback for devices/browsers without WebAuthn support (not every browser or old Android device has
it) — mandatory means "required to set up," not "the only possible credential ever," since a hard
password-only fallback ban would lock out real users on unsupported hardware.
**Why:** Chosen over TOTP for the still-open SuperAdmin 2FA gap (`production-gates.md` Gate 2→3,
unmet since Phase 8 shipped without it) — WebAuthn credentials are inherently phishing-resistant and
combine possession + biometric/PIN in one factor, and making it mandatory (not just available) is
specifically what closes that gate, since an optional-but-unused credential closes nothing.
**Scope consequence worth being explicit about**: mandating this for *every* role, not just platform
staff, means mobile's native-bridge work (see Feasibility below) is now required for MVP-level
completeness, not deferrable — driver/dispatcher/finance users are mobile-first. This is a real,
larger scope than "add a login option," and should be planned as its own build pass, not folded
silently into whatever else is in flight.
**Feasibility, checked directly (2026-09-21) rather than assumed:** `@supabase/supabase-js` is already
on 2.110.7 in both apps, comfortably past the 2.105.0 minimum Supabase's (experimental) passkey API
needs — web is a real, near-term build. Mobile (Expo/React Native) is a different story: Supabase's
passkey client support as of this writing officially covers `supabase_flutter` and `supabase-swift`
only, not React Native — carrieros-mobile needs a native passkey bridge library integrated against
Supabase's experimental API. Given the "mandatory across the board" resolution above, this is no
longer optional follow-on work — it blocks mobile users from completing account setup at all once
built, so it needs to land before mandatory enforcement ships, not after.
**Rules out:** Treating "add passkeys" as a single uniform task across web and mobile — they're
different-sized efforts with different feasibility today. Also rules out passkey as the *only* login
method anywhere for now (registration requires an already-confirmed account per Supabase's current
passkey flow, so it can't replace initial signup).

**Amended (2026-09-22) — reversed: passkey is available, not required.** Direct instruction: "allow
user to use passkey but it is not required." Passkey/WebAuthn is now an opt-in option a user can add
from Settings, same as before this entry's original framing rejected — no forced registration step
after signup, no "mandatory across the board" language. This actually matches what shipped (2026-09-21,
same session): the web build was already additive/opt-in only, never wired the forced-step-after-
signup flow this entry originally called for — the code didn't need to change to satisfy this
amendment, the decision needed to catch up to what was actually built.
**Real consequence, not silently dropped:** this entry's own "Why" tied *mandatory* passkey specifically
to closing the SuperAdmin mandatory-2FA gap (`production-gates.md` Gate 2→3) — "an optional-but-unused
credential closes nothing," this entry's own words. That reasoning still holds: making passkey optional
again reopens Gate 2→3 as genuinely unmet, with no other mechanism currently proposed to close it. Not
resolved by this amendment — flagged for a real decision next time SuperAdmin security is scoped, not
assumed solved.
**Also no longer true:** the "Scope consequence" paragraph above, which made mobile's native passkey
bridge library required-for-MVP once mandatory applied to mobile-first roles — with passkey optional
again, that urgency is gone. Mobile passkey reverts to a genuinely optional, lower-priority future
effort, not blocking anything.
**Rules out (addendum):** treating this as passkey being removed or deprioritized as a feature — it's
still real, built, and available; only the requirement that every user must set one up is reversed.

### T16 — In-app support ticketing with AI triage routing; resolves PR1's "dedicated support"
**Decision (2026-09-21):** Any authenticated user, any role, any tier, can submit a support ticket from
inside the app. On creation, a triage step (same `claude-haiku-4-5` / `@anthropic-ai/sdk` pattern as
T6's load extraction — fast/cheap classification, not a chat assistant) reads the ticket and the
submitter's own context (role, org, tier) and routes it to exactly one of three states:
- **`carrieros_support`** — CarrierOS's own tech-support queue, visible to `sx_support`/`sx_owner`
  platform-staff roles (SA1's amendment — these already exist, no new role needed). This is the
  "open support ticket" signal SA5's Triage Queue severity spec already anticipated as a Medium-tier
  exception but never had a real table behind — `app/(admin)/admin/page.tsx` (the existing Triage Queue
  page, SA2) is where these tickets surface, extending its existing urgency-bucket logic with a new
  signal rather than building a second, separate admin screen.
- **`org_support`** — the ticket's own carrier org's support staff, RLS-isolated the same way every
  other org-scoped table in this schema is (S5's `carrier_org_id` pattern) — a carrier's own team never
  sees another carrier's tickets, and never sees `carrieros_support`-routed tickets either.
- **`ai_resolved`** — the triage step generated and delivered an answer directly, above a confidence
  threshold, with no human touch. Never a dead end: an `ai_resolved` ticket still shows a "still need
  help?" action that reopens it into a real human queue (`carrieros_support` or `org_support`, whichever
  the original classification pointed at) — an auto-answer with no escalation path is a support failure
  mode, not a cost saving, regardless of how well the classifier is tuned.

**Tiering:** submitting a ticket and reaching `carrieros_support` (with AI triage/auto-answer active) is
available on **every tier** — this is baseline "get help with the product," withholding it from
Starter/Growth would be a retention/trust problem, not a real upsell. What's Enterprise-gated
(`has_feature('support_desk')`, same pattern as `branding_customization`, PR1) is **`org_support`
actually existing at all** — a carrier's own designated staff getting a real ticket queue, for their own
drivers/customers, inside the same mechanism. Below Enterprise, the classifier only ever chooses between
`carrieros_support` and `ai_resolved` — there is no third bucket to route into yet, so a Starter-tier
driver asking an operational question about their own dispatcher still reaches a human, just CarrierOS's
own support staff rather than their employer's, until their carrier upgrades. Who can staff an org's own
`org_support` queue: new `org_support_manage` capability, owner/solo by default — same default-grant
shape as `org_branding_manage` (migration 0026) and every other org-administration capability, not a new
pattern.
**This is the direct resolution to PR1's "dedicated support" half** — the previously-undefined other
half of Enterprise's original "white-label + dedicated support" line (branding was resolved separately,
2026-09-21 amendment above). "Dedicated support" now has a concrete meaning: an Enterprise carrier gets
their own support desk, running on infrastructure CarrierOS already built and operates, instead of
buying or building a separate helpdesk tool — a real cost-reduction argument for the tier, not just a
label.
**Cost, precisely:** the triage classification call itself runs on every tier's tickets (it has to, just
to know where a ticket goes) — that's an ordinary hosting/compute cost CarrierOS absorbs like any other
API route, not something itemized per tier. What Enterprise pricing actually covers is the thing that
costs something *additional*: the `org_support` queue and its staff console existing at all for that
org. Recorded this way deliberately rather than as "AI cost is covered by Enterprise" broadly, since
every tier generates real triage-classification cost the moment they submit a ticket, Enterprise or not.
**Why AI auto-resolution is trusted here:** explicit instruction ("trust AI if well setup") — read as
trust conditioned on the guardrail actually existing, not blind trust, hence the mandatory reopen path
above and a confidence threshold rather than always auto-answering.
**Not yet built** — this entry records the decision and scope; implementation (migration, RLS, the
triage integration, submit/track UI, and the two staff-facing queue views) is separate follow-up work,
same "decide first, build after" sequencing as every other entry in this file.
**Rules out:** A separate third-party helpdesk tool (Chatwoot/Zendesk/etc.) as the mechanism — evaluated
and explicitly rejected in favor of building this natively, since the codebase's existing auth/org/RLS/
entitlements plumbing already does most of the work a bolted-on tool would need bridged via SSO anyway.
Also rules out unconditional AI auto-close with no human escalation path, and rules out gating basic
tech-support ticket submission behind any paid tier.

### T17 — LLM calls go through a provider abstraction; SuperAdmin picks Anthropic / OpenAI / any OpenAI-compatible endpoint
**Decision (2026-09-21):** Both real LLM integrations (T6 load extraction, T16 support-ticket triage)
move off a hardcoded `@anthropic-ai/sdk` call onto a shared `lib/ai/` provider abstraction. A new
platform-wide (not per-org) config row picks which provider is active; a ShipmentX `sx_owner` changes
it from the SuperAdmin console. Three provider types, day one:
- **`anthropic`** — unchanged behavior, same SDK, now reached through the abstraction instead of
  directly.
- **`openai`** — new. Requested directly ("let us use openai api key instead of anthropic") as the new
  **default** provider.
- **`openai_compatible`** — a custom base URL + the `openai` SDK pointed at it. This is the pragmatic
  answer to "and open source": nearly every self-hosted/open-source inference server (Ollama, vLLM,
  LM Studio, and aggregators like OpenRouter/Together/Groq) speaks the OpenAI wire format, so one
  adapter covers "any open source model" without a bespoke SDK per project. A model genuinely
  unreachable this way is out of scope until a real one is named.
**What the abstraction actually normalizes — deliberately minimal:** only "send this
system/user/image content, get back `{text, inputTokens, outputTokens}`, classify the error into
`rate_limited`/`auth_error`/`provider_outage`/`unknown`." T6/T16's existing prompt-instructs-JSON +
manual `JSON.parse` (strip code fences, parse, validate) approach is kept as-is and moves unchanged —
not replaced with a provider-specific structured-output feature (OpenAI's `response_format:
json_schema`, Anthropic tool-use, etc.). Reason: those mechanisms differ enough per provider that
using each one natively would give each provider a different reliability/failure shape, undermining
the entire point of a swappable abstraction. The existing approach already works and is provider-
agnostic by construction — this decision does not change T6/T16's prompts, schemas, or business logic
(confidence thresholds, category overrides, etc.) at all, only which SDK sends the request.
**Where credentials live — a hard line, not a detail:** the DB config row selects a provider/model/
base-URL, never a credential. Each provider's actual API key stays exactly where every other secret in
this codebase lives — an environment variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`; the
`openai_compatible` key is optional, since local/self-hosted endpoints often require none), verified
present at call time with the same "throw a typed 'not configured' error" convention T6 already uses.
Storing a real API key in an app-writable table was never on the table — Postgres backups, replicas,
and every service-role query surface would expose it.
**Who can change the active provider:** new `admin_ai_config` capability, `sx_owner` only — same
scope as `admin_flags` (a platform-wide operational switch, not per-tenant), not opened to
`sx_finance`/`sx_support` despite this being cost-adjacent, since it also decides which outside vendor
sees ticket/load content, a materially different kind of decision than a billing override.
**Vision (image) extraction (`extractLoadFromImage`, mobile photo-intake) is in scope** — the
abstraction's content-block shape supports a text block and an image block from day one, not added
later as a special case.
**Rules out:** Storing any provider API key in the database, in any form. Building a bespoke SDK
integration per open-source project instead of standardizing on the OpenAI-compatible wire format.
Changing T6/T16's actual prompts, schemas, confidence thresholds, or category-override logic as part
of this migration — this is a transport-layer swap only.

**Amended (2026-09-22) — key management moves into the SuperAdmin console too, encrypted, not
plaintext:** the original "environment variable only" line meant every key rotation required someone
to touch AWS Secrets Manager / `.env.local` directly — a real deployment blocker this decision didn't
anticipate, correctly pushed back on directly ("LLM key should not be blockers as they should be part
of admin settings"). Resolution: `sx_owner` can now set/rotate each provider's API key from the same
`/admin/ai-config` page, **encrypted at rest**, not a plaintext column — the "never a raw credential
in Postgres" reasoning above still holds; what changes is *how* that's achieved. App-layer AES-256-GCM
(Node's `crypto`, not Postgres `pgcrypto` — the plaintext key never has to cross into a SQL statement
at all this way) using one new dedicated env var, `SECRETS_ENCRYPTION_KEY`, set once as real one-time
infrastructure — routine key rotation afterward never touches the environment again. The GET endpoint
returns only a masked preview (e.g. last 4 characters) of a configured key, never the full value —
same convention as GitHub PATs/Stripe keys, no "reveal" affordance at all, since an admin browser
session is a real exposure surface a masked-preview avoids. An environment variable remains a valid
fallback (checked when no encrypted DB value is set) so existing `.env.local`-based local dev and
already-deployed environments keep working unchanged — this is additive, not a replacement.
**Rules out (addendum):** a plaintext key column, a "reveal full key" affordance anywhere in the
admin UI, and treating this amendment as license to store any OTHER kind of credential in the database
without the same encrypted-at-rest treatment.

### T18 — Apple/Google sign-in uses OAuth, not a bespoke integration
**Decision (2026-09-22):** The PRD's Signup requirement ("Account creation via email/password or
Apple/Google SSO") is implemented as standard OAuth 2.0 sign-in — Supabase Auth's built-in
`signInWithOAuth({ provider: 'google' | 'apple' })` flow, the same mechanism T14 already chose for the
public developer API's machine-to-machine auth, applied here to human sign-in. Direct instruction:
"should be OAuth." Additive alongside existing email/password/magic-link/passkey — not a replacement
for any of them.
**Not yet built** — this entry records the requirement and the auth mechanism; implementation (Supabase
project OAuth app registration with Apple/Google, the sign-in button/flow on both `/login` and
`/signup`, callback handling) is separate follow-up work, same "decide first, build after" sequencing
as every other entry in this file.
**Rules out:** A custom/bespoke OAuth client implementation instead of Supabase Auth's built-in
provider support — no reason to hand-roll what the existing auth layer already does for OAuth.

### T19 — Accounting software integration: build the *readiness* layer now, defer the live QuickBooks/NetSuite connector
**Decision (2026-09-23):** Directly instructed: "we can keep the actual integration to accounting
software for later time but we should ensure that the app is ready for integration." Read as two
separate pieces of work, not one deferred item — the live OAuth connector to QuickBooks Online /
NetSuite (their auth flows, their field mappings, their rate limits, their sandbox-vs-production
account setup) is deferred, but the internal groundwork that any such connector would need to sit on
top of is in scope now:
- A stable, accountant-legible **ledger-shaped export surface** for invoices, settlements, and expense
  records (chart-of-accounts-style categorization, not raw internal table shapes) — extending T14's
  existing public API (`app/api/public/v1`, already has `invoices`) rather than inventing a second
  integration surface.
- **Idempotent, replayable financial events** (each invoice/settlement/expense change is a discrete,
  once-only-appliable event, not just "current row state") — this is the same shape a real accounting
  sync needs to avoid double-booking a transaction on a retried webhook, and the shape T14's OAuth
  client-credentials auth already assumes for machine callers.
- **Explicit currency/tax/period metadata** on every financial record (Rule I's already-locked
  currency-resolution chain, not a literal `'USD'` fallback) — accounting systems reject or mis-book
  a transaction missing this, so it has to be correct at the source, not bolted on at sync time.
**Why:** Building the live connector first, without this groundwork, means the connector work doubles
as a forcing function that retrofits the underlying data model under time pressure — exactly the kind
of shortcut this project's post-correction priority (quality/scale over MVP-scope minimalism, see
memory) exists to avoid. Building the readiness layer now, connector later, means the eventual
QuickBooks/NetSuite work is "point an existing well-shaped export at their API," not "redesign how
CarrierOS represents money in order to bolt on a sync."
**Rules out:** Starting QuickBooks OAuth app registration, NetSuite SuiteTalk/RESTlet work, or any
named-vendor credential/sandbox setup as part of this pass. Silently shipping the readiness layer
without ever revisiting the live connector — this decision defers it, it does not cancel it; the PRD's
existing "QuickBooks-compatible CSV export (Growth tier)" and "direct sync is Pro" lines stay on the
roadmap, unchanged in scope, just sequenced after this groundwork.

### T20 — EDI integration with shippers/brokers is in scope, reversing P1's original Phase 1 exclusion
**Decision (2026-09-23):** Directly instructed: "Carrier will need to support EDI integration to
communicate with shipper for real time data exchange." This **reverses** P1's original "Rules out:
...EDI... (Phase 1)" line — EDI is no longer excluded scope, it is a named requirement, because
real-time load-status/tender exchange with shipper and broker TMS platforms is exactly what P1's target
micro-carriers need in order to win freight from anyone already running standard EDI (which is most
mid-size-and-up shippers/brokers).
**Scope, read literally from "real time data exchange with shipper":**
- **Inbound EDI 204** (Motor Carrier Load Tender) — a shipper/broker offering a load, translated into
  a CarrierOS load record a dispatcher can accept/decline exactly like a manually-entered load.
- **Outbound EDI 990** (Response to a Load Tender) — accept/decline sent back through the same channel.
- **Outbound EDI 214** (Transportation Carrier Shipment Status) — the "real time" half of the
  requirement: milestone/status changes already captured by the existing load-milestone flow (the same
  data driving `/track/[token]`, R2) pushed out as EDI status updates, not just visible on our own
  tracking page.
- **Outbound EDI 210** (Motor Carrier Freight Details and Invoice) — natural pairing with T19's
  invoice-export work, same underlying invoice record, a different wire format for a different
  recipient (shipper/broker EDI, not an accounting system).
**Not yet decided — flagged as the real open question, not silently assumed:** whether CarrierOS hand-
rolls X12 parsing/AS2 connectivity itself, or integrates through an EDI-as-a-service provider (e.g.
SPS Commerce, TrueCommerce, Orderful, EDI2XML) that handles X12↔JSON translation and VAN/AS2
connectivity behind a REST API — the latter is how the vast majority of carriers this size actually
do EDI, since hand-rolling a compliant X12 stack is a large, ongoing-maintenance undertaking distinct
from the rest of this codebase's competency, and most such providers charge recurring per-transaction
or per-connection fees. This is a real spend decision, not a code-only one — see the "Existing
Solutions Preflight" rule in this project's own working agreement (avoid paid-service recommendations
without explicit approval) — so the provider choice itself is raised to the user separately rather than
picked here.
**Why:** Direct instruction, reversing the original micro-carrier-only scoping assumption now that the
product is being built for real, sustained scale (see memory's "quality/scale over MVP-scope
minimalism" correction) rather than the original 10-pilot-carrier MVP framing P1 was written under.
**Rules out:** Nothing else yet — this entry intentionally stops at "what" and "why," not "which vendor"
or "exact schema," pending the provider decision above.

**Amendment (2026-09-23) — build-vs-provider resolved: EDI-as-a-service, not hand-rolled X12/AS2.**
Approved directly by the user. Two candidates researched, both REST-API-with-JSON (not raw X12), which
lines up with T14's existing OAuth2 client-credentials public-API pattern and ADR 0003's JSON-everywhere
architecture instead of requiring a separate X12 codec:
- **Orderful (lead candidate):** REST API, canonical JSON mapping applied across all shipper partners
  (not a separate map per trading partner), supports 204/990/214/210/211 plus POD exchange over
  JSON/XML — the POD support pairs directly with this session's already-shipped POD offline-upload work
  (`carrieros-mobile/src/lib/pod-upload.ts`). Prebuilt SDKs, sandbox testing. Publicly advertised
  starting price ~$24/mo (vs. SPS Commerce's ~$99/mo, which is also retail-focused, not carrier-focused).
- **Zenbridge (alternative):** smaller, transportation/TMS-specific (not a generic retail-EDI platform
  repurposed for freight), also API-first, no public pricing found — worth a demo call as a second
  quote, not ruled out.
**Not yet done — explicitly flagged, not silently assumed:** no account created, no contract signed, no
actual pricing confirmed directly with either vendor (only publicly advertised figures), no code written
against either API. This amendment records the research finding and narrows the field; committing real
spend still needs an explicit go-ahead once real pricing is confirmed, same as any other vendor decision
this project makes.

---

## VISUAL DESIGN

### V1 — Web UI keeps the dark navy theme; the light-page mockup direction is not adopted
**Decision (2026-07-20):** `carrieros-web` keeps its current dark theme (`#0f1923` page background,
`bg-white/5` translucent cards, navy sidebar) rather than moving to the light `surface.page #f4f6f9` /
white-card direction described in `design-tokens.md`'s original Surface/Neutral table.
**Why:** A systematic mockup-vs-implementation review found the mockup set itself is split — early
mockups (legacy colors, e.g. mockup-06 onboarding) are dark-everywhere; later mockups (canonical
colors, e.g. mockup-22 fleet inventory) are light-paged. The build matches the earlier direction, not
the one the token doc's Surface table describes. Re-skinning ~15+ pages' worth of components (every
card uses a translucent-white-on-dark pattern that doesn't survive a straight background-color swap)
was judged higher cost than the payoff, given the dark theme is a legitimate, coherent aesthetic on
its own. Instead, invested in closing the *depth/polish* gap the review actually attributed most of
the "looks unfinished" impression to: cards had zero shadow usage anywhere and only one `transition`
declaration across the pages checked, vs. the mockups' five-deep shadow scale and hover transitions.
**Implemented:** a dark-theme-appropriate shadow/elevation/focus-ring scale, documented in
`design-tokens.md`'s new "Dark Theme (Shipped)" section (higher alpha than the light-theme shadow
tokens, which are invisible against `#0f1923`), applied across shared card/button/input patterns.
**Rules out:** A full light-theme re-skin of carrieros-web. The light-theme tokens in design-tokens.md
remain the reference for the mobile app's status-bar/header chrome only.

### V2 — Full visual-fidelity gap closure is a real priority, not "nice to have"
**Decision (2026-07-20):** V1's shadow/depth pass was scoped narrowly on purpose — it closed the
single biggest driver of "looks unfinished," not every gap the mockup work identified. That was a
sequencing choice, not a judgment that the rest doesn't matter. Explicit correction: the mockups
represent real, deliberate design investment (22 screens, a full token/spacing/shadow system in
`design-tokens.md`) and the remaining gaps `docs/design-gap-analysis.md` catalogs — sidebar background
color drift (`#0a1118` vs. spec `#0f1923`), sidebar width (240px vs. 256px), status-chip radius (6px
vs. pill), KPI/brand typography weight, sidebar section grouping, the dot-grid texture, load-detail's
rate treated as a buried label instead of a hero number — are to be treated as real, prioritized work,
not deferred indefinitely.
**Why:** Explicit product priority: UI visual appeal matters and the design work behind the mockups
should not be discarded just because the theme-direction question (V1) was resolved narrowly.
**Rules out:** Treating `design-gap-analysis.md`'s remaining items as a someday-list. They're the next
body of work, sequenced after (or alongside) the functionality gaps below.
**Also true, and worth stating alongside this:** most of the *functional* gaps that document
catalogs — onboarding's missing truck/customer/billing/completion steps, the dashboard's wrong KPI
metrics, DispatchPanel's plain `<select>` vs. visual driver cards, role-differentiated home screens —
need **no schema changes**. The tables/columns those screens would read from mostly already exist
(`trucks`, `customer_details`, `carrier_details`'s billing columns, `drivers.default_truck_id`,
`invoices`, `maintenance_reminders`). Three specific, narrow exceptions found while reviewing this:
1. `loads.status` has no `'cancelled'` value in its CHECK constraint — needed for the load-detail
   action grid's "Cancel Load" button (mockup-08).
2. No avatar/photo column exists anywhere (`drivers` or `profiles`) — needed for the driver strip's
   avatar (mockup-08) and would generalize to team/driver list cards.
3. `trucks` has only a boolean `is_active`, not a three-way Active/Idle/In-Shop status the fleet-status
   dashboard tile (mockup-15) wants — this one needs a product call: add an explicit `trucks.status`
   column, or derive "in shop" from an open `service_logs`/`maintenance_reminders` entry with no
   schema change. Leaning toward deriving it (today's maintenance tables already carry enough
   information), but flagging it as a real choice rather than deciding unilaterally.
   **Resolved 2026-07-21:** added as a real `vehicles.status` column (S8), manually toggled — not
   derived, since maintenance data genuinely can't represent "checked into a shop right now."

### V3 — Light/Dark/System theme toggle added; this extends V1, it does not reverse it
**Decision (2026-07-21):** `carrieros-web` and `carrieros-mobile` both get a real, user-selectable
Light/Dark/System theme preference (`profiles.theme_preference`, default `'dark'` — no visible change
for any existing/new user until they explicitly opt in). Most of the light palette already existed on
paper in `design-tokens.md`'s original `surface.*`/`text.*` section (marked "kept for reference" by
V1) — this mostly wires up what was already specified rather than inventing a new palette. Sidebar/
chrome stays fixed dark navy in both modes (a common dark-chrome-plus-switchable-content pattern, and
`design-tokens.md`'s Sidebar spec was already written without conditional light/dark language); badges
and `brand-orange` stay identical across both themes.
**Why:** V1 decided which theme the app *ships with by default* (dark, rejecting the light-page
mockup direction as the one-and-only look) — it never ruled out a real user choice, and those are
different questions. Requested directly: "most top applications now have light/dark mode... no styles
should be hard-coded, they should be in stylesheets."
**Also surfaced and fixed in the same pass:** 30 web files were using raw hardcoded hex (`bg-[#...]`
etc.) instead of token classes — none of them could have responded to a theme switch until converted.
**Rules out:** Treating this as contradicting V1; hardcoding any new color value outside the token
system going forward.
**Delivered (2026-09-21) — closing the loop V6 opened:** `profiles.theme_preference` and the full
web picker were built this session (mobile's own implementation — `use-theme.tsx`, the Settings ->
Appearance picker, light/dark palettes — turned out to already exist, undocumented, by the time this
was picked back up). Found in the process: the column had shipped as `NOT NULL DEFAULT 'system'`
(migration 0001), not `'dark'` as this entry specifies — an unreviewed drift, not a considered
override (schema.sql's own comment justified the column being `NOT NULL`, never actually addressed
the literal default value against this entry's explicit text). Fixed via migration 0030,
`ALTER COLUMN theme_preference SET DEFAULT 'dark'` — zero retroactive impact, since the column being
`NOT NULL` means every already-provisioned profile already has an explicit value; this only changes
what a brand-new signup gets. Web's ~69 pages still built on literal hardcoded-dark Tailwind classes
(not the semantic token system) don't respond to the toggle yet — verified this doesn't break them
(they simply stay dark, unchanged), but converting them to actually switch is real follow-up work on
the same scale as this entry's own original "30 hardcoded files" cleanup, not done here.
**Rules out (addendum):** treating a schema-level comment that explains one design choice (nullable
vs. `NOT NULL`) as also having settled a different one (which literal value to default to) without
checking it against this entry's own explicit text.

### V4 — Semantic color legend + a deliberate icon-system split
**Decision (2026-07-21):** Formalized (no new hex values) how the existing danger/warning/info/success
color tokens map to *meaning* everywhere in the app — red=urgent/overdue, amber=due-soon/warning,
blue=informational/upcoming, green=all-clear/healthy, neutral=inactive — so every screen (exceptions
tiers, health-score ring, fleet/compliance pills) draws from one legend instead of ad hoc per-component
choices. Separately: Material Symbols Outlined stays the default icon system everywhere, EXCEPT
vehicle-type and maintenance-service-type icons, which use a new custom illustrated SVG set instead (a
real visual-distinctiveness upgrade for those two screens specifically, not a wholesale custom-icon
system app-wide).
**Why:** Found while re-reading mockup-13/14's systematic, consistent use of color across many
distinct data types (not just one status enum) and mockup-13's bespoke truck-silhouette/service icons,
which directly contradicted `design-tokens.md`'s stated "Material Symbols only" system as previously
documented.
**Rules out:** Ad hoc color choices per new component; adopting a fully custom icon system everywhere.

### V5 — Mockup research findings: mtime is not a design-quality signal here; mockups 17-21 are tracked, not forgotten
**Decision/finding (2026-07-21):** A deliberate re-review of all 22 mockups (requested specifically to
check whether later edits contained refinements worth not losing) found the opposite of the working
assumption: the mockups that look most refined by mtime (mockup-13/22 — light page, white cards, real
shadows) are the light-theme direction V1 already evaluated and rejected — chasing "the newest-looking
mockup" would have pointed at an already-abandoned direction. Within the kept dark-navy family,
mockup-01/04/07 (oldest) use token-for-token identical CSS to mockup-02/08 (newest) — no drift to
chase there either. Separately: mockups 17-21 (IFTA hub, fuel logging, driver chat, IFTA mileage log,
Growth desktop command center) are **not** forgotten scope — they're fully specified Growth/Pro-tier
roadmap items with matching tables already in `Carrier_OS_DB_Schema.sql` and matching BRD/FRD
requirements, deliberately excluded from the current mockup-parity plan (mockups 1-16 range).
**Addendum:** mockup-19's driver chat (`driver_messages`) needs to be translation-aware whenever it's
built — each message records its `original_language` (sender's `preferred_language`), an on-demand
"Translate" affordance appears when a reader's language differs, translations are cached per
(message, target language) rather than re-computed on every view. Needs a real translation backend
(LLM call or a service like DeepL) — flagged as new infrastructure, not assumed.
**Why recorded here:** so a future session doesn't re-discover any of this from scratch.

**Resolved (2026-09-24):** real translation is built — an LLM call through the existing `lib/ai/`
provider abstraction (T17), cached per (message, target_language) exactly as specified above. Both
`app/api/driver-messages/[id]/translate` (legacy, mobile/web UI already call this) and
`app/api/v1/driver-messages/[id]/translate` share one implementation
(`DriverMessageService.translate()`). Independently configurable from the platform-wide LLM default
via `ai_feature_overrides` (migration 0036) — e.g. to run translation on a cheaper or self-hosted
open-weight model without affecting load extraction or support triage.

### V6 — Adopt the mockups' bespoke palette; supersedes V1's canonization of `#0f1923`/`#f97316`
**Decision (2026-07-25):** `carrieros-web` and `carrieros-mobile` move to the mockup set's bespoke
palette: `navy #0f1923 → #0f1e35`, `brand-orange #f97316 → #f47920`, `navy-light #1e3a5f → #1f3a58`,
`success #16a34a → #2ecc71`, `text-secondary #8898aa → #8fa3b8`, plus four tokens the app never had —
`navy-mid #182c46`, `navy-card #162033`, `brand-orange-light #f9a55a`, `gray-light #d6e0ea` — and the
mockups' two-step radius scale (`--radius-card: 14px` alongside the existing 8px `rounded-lg`).
`teal #1abc9c` and `warning-amber #f0a500` already matched and are unchanged.
**Why:** Prompted by "I don't see the color scheme" on `/onboarding`. Root cause: nearly the entire
palette was **stock Tailwind renamed** — `#f97316` is `orange-500`, `#16a34a` `green-600`, `#dc2626`
`red-600`, `#d97706` `amber-600`, `#2563eb` `blue-600`, `#64748b`/`#94a3b8` `slate-500`/`400`,
`#f59e0b`/`#f43f5e` `amber-500`/`rose-500`. Only `teal` and `warning-amber` had survived from the
mockups' bespoke set. `#0f1923` + Tailwind orange-500 is what an app looks like when no palette was
ever chosen, which is exactly what the user perceived. 20 of 23 mockups declare `--navy:#0f1e35` /
`--orange:#f47920`; only mockups 17, 22 and 23 use the values the app had.
**Corrects V5:** V5 concluded "no drift to chase" from comparing mockups 01/02/04/07/08 — true of
*those five* (all `--red:#e55353`) but not of the wider set. A full 23-mockup token union found red
drifting `#e55353` (01-04,07,08) → `#e74c3c` (09-11,13,16,18,21) → `#dc2626` (14,15,22,23). V5 also
implies light-page and `#0f1923` are the same family; they are independent axes — five of the six
light-page mockups (13,18,19,20,21) use `#0f1e35`.
**`danger` deliberately NOT changed:** unlike navy/orange, red never converged (6/7/4 split above) and
mockup-06 declares no red at all. The newest four mockups landed on `#dc2626`, already in use, so
changing it would mean picking an arbitrary older value.
**Does not reverse V1:** V1 decided web ships *dark by default* rather than adopting the light-page
mockup direction. That still holds — this changes which navy, not whether the app is dark.
**Surfaced, not fixed here:** V3 (Light/Dark/System toggle via `profiles.theme_preference`) was
recorded as decided on 2026-07-21 but **was never implemented** — that column does not exist in
`supabase/schema/schema.sql`, and the only reference anywhere in the code is the comment at
`app/layout.tsx:31` noting it was never built. The light `:root` token block in `globals.css` is
therefore unreachable, and was left un-retinted for that reason. V3 remains an open, undelivered
decision, not a closed one.
**Rules out:** treating `docs/design/design-tokens.md` as a source of truth (that file does not
exist); reproducing token values in prose docs — `carrieros-web/app/globals.css`'s `@theme` block is
canonical and `scripts/check-tokens.mjs` enforces the two hand-mirrors against it.

---

## I18N / LOCALIZATION

### L1 — Four supported languages: English, Spanish, Punjabi, Urdu
**Decision:** `profiles.preferred_language` accepts 'en' | 'es' | 'pa' | 'ur'. UI language follows user preference, not company setting.
**Why:** CA micro-carrier market is heavily South Asian (Punjabi) and Latino (Spanish). Punjabi and Urdu share script (Nastaliq) but are distinct languages with different audiences. English is default.
**Rules out:** French (not relevant to CA market), general "add more later without planning" approach.

### L2 — preferred_language on profiles, not companies
**Decision:** Language preference is per-user, not per-carrier organization.
**Why:** A carrier may have an English-speaking owner and a Punjabi-speaking driver. Both use the same org but need different UI languages.

### L3 — Units and date/time format also follow the user, not the org
**Decision (2026-07-20):** `profiles.uom_system` ('imperial' | 'metric', nullable), `profiles.date_format` ('MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD'), and `profiles.time_format` ('12h' | '24h') are per-user overrides, same pattern as L2. `uom_system` is nullable specifically so it can mean "inherit the carrier's default" from `carrier_details.uom_system` (S7) when the user hasn't set a personal override.
**Why:** S7 gave every carrier org one default unit system, but a driver working across a US carrier and a Canadian one (or an owner who just prefers metric personally) needs their own choice without changing the whole org's setting.
**Implemented:** Personal settings screens on both apps — `carrieros-web` at `/settings`, `carrieros-mobile` on the repurposed `(tabs)/explore.tsx` tab (also the language picker, decision L1/L2). Both write directly to `profiles` via RLS (`own_profile_update`), no API route needed (decision R3b — plain CRUD doesn't need one).
**Rules out:** A single org-wide unit/date/time setting with no personal override.

### L4 — Language now inherits carrier → user, matching L3's `uom_system` pattern exactly
**Decision (2026-07-21):** `carrier_details.default_language` (new column) is the carrier-level
default; `profiles.preferred_language` is now nullable, where `NULL` means "inherit the carrier's
default" — identical semantics to `uom_system` (L3), replacing the previous hardcoded `DEFAULT 'en'`
with no carrier-level fallback at all. See S9 for the schema detail.
**Why:** Found by direct correction: "Language is a default choice of the carrier that then is
inherited by users but can be changed by them... role agnostic" — `uom_system` already had exactly
this shape and `preferred_language` should have matched it from the start.
**Rules out:** A hardcoded `'en'` default with no path for a non-English-speaking carrier's own
preference to become the default for their new team members; any coupling between language and role
(they are unrelated — language is not tied to what role a user holds).

---

## OPEN QUESTIONS (not yet decided)
_Cleaned up 2026-09-21: the four items previously listed here (invoice payment method, load tracking
URL shape, team invite flow, customer portal architecture) were already fully answered in R1–R4 below
and had just never been removed from this list — a real instance of exactly the "doc says open, code
already decided it" drift this session has been finding elsewhere. Removed rather than left to keep
confusing a future read of this file. Same day, both remaining items below were also resolved (PR1's
amendment, T15's decision text) — nothing currently listed here as of this cleanup. "Dedicated support"
(the other half of PR1's original Enterprise line, listed here until this same update) is now resolved
too — see T16._

Nothing currently open as of this update.

---

## RESOLVED — Previously Open Questions
_Decided: 2026-07-19_

### R1 — Invoice payments: Stripe direct + factoring integration
**Decision:** Support both Stripe (direct card/ACH from shipper) and factoring company integrations (TriumphPay, OTR, RTS, etc.). Carrier chooses their preferred method per invoice or globally.
**Why:** Many micro-carriers use factoring as their primary cash flow tool — they sell receivables immediately rather than waiting 30–60 days. Stripe handles the carriers who bill direct. Both paths need to coexist since a carrier may factor some loads and bill others directly.
**Implications:** Invoice model needs a `payment_method` field ('stripe' | 'factoring' | 'other'). Factoring integration = webhook/API to notify the factor when an invoice is created. Stripe = payment link on the invoice PDF.
**Rules out:** Picking one payment rail and excluding the other.

### R2 — Load tracking: token-based URL (/track/[token])
**Decision:** Each load gets a unique random token. Public tracking URL is `/track/[token]` — no auth required, no carrier subdomain.
**Why:** Subdomain approach (carrier.carrieros.com/track/123) requires DNS per carrier, SSL cert provisioning, and routing infrastructure — massive complexity for a feature that just needs to show "your shipment is in transit." Token URLs are shareable by text message, work on any device, and require no setup. Token can be regenerated if the link is leaked.
**Implications:** `loads` table needs a `tracking_token` column (unique, default `gen_random_uuid()` or a short nanoid). `/track/[token]` is a public Next.js route with no auth middleware.
**Rules out:** Per-carrier subdomains for tracking (post-MVP consideration only).

### R3 — Team invite: Supabase magic link (passwordless)
**Decision:** When an owner invites a driver, dispatcher, or finance user, Supabase sends a magic link email. No password is set or required.
**Why:** Drivers are on mobile and often non-technical — they forget passwords and abandon setup flows. Magic links work on any device with no app install required for the email step. Supabase Admin API (`admin.auth.inviteUserByEmail`) handles delivery.
**Implemented (2026-07-19) — deviates slightly from the original wording above:** `POST /api/drivers/invite` calls `createAdminClient().auth.admin.inviteUserByEmail(email, { data: { org_id, role: 'driver' } })` AND creates the `profiles` + `drivers` rows **synchronously, at invite time** (still via the admin client) — not deferred to first sign-in via `user_metadata` in the callback. Reason: `drivers.profile_id` is `NOT NULL`, so a `drivers` row literally cannot exist before a `profiles` row does; deferring to the callback would require relaxing that constraint and adding a second profile-creation code path in `app/auth/callback/route.ts`. Creating both rows up front (mirroring the already-proven onboarding bootstrap pattern, decision T3) is simpler and keeps one code path. The invitee still must click the magic link to authenticate — only the DB rows exist ahead of that. `app/auth/callback/route.ts` needed no changes as a result.
**Rules out:** Email + password invite flow. Username/password entirely for invited users. Deferred (metadata-driven) profile creation on first sign-in.

### R3b — API/DB/frontend separation for web+mobile reuse
**Decision (2026-07-19):** Every write is one of two shapes, not a spectrum:
1. **Needs a server secret or the service-role bypass** (Anthropic key, Resend key, admin auth API for invites, onboarding's bootstrap) → stays a Next.js API route under `carrieros-web/app/api/`. These routes authenticate via `lib/api-auth.ts`'s `getAuthedContext()`, which accepts EITHER a cookie session (web) OR an `Authorization: Bearer <token>` header (carrieros-mobile — Expo has no cookies, holds its session in AsyncStorage). Both auth paths were verified end-to-end (2026-07-19).
2. **Plain RLS-protected CRUD or a business rule that must be atomic/consistent regardless of caller** → a Postgres RPC (`SECURITY DEFINER` when it needs to bypass RLS for its own internal checks, e.g. `create_customer_org`) or a direct table query. Callable identically by web and mobile via `supabase.rpc()` / `supabase.from()` — no Next.js layer needed, so there's exactly one implementation of the business rule, not two (one per client).
**Why:** Before this pass, every API route authenticated via cookies only (`createClient()` reading `next/headers`), which silently made every route web-only — a mobile client calling any of them would have been bounced by both the route's own check AND `proxy.ts`'s middleware-level auth guard (which also only read cookies and ran before any route handler, regardless of what the route itself supported). Customer creation was also non-atomic (two separate inserts, no transaction) and missing its RLS INSERT policy entirely — it had never been exercised end-to-end before this pass.
**Also fixed in this pass:**
- `proxy.ts` now exempts `/api/*` from its own cookie-only auth guard (routes handle their own auth via `getAuthedContext`) — previously this blocked Bearer-token requests before they ever reached route code.
- `/api/extract-load` had **zero auth check** — any unauthenticated caller could burn the Anthropic API key. Fixed.
- Added `organizations` RLS policy `carrier_reads_own_customer_orgs` — the existing `org_member_select` only covered a customer-portal user reading their carrier's org, not the reverse. Without it, `GET /api/customers`'s embedded `organizations(...)` join silently returned `[]` (PostgREST embeds are inner joins — an RLS-blocked embedded row drops the whole outer row).
- `customer_details` has two FKs to `organizations` (`org_id`, `carrier_org_id`), so the bare `organizations(...)` embed syntax is ambiguous (`PGRST201`). Must use `organizations!customer_details_org_id_fkey(...)`.
- Routes previously destructured only `{ data }` from Supabase queries, silently swallowing `error` — the ambiguous-embed bug above surfaced as an empty array, not a visible failure, for this exact reason. `/api/customers` GET now checks `error` explicitly; worth auditing other routes for the same pattern.
**Error convention:** every API error response now includes a stable `error_code` (`AUTH_REQUIRED`, `FORBIDDEN`, `NOT_ONBOARDED`, `VALIDATION_ERROR`, etc. — see `lib/api-auth.ts`) alongside the existing English `error` string. The `error` string is for logs/devs only; each client maps `error_code` → a localized string via its own `messages/{locale}.json` (`next-intl` web, `i18n-js` mobile) so no client ever renders raw English error text to a Spanish/Punjabi/Urdu-speaking user.
**Rules out:** Adding new CRUD as Next.js routes by default going forward — check whether it actually needs a secret first. Silently ignoring `error` from any Supabase call.

### R4 — Customer portal: same app, role-based access
**Decision:** Customer-facing portal users (shippers/brokers who want to check their load status) log into the same carrieros-web app. Their role ('customer_admin' or 'customer_viewer') controls what they see.
**Why:** Separate subdomain/app doubles infrastructure and maintenance. Role-based routing in proxy.ts already handles this pattern. Customer portal users have an `org_id` pointing to their customer organization, and can only see loads where `customer_org_id = their org`.
**Implications:** Customer portal routes need to be added to proxy.ts ROLE_HOME and ROLE_ROUTES. Customer portal pages are scoped to loads/documents for their org only. Phase 2 feature — not blocking MVP.
**Rules out:** Separate carrieros-customer.com app or subdomain.

### R5 — i18n rollout: both apps, all screens, in one pass
**Decision (2026-07-20):** When asked to scope the L1/L2 language work, explicitly chose "both apps, all screens, full pass" over "mobile driver screens first."
**Why:** L1/L2 were already locked as product decisions; the only open question was sequencing. Doing both apps together let the two i18n efforts (next-intl on web, i18n-js on mobile — different libraries, different runtimes, see T9) run as independent parallel agents rather than serially, and avoided a half-translated interim state where e.g. the web dashboard is English-only while mobile is fully localized.
**Implemented:** All screens on both apps wired and verified live (English, Spanish, Punjabi, Urdu — including RTL mirroring for Urdu). Includes the new personal settings screens (L3).
**Open risk — not yet resolved:** the Spanish/Punjabi/Urdu translation strings were authored by Claude, not reviewed by a native speaker. Acceptable for internal testing and the pilot's English-speaking staff, but should get a native-speaker pass before real Punjabi/Urdu/Spanish-speaking drivers depend on them for DVIR or load-status wording.

---

## SUPER ADMIN (Phase 8 Design — Cowork session 2026-07-22)

Design is locked in `design/mockups/mockup-23-super-admin.html` (open the file and click "Build Spec" top-right for per-screen data sources and SQL). Summary of decisions made during the mockup:

### SA1 — Super admin auth is wholly separate from Supabase Auth / profiles
**Decision:** Platform operators authenticate via a `platform_admins` table with bcrypt passwords + mandatory TOTP 2FA. Session is a signed cookie — never a Supabase Auth JWT, never a `profiles.role` value.
**Why:** A `profiles.role = 'superadmin'` approach means a compromised carrier account could be escalated to platform-level access via a single UPDATE. Separate auth surface = separate attack surface. Supabase Auth's JWT contains the user's `role` claim baked in — there's no safe way to elevate that to platform-admin without it being visible in a JWT a carrier user could theoretically intercept.
**Rules out:** Adding 'superadmin' as a role value in `profiles.role`. Using Supabase Auth for platform-operator login. SSO/OAuth for the first build.

**Amendment (2026-07-23):** Reversed — what actually shipped in Phase 8 is `profiles.role IN ('sx_owner','sx_finance','sx_support')` in a `type='platform'` organization, reusing ordinary Supabase Auth, not a separate `platform_admins` table. This was flagged as an unresolved architecture-drift finding by `docs/feature-completeness-audit.md` and raised explicitly for a decision. Decision: keep the pragmatic `profiles.role`-based model rather than migrate to the separate auth surface this entry originally specified. The privilege-escalation risk this entry was written to prevent is accepted as-is for the current single-operator/small-team stage; revisit if/when a compromised carrier account escalating to platform access becomes a real threat model (e.g. before onboarding an external support team).

### SA2 — Six-screen team workspace (not a solo founder dashboard)
**Decision:** Super admin is designed for a team: a support queue (Triage), a customer health board, an org detail drilldown, a billing/payments screen, a sales pipeline, and an audit log. Each screen maps to a distinct team role (support / billing / sales).
**Why:** At scale, a founder can't monitor everything; specialist team members need focused surfaces rather than one overwhelming dashboard. Exception-driven design (worst items first) means the support team can act without reading the whole list.
**Screens:** Triage Queue · Customer Health Board · Org Detail · Billing & Payments · Sales Pipeline · Audit & Activity · Feature Flags (bonus 7th).

### SA3 — Five new DB tables required for Phase 8
**Decision:** The following tables are needed and do not exist yet:

| Table | Purpose |
|---|---|
| `platform_admins` | Platform operator accounts (bcrypt + TOTP, separate from profiles) |
| `admin_notes` | Internal notes on orgs — org_id, body, admin_user_id, created_at |
| `admin_events` | Cross-org audit log — org_id, user_id, event_type, metadata JSONB, ip, user_agent, created_at |
| `billing_events` | Stripe webhook mirror — org_id, stripe_event_id, event_type, amount, status, card_last4, resolved_at |
| `feature_flags` + `org_flag_overrides` | Per-flag defaults + per-org overrides for the Feature Flags screen |

**Rules out:** Using `exception_events` (already exists for carrier-facing exceptions) as the platform audit log — they serve different audiences and have different retention/access requirements.

### SA4 — Customer health score formula (three signals, 0–100)
**Decision:** `health_score = (login_recency × 30) + (load_velocity × 35) + (feature_depth × 35)` — each sub-score is normalized 0–1 before weighting. Thresholds: ≥70 green / ≥40 amber / <40 red.
**Why:** Login recency alone misses engaged-but-stuck users (high login, zero invoices). Load velocity alone misses users who front-loaded activity then dropped off. Feature depth (how many of the 7 adoption milestones are complete) catches shallow users before they churn.
**Rules out:** A single-signal health score (e.g. "days since last login" used alone).

### SA5 — Exception grouping: four severity tiers
**Decision:** Triage queue groups exceptions as Critical (payment failed/expired card) · High (trial expiring <7d, low adoption) · Medium (new signup stuck, open support ticket, invoice overdue) · Low (new signup on-track, FYI).
**Why:** Support team needs to know what to act on today vs. this week vs. monitor. Color coding: red / orange / amber / blue — matching the existing `exception_events` severity palette so the internal and carrier-facing views speak the same language.

### SA6 — `price_override` on `carrier_details` already exists (grandfathering slot)
**Decision (noted, not new):** `carrier_details.price_override` column was added in Phase 7 as a grandfathering slot — a price change in `tiers` should not silently reprice existing subscribers. Phase 8 will use this column but did not add it; it's already in the schema.
**Why recorded here:** So the Phase 8 builder doesn't add a duplicate column or miss that the hook exists.
