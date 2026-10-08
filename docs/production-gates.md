# CarrierOS — Production Readiness Gates

_Drafted 2026-07-22. Prompted by a direct question: what does the path to production look like, and
how do we make sure each phase of building an AI-native SaaS product has a real audit gate, not just
a hope that things are fine? This document is the durable answer — a standard to hold every future
phase to, not a one-time checklist for right now._

---

## 0. Purpose

Software maturity here is phase-gated: each phase below has an **entry point** and an **exit gate**.
The gate is a set of conditions that must be true before advancing — not a nice-to-have list, a real
blocker. The point of writing this down is the same reason `docs/architecture-principles.md` and
`docs/design/ux-foundations.md` exist: so standards survive past the conversation that produced them,
and a future session (or a new engineer) can check "are we actually allowed to call this phase done?"
against something concrete instead of a feeling.

**How this relates to the other two standards documents:**
- `docs/architecture-principles.md` governs how code is structured (query encapsulation, response
  DTOs, exhaustive enum handling). It's a *quality* standard, checked continuously.
- `docs/design/ux-foundations.md` (and its CarrierOS-specific companion) governs visual/UX
  consistency. Also a *quality* standard, checked continuously.
- This document governs *when a phase is actually complete* — it's the gate those quality standards
  (and everything else: testing, security, ops) get checked against at specific decision points.

**This document does not prescribe a timeline.** "Early cycle" is explicit context — the gates exist
so that moving fast doesn't quietly trade away the things that make moving fast *safe*, not to slow
anything down for its own sake.

---

## 1. The phases

| Phase | What it means | Who's using it |
|---|---|---|
| **0 — Foundation** | Core data model, auth, tenant isolation, first vertical slice of real features | Nobody outside development |
| **1 — Internal Alpha** | The team and a few trusted users run real workflows against it | You, maybe 1-2 friendly early users |
| **2 — Private Beta** | A handful of real external carriers, with data that matters to someone | A small, curated set of paying or soon-to-pay customers |
| **3 — Public Beta / GA** | Anyone can sign up | The open market |
| **4 — Scale** | Growth-driven; multiple engineers; possibly multiple products sharing infrastructure | Many customers, many contributors |

**CarrierOS is in Phase 0 as of 2026-07-22.** See §4 for the honest current-state mapping.

---

## 2. Gate criteria per phase

Each gate below is written as a yes/no condition — if any answer is "no," the phase isn't actually
exited, regardless of how much feature work has shipped.

### Gate 0 → 1 (Foundation → Internal Alpha)

- [ ] An automated test suite covers the highest-risk paths: authentication/onboarding, tenant
  isolation (RLS), the core entity lifecycle (loads, in this product), and billing/invoicing logic.
  Manual, one-time verification (however careful) does not satisfy this — it doesn't protect against
  regression on the *next* change.
- [ ] CI runs typecheck + the test suite + a schema replay (per `supabase/schema/README.md`) on every
  change, automatically — not something a person remembers to run.
- [ ] Every documented architecture/design standard (`architecture-principles.md`,
  `ux-foundations.md`) has at least one real, working example in the codebase — proof the standard is
  followed, not just written.
- [ ] AI-dependent features (load extraction, etc.) have a documented failure mode — what happens when
  the model call times out, rate-limits, or returns malformed output — rather than an unhandled
  exception.

### Gate 1 → 2 (Internal Alpha → Private Beta)

- [ ] Basic observability exists: error tracking (e.g. Sentry-equivalent) and structured logs for API
  routes, at minimum on auth, billing, and any AI-call path.
- [ ] Billing is either real (a live Stripe integration, not the demo seam) or explicitly, visibly
  gated off from anything a real customer could trigger.
- [ ] AI-extraction accuracy has a regression test against a golden set of real-shaped inputs — a
  prompt or model change should not be able to silently degrade accuracy with nobody noticing.
- [ ] Every external user of the system (a real carrier) has been through a cross-tenant isolation
  test personally verified for their specific data — not just "the RLS policy exists," but a
  deliberate attempt to read another org's data and confirm it fails.

### Gate 2 → 3 (Private Beta → Public Beta / GA)

- [ ] Rate limiting and basic abuse prevention exist on any publicly reachable endpoint (signup,
  public tracking links, any future public API).
- [ ] The SuperAdmin console has a real UI (not API-only), 2FA or an equivalent elevated-auth
  requirement, and an audit-log view of every privileged action taken.
- [ ] A systematic (not spot-check) security review of the full RLS policy surface has been done —
  every table, every policy, checked against the cross-tenant isolation test, not just the tables
  touched by recent feature work.
- [ ] Cost/usage observability exists for anything metered (AI token spend, storage, etc.) per
  organization, so a runaway process or an abusive account is visible before it's a billing surprise.

### Gate 3 → 4 (Public Beta/GA → Scale)

- [ ] The architecture-principles.md gaps are actually closed in code, not just documented: hot-table
  query encapsulation (Rule B) and explicit API response DTOs (Rule C) exist for the entities under
  the most cross-team/cross-product traffic. At scale, an ad hoc `.from()` call or a raw-row API
  response is what turns a routine column rename into a multi-day incident.
- [ ] The design system's Core/product-specific split (per `ux-foundations.md`) has been exercised by
  at least one additional product, proving it's actually reusable and not just theoretically so.
- [ ] On-call/incident response process exists — who gets paged, how a postmortem gets written, what
  counts as an incident.

---

## 3. AI-native-specific concerns (apply across every phase, not just one gate)

These are easy to defer because they don't block a demo — but they're exactly the things that bite an
AI-native product specifically, later and harder than a normal SaaS gap would:

- **Extraction/generation accuracy regression tests** — any feature relying on an LLM call (load
  extraction today; anything future) needs a golden-set test, not just "it looked right when I tried
  it."
- **Graceful degradation on AI failure** — timeouts, rate limits, and malformed output are not edge
  cases for a product depending on a third-party model API; they are Tuesday. Every AI-dependent code
  path needs an explicit fallback, not an unhandled exception.
- **Cost observability** — token spend is a real, variable cost that scales with usage in a way
  traditional compute costs don't; visibility per-org from day one avoids an unpleasant surprise later.
- **Model/prompt versioning** — treat a prompt change with the same rigor as a schema change: know
  what changed, when, and be able to correlate a behavior change back to it.
- **Data handling for AI processing** — confirm what's actually sent to a third-party model API (full
  documents? just extracted fields?) and that this is consistent with what the product's privacy
  posture claims to customers.

---

## 4. Where CarrierOS actually is (honest mapping, 2026-07-22)

**Phase 0, Gate 0→1 is now partially met** — the test suite exists and passes; CI is deliberately
deferred (no git remote configured yet, so GitHub Actions can't run — a real infra decision, not an
oversight). Specifically:

| Gate 0→1 criterion | Status |
|---|---|
| Automated test suite (auth, RLS, load lifecycle, billing) | 🟢 Met. Web: Vitest, `carrieros-web/tests/`, 40 tests across 7 files — the original 4 (tenant-isolation RLS, onboarding, load lifecycle, billing) plus driver-messages (role/entitlement gating, translate caching), settlements (role/tier gates, exact pay-calc), and exceptions/health-score (tier boundaries, formula, cross-org isolation). Mobile: Jest + jest-expo, `carrieros-mobile/tests/`, 34 tests (status-pill exhaustiveness, exceptions sort/dedup, i18n predicates) — mobile had zero test infrastructure before 2026-07-22. Every web test creates/tears down disposable data, confirmed zero residue. Not yet covering: mobile component/screen-level tests (deferred pending a proven Supabase-mock + native-module-shim pattern), ~40 other API routes. |
| CI running typecheck + tests + schema replay | ❌ Deliberately deferred — no git remote exists yet, so GitHub Actions has nothing to run against. Revisit once this repo has one. |
| Architecture/design standards have real examples in code | 🟡 Partial. `architecture-principles.md` Rule A is now fully applied — no known duplicated status-color logic remains in `carrieros-web` (9 modules/pages migrated across two waves, 2026-07-22). Rules B and C now have their first real applications too: `lib/queries/profiles.ts` (20 call sites migrated) and explicit response DTOs on the routes §2 specifically cited as violations (`api/customers`, `api/drivers`, `api/vehicles`, customer-contacts). Both are deliberately incremental, not full-codebase migrations — most of `profiles`' 56 raw call sites and ~20 other API routes remain unmigrated. `ux-foundations.md`'s Core component library (`components/ui/`) is built and committed in the parallel session, and this session's Wave 1/2 migrated the pages that consume it onto real `<StatusBadge>` usage. Mobile's status-color copy still unmigrated. |
| AI failure-mode handling documented | 🟢 Met. `extract-load` distinguishes rate-limit/auth/provider-outage/malformed-output failure modes (structured logging via `lib/observability.ts`), and a golden-set accuracy regression test now exists (`tests/extraction.golden.test.ts`, 4 realistic rate-confirmation shapes, run via `npm run test:extraction` — excluded from the default `npm test` since it hits the real Anthropic API). |

**A real bug the test suite itself caught while being built, worth recording as evidence this is
already paying for itself**: the test helper's cleanup function (`cleanupTestOrg`) initially left
orphaned test data behind because `drivers.profile_id` and `load_events.created_by` both reference
`profiles(id)` with no `ON DELETE CASCADE` — deleting a profile while either still pointed at it
silently failed. Found by checking the database directly after a run, not assumed clean; fixed by
reordering cleanup (drivers → loads → profiles → organizations) and by making the final delete's
error surface loudly instead of failing silently.

**What IS in good shape, worth noting so it isn't re-litigated:** the schema-change verification
discipline (replay + regen-types + tsc, now with the Rule E impact-analysis step), the RLS
cross-tenant isolation pattern (checked per-feature, consistently, all session), and the
`SECURITY DEFINER` centralization pattern are all genuinely solid foundations for the phases ahead —
they just haven't been backed by automation yet.

### 4a. Feature completeness — a different axis, tracked separately

Everything above is about *quality/infra* readiness (this document's actual scope). It says nothing
about whether the product's *feature surface* actually matches the PRD. That's now tracked in
`docs/feature-completeness-audit.md` (2026-07-22, evidence-based — every row cites a checked file
path, not a summary of prior claims) — do not conflate its build-phase numbering (0–9, from
`resume.md`/`decisions.md`) with this document's readiness-phase numbering (0–4); they are unrelated
systems, a mistake the audit itself calls out explicitly.

Headline finding: several PRD P0 (MVP, all-tier) items have **no implementing code at all** — manual
load entry and PDF/image upload are explicitly disabled in the UI ("Coming soon"), there's no
Accept/Decline load action, no invoice PDF download or pre-send review/edit, no CSV export of
loads/revenue, no Company Documents UI (schema exists, page is a one-line stub), and no bulk customer
CSV import. Driver Settlement has a real, tier-gated API but zero UI in either app and a pay
calculation that's an explicitly-labeled placeholder. Two declared mobile dependencies
(`expo-location`, `expo-notifications`) are never imported anywhere — GPS location-sharing and push
notifications look present in a `package.json` skim but have no code behind them. The full ranked list
is in that document's "Top Gaps" section — it should be read before any "ready to deploy" claim, since
none of the criteria in the table above would have caught any of these gaps.

---

## 5. How to use this document

- Before declaring a phase "done," check its gate table above literally, item by item.
- When a gate criterion is met, note it here with a date, the same way `architecture-principles.md`
  and `ux-foundations.md` track changes in their own Changelogs.
- If a gate criterion turns out to be wrong or premature for this product's actual trajectory, change
  it explicitly and say why — don't silently skip it.

---

## Changelog

| Date | Change |
|---|---|
| 2026-07-22 | Initial version — five-phase gate framework, AI-native-specific section, honest current-state mapping (Phase 0, Gate 0→1 not yet met). |
| 2026-07-22 | Test suite built (Vitest, 23 passing tests: RLS isolation, onboarding, load lifecycle, billing role-gating). CI deferred pending a git remote. AI-extraction failure-mode handling improved (still no automated regression test). |
| 2026-07-22 | Test coverage expanded to 40 web tests (+driver-messages, settlements, exceptions/health-score) and mobile got its first test suite ever (Jest+jest-expo, 34 tests) — Gate 0→1's test-suite criterion now fully met. Found and fixed a real live bug in the process: `driver_message_translations` had no INSERT RLS policy, so every real translation request 500'd. Also added `docs/feature-completeness-audit.md` — a first systematic check of the product's actual feature surface against the PRD, a different axis from this document's infra/quality gates; several PRD P0 items were found to have no implementing code at all (see §4a). |
| 2026-07-22 | Wave 1/2 of the `components/ui/` page migration completed: 9 pages/modules across web now render status via `<StatusBadge>` + shared Rule A modules, closing out that architecture-principles.md rule. Verified via tsc, the full Vitest suite, and browser spot-checks each wave. |
| 2026-07-22 | Golden-set AI-extraction regression test added (`tests/extraction.golden.test.ts`, 4 cases, run via `npm run test:extraction`), closing the last open Gate 0→1 item. Gate 0→1 is now fully met except CI (still deliberately deferred, no git remote). |
