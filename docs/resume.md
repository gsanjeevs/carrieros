# CarrierOS — Session Resume
_Last updated: 2026-10-07 (docs moved into the repo; catch-up entries for 2026-09-22 → 2026-10-01 below)_

## Docs moved into the repo (2026-10-07)

This file and the rest of the former Zoho WorkDrive product docs now live in the main repo at
`~/code/carrieros/docs/` (tracked in git; `/docs` removed from `.gitignore`), replacing the
gitignored Zoho symlink. Anything below that says "Zoho Drive", "open Cowork and select the Carrier
Portal folder", or "Cowork Write tool is blocked on Zoho paths" is historical. Same pass: refreshed
`docs/carrieros-db/schema.sql` from `supabase/schema/schema.sql` (it had drifted badly — 890 vs
6,212 lines); fixed `decisions.md`'s stale "Last updated" header; added `carrieros-mcp` to
`strategy/tech-spec.md` §5.7 and `strategy/prd.md`; marked `feature-completeness-audit.md` as a
point-in-time snapshot.

**Where current status lives now** (this file is a dated history, not the live board):
`CURRENT_WORK.md` (active/recently finished work across concurrent Claude + Codex/GPT sessions —
read it before starting anything), `git log`, `architecture/deployment.md`, and
`architecture/infrastructure-as-code.md`.

## Staging cut over to CDK-managed infrastructure (2026-09-30 → 2026-10-01)

Source of truth: `architecture/infrastructure-as-code.md` (full evidence trail) and commits
`bc4897f` → `4a96e2a` on `origin/main`.

- **AWS CDK v2 (TypeScript) in `infra/`** (`bc4897f`, 2026-09-30): one app, two environments
  parameterized by `infra/config/{staging,production}.ts`. Stacks: `CarrierOS-<env>-Network`,
  `-Ecr` (image-retention policy on the existing `carrieros-web`/`carrieros-mcp` repos),
  `CarrierOS-staging-Services` (Express Gateway services `carrieros-web-staging-cdk` +
  `carrieros-mcp-staging-cdk`), and `CarrierOS-production-Services` (custom ALB + Fargate + WAF —
  **written and synth-clean, never deployed**). Staging and production deliberately use different
  constructs because Express Gateway has no custom-domain parameter and hides its ALB (no WAF).
- **Deployed and live-verified on staging** (`1144d1a`, 2026-09-30): `cdk diff` was entirely
  additive; web serves the real app at `https://ca-4f7c487503aa47609a79a96746866bb8.ecs.us-east-1.on.aws`,
  MCP at `https://ca-f68d8ab0d62b4f638db9eaec01052b4f.ecs.us-east-1.on.aws`; a real MCP `tools/call`
  (`list_vehicles`) returned real Sierra Freight Co data through the new web service. New
  `scripts/staging-pause.sh` / `staging-resume.sh` (target only the `-cdk` services).
- **Staging is always-on, `minTaskCount: 1`** (`35b10ac`, account owner's decision): Express Gateway
  autoscaling is CPU-based and can never scale up from zero tasks, so 0 means "down until a human runs
  a script". `cdk deploy` restores 1, so it un-pauses a paused environment.
- **Cutover, reversible half** (`405afe8`, `b5d8281`): `buildspec.yml`, `carrieros-mobile/eas.json`
  staging profiles, and `check-staging-drift.mjs` repointed at the CDK service; the CodeBuild service
  role's IAM policy was hand-widened to include the `-cdk` service ARN (would otherwise `AccessDenied`).
  Proven with a real push: commit `405afe8` auto-built, rolled `carrieros-web-staging-cdk`, and served
  at `/api/version` ~6 min after the build went green.
- **Cutover, irreversible half** (`4a96e2a`, 2026-09-30 evening Pacific = 2026-10-01 UTC, with the
  account owner's direct go-ahead): staging Supabase's WebAuthn RP ID/origin moved to the CDK web
  hostname via the Management API (`PATCH /v1/projects/{ref}/config/auth` — `supabase config push`
  silently ignores `webauthn_*` fields), verified by an independent re-`GET`. Then the original
  hand-built `carrieros-web-staging` and `carrieros-mcp-staging` were **deleted**, with the CDK web
  service returning `200` on every poll throughout. **Staging is now sole-sourced from the CDK pair.**
  The old hostnames (`ca-aa167deb…` web, `ca-185d9362…`/`ca-7dc84edc…` mcp) are gone for good —
  Express Gateway hostnames are not deterministic.
- **Still manual / not in CDK**: the CodeBuild project, SES identity + SNS bounce topic, SMTP IAM
  user, the Supabase project. **Production does not exist** — gated on a production Supabase project,
  a registered domain (none on the account), ACM/HTTPS, and SES domain verification.

## Auto-deploy pipeline, SMTP, mobile EAS, and the public-API staging gap (2026-09-29)

Source: `architecture/deployment.md`, `CURRENT_WORK.md`.

- **Staging auto-deploys on push to `main`** via AWS CodeBuild project `carrieros-web-staging-deploy`
  (GitHub connection `sx-github`, webhook on `PUSH` to `main`, repo-root `buildspec.yml`: ECR login →
  `docker build` → push → `aws ecs update-express-gateway-service`) — `d608a32`, documented in
  `3f9a195`. Least-privilege role `carrieros-codebuild-staging-deploy`. Ordering caveat: it does not
  wait for CI or the migration-only `deploy.yml` workflow, so a schema-coupled release can briefly run
  before its migration. A green build is not proof of deployment — check `/api/version` /
  `check-staging-drift.mjs`. (This closes the 2026-09-21 note below that `deploy.yml`/`deployment.md`
  still described Vercel.)
- **Real outbound email on staging** (`3e17da4`): SES single verified sender `sanjeev@shipmentx.com`,
  production access granted, IAM user `carrieros-ses-smtp-staging`, creds in Secrets Manager
  `carrieros-staging/SMTP_CREDENTIALS`, pushed to Supabase Auth from a scratch config. The previously
  failing customer-contact invite e2e spec now passes against staging (suite 5/6; `loads.spec.ts`
  failed on an unrelated timeout). Bounce/complaint notifications routed to an SNS topic on 2026-09-30
  (`645e3c0`).
- **Mobile**: EAS project registered (`@gsanjeevs/carrieros-mobile`, `86d1dc6`), `staging` profile
  points at staging web/Supabase, plus a `simulator` profile (`9e30c10`). Production profile values
  are still `REPLACE_WITH_*` placeholders.
- **`PUBLIC_API_JWT_SECRET` was never set on staging** until 2026-09-29 (`21ff7b4`) — every public
  API call had been 500ing despite the feature being "built". Found while verifying `carrieros-mcp`
  against staging. Lesson: built + deployed ≠ working until a real request proves it.

## `carrieros-mcp` — a separate repo and hosted service (2026-09-28 →)

Not part of this monorepo: `~/code/carrieros-mcp`, `github.com/gsanjeevs/carrieros-mcp`. An MCP
server exposing the **public developer API** (`/api/public/v1/*`) as read-only LLM tools
(`list_loads`, `get_load`, `list_invoices`, `get_invoice`, `list_vehicles`, `list_exceptions`,
`list_financial_events`). Initial commit `12ac4d3` (2026-09-28); hosted multi-tenant HTTP transport
the same day (`3b958b7`, stateless, per-request tenant credentials); MCP OAuth 2.1/PKCE for remote
connectors such as ChatGPT (`c4040b0`, 2026-09-29). Authenticates with the same Developer API OAuth
client credentials any integration uses, so it can see nothing the public API doesn't expose.
Hosted only on staging, now as `carrieros-mcp-staging-cdk` (defined in this repo's `infra/`); no
production deployment, and no auto-deploy for its image yet. Drivers are not exposed: the public
API's least-privilege `finance` actor lacks the `drivers` capability, an open product decision.

**Phase 9 status, superseding the older entries below**: the public developer API **is built and
merged** — OAuth 2.0 client-credentials (T14, not API keys), Growth+ gated. Base loads/invoices API
committed 2026-09-21 (`4e8ecf5` migration 0025, `ea8a509` routes); `financial-events` added with the
T19 accounting-readiness work (`5c11b44`, 2026-09-23); `vehicles`/`exceptions`/`drivers` merged
2026-09-28 (`0c72280`), with `drivers` routed but refused.

## Other work 2026-09-22 → 2026-09-28 (pointer, not a full log)

Well over 100 non-merge commits landed on `main` in this window; `git log --since=2026-09-22` is the
record. Headline items, by commit subject: platform-admin Role Capabilities screen, Debug/Error Log
viewer, and org outbound webhooks (09-24); last mobile/web legacy-route migrations onto `/api/v1`
(09-24); self-service profile avatars, live dispatch map, Samsara + Motive telematics integration
(09-26); `/api/version` + staging drift check, DAT load-board posting Phase 1, 24-language i18n with
timezone-aware dates, load-detail tabs, breadcrumb back-navigation, multi-session coordination via
`CURRENT_WORK.md` (09-27); SX admin audited support view/ticket inbox/analytics (Codex, merged to
`main`); test-suite orphaned-org leak fixed (09-27).

## Fresh verification pass (2026-09-21, Cowork) — checked the log's claims against actual repo state

Ran because the user has been working via a separate Claude Code session for 2 days and asked to
verify the self-reported log rather than trust it blindly. Findings:

**Branch state — confirmed clean.** `main` and `api-writes` are the exact same commit (`50c6c6b`), and
both match their `origin` remotes exactly. No divergence, nothing dangling.

**Phase 9 (public developer API) — real, but NOT committed.** The working tree (on `api-writes`, same
commit as `main`) has uncommitted, untracked work: `supabase/migrations/0025_public_developer_api.sql`,
OAuth client service/repository code (`server/application/oauth-client-service.ts`,
`server/domain/oauth/`, `server/infrastructure/supabase/oauth-client-repository.ts`), public API routes
(`app/api/public/`, `app/api/v1/oauth-clients/`), and a developer-API settings page
(`app/(app)/settings/developer-api/`). Also several tracked files are modified but unstaged (generated
API types, `schema.sql`, `verify-migrations.mjs`, `gen-erd.mjs`, `messages/*.json`, `Sidebar.tsx`, an
invite route). **This work will be lost if the working tree is reset or the machine changes** —
whoever's driving Claude Code should finish and commit it, or at minimum `git stash` it, before doing
anything else destructive in that checkout.

**`feature-completeness-audit.md`'s 4 remaining P0 gaps — 3 of 4 are actually resolved, only 1 is
still open.** This corrects both that doc (updated in place, see its own entries) and this file's
9-21 addendum, which had passed along the audit doc's stale claim without re-verifying:
- Manual load entry — **resolved** (real form, `ManualLoadForm.tsx`).
- PDF/image load-intake upload — **still genuinely open** (disabled card, "coming soon" label, in
  `loads/new/page.tsx:57-70`). This is now the ONLY confirmed-open item of the original 4.
- Accept/Decline load action — **resolved** (`declined` status + real Decline button in
  `DispatchPanel.tsx`, explicitly citing the original PRD gap in its own code comment).
- Invoice review-before-send + CSV export — **resolved** (`EditInvoiceCard.tsx` draft-edit step,
  `PrintButton.tsx` print/PDF path, `/api/loads/export` RFC-4180 CSV route — all three cite the
  original gaps directly in their header comments).
- **Open follow-up, not yet checked**: mobile parity on load creation and accept/decline wasn't
  confirmed present or absent — don't assume either way until someone greps `carrieros-mobile` directly.


## Addendum to the addendum below (2026-09-21, same day, different tool session) — PRD/decisions.md updates

Two things landed after the entry below was written, via `architecture-principles.md`/PRD/`decisions.md`
directly (not code): **T14** — public API auth changed from the PRD's original "API keys, not OAuth" to
OAuth 2.0 client-credentials (the Phase 9 work in progress already matches this, no code change needed
from the switch itself). **T15** — passkey/WebAuthn added as a login option for every role including
platform staff, web via Supabase's passkey API (already on a new-enough `supabase-js`), mobile needs a
separate native-bridge effort — not yet built, tracked as new work. Also fixed two stale-doc issues
found while making these edits: the PRD's Super Admin roadmap line still described the original
(reversed) separate-auth-table design as current, and `decisions.md`'s "OPEN QUESTIONS" section still
listed 4 questions that were already answered in R1–R4 years... well, months ago. See `architecture-principles.md`
Rule I for a running list of "requirement existed, wasn't honored" findings if continuing that thread.

## Session addendum (2026-09-21) — mobile API migration COMPLETE, main synced, first AWS deployment (moved off Vercel), staging live+seeded+E2E-verified, Phase 9 (public API) in progress

**Mobile API-only migration finished**: 66 direct Supabase calls across 30 files -> **0 in 0 files**. Two large batches (existing-route wiring, then new backend endpoints for customers/billing/settlements/maintenance/IFTA-summary/fuel-stops/chat/exceptions/dashboard) plus a small cleanup batch for 2 files (`use-locale`/`use-theme`) that fell through the cracks between batches. Each batch independently re-verified against a freshly-restarted dev server before trusting it (see gotcha below) — one batch's self-reported "16/16 security tests passing" was actually a stale-server false alarm on first check, genuinely passing after restart. New `GET /api/v1/me/preferences` endpoint added for the last 2 files. All pushed to `main` (was `307e529`, now several commits ahead) — `api-first`/`foundations` turned out to be strict ancestors of `api-writes` (one linear history, not 3 diverged branches as earlier addenda assumed), so no reconciliation was actually needed, just a fast-forward.

**CI genuinely green on GitHub for the first time this repo has ever had it** (prior addenda's "CI green" was PR-level, this is `main`). Real bug found+fixed: npm 22 (CI's pinned version) resolves `package-lock.json` differently than local npm 12/npm 10, producing `Missing: @swc/helpers@0.5.23 from lock file` — different root cause than the earlier-logged npm-12-vs-10 lockfile issue, same class of bug. Fix: reproduce with `nvm install 22 && nvm use 22`, not whatever's locally active.

**Deployed off Vercel to AWS ECS Express Mode** (user's call — wanted to move off Vercel, has AWS access, doesn't want to hand-wire IAM/OIDC). `deploy.yml`/`architecture/deployment.md` still describe the Vercel path; **not yet updated for AWS, this is now stale documentation**. Real infra created: ECR repo `carrieros-web`, a new default VPC (account had none, and an old non-default VPC had zero internet connectivity), 2 IAM roles, Express service `carrieros-web-staging` in the `default` cluster. Three real bugs hit building this (all now in `.claude/memory/project_ecs_express_staging_deploy_2026_09_20.md`, read before touching this again): local Apple-Silicon Docker builds are arm64 by default, Fargate wants x86_64 (`docker buildx build --platform linux/amd64 --push`); AWS's own documented managed policy `AmazonECSInfrastructureRoleforExpressGatewayServices` is missing `ec2:DescribeAccountAttributes`, silently stalling every resource in `PROVISIONING`; a non-root container user can't bind port 80 on Linux (moved to port 3000). Live: `https://ca-aa167deb702e4a338c4370ff70576195.ecs.us-east-1.on.aws`. `SUPABASE_SERVICE_ROLE_KEY` wired via AWS Secrets Manager (`secrets` field on the ECS container def, not a literal env value).

**Staging Supabase project's database had never been migrated** (project existed, keys worked, but no schema at all — `/rest/v1/profiles` was 404, not 401). All 24 migrations applied via `DATABASE_URL` fetched from Secrets Manager straight into `node scripts/db/migrate.mjs`. Then seeded matching demo data (`carrieros-web/scripts/seed-staging-demo.mjs`, now committed/reusable) — `demo@carrieros.dev` (owner, "Sam Rivera" to match the existing e2e assertion), `mike.driver@carrieros.dev`, `info@shipmentx.com` (sx_owner), Sierra Freight Co org, 2 vehicles, 3 loads (one advanced to `invoiced`, one `dispatched` to the driver), 1 customer (auto-numbers `C-1`).

**Playwright E2E suite built from scratch** (none existed before) — 6 specs (auth, loads, invoices, driver, admin, customer-contacts-portal-invite). `playwright.config.ts` now supports `PLAYWRIGHT_BASE_URL` to target *any* deployment, not just a local dev server — used it to run the whole suite against live staging: **5/6 passing** (real browser, not API pings). The 6th (customer-contact invite email) fails only because staging has no SMTP configured, a known deferred gap, not a bug — the UI assertions before that point all pass, confirming the invite itself works.

**Phase 9 (public developer API) — design decided, build in progress** (background agent at time of writing, not yet merged/verified): OAuth 2.0 client-credentials grant (not API keys — user's explicit call, more standard/enterprise-grade), Growth-tier+ gated via the existing `has_feature()` model, v1 scope is read-only (`GET` loads/invoices under `/api/public/v1/**`, separate trust boundary from both the internal `/api/v1/**` and legacy `/api/**`), Postgres-based rate limiting (no new infra dependency), new `oauth_clients` table with bcrypt-hashed secrets, client-management UI under Settings. Check git log / this file's next addendum for whether it actually landed.

**Real gotchas from this session worth not re-discovering**: zsh's `!` history-expansion silently mangles connection strings containing `!` even inside quotes (both single and double, interactively) — symptom is a misleading `password authentication failed` or `event not found`, not an obvious syntax error; fix is `set +H` before typing/pasting. Supabase's connection-string UI can default to showing the **pooler** host (`*.pooler.supabase.com`) instead of the **direct** connection migrations need (`db.<ref>.supabase.co`) — same misleading auth-failure symptom. `psql` isn't in PATH by default on this Mac even after `brew install libpq` (keg-only formula) — use `/opt/homebrew/opt/libpq/bin/psql`. The Zoho WorkDrive `docs/` symlink needs Full Disk Access granted to the **resolved** binary path (`/opt/homebrew/Caskroom/claude-code/<version>/claude`), not the `/opt/homebrew/bin/claude` symlink — plus a genuine gateway process restart (check the PID actually changed) before it takes effect.

**Cross-checked `feature-completeness-audit.md` + `production-gates.md` (both 2026-07-22/23) against today's actual state while answering "what's remaining"**: found those two docs are themselves now internally inconsistent with each other in places — this file's own "Build Order Remaining" list below still says Phase 8/Growth-tier-features "not built," but `feature-completeness-audit.md`'s "Top Gaps" section has both marked resolved 2026-07-23 with verification detail. Trusted the audit doc (more specific/evidence-based) over this file's stale list, but this was NOT independently re-verified this session — a real re-audit pass would be worth doing before relying on either doc further. The 4 P0 gaps the audit doc found genuinely unresolved (manual load entry UI, PDF/image load-intake upload, Accept/Decline load action, invoice PDF/review-before-send) were NOT touched this session and are presumably still open.

## Session addendum (2026-09-20, overnight unsupervised run) — mobile writes COMPLETE (branch `api-writes`)

Phases (each ended with an eval gate: full web+mobile suites, verify-migrations, ERD check, compliance; simulator where UI-affecting):
1. POD upload via signed URLs — verified on the iPhone 17 Pro sim: 3.5MB photo straight to storage at a server-chosen path. Device
   testing found + fixed: revoked-session half-alive state (now refresh-then-local-signout on 401) and an error-logging bug.
2. CI green on GitHub for PRs #1-#3.
3. Invoices: edit (draft only) + atomic mark-paid (0014, SECURITY INVOKER).
4. Chat read receipts, live location (3 columns only, forward in time), own driver profile (allowlist), vehicle service log + reminder
   atomically (0015); fixed Date#setMonth overflow bug (Jan 31 + 1mo = Mar 3) via clamped addMonths.
5a. IFTA crossings (0016): manual override never worked for DRIVERS (client-side delete blocked by RLS) — fixed; entitlement now server-side.
5b. DVIR (0017): inspection+defects atomic; condition derived server-side; signature/photos via signed URLs.
RESULT: zero direct insert/update/delete/upsert in carrieros-mobile/src. Remaining mobile debt = 65 read sites (+storage/RPC reads).
Web direct sites still 112/38 files. Tests: web 200, mobile 86, migrations 10 checks (0000-0017), ERD current.
NOT verified on device: DVIR signature draw + photo flow, IFTA background GPS task (needs native build), offline replay.
Follow-ups noted: driver_loads_update_status RLS lets a driver update ANY column of their load via PostgREST — tighten once no client
needs it; web still uses legacy PATCH /api/loads/[id] for status; migrate reads next (start with dashboards, then lists).

## Session addendum (2026-09-21) — writes batch 2 + ERD, branch `api-writes` (de9a7be, NOT pushed)

Done: fuel stops + problem reports via API; shared idempotency lifecycle (reserve first, so concurrent duplicates can't both run —
tested with 6 parallel requests); migration 0013 (service_role grants for idempotency + TRUNCATE sweep: TRUNCATE ignores RLS and had
been re-granted to anon/authenticated on tables created after 0003, incl. append-only audit_events; verifier now has a 10th check).
**ERD now exists**: architecture/erd.md, generated by scripts/db/gen-erd.mjs (46 tables/85 FKs/6 domain diagrams), CI-checked,
identical to a fresh-from-migrations DB. Verified on simulator as demo driver (fuel row + exception inbox entry correct; demo rows removed).
Answer to "all tables built?": tables cover the CURRENT product; the shipper<->carrier domain named in ADR 0002 / outbox event types
(relationships, tenders, pricing proposals, bookings, disputes) has NO tables — plan it before building. PRD/tech-spec (external) not
compared line-by-line. Remaining mobile writes (17): POD upload + DVIR (storage: signed-URL API design needed), invoice edit/paid
(multi-write), IFTA crossings, service logs/vehicle edit, driver-profile edit, driver-chat read receipts, share-location.

## Session addendum (2026-09-20, night) — mobile writes batch 1, branch `api-writes` (057da07, NOT pushed)

Migrated 7 of 26 mobile writes: load status (`POST /api/v1/loads/{id}/milestones` via ShipmentMilestoneService ->
`submit_shipment_milestone`), preferences (`PATCH /api/v1/me/preferences`), push token (`PUT /api/v1/me/push-token`). Offline queue
rewritten as a typed command queue replaying through the same endpoint (idempotency key + original timestamp kept; server refusals
dropped, network/5xx kept; v1 entries migrated). App layer enforces roles the SECURITY DEFINER SQL doesn't: owner/solo/dispatcher/
assigned-driver only (finance excluded — narrower than old RLS, deliberate), cross-tenant and other-driver = 404.
Verified on iPhone 17 Pro sim: tap wrote status+timeline+audit+outbox atomically; a stale tap got the localized conflict message and
refreshed with no extra write. Web 115/115, mobile 73/73. NOT verified: offline replay on a device.
Remaining direct debt: web 112/38 files, mobile 91/34 files. Next batches (from ADR 0003): driver actions (fuel stops, DVIR incl.
signature upload, exception/problem reports, POD upload = storage), invoice edit/paid (multi-write), IFTA crossings, customers/vehicles/
maintenance/settlements screens, profile reads (extend GET /me with preferences). Web still uses legacy PATCH /api/loads/[id] for status.

## Session addendum (2026-09-20, evening) — CI green on GitHub + simulator verification

PRs open: #1 `foundations` -> main, #2 `api-first` -> foundations (stacked; retarget #2 to main after #1 merges).
**CI ran on GitHub for the first time and failed 3/3, then went green** after 3 env-only fixes: npm 10 lockfile (I had
generated it with npm 12), mobile `.css` types (expo-env.d.ts is gitignored -> committed `src/types/assets.d.ts`), and
`supabase start` already applies `supabase/migrations/` so CI adopts it with `migrate.mjs --baseline` instead of re-running.
**iOS simulator (Expo Go, iPhone 17 Pro) now verified:** app was crashing SIGSEGV in react-native-worklets because Expo SDK 57
patch packages were weeks behind Expo Go (aligned 30 packages, own commit). Then found+fixed a real bug: openapi-fetch
middleware must not return the Response object in React Native (instanceof mismatch). After that: Loads tab works through
/api/v1/me + /api/v1/loads, and a DB-inserted load appeared live over expo/fetch SSE with no refresh. A pre-existing session
survived the keychain adapter + upgrade (consistent with legacy migration; not separately proven).
Still NOT verified: keychain migration proven in isolation, background location/IFTA (not in Expo Go), real device, physical
push. Run the simulator with: `EXPO_PUBLIC_API_URL=http://localhost:3100 npx expo start --ios` (port 3000 is Open WebUI here)
against `npm run start -- -p 3100` in carrieros-web. Mobile eslint has 1 pre-existing set-state-in-effect error (loads.tsx:77);
mobile lint is not in CI.

## Session addendum (2026-09-20, later) — API-only data access (ADR 0003), branch `api-first` (commit 040b44f, NOT pushed)

**User requirement (standing):** all mobile AND web calls go through the common API — no direct DB/RPC/storage calls from
frontends; APIs reused between mobile and web with no duplication; live-update (listener) mechanism so screens refresh
without a reload. Choices made: lint + RLS backstop (not hard lockdown), shared in-process service layer for web Server
Components, **API-owned SSE stream**, schema-first generated client.

**Built + verified:** zod contract -> OpenAPI -> identical typed client in both apps (`npm run gen:api`, `check:api` in CI);
`change_events` (0012, signal-only) + `GET /api/v1/events`; `GET /api/v1/{loads,me}`; ports/adapters/services per ADR 0002;
ratchet guard `api-only-frontend`. Pilot = loads list on web + mobile. Verified in a real browser (demo driver sees only own
loads, no rate; DB change updated the page with no reload). Web 97/97, mobile 65/65, migrations 9/9.

**Remaining migration (tracked by the guard on every run):** web 112 direct sites / 38 files, mobile 99 / 35 files. Order:
writes (26 mobile + ~19 web client components; route multi-step ones through `submit_shipment_milestone`) -> storage ->
RPCs -> reads by screen. Add each migrated file to `API_ONLY` in `carrieros-web/scripts/check-architecture.mjs`.

**Not verified:** mobile loads screen and `expo/fetch` streaming never run on a simulator/device; SSE cost/limits on Vercel
(each open stream = one DB poll / 2s, capped ~270s, client reconnects) — see ADR 0003 for when to move to LISTEN/NOTIFY.

## Session addendum (2026-09-20) — foundations sprint (all committed on branch `foundations`, NOT pushed)

Commits: `1f91fbe` role_capabilities (0009/0010), `b4ef1e3` i18n + lint fixes, `b3fb6d6` CI + 0011,
`f09b153` env/deploy config, `59eb47c` error handling/observability, `47c5ce0` auth hardening, `7c53277` CLAUDE.md.
Decisions taken: Vercel for web, Sentry for tracking, 12+ char mixed-case+digit passwords.

**Done and verified locally:** migration 0009/0010 applied; **root-caused the 2 hanging milestone tests** — PostgREST
v14.14 hangs on any function raising SQLSTATE 40001, so a real version conflict would have hung the API; fixed in 0011
(PT409/PT404). Web 83/83 tests with the app running, mobile 65/65, verify-migrations 9/9, prod build OK.
CI workflow (`.github/workflows/ci.yml`), deploy workflow (`deploy.yml`), `.env.example`s, `vercel.json`, `eas.json`,
`architecture/deployment.md`. Web: `x-request-id`, error boundaries (localized), Sentry (inert w/o DSN), 36 console.error
sites moved to `logError`. Mobile: logError seam + global handler + ErrorBoundary. Password policy enforced in local Auth
(verified via public sign-up). Mobile session moved to keychain (chunked SecureStore adapter, migrates old sessions).

**Correction to my earlier audit:** the API error contract (`apiError` + typed `ErrorCode`, 194 call sites) already
existed, and Supabase already keeps an auth audit log (`auth.audit_log_entries`, 5k+ rows) — neither was a gap.

**NOT verified / needs a human:**
- Neither GitHub workflow has run on GitHub. Nothing is pushed. `deploy.yml` needs the accounts/secrets in
  `architecture/deployment.md` (Supabase staging+prod projects, Vercel project, GitHub Environments, branch protection).
- Sentry needs a DSN; mobile has no SDK (needs native rebuild). Hosted Supabase needs the password policy set separately.
- Keychain session storage is unit-tested only — try sign-in, kill app, reopen on a real simulator/device, and confirm an
  already-signed-in install stays signed in after upgrading.
- `eas.json` URLs are `REPLACE_WITH_*` placeholders. `/api/cron/send-reminders` still has no scheduler (Vercel Cron sends GET).

**Still open:** API layer completion (invoice/settlement list+detail routes; wire `submit_shipment_milestone` into web+mobile;
mobile still does ~35 direct Supabase calls — needs a decision on which move behind the API); Rule B (`loads`/`drivers`/`profiles`
queries) still warn-only; auth events not surfaced in SuperAdmin UI; remaining hand-rolled `_ROLES` arrays.

## Session addendum (2026-09-19, later same day) — i18n hardcoding fixes + shared-backend architecture fix

**i18n hardcoding audit + fix (web + mobile):** Audited both apps for hardcoded, non-localized text.
Web had two real hotspots: the entire SuperAdmin surface (`app/(admin)/admin/**` + `AdminSidebar.tsx`,
~60+ strings) and the Add Load flow (`ManualLoadForm.tsx`, `ExtractionReview.tsx`, `loads/new/**`,
~65 strings) — both fixed, new `admin` and `loadIntake` namespaces added to all 4 locale files with
real (not placeholder) translations, plus a handful of stragglers (Toast/Modal aria-labels,
LanguageSwitcher's own hardcoded aria-label). Mobile had no hardcoded JSX text at all, but a systemic
formatting gap: currency/date formatting used ad hoc `.toLocaleString()` with no locale param, silently
falling back to device locale instead of `profiles.preferred_language`. Fixed via new shared helpers
`format-money.ts` (now `Intl.NumberFormat`-based), `format-date.ts`, `format-number.ts` (new), with all
known call sites migrated. Both apps got a new ratcheted ESLint guard (matching the existing
Tailwind/UI-component guard pattern) to block regressions: web flags hardcoded JSX text /
aria-label/title/alt literals; mobile flags raw `.toLocaleString()`/`.toLocaleDateString()` outside the
new helpers. `tsc --noEmit` clean on both, changes left unstaged for review (not committed/pushed).

**GitHub remote added:** `~/code/carrieros` previously had no git remote at all (confirmed via
`git remote -v`) — no backup beyond the one laptop. Walked through SSH key generation + GitHub
registration; repo now pushed to `git@github.com:gsanjeevs/carrieros.git`, tracking `origin/main`.

**Full production-readiness audit (8 parallel research passes, code-grounded, no guessing):** auth/
security, RBAC, multi-tenancy, DB schema, API layer, error handling/logging, deployment pipeline, test
infrastructure. Headline findings: multi-tenancy (RLS + `my_org_id()`) and the DB schema are genuinely
solid, no critical gaps. Real gaps, worst first: **no deployment pipeline at all** (no CI/CD, no
staging/prod Supabase project, no `.env.example`, no mobile build config — everything is local-dev
only); **no error tracking/observability** (no Sentry/APM, no structured logging, no error boundaries,
no request-correlation propagation); auth foundation has no MFA, weak password policy, mobile stores
session tokens in unencrypted AsyncStorage (not SecureStore), no SSO/SAML (though web's auth layer is
centralized enough to add it later; mobile isn't); test infra is real but partial (web has genuine
DB-backed integration tests via a local Supabase Postgres container, mobile is unit/mock-only despite
CLAUDE.md's blanket phrasing, no CI — only a bypassable local git pre-push hook, no coverage tooling,
no E2E). Recommended order: (1) deployment pipeline, (2) move test enforcement into that new CI +
coverage, (3) error handling/observability, (4) auth hardening (SecureStore, password policy, auth
audit log — defer MFA/SSO until an actual enterprise deal needs it), (5) finish API layer (invoices/
settlements have no list/detail REST routes, mobile-only reachable via action-specific sub-routes).

**"Is the backend/API common for both mobile and web?" — answered: partial, then fixed the first
instance.** Audit found Postgres (schema/RLS/SQL functions) genuinely is the shared backend, but there's
no shared TypeScript and no unified API layer — mobile bypasses web's `/api/**` for most reads/writes
(27 direct `.from()` + 8 direct `.rpc()` calls vs. ~13 through web's API), and any rule that isn't
already a DB function gets hand-duplicated per app. Two confirmed drift cases: role/nav gating
(`proxy.ts` vs. mobile's `tab-sets.ts`) and `format-money.ts` (different capabilities per app). **Fixed
the role-gating case as the first real application of a new architecture rule (Rule H, added to
`architecture-principles.md`):** cross-client logic goes into Postgres as data/functions, single-sourced
via a *generated* (not hand-written) constants file — same pattern as `regen-types.sh`. Built: migration
`0009_role_capabilities.sql` (new `role_capabilities` table, seeded to match pre-existing behavior
exactly — a refactor, not a policy change), `scripts/gen-role-capabilities.mjs` (generator, mirrors
`regen-types.sh`'s pattern), and the two apps refactored to consume it — web's `proxy.ts` `ROLE_ROUTES`
and `lib/roles-policy.ts`'s `INVOICE_ROLES`/`SUBSCRIPTION_ROLES`, mobile's `tab-sets.ts` for the
dispatch/drivers tabs (Home/Customers/More tabs deliberately left alone — no clean 1:1 capability
match, would have required inventing new capabilities without sign-off).

**Update (2026-09-19, later): the 0009 migration is now actually applied and verified** on the local
Supabase stack. `node scripts/db/migrate.mjs` applied 0009; `verify-migrations.mjs` then caught real
snapshot drift (schema.sql's blanket grant gave `service_role` full access to `role_capabilities`, 0009
granted it nothing) — fixed forward with `0010_role_capabilities_service_role_grants.sql`, now 9/9 checks
pass. `gen-role-capabilities.mjs` and `regen-types.sh` were re-run against the live DB (types now include
`role_capabilities`), and `tsc --noEmit` is clean in both apps. `verify:compliance` still shows 5
`react-hooks/set-state-in-effect` ESLint errors (Modal.tsx, admin/pipeline, etc.) that predate this work.
Gotcha hit: `regen-types.sh` writes the CLI's JSON error into `types/supabase.ts` if Docker/Supabase
isn't ready (tsc then fails at line 1) — re-run once the stack is up. Nothing committed yet: 0009, 0010,
generator, generated files, and the i18n changes are all still in the working tree.

**Still open / not started this session:** the ~20 other hand-rolled `_ROLES` arrays across web page
files were deliberately left untouched (out of scope, no sign-off on what their capabilities should be
yet) — same for mobile's Home/Customers/More tabs. The platform-agnostic architecture decision from
earlier this session is still unresolved. The 9-document engineering-standards plan is still unbuilt.

## How to Resume
1. Open the `~/code/carrieros` repo (these docs are in `docs/` since 2026-10-07; the old Zoho Drive
   "Carrier Portal" folder is no longer the home for them).
2. Read `CURRENT_WORK.md` first, then this file's newest entries, then pick up where we left off.

---

> **Historical snapshot (as of ~2026-07/2026-09-21).** The status heading and the sections below it
> predate the dated entries at the top of this file. Where they disagree — notably Phase 9, which is
> now built, and Phase 8, which the audit doc records as shipped 2026-07-23 — the newer entries,
> `CURRENT_WORK.md`, and the code win.

## Current Status: Phases 0–7 done + 3H done. Phase 8 (SuperAdmin) foundation started (not complete). Phase 9 (Public API) not started. Design system restructured into Core/product layers + a real components/ui/ library exists (not yet consumed by pages).

**Infra note (2026-09-19):** `~/code/carrieros` now has a GitHub remote —
`git@github.com:gsanjeevs/carrieros.git` — pushed and tracking `origin/main`. Previously local-only
with no backup; this closes that gap. SSH key was newly generated and registered on GitHub as part
of this.

Full decision-by-decision detail lives in `decisions.md` (P/PR/S/T/V/L series + Resolved Open
Questions) — this file is the quick-orientation summary. If the two ever disagree, `decisions.md` and
the actual code win.

### What's done (all verified live, not just code review — see `decisions.md` for per-item detail)
- **Data model**: unified `organizations` (carrier/customer), `carrier_details`/`customer_details`,
  region-neutral `vehicles` (renamed from `trucks`) with global `vehicle_types`/`vehicle_classifications`
  master data (11 regions), `roles`/`languages` reference tables, a real `tiers`/`features` entitlement
  system with an RLS-usable `has_feature()` gate, full document tables for vehicles/drivers/orgs, an
  `exception_events` log, and `customer_contacts` with portal-login invite/revoke. `profiles.is_active`
  + a system-wide deactivate-never-delete rule.
- **i18n**: 4 languages (English/Spanish/Punjabi/Urdu) across both apps, all screens, including Urdu
  RTL. Language now inherits carrier → user (same pattern as units).
- **Onboarding**: real 6-step flow (company → profile → vehicle → customer → billing → completion),
  address collection fixed on both the company and customer steps.
- **Visual/structural rework**: pill-shaped status badges, load cancellation, load-detail hero rate
  card + route strip + status pipeline + action grid, status-grouped loads list with filter chips,
  avatar-card driver/vehicle picker in DispatchPanel (with default-vehicle auto-fill — previously dead
  data), a real dashboard (revenue/outstanding-invoices/avg-rate/fleet-status/driver-compliance), CDL
  cards + endorsement badges on drivers, a working vehicle-type picker (7 custom icons) that actually
  persists to the DB (was silently hardcoding every vehicle to `'semi'` before this pass), maintenance
  progress bars + 5 custom service icons, a real language/role picker UI sourced from the DB instead of
  hardcoded arrays.
- **Role-differentiated home screens, both platforms**: web dashboard split into
  Owner/Solo/Driver/Dispatcher/Finance views; mobile rebuilt from one universal 2-tab layout into 5
  role-specific tab sets with new Loads/Alerts/Fleet/Customers/Invoices/Reports/DVIR/History/Profile
  screens.
- **Management by exception**: vehicle/driver/customer detail pages (none existed before this pass —
  only list pages did) with document upload, a tiered exceptions inbox with Starter/Growth gating, a
  customer health-score function, inline exception chips on every list page (web + mobile), and
  automated-reminder logic (not yet on a schedule — see below).
- **Customer contacts**: `customer_contacts` + carrier-initiated portal invite/revoke, connecting the
  `customer_admin`/`customer_viewer` roles that had real RLS policies but no code path to ever create
  a profile with either one.
- **Design system restructuring (2026-07-22, Cowork session)**: `design/design-system.md` and the
  older `design/design-tokens.md` were superseded and deleted, replaced by two files —
  `design/ux-foundations.md` (Core layer, v1.1: product-agnostic tokens, component API catalog,
  accessibility/ARIA/RTL/data-viz/layout-grid/destructive-action/deprecation rules — this company's
  first product-agnostic foundation, meant to outlive CarrierOS) and `design/carrieros-design-system.md`
  (CarrierOS's product layer: concrete brand theme, domain patterns, mobile StyleSheet recipes). A real
  `carrieros-web/components/ui/` library (15 components: Button, StatusBadge, Card, Input, KpiTile,
  Avatar, Table, ProgressBar, Tabs, SegmentedControl, Modal, Tooltip, Toast, EmptyState, Skeleton) was
  built matching this catalog exactly, plus the Layer 3 semantic (`:root`/`.dark`) token block was
  finally added to `globals.css` (was drafted but missing for weeks). Committed (`d2e9078`), `tsc`
  clean. **Not yet done**: no existing page uses these components yet — see
  `design/page-migration-coordination-note.md` for the handoff (Wave 1: loads/dashboard pages already
  on `lib/domain/load-status.ts`, just need the component swap; Wave 2: customers/drivers/vehicles
  detail pages need both steps). `track/[token]/page.tsx` is deliberately excluded from all of this
  (public-facing isolation boundary, per `architecture-principles.md`).
- **Cross-session architecture hardening (2026-07-22, parallel Code session, `f27cc85`/`fad2939`)**:
  `docs/architecture-principles.md` (new) documents real coupling found (loads.status color mapping
  hand-copied in ~12 places and drifted; a role-array naming collision between two actually-different
  policies) and the fix pattern (shared exhaustive-switch modules — `lib/domain/load-status.ts`,
  `lib/roles-policy.ts` — plus a schema-change impact-analysis step). A Vitest suite was added
  (RLS isolation, onboarding, loads, billing). **Worth double-checking, not yet confirmed**: this
  commit's platform-admin data model uses `organizations.type='platform'` +
  `sx_owner`/`sx_finance`/`sx_support` **`profiles.role`** values — this appears to differ from SA1's
  original lock (`decisions.md`: separate `platform_admins` table, "never a `profiles.role` value").
  Flagging rather than resolving — confirm with whoever owns Phase 8 whether SA1 was deliberately
  revised or this is drift.

- **Mobile Owner/Solo feature-parity pass (2026-07-23)**: `carrieros-mobile` was read-mostly for
  Owner/Solo before this — could view loads/vehicles/alerts but not create a load, assign a driver, log
  maintenance, manage customers, or see billing/team/settlements without switching to web. Built: load
  creation (`src/app/load/new.tsx`, posts through the existing `carrieros-web` `/api/loads` route rather
  than duplicating load-number generation), driver/vehicle assignment on load detail, a Customers view
  for Owner/Solo (previously Dispatcher/Finance only), a vehicle detail + maintenance-logging screen
  (Fleet cards weren't pressable before), and view-only Team/Billing/Settlements screens reachable from
  a new "Business" section in More. Deliberately no invite/role-change/tier-change/run-settlement
  actions on mobile — those need the service-role Admin Auth API, which must never ship to a mobile
  client. Found and fixed two real bugs along the way: (1) `carrieros-mobile`'s `apiFetch()` helper had
  never actually been exercised — `carrieros-web`'s `/api/*` routes had no CORS headers, so cross-origin
  calls from the Expo web preview failed; fixed in `carrieros-web/proxy.ts`. (2) i18n-js does not parse
  embedded ICU plural syntax (`{count, plural, one {...} other {...}}`) — it needs a `{"one": "...",
  "other": "..."}` object instead; two pre-existing keys had this same bug
  (`offline.offlineWithQueue`, `offline.syncing`). **Fixed and merged 2026-07-24 (`2e82d1c`)** — both
  converted to i18n-js plural objects across all 4 locales with tests (mobile suite: 52 green).
  `dvir.photoUploadFailedWarning` turned out NOT to have this bug — it uses a plain `%{count}` with a
  "photo(s)" workaround, which renders correctly; pluralizing it properly is optional polish, not a bug.
- **Full 23-mockup fidelity audit (2026-07-23)**: user asked directly whether the built product had
  drifted from `docs/design/mockups/*.html`, after noticing the signup flow (mockup-09) was missing. Ran
  6 parallel agents comparing every mockup against both apps' actual code (file:line evidence, not
  inference). Result: 4 mockups Critical (missing/stubbed), 9 High (hollowed out), 7 Medium (polish
  lost), 3 genuine matches (Exceptions, Super Admin, Localization). Full findings in Claude memory
  (`project_mockup_parity_plan.md`) since the original report was a private Artifact link.
  **Update (2026-08-18, "finish critical tasks")**: all 4 Critical items are now done — most were built
  by work outside this session's own thread (signup, Finance Hub, mobile fuel logging, mobile IFTA
  screens, plus two High items: the driver DVIR pre-trip reminder and the Report-a-Problem/Delay flow).
  Live-verified each rather than trusting source alone: created a real signup account end to end
  (confirmed `carrier_details.tier` set correctly), rendered the Finance Hub at Pro tier (6 KPIs, no
  crash), logged a real mobile fuel stop, and submitted a real driver problem-report (confirmed it
  writes into `exception_events`, reusing the existing Exceptions inbox with correct RLS). All test
  data deleted afterward. **One real gap remains**: no dedicated web IFTA summary view for Growth-tier
  orgs (only Pro's Finance Hub and mobile's Reports tab have one) — small, not yet built. The
  High/Medium items' remediation roadmap is still unprioritized — the "what phase are we actually in"
  question from the original audit was never answered before work moved to execution; ask directly
  next session rather than assume.
- **Design-system adoption ratchet — complete for the tenant app (2026-07-23)**: Waves 1–4 retrofitted
  all 13 `app/(app)/**` directories onto `components/ui/*`; every one of them is now in
  `eslint.config.mjs`'s `ERROR_SURFACES`, so regressions are hard errors, not warnings. Enforcement is
  git hooks, not CI (`scripts/git-hooks/pre-commit` + `pre-push`, one-time
  `git config core.hooksPath scripts/git-hooks` per clone) plus `npm run verify:compliance`. See
  CLAUDE.md § Gated checks for the standing audit cadence.
- **Housekeeping done 2026-07-24**: a stale 650 MB detached git worktree
  (`carrieros-web/.claude/worktrees/cool-burnell-9d3eba`, left behind by a background agent) was
  stranding the only copy of the i18n plural fix above and was being linted as if it were repo source,
  inflating every lint count. Fix cherry-picked to `master`, worktree removed. **Lesson: check
  `git worktree list` at session start** — an agent's worktree can hold real unmerged commits.

### Cowork session, 2026-07-23/09-19 — research + planning, no code changes
Two threads, both still open, neither started in code:
- **Engineering documentation standards initiative (not started, decision pending).** Audited the
  live repo (Supabase coupling surface: 16 files import the SDK directly, 79 `auth.uid()`/`auth.jwt()`
  call sites in RLS, Storage buckets in use; zero deployment infra — no Dockerfile/CI/IaC anywhere;
  Vitest exists but no E2E; no monorepo tooling between web/mobile). Proposed a 9-document set
  (architecture/ADR, API design, DB migration — since resolved by the real migrations system above,
  security/tenancy, testing, observability, infra/deployment, frontend, vendor register), each
  grounded in a named industry standard (Twelve-Factor App, C4 model, OWASP ASVS/STRIDE,
  OpenTelemetry, Test Pyramid, etc.). **Open decision, asked twice, not yet answered**: whether
  "platform-agnostic" means (a) self-host the Supabase OSS stack anywhere (keeps RLS +
  `auth.uid()`, ~90% of code unchanged) or (b) a full re-architecture replacing Supabase Auth's
  JWT/RLS bridge with app-owned sessions + `SET LOCAL app.current_org_id` (keeps RLS as a Postgres
  feature, removes Supabase-Auth-specific coupling, without discarding DB-enforced tenant isolation
  as defense-in-depth). User picked "true platform-agnostic re-architecture" then the conversation
  moved to the documentation-standards discussion before confirming which of the two technical shapes
  above that means — **confirm this explicitly before any of the 9 docs get written**, since the
  security/tenancy doc especially depends on it.
- **Trucking industry market-landscape research, done.** `strategy/trucking-industry-market-landscape.md`
  — pitch-ready summary (industry scale, TT100-adjacent top-10 carrier table, why-it-matters framing)
  from 3 web sources. Flagged, not resolved: TT100's company names didn't come through a static fetch
  (client-rendered), so the top-10 table was name-matched by revenue against the other two sources —
  verify against ttnews.com before quoting specific TT100 figures externally. The "~96% of carriers
  run 1-5 trucks" stat is commonly cited but not traced to a primary FMCSA source — pull that directly
  before it goes in an investor deck.
- Also answered, no artifact produced: how Expo/RN localization works generally + specifically in
  `carrieros-mobile` (`expo-localization`/`I18nManager`/`expo-font` + `i18n-js`, locale sourced from
  `profiles.preferred_language` not device locale, RTL requires a native restart); confirmed web and
  mobile's message-catalog duplication (`carrieros-web/messages/*.json` vs
  `carrieros-mobile/src/messages/*.json`) is mostly *not* wasteful duplication (different libraries —
  `next-intl`/ICU vs `i18n-js` — and ~90% genuinely different screens/content) but flagged a real,
  fixable slice: `roles` and status-enum labels are the same real-world concepts hand-translated
  twice with no sync mechanism, same failure mode as the token/`theme.ts` drift already documented
  elsewhere. Not yet built: a canonical shared-vocabulary JSON + sync script for just that slice.

### Known-red gate (decide next session)
`npm run verify:compliance` currently **fails** on 8 pre-existing ESLint errors, none of them from the
design-system or architecture guards (real counts after the worktree cleanup: 8 errors, 22 warnings,
of which 17 are the UI guard). All 8 are React-Compiler-era `react-hooks` rules:
`set-state-in-effect` × 7 (`app/(admin)/admin/{page,flags,pipeline,orgs/[org_id]}/page.tsx`,
`components/DriverMessageThread.tsx`, `components/ExtractionReview.tsx`, `components/ui/Modal.tsx`)
and `react-hooks/immutability` × 1 (`components/LanguageSwitcher.tsx:60`, a `document.cookie` write
inside an event handler — likely a false positive). This matters because `pre-commit` runs `eslint` on
staged files, so any future edit to those 8 files is already blocked. Decide: fix the patterns, or
downgrade the specific rules to `warn` with a written justification. Remaining UI-guard warnings are
11 real (`app/login/**`, `app/onboarding/**`) + 6 in `app/track/[token]/page.tsx`, which is
deliberately excluded from the design system per `architecture-principles.md` — a Wave 5 on
login/onboarding should be sequenced *after* the signup/onboarding mockup-gap decision, since those
same files are what mockup-09 would rewrite.

### Explicitly NOT started — real product/security decisions, not implementation gaps
- **Phase 8 — SuperAdmin.** Platform-operator surface for managing `tiers`/`features` pricing/gating
  across every carrier org. Design decided but not built: wholly separate auth from the rest of the app
  (own `platform_admins` table, bcrypt + mandatory TOTP 2FA, signed session cookie — never Supabase
  Auth, never a `profiles.role` value), a `carrier_details.price_override` column so a price change
  grandfathers existing subscribers rather than silently repricing them, full audit log on every admin
  action. First build attempt was blocked by the coding tool's own permission classifier — building
  password/2FA auth autonomously in the background was flagged as too sensitive to run unsupervised.
  Needs to happen with a human watching, or after the design is explicitly re-reviewed.
- **Phase 9 — Public developer API.** _(Superseded: built with OAuth client-credentials under
  `/api/public/v1/*`, base committed 2026-09-21, expanded through 2026-09-28 — see the `carrieros-mcp` entry at the top.)_ Original
  text: Design decided, not built: API keys (not OAuth), `/api/v1/...`
  versioning from day one, reuses the existing `{error_code, error}` response convention, gated via
  `has_feature()` same as every other tiered feature.
- **`platform_admin`-adjacent question, deliberately not conflated with the above:** the older stale
  "Immediate Next Steps" list below (kept for history) had already-superseded items — see Build Order
  section for what's genuinely left.

---

## Schema changes now go through migrations (superseded 2026-07-26, confirmed still current via CLAUDE.md)
**This section replaces the old hand-copy-into-schema.sql workflow described below the line** — kept
struck-through-in-spirit rather than deleted, since old habits die hard and a future session (or a
stale memory) might reach for it. `supabase/migrations/*.sql` is now the sole authority for schema
evolution (`architecture/database-migrations.md` has the full story — real drift/upgrade-path
failures under the old approach prompted this). Migrations are numbered, checksummed, and immutable
once applied — fix mistakes forward with a new migration, never edit a merged one.

```sh
node scripts/db/migrate.mjs --status     # inspect pending migrations
node scripts/db/migrate.mjs --dry-run    # preview before applying
node scripts/db/migrate.mjs              # apply
```

`supabase/schema/schema.sql` is now a **reviewed current-state snapshot**, not the thing you edit —
`node scripts/db/verify-migrations.mjs` (9 checks in throwaway DBs) catches drift between it and the
migrations, but does not generate the snapshot for you; hand-update it alongside any new migration.
After any schema change: write the migration → apply it → hand-update `schema.sql` → run the
verifier → `./scripts/regen-types.sh` → `tsc --noEmit` in both apps. Full sequence and the
`supabase gen types` stdout-corruption gotcha are in `CLAUDE.md`.

_Old workflow (pre-2026-07-26, kept for historical context only — do not follow):_ `schema.sql` used
to be self-sufficient after a `supabase db reset` via a blanket grant statement (SECTION 8c) and you'd
replay the whole file by hand with `docker exec -i supabase_db_carrieros psql -U postgres -d postgres
< supabase/schema/schema.sql`. That grant statement's history (a real incident where new tables had
RLS but no base grant, silently returning zero rows) is still worth knowing, but the replay-by-hand
step is gone — migrations do this now.

---

## Schema Summary (current — see `supabase/schema/schema.sql` for the source of truth)
- `organizations` — carriers + customers unified (`type`: 'carrier'|'customer'), `logo_path`.
- `carrier_details` — mc/dot number, `tier`, `billing_status`, `default_language`, `price_override`
  (grandfathering slot for Phase 8, not yet used by anything).
- `customer_details` — carrier_org_id FK, customer_number, contact_name (lightweight quick-add — the
  full contact list is `customer_contacts`).
- `customer_contacts` — org_id, name/email/phone/title, `is_primary`, nullable `portal_profile_id`.
- `vehicles` (renamed from `trucks`) — `vehicle_type_id` FK, `cab_type`, `color`, `dimensions`,
  `status` ('active'/'idle'/'in_shop'), `photo_path`.
- `vehicle_types` / `vehicle_classifications` / `vehicle_type_classifications` — global master data,
  11 regions (US/EU/GB/CA/MX/CN/IN/JP/KR/AU/BR).
- `roles` / `languages` — reference/display tables (label columns are English-fallback only; UI always
  renders via message-catalog keys, never the DB column directly).
- `tiers` / `features` — entitlement master data, `has_feature(key)` is a real `SECURITY DEFINER` SQL
  function callable from RLS policies directly, not just app code. `get_my_entitlements()` returns the
  full set for data-driven menus.
- `drivers` — `cdl_class`/`cdl_expiry`/`med_cert_expiry`/`endorsements`, `default_vehicle_id`.
- `profiles` — ALL users, `org_id`, `is_active` (deactivate-not-delete), `avatar_path`,
  `preferred_language` (nullable — inherits `carrier_details.default_language`), `uom_system` (same
  inheritance pattern). Roles: owner/solo/driver/dispatcher/finance/customer_admin/customer_viewer.
- `*_documents` (vehicle/driver/org) + `exception_events` — the exceptions system's data.
- `fuel_stops`/`load_expenses`/`ifta_*`/`driver_messages`/`driver_settlements` — Growth/Pro backend
  scaffold (schema + API contracts exist; business logic mostly deferred, per Phase 7's own scope).
- All PKs **BIGSERIAL** except `profiles.id` (UUID — auth). FK pattern: `carrier_org_id` everywhere.
- `next_entity_val(carrier_org_bigint, entity_name)` — atomic number generation (loads, vehicles,
  drivers, customers, invoices all use this, not raw sequences).
- `my_org_id()` / `my_role()` — `SECURITY DEFINER` helpers nearly every RLS policy is built on; both
  now filter `is_active = true` (S16), so a deactivated profile is denied everywhere these are used. A
  handful of older policies subquery `profiles` directly and are NOT covered by this — see
  `decisions.md` S16 for the exact list before building any other "deactivate X" feature.

## Key Architecture (locked)
| Decision | Detail |
|---|---|
| Next.js 16 | proxy.ts, export `proxy` (NOT middleware.ts) |
| Tailwind v4 | CSS-first via `app/globals.css`, no `tailwind.config.ts` |
| Onboarding API | createAdminClient() — user has no org yet, bypasses RLS |
| proxy.ts | Skips org_id check for /api/ routes |
| API vs RPC | R3b test: needs a server secret/service-role bypass → Next.js route; plain RLS CRUD or an atomic business rule → Postgres RPC, callable identically by web + mobile |
| Team invite | Supabase magic link (passwordless). inviteUserByEmail admin API. Same pattern reused for customer-portal contact invites. |
| Load tracking | /track/[token] token-based URL, via `get_public_tracking()` — never queries `loads` directly |
| Invoices | Stripe direct + factoring integration, `payment_method` per invoice |
| Customer portal | Same app, role-based — now actually implemented (S16), not just a locked RLS policy nobody could reach |
| Tier gating | `has_feature('key')` everywhere — never a hardcoded `tier === '...'` string check anywhere in app code |
| i18n | next-intl (web) / i18n-js (mobile), `%{name}` interpolation on mobile, `{name}` on web — different syntax, don't mix up |

## Files (carrieros-web) — high-traffic ones, not exhaustive
- `proxy.ts`, `app/page.tsx`, `app/login/page.tsx`, `app/auth/callback/route.ts`
- `app/(app)/layout.tsx`, `dashboard/{page,OwnerView,SoloView,DriverView,DispatcherView,FinanceView}.tsx`
- `app/(app)/loads/page.tsx`, `loads/[load_number]/page.tsx`, `loads/new/`
- `app/(app)/vehicles/page.tsx` + `[vehicle_number]/`, `AddVehicleButton.tsx`
- `app/(app)/drivers/page.tsx` + `[driver_number]/`
- `app/(app)/customers/page.tsx` + `[customer_number]/` (Overview/Loads/Exceptions/Invoices/Contacts)
- `app/(app)/exceptions/page.tsx`
- `app/onboarding/page.tsx` + `steps/`
- `app/api/onboarding`, `loads`, `loads/[id]`, `customers/[org_id]/contacts/**`, `drivers`, `vehicles`,
  `team/invite`, `cron/send-reminders`
- `lib/supabase/server.ts` (createClient + createAdminClient), `lib/api-auth.ts`, `lib/entitlements.ts`,
  `lib/exceptions.ts`, `lib/generate-number.ts`, `lib/send-email.ts`
- `components/Sidebar.tsx`, `DispatchPanel.tsx`, `LanguageSwitcher.tsx`, `LoadDocuments.tsx`,
  `VehicleDocuments.tsx`, `DriverDocuments.tsx`, `CustomerContacts.tsx`, `ExceptionChip.tsx`
- `components/icons/vehicle-types/`, `components/icons/maintenance/` — custom SVG icon sets

## Local Supabase
Studio: http://127.0.0.1:54323 | API: http://127.0.0.1:54321
Start: `supabase start` from ~/code/carrieros/
Keys: ~/code/carrieros/carrieros-web/.env.local
Mailpit (local SMTP relay, real emails land here in dev): http://127.0.0.1:54324

## Product docs (`docs/` in the repo since 2026-10-07; formerly Zoho Drive)
- `decisions.md` — full decision log (P/PR/S/T/V/L series + Resolved Open Questions)
- `design-gap-analysis.md` — original mockup vs. code gap analysis (mostly closed now, kept for history) — **not present in `docs/` as of 2026-10-07**; it did not
  come across in the move (or was removed earlier)
- `carrieros-db/schema.sql` — a copy of the real schema, kept so product docs stay self-contained; the
  repo's own `supabase/schema/schema.sql` is the actual source of truth if they ever disagree
  (last refreshed 2026-10-07 — re-copy it after schema changes or it will drift again)
- `design/mockups/` — 22 HTML mockups + `mockup-23-super-admin.html` (Cowork session, 2026-07-22; 7-screen super admin command center with embedded build spec — see Build Spec panel in the file). Mockups 17-21 are Growth/Pro roadmap items, not forgotten scope
  — see V5)
- `design/ux-foundations.md` — **Core design-system layer** (product-agnostic): token taxonomy,
  component API catalog, accessibility minimums, multi-platform delivery rule. Validated against all
  23 mockups 2026-07-22. No CarrierOS-specific content by design — read this first.
- `design/carrieros-design-system.md` — **CarrierOS product layer**: concrete brand hex values
  (light+dark) for Core's color roles, canonical-token-source/manual-sync process, and every
  CarrierOS-specific pattern (load pipeline, exception tiers, IFTA table, DVIR, chat, mobile
  StyleSheet equivalents, etc.) — read this before building any UI screen.
- `design/design-tokens.md`, `design/design-system.md` — deleted 2026-07-22 (superseded by the two
  files above). Note: `theme.ts`, `globals.css`, `Sidebar.tsx`, and mobile's `loads.tsx` still have
  code comments pointing at these old filenames — update those to reference `carrieros-design-system.md`
  next time either file is touched.
- `strategy/prd.md`, `tech-spec.md`, `tier-pricing-structure.md`

## Design Tokens
Dark navy (shipped default) `#0f1923` · orange `#f97316` · green `#16a34a` · teal `#1abc9c` ·
amber `#d97706` · red `#dc2626`. Light theme also exists (Light/Dark/System toggle, V3) — sidebar chrome
stays dark navy in both modes. Font: Inter · Icons: Material Symbols Outlined everywhere except
vehicle-type and maintenance-service icons (custom illustrated SVGs, a deliberate split — V4).

## Pricing (locked)
Starter $49 (1 truck incl.) · Growth $99 (3 incl.) · Pro $199 (6 incl.) · Enterprise $349 (12 incl.),
plus a per-additional-truck fee at each tier. CA pilot: Growth free 90 days.

## Build Order Remaining
**NOTE (2026-09-21): items 1 and 4 below are stale — `feature-completeness-audit.md`'s "Top Gaps"
section marks both resolved 2026-07-23 with verification detail (full SuperAdmin UI, all 5 Growth-tier
features shipped), which post-dates this list. Not independently re-verified this session; trust the
audit doc over this list for those two items until someone re-checks. Item 6 is also contradicted by
the same audit doc (Company Documents UI shipped 2026-07-22).**
1. ~~**Phase 8 — SuperAdmin**~~ (see note above — audit doc says shipped 2026-07-23)
2. ~~**Phase 9 — Public developer API**~~ — built 2026-09-21, expanded through 2026-09-28 (OAuth client-credentials,
   read-only loads/invoices/vehicles/exceptions/financial-events); see the `carrieros-mcp` entry at
   the top of this file
3. Wire an actual scheduler (`pg_cron` or an external cron) to `POST /api/cron/send-reminders` —
   the reminder-detection logic and email-send both work, nothing currently calls it on a timer
   (still listed under "Not set up yet" in `architecture/deployment.md` as of 2026-10-07; EventBridge
   Scheduler is the suggested fit now that the app runs on ECS)
4. ~~Growth/Pro feature business logic (fuel/IFTA/driver chat/settlements)~~ (see note above — audit
   doc says all 5 shipped 2026-07-23)
5. Real avatar/vehicle-photo upload on web (currently mobile-only for avatars; vehicles have a simple
   web upload button but drivers don't have a web equivalent) — status not re-checked 2026-09-21
6. ~~`/documents` page is still a placeholder~~ (see note above — audit doc says Company Documents UI
   shipped 2026-07-22). Still genuinely open per the same audit (not contradicted): manual load-entry
   UI, PDF/image load-intake upload, Accept/Decline load action, and invoice PDF/review-before-send
   are all explicitly disabled/missing — see `feature-completeness-audit.md` for evidence.
7. (Formerly under item 6) Exception CTAs for document-expiry types currently have no destination to link to

## Notes
- (Historical, pre-2026-10-07 Zoho Drive era) Zoho Drive: bash errors on file path = cloud-only file, use Read tool instead
- (Historical) carrieros-web is NOT in Zoho Drive — it's at ~/code/carrieros/carrieros-web
- Restart Supabase: `supabase start` from ~/code/carrieros/ if Docker quit
- (Historical) Cowork file Write tool is blocked on Zoho Drive paths — use bash to write there
- Persistent demo accounts (do NOT delete, reused across sessions — reset via `./scripts/reset-demo.sh`
  if a test changed language/units/prefs): `demo@carrieros.dev` (owner, org "Sierra Freight Co") /
  `mike.driver@carrieros.dev` (driver, same org), both `Demo123!`
- For real accounts/data needed mid-session testing, prefer disposable throwaway accounts
  (GoTrue admin API) over touching the persistent demo accounts, and clean them up afterward

## Addendum — Phase 7 (2026-09-20)
- Web `LanguageSwitcher` → `PATCH /api/v1/me/preferences`; `DriverMessageThread` read receipts → `POST /api/v1/loads/{id}/messages/read` (same endpoints as mobile). Browser-verified on a fresh build (an earlier check hit a stale build and proved nothing — always rebuild before verifying).
- Test cleanup (`helpers.ts`, `global-teardown.ts`) now clears `maintenance_reminders`; it was leaking orgs.
- Pre-push hook needs `TEST_APP_URL=http://localhost:3100` with the app running, else 136 spurious failures.
- Evals: web 207/207, mobile 86/86, verify-migrations 10/10, ERD + API client current, CI green on PR #3 (21a8526).
- Remaining API-only debt: web 109 sites/38 files; **mobile is now 0 sites/0 files (finished 2026-09-21, see this file's newest addendum)**. DriverMessageThread's live channel still uses Realtime directly (not migrated, separate from the read/write API-only rule).

## Addendum — Security fixes from the roles/tenancy audit (2026-09-20)
Four parallel audits ran (roles, tier enforcement, billing, localization); their probes are in `carrieros-web/tests/audit/` (red = open finding; `npm run test:audit`; excluded from the default run/CI/lint). Fixed in migrations 0019 + 0020 (commit 91884aa): self-insert of profiles/orgs/carrier_details removed (anyone could become owner of any org or sx_owner; onboarding also took `role` from the body), carrier_details is server-write-only (owner could self-upgrade tier/billing), `caller_may_act_on_load()` in the milestone and manual-IFTA RPCs, tenancy triggers on loads (driver/vehicle/customer) and customer_contacts, driver_messages insert/update split + column guard, check_ifta_completeness no longer anon/cross-tenant. 11 regression tests: `tests/security-privilege-escalation.test.ts`. Evals: web 218/218, mobile 86/86, verify-migrations 10/10, ERD/API client current, compliance 0 errors.
STILL OPEN (from the audits): has_feature()/get_my_entitlements() ignore billing_status/trial/grace/org_flag_overrides/platform_flags (EntitlementService is dead code); most gated features enforced only in API routes not RLS/RPC; truck limits unenforced; billing is a stub (no provider/webhooks/subscription state; needs a provider decision); read-scope leaks (drivers see load rate + coworker CDL scans, portal sees rates/EIN, deactivated users keep access, mark_overdue_invoices/get_exceptions unguarded for drivers); role rules duplicated in ~4 places (role_capabilities is not the single source); localization: language list in 2 CHECKs + ~10 files, web RTL not done (~90 physical Tailwind classes), country/currency hardcoded (US/CA/MX, USD in ~20 sites, 50-state list copied in 6 files), mobile ignores date/time/unit prefs, exception/reminder text generated in English in SQL.

## Addendum — Server-side tier enforcement (2026-09-20, migration 0021, commit c80b542)
`entitlement_decision(org, key)` (SQL) mirrors `server/domain/entitlement/model.ts`; `tests/entitlement-parity.test.ts` runs 19 scenarios through both. `has_feature()`/`get_my_entitlements()` now honour billing_status, trial, grace, per-org platform-flag overrides and the new `org_feature_overrides` (admin PUT/DELETE `/api/admin/orgs/:id/feature-overrides`, audited). Write gates for driver chat / settlements / IFTA crossings / load expenses are RESTRICTIVE RLS policies (reads stay open after a downgrade); IFTA summary/tax/customer-health RPCs and replace-IFTA carry their own checks. `features.retained_when_delinquent` exists but no feature sets it yet. `scripts/reset-demo.sh` now also refreshes the demo org's trial (otherwise an expired trial would lock demo features). Evals: web 251/251 (twice), mobile 86/86, verify-migrations 10/10, ERD current.
DECIDED, NOT A BUG: truck limits are not hard-blocked (tiers price overage per extra truck), so they are a billing/metering item, not enforcement. Still open: real billing (provider port, webhooks, subscription state), read-scope leaks, role single-sourcing, localization tables, API migration. `npm run test:audit` now works (vitest.audit.config.ts); the billing 'GAP' probes flip red when the gap is fixed, and the tiers probes still assume the old flag semantics: triage when promoting them.

## Addendum — Role-scoped reads (2026-09-20, migration 0022)
41 policies rewritten (generated from schema.sql by a script so snapshot == migration): raw `(SELECT org_id/role FROM profiles ...)` and `(SELECT id FROM drivers WHERE profile_id=auth.uid())` → `my_org_id()/my_role()/my_driver_id()` so deactivation reaches every policy (profiles' own policies deliberately untouched: a deactivated user can still read their own row). Role-scoped: drivers see only own driver_documents / docs on their own loads (or ones they uploaded) / no load_expenses; finance sees no driver_documents; dispatchers KEEP driver_documents (their role has the `drivers` capability — product call, revisit if CDL scans should be owner-only); customer_details is office-roles only (portal no longer reads its carrier-side row). Finance may only move a load to invoiced/paid (trigger). get_exceptions() = role-checked wrapper over get_exceptions_unchecked(); mark_overdue_invoices() office-only; /api/extract-load owner/solo/dispatcher only. 10 regression tests in tests/security-role-scoping.test.ts. Evals: web 261/261, mobile 86/86, verify-migrations 10/10.
STILL OPEN from the roles audit: drivers + portal logins still read loads.rate / raw_intake_text / extraction_data from the base table (RLS can't hide columns; needs the mobile/web reads moved to the API, then drop the driver/portal base-table SELECT); portal reads carrier organizations.ein; unauthenticated /api/invoices/:id/track flips opened_at by sequential id (low); CORS reflects any Origin (low, Bearer-only); role_capabilities still not the single source of truth (~4 copies of role lists); driver_messages/settlements RLS still org-wide read for dispatcher/finance per BR-2 intent unchanged. Audit probes in tests/audit/ need triage (some expectations assume old semantics, e.g. dispatcher/driver_documents).

## Addendum — role_capabilities is now the single source of role gating (2026-09-20, migrations 0023 + 0024)
0023 seeded 21 action capabilities, 0024 the view/visibility ones (loads_view, customers_view, exceptions_view, maintenance_view, settlements_view, settings_view, org_documents_view/manage, documents_delete, rate_visibility). Services (13 MAY_* sets gone), 25 API routes, the admin console (requireAdminRole takes a capability), the sidebar (zero role literals) and page guards read `roleHasCapability`/`rolesWithCapability` from the generated module (`node scripts/gen-role-capabilities.mjs` writes web+mobile). Conversion rule: only where the capability's holder set EXACTLY equals the literal it replaces, so no access moved. `tests/role-capabilities-drift.test.ts` fails if the module and table disagree, if the two apps' copies differ, or if the pinned rules change (drivers never see rates, support never reaches billing).
Deliberately still literal: team INVITABLE/ASSIGNABLE roles (who may be assigned, not what a role may do), SELF_SERVE_ROLES at onboarding, 'driver'/'solo' UI-shape checks. Chat office-staff branch maps to loads_manage, NOT chat_participate (that includes the driver). Known UI/server gap: mobile+web UIs gate driver-side field actions on driver/solo while the server capability also allows owner/dispatcher: UI is narrower (safe), decide whether owners should get those buttons. Evals: web 273/273, mobile 86/86, verify-migrations 10/10.
