# Tier & Pricing Structure
**Product:** CarrierOS
**Date:** July 2026
**Version:** 4.0 — Expanded feature scope across all tiers; Pro/Enterprise fully defined; desktop views added
**Status:** Draft — pending pilot validation

**Changelog:**
- Jul 2026 (v4.0) — Full 4-tier feature classification; Starter adds fuel stop logging + single-truck calendar; Growth adds driver chat, IFTA mileage log, desktop command center views; Pro fully defined (IFTA tax hub, fuel analytics, driver performance, revenue analytics, finance desktop, carrier public profile, load board posting, banking/autopay); Enterprise adds AI dispatch, HOS alerts, enterprise safety dashboard, driver training, custom permissions
- Jul 2026 (v3.0) — Starter raised to $49, Growth $99, Pro $199; switched to "included trucks" model; gated load/driver/truck history (90 days on Starter), Exceptions Inbox (top 3 on Starter), Dispatcher + Finance roles, CSV import; language/DVIR/compliance remain all-tier; CA pilot gets Growth free for 90 days
- Jun 2026 (v2.0) — Per-truck pricing model; DVIR + maintenance added; Enterprise tier renamed
- Jun 2026 (v1.0) — Initial version

---

## Pricing Philosophy

**Gate operational intelligence, not safety or compliance.**

- Safety features (DVIR, CDL/med cert compliance, FMCSA-required inspection records) belong in every tier. Gating them creates liability and undercuts the CA pilot value story.
- Language support (English, Spanish, Punjabi, Urdu) belongs in every tier. It's a differentiator, not a premium add-on. Gating it would hurt the driver community we're trying to serve.
- What we gate are *operational intelligence* features — the things that make a growing business more profitable and less reactive: full exception history, unlimited load/driver/truck history, advanced reporting, Dispatcher and Finance roles, IFTA automation, driver analytics. These are the features a carrier realises they need *after* they've been using the product for 60–90 days. Loss aversion drives upgrade — once they've seen the full Exceptions Inbox during the pilot, they won't want to give it up.
- Every upgrade trigger should fire at the exact moment the carrier hits a limit — not as a generic upsell banner.
- Pricing must be transparent and simple. "X trucks included, +$Y per additional truck" is easy to explain in a 30-second conversation.
- The CA pilot gets Growth free for 90 days — they experience the full product, including exceptions and unlimited history. After 90 days, they're choosing to pay $99 to keep what they have.

---

## Pricing Model

**Flat monthly base with trucks included. Additional trucks billed per truck.**

| | **Starter** | **Growth** | **Pro** | **Enterprise** |
|---|---|---|---|---|
| **Monthly base** | **$49/mo** | **$99/mo** | **$199/mo** | **$349/mo** |
| **Trucks included** | 1 | 3 | 6 | 12 |
| **Per additional truck** | +$15/truck | +$20/truck | +$25/truck | +$30/truck |
| **Target fleet size** | 1–3 trucks | 3–6 trucks | 6–15 trucks | 16+ trucks |
| **Target user** | Solo owner-operator | Small fleet with drivers | Growing carrier with team | Established carrier |
| **MVP?** | ✅ Launch | ✅ Launch | Post-MVP | Post-MVP |

**Example monthly costs:**

| Trucks | Starter | Growth | Pro | Enterprise |
|---|---|---|---|---|
| 1 | $49 | — | — | — |
| 2 | $64 | — | — | — |
| 3 | $79 | $99 | — | — |
| 4 | $94 | $119 | — | — |
| 5 | $109 | $139 | — | — |
| 6 | $124 | $159 | $199 | — |
| 8 | $154 | $199 | $249 | — |
| 10 | — | $239 | $299 | — |
| 15 | — | — | $424 | — |
| 16 | — | — | — | $349 |
| 20 | — | — | — | $469 |

> At 3 trucks, Starter is $79 vs. Growth $99 — $20/month more for the full exceptions inbox, unlimited history, Dispatcher + Finance roles, GPS, desktop command center, and driver chat. This is the key upgrade window.

**Annual billing:** 2 months free (~17% discount). Monthly billing available for Starter and Growth; Pro and Enterprise: annual only.

**Free trial:** 30 days, no credit card required. CA pilot carriers: Growth free for 90 days.

---

## Upgrade Trigger Ladder

Each upgrade should be triggered by a real operational pain surfaced in-app at the moment it occurs — not a generic pricing banner.

```
Starter → Growth:     "You have 8 exceptions — upgrade to see all of them"
                      "Fleet hit 3 trucks — you need a dispatcher view and a live map"
Growth  → Pro:        "IFTA is due in 14 days — we can prep your filing automatically on Pro"
                      "You have 8 trucks — your fuel costs need per-truck analytics"
Pro     → Enterprise: "Driver #4 just hit HOS risk — you need alerts before violations happen"
                      "Connect your ELD to auto-import mileage and eliminate manual entry"
```

---

## Starter — $49/mo (1 truck included, +$15/truck)
**1–3 trucks · Solo owner-operator**

Fully functional for a carrier who drives one of their own trucks and handles all admin themselves. No features require a second user. Built to replace spreadsheets + Quicken + paper DVIRs in a single product.

### TMS Core
- Load management: manual entry, AI extraction from PDF/image/email/paste
- Accept/decline loads; status updates (Scheduled → In Transit → Delivered → Invoiced)
- Customer visibility link: shareable per-load tracking link, no login required, auto-updates on status change
- Invoicing: auto-generate from completed load; review + edit; email + PDF; manual mark-as-paid
- Invoice status: Draft → Sent → Paid → Overdue; 7-day overdue notification
- Document capture: POD/BOL photo capture and send to broker
- Customer directory: unlimited customers with notes + tags
- Solo mode: owner-operator unified view; no role switching needed

### Compliance & Safety (all tiers — never gated)
- Pre/post-trip DVIR: FMCSA-compliant digital forms, timestamped with driver signature
- FMCSA templates: pre-built checklists for all required inspection items
- Defect flagging: driver marks defects with notes/photos; owner alerted instantly
- Driver compliance: CDL (number/class/state/expiry), DOT medical cert, endorsements (HazMat/Tanker/Doubles), emergency contact; fleet compliance dashboard showing per-driver status; 60-day expiry alerts
- Truck service log: manual entries (date, mileage, type, cost, shop)
- Mileage + time-based reminders: oil change intervals, annual DOT inspection
- Truck documents: registration, insurance cert, DOT authority per truck
- Company documents: COI, general liability, workers' comp, MC authority, DOT certificate, UCR, W-9/EIN, business license; 30-day expiry alerts

### Language Support (all tiers — never gated)
- English (en), Spanish/Español (es), Punjabi/ਪੰਜਾਬੀ (pa), Urdu/اردو (ur)
- `profiles.preferred_language` — available to every role
- Punjabi: Noto Sans Gurmukhi (LTR); Urdu: Noto Nastaliq Urdu (RTL — `dir="rtl"` on root layout)

### Operations
- **Fuel stop logging:** simple form — gallons, cost, odometer, location; stored per truck; groundwork for IFTA mileage tracking
- **Single-truck calendar:** schedule view for the owner's own truck — what's assigned, what's open, when they're available

### What's Gated (upgrade to Growth to unlock)
| Feature | Starter | Growth |
|---|---|---|
| **Load / driver / truck history** | Last 90 days | Unlimited |
| **Exceptions Inbox** | Top 3 items only | Full inbox (Today / This Week / Upcoming) |
| **Exception timelines** (driver, truck, customer profiles) | Not available | ✅ |
| **Customer health scores** | Not available | ✅ |
| **Dispatcher + Finance roles** | Not available | ✅ |
| **CSV customer import** | Not available | ✅ |
| **Data export / reporting** | Not available | ✅ |
| **GPS real-time tracking** | Not available | ✅ |
| **Offline driver mode** | Not available | ✅ |
| **Invoice auto-reminders** | Manual only | Auto at due date + 7 days overdue |
| **Driver in-app chat** | Not available | ✅ |
| **Fleet calendar (multi-truck)** | Single truck only | Full fleet view |
| **IFTA mileage log** | Manual fuel log only | Auto-recorded via GPS |
| **Desktop command center** | Not available | ✅ |

### Upgrade Triggers
- "You have 8 exceptions — upgrade to see all of them"
- "Load history older than 90 days is archived — upgrade to access"
- "CSV import is available on Growth and above"
- "Add a Dispatcher or Finance user on Growth and above"
- When fleet reaches 3 trucks and per-truck math makes Growth's 3-included attractive

---

## Growth — $99/mo (3 trucks included, +$20/truck)
**3–6 trucks · Small fleet with employed drivers**

For the owner who no longer drives every load but manages drivers and trucks. The core unlock is operational intelligence: full exception visibility, unlimited history, roles-based team access, real-time fleet visibility, and driver communication.

### Everything in Starter, plus:

**Exceptions & History (key unlock)**
- Full Exceptions Inbox: Today / This Week / Upcoming grouping; all items; CTA buttons per exception
- Unlimited load history: driver document timelines, truck load history, customer exception timelines
- Customer health scores: 0–100 score ring based on payment behavior, on-time rate, exception frequency
- Exception history on all profiles: driver, truck, customer

**Dispatch & Fleet**
- Dispatcher role: ops access without billing; can create loads, assign drivers, manage fleet, view customers
- Finance role: billing access without ops; invoices, reports, customers — no driver details or dispatch
- Offline mode: driver status updates and POD capture queue locally; sync on reconnect
- GPS real-time tracking: driver phone feeds live location into customer tracking link
- Fleet calendar: multi-truck view — which trucks are assigned vs. available by day; schedule future loads
- Live dispatch map: current location and status of all trucks overlaid with active loads on one screen
- Load reassignment: reassign to different driver with auto-notification

**Driver Communication**
- In-app messaging: dispatcher ↔ driver threads; load-specific chat; BOL and document sharing in-thread
- New load notification: driver receives push notification with load details on assignment
- Status nudge: dispatcher can ping driver for a status update from the dispatch screen

**IFTA Mileage Tracking**
- Auto-record state crossings via GPS: each state-line crossing logged with timestamp, odometer estimate, and coordinates
- Mileage summary by state: quarterly view of miles per state per truck
- Manual entry fallback: driver can log fuel stop with state if GPS missed a crossing
- Note: mileage log only — tax computation and quarterly filing is Pro tier

**Financials & Reporting**
- Per-load expense tracking: fuel, tolls, lumper fees; net margin on load detail and invoice
- Driver settlement: configurable per driver (% of rate, per-mile, per-load flat); auto-calculated at delivery; PDF statement in-app
- Invoice auto-reminders: auto-sent at due date and again at 7 days overdue
- Dashboard + reporting: loads this month, revenue, outstanding invoices, on-time delivery %
- CSV export (QuickBooks-compatible)
- CSV customer import (up to 500 customers)

**Maintenance+**
- Preventive maintenance scheduling: recurring schedules per truck
- DVIR defect → service reminder: auto-creates reminder when driver flags a defect
- Maintenance cost per truck: total spend on truck profile

**Customer Intelligence**
- Revenue per customer (total, load count, % of business)
- Average days-to-pay + payment trend
- Rate history per lane per customer (last 5 rates on a given O-D pair)
- Invoice aging by customer

**Desktop Command Center (Growth+)**
- Owner desktop home: fleet status overview, exceptions strip, revenue KPIs — sidebar nav + main canvas
- Dispatcher desktop: all trucks on map + load queue + driver availability — full-width layout
- Finance desktop (basic): invoice pipeline, outstanding by customer, settlement summary
- Responsive: collapses to mobile bottom nav for owners who check from phone

### Upgrade Triggers
- "IFTA is due — you have mileage data but Pro will compute your tax breakdown automatically"
- "You have 8 trucks — your fuel costs need per-truck analytics"
- "Driver performance data is available on Pro — see on-time % and safety scores by driver"

---

## Pro — $199/mo (6 trucks included, +$25/truck)
**6–15 trucks · Growing carrier with dispatcher + finance team**
*(Post-MVP — build after pilot validation)*

For carriers who've outgrown owner-operator tools. The unlock is analytical power: IFTA automation, fuel economics, driver performance, and desktop-first finance operations.

### Everything in Growth, plus:

**IFTA Tax Reporting Hub**
- Full quarterly IFTA filing prep: automated state-mile breakdown from GPS data, estimated fuel tax due per state, net tax owed or refund
- Fuel purchase reconciliation by state: match fuel card purchases to state miles
- Filing deadline alerts: 30-day and 7-day warnings per jurisdiction
- Export-ready report: formatted for direct submission or CPA handoff
- Per-truck IFTA breakdown: isolate one truck's mileage for owner-operator contractors
- Audit trail: every state crossing logged with timestamp, coordinates, odometer

**Fuel Card Management & Analytics**
- Fuel card integration: import transactions from WEX, Comdata, Fleetone
- Fuel cost per mile: by truck, by driver, by lane — all periods
- Anomaly detection: flag unusual fill-ups (wrong state, excessive gallons, off-route stops)
- Fuel budget vs. actual: set monthly budget per truck; alert on overrun
- MPG trend by truck: identify trucks needing engine service before it's obvious

**Driver Performance Dashboard**
- On-time delivery %: per driver, per month, trend view
- Fuel efficiency score: MPG vs. fleet average
- Safety score: DVIR defects flagged, incidents, HOS proximity (based on self-reported data)
- Empty miles ratio: deadhead vs. loaded miles per driver
- Settlement accuracy: flag discrepancies between expected and actual settlement amounts
- Performance ranking: sort drivers by any metric for review conversations

**Revenue Analytics (Desktop)**
- Revenue per mile by lane: identify profitable vs. money-losing routes
- Customer profitability: total revenue, avg margin, avg days-to-pay, exceptions per customer
- Load margin trend: weekly/monthly view of per-load margin including expenses
- Capacity utilization: % of available truck-days actually running loads
- Top 10 lanes by volume and margin: where to focus sales effort

**Finance Desktop Command Center**
- Full-width desktop layout: IFTA summary + invoice pipeline + driver settlements + revenue analytics on one canvas
- Custom date ranges: any period, not just current month
- Multi-column invoice management: filter by customer, status, amount, aging bucket
- Settlement ledger history: every driver settlement with export
- One-click quarterly package: IFTA report + P&L summary + settlement records for CPA

**Advanced Customer Portal**
- Customer login: each customer has their own portal — load history, invoice download, BOL retrieval
- Rate agreements: store agreed lane rates per customer; flag when a new load is priced outside agreement
- Recurring lane setup: customer can request a regular lane; owner approves and locks the rate
- Onboarding flow: customer completes their own profile (billing address, contact, payment method)

**Carrier Public Profile**
- Public-facing page at `carrieros.app/carrier/[mc-number]`
- Displays: MC number, safety rating, DOT number, lanes served, equipment types, endorsements
- Used for: load board credibility, broker vetting, customer referrals
- Owner controls visibility and content

**Load Board Posting**
- Post available capacity to DAT and Truckstop.com from within CarrierOS
- Load posted with truck type, lanes, available dates — no double-entry
- Inbound leads flow into load intake; owner reviews and accepts/declines

**Banking & Autopay**
- ACH setup for driver settlements: auto-pay drivers on delivery confirmation
- Recurring vendor autopay: fuel card, insurance, lease payments logged against truck
- Banking connection (Plaid): connect business checking for reconciliation view

**Team & Integrations**
- Multi-dispatcher logins: multiple dispatcher accounts with role-based permissions
- QuickBooks direct sync (vs. CSV export in lower tiers)
- Factoring integration: OTR Capital, RTS, Triumph — mark as factored, record advance, reconcile
- Priority support: dedicated channel; response within 4 hours
- NHTSA recall alerts: automatic alert on open safety recalls for any fleet truck

### Upgrade Triggers
- "Driver #4 just hit HOS risk — you need real-time alerts before violations happen"
- "Connect your ELD to eliminate manual state-line logging and auto-import hours"
- "Your fleet has 16 trucks — Enterprise includes 12 and saves you on per-truck cost"

---

## Enterprise — $349/mo (12 trucks included, +$30/truck)
**16+ trucks · Compliance-critical carrier**
*(Post-MVP — build after Pro is stable)*

For established carriers where a single compliance failure costs more than years of subscription. The unlock is proactive safety intelligence, deep integrations, and enterprise-grade operations.

### Everything in Pro, plus:

**AI Smart Dispatch**
- Load-to-driver matching: suggest best driver + truck for each load based on HOS remaining, current location, endorsements, customer history, and lane familiarity
- Availability matrix: real-time view of which drivers can legally accept which loads
- Dispatch automation: owner or dispatcher reviews AI suggestion and approves with one tap
- Smart match settings: configure weighting (prefer lowest deadhead vs. prefer rested driver)

**HOS Safety Alerts**
- Hours-of-service monitoring: track driving hours based on driver-reported status and ELD data
- Violation risk warning: alert dispatcher and driver when approaching legal limits (2-hour warning)
- Rest suggestions: flag which drivers need rest stops and projected available time
- 34-hour reset tracking: notify when driver completes reset and is available again
- Exemption support: short-haul and agricultural exemptions configurable per driver

**Enterprise Safety Risk Dashboard**
- Fleet-wide safety score: composite score by driver, truck, and route
- Incident history: DVIR defects, HOS events, delays, customer complaints — unified timeline
- Predictive risk flagging: identify drivers or trucks statistically likely to have an incident based on trend data
- DOT audit readiness: all inspection records, DVIR logs, and compliance data pre-packaged for FMCSA audit
- Safety leaderboard: rank drivers for coaching and recognition programs

**Driver Training & Certification Tracking**
- Training completion tracking: required courses per driver (HazMat, defensive driving, customer service)
- Endorsement renewal calendar: fleet-wide view of upcoming CDL endorsement expirations
- Coaching flags: link performance data to training recommendations
- Third-party training integration: connect to J.J. Keller or similar training providers

**ELD & Telematics**
- ELD/telematics integration: Samsara, Motive — location and HOS data flows into CarrierOS automatically
- Eliminates manual state-line logging: GPS from ELD replaces phone-based tracking for IFTA
- HOS data sync: ELD hours feed directly into HOS alert system

**Load Board Integration (Bi-directional)**
- DAT, Truckstop, Amazon Relay: post and receive loads in both directions
- Automated load matching: inbound load board leads matched to available capacity

**Custom Permissions & Administration**
- Beyond the 5-role model: granular permission sets per user (read-only finance, dispatch-only, view-no-edit)
- Admin audit log: every action logged with user, timestamp, and change detail
- Multi-location support: organize trucks and drivers by terminal or hub

**Enterprise Integrations & Support**
- Full API access + webhooks: push load events, driver status, and invoice data to external systems
- Custom reporting + scheduled delivery: any report emailed on a schedule to any recipients
- Dedicated account manager + white-glove onboarding
- Phone support + 4-hour SLA

---

## Feature → Tier Matrix

| Feature | Starter | Growth | Pro | Enterprise |
|---|---|---|---|---|
| **PRICING** | | | | |
| Monthly base | $49 | $99 | $199 | $349 |
| Trucks included | 1 | 3 | 6 | 12 |
| Per additional truck | +$15 | +$20 | +$25 | +$30 |
| **SAFETY & COMPLIANCE (never gated)** | | | | |
| Pre/post-trip DVIR (FMCSA templates) | ✅ | ✅ | ✅ | ✅ |
| Defect flagging + owner alert | ✅ | ✅ | ✅ | ✅ |
| Driver compliance (CDL, med cert, endorsements) | ✅ | ✅ | ✅ | ✅ |
| Fleet compliance dashboard | ✅ | ✅ | ✅ | ✅ |
| Truck + company document storage | ✅ | ✅ | ✅ | ✅ |
| Expiry alerts (30/60-day) | ✅ | ✅ | ✅ | ✅ |
| **LANGUAGE (never gated)** | | | | |
| English / Spanish / Punjabi / Urdu (EN/ES/PA/UR) | ✅ | ✅ | ✅ | ✅ |
| **TMS CORE** | | | | |
| Load management (manual + AI extraction) | ✅ | ✅ | ✅ | ✅ |
| Email forwarding intake | ✅ | ✅ | ✅ | ✅ |
| Customer visibility / tracking link | ✅ | ✅ | ✅ | ✅ |
| Invoicing + PDF | ✅ | ✅ | ✅ | ✅ |
| Document capture (POD/BOL) | ✅ | ✅ | ✅ | ✅ |
| Customer directory (notes + tags) | ✅ | ✅ | ✅ | ✅ |
| Solo mode | ✅ | ✅ | ✅ | ✅ |
| **OPERATIONS** | | | | |
| Fuel stop logging (simple) | ✅ | ✅ | ✅ | ✅ |
| Truck service log + maintenance reminders | ✅ | ✅ | ✅ | ✅ |
| Fleet calendar (single truck) | ✅ | ✅ | ✅ | ✅ |
| Fleet calendar (multi-truck) | — | ✅ | ✅ | ✅ |
| Live dispatch map | — | ✅ | ✅ | ✅ |
| **HISTORY & EXCEPTIONS (gated)** | | | | |
| Load / driver / truck history | 90 days | Unlimited | Unlimited | Unlimited |
| Exceptions Inbox | Top 3 only | Full inbox | Full inbox | Full inbox |
| Exception timelines (driver / truck / customer) | — | ✅ | ✅ | ✅ |
| Customer health scores | — | ✅ | ✅ | ✅ |
| **DISPATCH & ROLES** | | | | |
| Dispatcher role | — | ✅ | ✅ | ✅ |
| Finance role | — | ✅ | ✅ | ✅ |
| Multi-dispatcher logins | — | — | ✅ | ✅ |
| Custom permissions (beyond 5-role model) | — | — | — | ✅ |
| Offline driver mode | — | ✅ | ✅ | ✅ |
| GPS real-time tracking link | — | ✅ | ✅ | ✅ |
| Load reassignment workflow | — | ✅ | ✅ | ✅ |
| **DRIVER COMMUNICATION** | | | | |
| In-app driver messaging / chat | — | ✅ | ✅ | ✅ |
| New load push notification | — | ✅ | ✅ | ✅ |
| Status nudge from dispatcher | — | ✅ | ✅ | ✅ |
| **IFTA & FUEL** | | | | |
| Fuel stop logging (manual, per truck) | ✅ | ✅ | ✅ | ✅ |
| IFTA mileage log (auto via GPS) | — | ✅ | ✅ | ✅ |
| IFTA tax reporting hub (quarterly filing prep) | — | — | ✅ | ✅ |
| Fuel card integration + analytics | — | — | ✅ | ✅ |
| Fuel anomaly detection | — | — | ✅ | ✅ |
| ELD-based IFTA (auto-import mileage) | — | — | — | ✅ |
| **FINANCIALS** | | | | |
| Invoice auto-reminders | — | ✅ | ✅ | ✅ |
| Per-load expense tracking | — | ✅ | ✅ | ✅ |
| Driver settlement | — | ✅ | ✅ | ✅ |
| Banking / ACH autopay (driver settlements) | — | — | ✅ | ✅ |
| Dashboard + reporting | — | ✅ | ✅ | ✅ |
| CSV export (QuickBooks-compatible) | — | ✅ | ✅ | ✅ |
| CSV customer import | — | ✅ | ✅ | ✅ |
| QuickBooks direct sync | — | — | ✅ | ✅ |
| Factoring integration (OTR, RTS, Triumph) | — | — | ✅ | ✅ |
| **ANALYTICS** | | | | |
| Customer intelligence (revenue, days-to-pay, lane rates) | — | ✅ | ✅ | ✅ |
| Invoice aging by customer | — | ✅ | ✅ | ✅ |
| Revenue per mile by lane | — | — | ✅ | ✅ |
| Driver performance dashboard | — | — | ✅ | ✅ |
| Capacity utilization analytics | — | — | ✅ | ✅ |
| Advanced reporting (lane / driver / trend) | — | — | ✅ | ✅ |
| Enterprise safety risk dashboard | — | — | — | ✅ |
| **CUSTOMER & MARKET** | | | | |
| Customer tracking link (no login) | ✅ | ✅ | ✅ | ✅ |
| Customer portal (login + invoice download) | — | — | ✅ | ✅ |
| Advanced customer portal (rate agreements, onboarding) | — | — | ✅ | ✅ |
| Carrier public profile | — | — | ✅ | ✅ |
| Load board posting (DAT, Truckstop) | — | — | ✅ | ✅ |
| Load board integration (bi-directional) | — | — | — | ✅ |
| **DESKTOP VIEWS** | | | | |
| Desktop command center (Owner + Dispatcher + Finance) | — | ✅ | ✅ | ✅ |
| Finance desktop hub (IFTA + settlements + analytics) | — | — | ✅ | ✅ |
| **SAFETY INTELLIGENCE** | | | | |
| NHTSA recall alerts | — | — | ✅ | ✅ |
| HOS safety alerts + violation risk warnings | — | — | — | ✅ |
| AI smart dispatch | — | — | — | ✅ |
| Driver training + certification tracking | — | — | — | ✅ |
| DOT audit readiness package | — | — | — | ✅ |
| **INTEGRATIONS** | | | | |
| ELD/telematics integration (Samsara, Motive) | — | — | — | ✅ |
| API access + webhooks | — | — | — | ✅ |
| Custom reporting + scheduled delivery | — | — | — | ✅ |
| **SUPPORT** | | | | |
| In-app support | ✅ | ✅ | ✅ | ✅ |
| Priority support (4-hour response) | — | — | ✅ | ✅ |
| Dedicated account manager | — | — | — | ✅ |
| Phone support + SLA | — | — | — | ✅ |

---

## Gating Rationale

### Why history is gated at 90 days on Starter
90 days covers day-to-day operations with no friction. The wall hits at tax time and when a carrier needs to pull a prior-year lane rate or dispute a payment. That's exactly when upgrade value is obvious.

### Why Exceptions Inbox is limited to 3 on Starter
Three items is enough to see the feature and understand its value — but not enough to manage a real business. The badge count always shows the true total ("8 items"), so the carrier knows what they're missing. Loss aversion does the rest.

### Why IFTA mileage log is Growth but tax hub is Pro
Mileage recording is operationally necessary for any multi-state carrier and is the groundwork for Pro's tax automation. Giving it at Growth builds the data set that makes the Pro upgrade immediately valuable — the carrier arrives at Pro with a full year of mileage data already there.

### Why HOS alerts are Enterprise-only
Hours-of-service monitoring requires reliable continuous location data, which means ELD integration. ELD integration is Enterprise. Standalone HOS monitoring without ELD data would be inaccurate and potentially dangerous. The full feature requires the full integration.

### Why desktop views start at Growth
A solo owner-operator (Starter) is on their phone. The first person who needs a desktop command center is the owner-manager who no longer drives — that happens at Growth when they have drivers and a dispatcher.

### Why safety and language are never gated
DVIR and driver compliance are legally required for commercial carriers (FMCSA 49 CFR 396.11). Gating them would create liability. Language support is a cultural inclusion feature central to the CA pilot — gating it would undercut our core differentiator and harm the driver community we're trying to serve.

### Why the CA pilot gets Growth free for 90 days
Experience with the full product, not the limited one. After 90 days, converting to $99/month to keep what they have is easy. Converting from Starter (paying for something new) is harder.

---

## Scope Exclusions (Deliberate)

These features appear in competitor products but are excluded from CarrierOS's roadmap for now:

| Feature | Why Excluded |
|---|---|
| AI voice assistant | Unvalidated for this market; adds native mobile complexity without clear ROI |
| AI lumper fee negotiation | Niche broker-side workflow; not carrier-facing |
| Multi-hub / multi-location management | Beyond 25 trucks; not our target market |
| White-label customer portal | Enterprise edge case; revisit post-scale |

**Removed 2026-09-21:** "In-app support ticketing system" is no longer excluded — see `decisions.md`
T16. Reversed the original "handle with email + Intercom externally" call: native, AI-triaged ticketing
(routing to CarrierOS support, or — Enterprise-gated — an org's own support staff) turned out to be a
real Enterprise cost-reduction argument, not just admin overhead, and this codebase's existing auth/org/
RLS/entitlements plumbing makes building it cheaper than bridging a third-party tool via SSO.

---

## Competitive Pricing Context

| Competitor | Price | What it covers | Gap vs. CarrierOS |
|---|---|---|---|
| TruckingOffice | ~$20/mo | Dispatch + invoicing + IFTA | Dated UX, no mobile, no DVIR, no language support |
| Toro TMS | $19–$49/mo | Dispatch + invoicing | No mobile, no DVIR, no compliance, no language support |
| TruckLogics | $39.95+/mo | Dispatch + IFTA + invoicing | Complex UI, no DVIR, no maintenance, no language |
| Rose Rocket | $233+/mo | Full TMS + AI | Far too expensive and complex for micro-carrier |
| Motive | $35–$50/truck/mo + hardware | ELD + compliance only | Not a TMS — no dispatch or invoicing; hardware cost $250–450 |
| Fleetio | $4–$10/truck/mo | Fleet maintenance only | Not a TMS — no dispatch or invoicing |
| Fleetio + Toro TMS | ~$100–130/mo (5 trucks) | Maintenance + basic TMS | Two products, two logins, no AI, no language |
| **CarrierOS Starter** | **$49/mo** | **Full TMS + DVIR + compliance + 4 languages (EN/ES/PA/UR)** | **Nothing comes close at this price** |
| **CarrierOS Growth** | **$99/mo** | **Above + exceptions + history + roles + GPS + IFTA mileage + driver chat + desktop** | **Replaces Fleetio + Toro at better price with single login** |
| **CarrierOS Pro** | **$199/mo** | **Above + full IFTA tax hub + fuel analytics + driver performance + load board** | **Replaces TruckLogics + Fleetio + ELD for mid-size fleet** |

---

## Pricing Risks & Open Questions

| # | Risk / Question | Recommendation |
|---|---|---|
| 1 | Will $49 convert spreadsheet users vs. old $29? | Run A/B on pricing page during pilot; if conversion < 40%, consider 14-day free trial with no card |
| 2 | Annual discount | 2 months free (~17%) on annual; Growth annual = $990/yr vs. $1,188/mo |
| 3 | 90-day history limit — will it feel punitive? | Frame as "90-day active view" not "limited access"; make the upgrade banner helpful, not guilt-driven |
| 4 | Validate "included trucks" model with pilot | Ask: "Do you prefer flat $49 for 1 truck + $15 each, or just $79 for up to 3?" |
| 5 | DVIR: do pilot carriers do paper DVIRs today or skip them? | Determines whether to frame DVIR as compliance upgrade or convenience feature in onboarding |
| 6 | Could a freemium tier (1 truck, 10 loads/month, no DVIR) drive top-of-funnel? | Consider post-pilot if paid conversion is < 35% |
| 7 | Will Pro IFTA hub displace TruckingOffice users? | Yes — but only if the quarterly filing export is CPA-ready. Needs validation with a real CPA. |
| 8 | Desktop at Growth — will owners actually use it? | Validate during pilot — if owners stay on mobile even when managing 3+ trucks, delay desktop build |

---

*Version 4.0 — July 2026. Supersedes v3.0. Validate Pro/Enterprise feature set with pilot feedback before building.*
