#!/usr/bin/env node
// Mechanical gate for docs/architecture-principles.md's decoupling rules
// (Rule B/D/G) and the UI-component-library convention. Pure static grep —
// no DB, no build step — so it can run in a pre-commit hook in well under a
// second. See CLAUDE.md "Gated checks" section for how this is wired in.
//
// Each check below passed with zero violations when written (verified by
// grepping the real tree before adding it as a hard gate) — so any hit here
// is a real new regression, not pre-existing debt to grandfather.

import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = process.cwd()

function filesMatching(dir, exts) {
  // A rule may legitimately guard a directory that does not exist yet — the
  // v1-route-delegation rule guards app/api/v1 before the first endpoint is
  // written, so that the boundary is in place the moment someone creates it.
  // Checked up front rather than relying on the catch below, because `find`
  // writes "No such file or directory" to stderr and still exits non-zero,
  // which produced a spurious error line on every run.
  if (!existsSync(path.join(ROOT, dir))) return []
  try {
    return execSync(`find ${dir} -type f \\( ${exts.map((e) => `-name "*.${e}"`).join(' -o ')} \\)`, {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

const violations = []
const warnings = []

function checkPattern({ label, dirs, exts, forbiddenPattern, message, exclude, severity = 'error', skipComments = false }) {
  const sink = severity === 'warn' ? warnings : violations
  for (const dir of dirs) {
    for (const file of filesMatching(dir, exts)) {
      if (exclude && exclude.some((e) => file.startsWith(e))) continue
      const content = readFileSync(path.join(ROOT, file), 'utf8')
      const lines = content.split('\n')
      lines.forEach((line, i) => {
        if (skipComments && /^\s*(\/\/|\*)/.test(line)) return
        if (forbiddenPattern.test(line)) {
          sink.push(`[${label}] ${file}:${i + 1}: ${line.trim()}\n  → ${message}`)
        }
      })
    }
  }
}

// Rule B/D — business-logic and query modules must stay framework/UI-free,
// so they stay swappable and testable without React/Next.js in scope.
checkPattern({
  label: 'decoupling',
  dirs: ['lib/domain', 'lib/queries'],
  exts: ['ts', 'tsx'],
  forbiddenPattern: /from\s+['"](react|next\/|@\/components)/,
  message: 'lib/domain and lib/queries are business/query logic — must not import React, Next.js, or components/*. See architecture-principles.md Rule B/D.',
})

// ── server/ layer boundaries (2026-07-26 modernization, Phase 3) ────────────
//
// server/ holds the layered API stack: domain -> application -> ports, with
// infrastructure adapters implementing the ports and app/api/v1 route handlers
// as transport. The whole directory is written so it can later be lifted into
// a standalone Node service; these rules are what keep that true, because the
// thing that makes such a move expensive is always a handful of stray imports
// that nobody noticed accumulating.
//
// The rules are enforced as ERRORS from day one, not ratcheted like the older
// UI/query debt. That is affordable precisely because server/ is new: there is
// no pre-existing violation to grandfather, and the cheapest moment to enforce
// a boundary is before anything has crossed it.

// The domain layer is pure: no framework, no I/O, no SDK. This is what lets
// the entitlement decision (and every state machine) be unit-tested with a
// plain object and a fixed Date, with no database in scope.
checkPattern({
  label: 'server-domain-purity',
  dirs: ['server/domain'],
  exts: ['ts'],
  forbiddenPattern:
    /from\s+['"](react|react-dom|next(\/|['"])|@supabase\/|@\/components|@\/lib\/supabase|@\/app\/)/,
  message:
    'server/domain must be pure — no React, Next.js, Supabase, components, or app imports. It may import only other server/domain modules. See architecture/adr/0002-layered-server-architecture.md.',
})

// The application layer orchestrates domain + ports. It may not reach for a
// concrete adapter: depending on the interface is what allows a repository to
// be swapped for a fake in tests and for a different database later.
checkPattern({
  label: 'server-application-purity',
  dirs: ['server/application'],
  exts: ['ts'],
  forbiddenPattern:
    /from\s+['"](react|react-dom|next(\/|['"])|@supabase\/|@\/components|@\/lib\/supabase|@\/app\/|\.\.\/infrastructure|@\/server\/infrastructure)/,
  message:
    'server/application may import server/domain and server/ports only — never Next.js, React, Supabase, or a concrete infrastructure adapter. Inject dependencies through the service constructor instead.',
})

// Ports are interface declarations. A port that imports an adapter has
// inverted the dependency it exists to create.
checkPattern({
  label: 'server-ports-purity',
  dirs: ['server/ports'],
  exts: ['ts'],
  forbiddenPattern:
    /from\s+['"](react|next(\/|['"])|@supabase\/|@\/components|@\/lib\/supabase|\.\.\/infrastructure|@\/server\/infrastructure)/,
  message:
    'server/ports declares interfaces only — it must not import Next.js, React, Supabase, or any infrastructure adapter.',
})

// Route handlers are transport: parse, authenticate, authorize, validate,
// delegate, map the result. Reaching past the application layer straight into
// the database is how business logic ends up back in the HTTP layer.
checkPattern({
  label: 'v1-route-delegation',
  dirs: ['app/api/v1'],
  exts: ['ts'],
  forbiddenPattern: /\.from\(['"`]|\.rpc\(['"`]/,
  message:
    'app/api/v1 route handlers must delegate to an application service — no direct .from()/.rpc() table or RPC access. Persistence belongs behind a repository port.',
})

// UI layer must not talk to Supabase directly — routes/server components/
// lib own data access; components only take props. Prevents the DB from
// leaking into presentation and keeps components testable in isolation.
checkPattern({
  label: 'ui-db-boundary',
  dirs: ['components'],
  exts: ['ts', 'tsx'],
  forbiddenPattern: /from\s+['"]@supabase\/(supabase-js|ssr)['"]/,
  message: 'components/* must not import supabase-js/ssr directly — fetch data in a route/Server Component/lib module and pass it down as props. See architecture-principles.md Rule G.',
})

// Rule G — the provider-adapter boundary only does its job if call sites
// actually go through it instead of reaching for the raw SDK.
checkPattern({
  label: 'provider-boundary-storage',
  dirs: ['app', 'lib', 'components'],
  exts: ['ts', 'tsx'],
  exclude: ['lib/storage'],
  forbiddenPattern: /\.storage\.from\(/,
  message: 'Use lib/storage/StorageProvider instead of calling supabase.storage.from() directly. See architecture-principles.md Rule G.',
})

checkPattern({
  label: 'provider-boundary-auth-admin',
  dirs: ['app', 'lib', 'components'],
  exts: ['ts', 'tsx'],
  exclude: ['lib/auth-admin'],
  forbiddenPattern: /auth\.admin\./,
  message: 'Use lib/auth-admin/AuthAdminProvider instead of calling supabase.auth.admin.* directly. See architecture-principles.md Rule G.',
})

// Rule B — hot-table query encapsulation. Per-table severity: a table
// tightens from `warn` to `error` once its lib/queries/<table>.ts module
// exists and its call sites have actually migrated (same ratchet posture as
// ERROR_SURFACES for the UI lint guard — ratchet per-surface, not all-or-
// nothing). `profiles` migrated fully on 2026-07-24 (0 remaining call sites)
// and is now gated as `error`. `loads`/`drivers` still have a handful of
// deliberately-left one-off shapes (see each lib/queries/<table>.ts header
// comment for why forcing those into the shared module would be over-
// abstraction) — still `warn` until/unless those are revisited.
const QUERY_ENCAPSULATION_SEVERITY = {
  profiles: 'error',
  loads: 'warn',
  drivers: 'warn',
}
for (const [table, severity] of Object.entries(QUERY_ENCAPSULATION_SEVERITY)) {
  checkPattern({
    label: `query-encapsulation-${table}`,
    dirs: ['app', 'lib'],
    exts: ['ts', 'tsx'],
    exclude: ['lib/queries'],
    forbiddenPattern: new RegExp(`\\.from\\(['"]${table}['"]\\)`),
    message: `Prefer a shared lib/queries/${table}.ts function over an ad hoc .from('${table}') call site. See architecture-principles.md Rule B.${severity === 'warn' ? ' (warn-only — not yet a hard gate, see script comment.)' : ''}`,
    severity,
  })
}

// Rule A — shared enum/status modules with exhaustive handling. Migrated
// fully on 2026-07-22/23 (see architecture-principles.md §4 and its
// changelog) — this check verifies that stays true by flagging a hand-
// written status-color map (a `<status literal>: '<tailwind-or-hex-color>'`
// line) outside lib/domain (web) or constants/theme.ts (mobile), the
// designated shared modules found by grepping for the existing Rule A
// modules before writing this check. Scoped to loads.status's specific,
// highly-distinctive vocabulary (picked_up/in_transit/dispatched don't
// collide with unrelated UI-state enums) and to color-shaped values
// (`bg-`/`text-`/`#`) rather than every status word, after an earlier, looser
// draft of this pattern false-positived on components/ui/ChecklistItem.tsx's
// unrelated `'active'`/`'pending'` checklist-row states — same
// false-positive-avoidance discipline as Rule C's precedent below. Run
// against the current tree before this was added: it found ONE real hit,
// app/track/[token]/page.tsx's STATUS_COLOR map (deliberately not sharing
// the authenticated pages' module per that file's own header comment, but
// still the exact duplication shape Rule A exists to prevent) — so this
// stays `warn`, not the hard gate the zero-violations precedent (Rule G)
// would otherwise justify.
checkPattern({
  label: 'rule-a-status-color-duplication',
  dirs: ['app', 'components', '../carrieros-mobile/src'],
  exts: ['ts', 'tsx'],
  exclude: ['../carrieros-mobile/src/constants/theme.ts'],
  forbiddenPattern: /^\s*(draft|scheduled|dispatched|picked_up|in_transit|delivered|invoiced|paid|cancelled|declined)\s*:\s*['"](#|bg-|text-)/,
  message: "Hand-written status-color mapping outside the shared Rule A module (lib/domain/load-status.ts web, constants/theme.ts mobile). See architecture-principles.md Rule A. (warn-only — one pre-existing, documented exception found; see check-architecture.mjs comment.)",
  severity: 'warn',
})

// Rule H — cross-client business/gating logic must not be hand-duplicated
// TypeScript; role_capabilities + scripts/gen-role-capabilities.mjs is the
// generated single source. This does not stop a NEW hand-rolled role-list
// array from being introduced elsewhere (role-capabilities-drift.test.ts
// only protects the generated file itself) — flags an array literal of 2+
// role-name string literals outside the generated files in either app.
// Necessarily a heuristic (an array of role names looks like any other
// string array to a regex) — comment lines are skipped after an early draft
// flagged lib/roles-policy.ts's own header comment, which quotes a role
// array as prose while explaining the BILLING_ROLES drift incident. Run
// against the current tree: found violations (existing hand-rolled arrays
// predating this check, e.g. team/InviteMemberButton.tsx's ROLES,
// api/onboarding/route.ts's SELF_SERVE_ROLES) — a new ratchet, so `warn`,
// not `error`; see the task report for the full count.
checkPattern({
  label: 'rule-h-role-list-literal',
  dirs: ['app', 'lib', 'components', 'server', '../carrieros-mobile/src'],
  exts: ['ts', 'tsx'],
  exclude: ['lib/generated', '../carrieros-mobile/src/lib/generated'],
  forbiddenPattern: /\[\s*'(owner|solo|dispatcher|finance|driver)'(\s*,\s*'(owner|solo|dispatcher|finance|driver)')+\s*\]/,
  skipComments: true,
  message: "Hand-rolled array of role-name literals outside the generated lib/generated/role-capabilities.ts. Prefer role_capabilities/roleHasCapability()/rolesWithCapability() (or lib/roles-policy.ts's thin re-export shim) so this can't drift the way BILLING_ROLES already did once. See architecture-principles.md Rule H. (warn-only — new ratchet, pre-existing hits reported, not yet fixed.)",
  severity: 'warn',
})

// Rule I — every locale-varying value resolves through one inheritance
// chain, never a literal fallback. Flags a literal 'USD'/'CAD'/'MXN' used as
// a `??`/`?:` fallback or branch result outside lib/format-money.ts's own
// default parameter (formatMoney's `currency = 'USD'` is a generic
// formatter's last-resort default, not a per-call-site duplication of an
// org's actual currency — the thing Rule I's entry 1 is actually about).
// Run against the current tree: found the ~20-site pattern architecture-
// principles.md's Rule I entry 1 describes (`carrierOrg?.currency ?? 'USD'`
// repeated per page, plus api/onboarding/route.ts's country->currency
// ternary computing it inline instead of through a shared resolver) — not
// yet fixed, so `warn`; see the task report for the exact count and a note
// on how it compares to the doc's approximate figure.
checkPattern({
  label: 'rule-i-currency-literal-fallback',
  dirs: ['app', 'lib', 'components', 'server', '../carrieros-mobile/src'],
  exts: ['ts', 'tsx'],
  exclude: ['lib/format-money.ts', '../carrieros-mobile/src/lib/format-money.ts'],
  forbiddenPattern: /(\?\?|\?|:)\s*'(USD|CAD|MXN)'/,
  skipComments: true,
  message: "Literal currency fallback outside a single designated resolver. Every locale-varying value must resolve through one inheritance chain, the same shape already correctly used for preferred_language/uom_system — never a literal default typed inline at each call site. See architecture-principles.md Rule I. (warn-only — not yet fixed, tracked as a living list per Rule I's own text.)",
  severity: 'warn',
})

// ── ADR 0003: no frontend data access except through the API ────────────────
//
// Every screen reads and writes through /api/v1 (mobile via the generated
// client; web Server Components via the same application services, called
// in-process). A direct `.from('table')` / `.rpc('fn')` / `.storage` call in UI
// code is a second data path with its own rules -- the source of the drift this
// architecture exists to end.
//
// Ratchet, like the UI guard: legacy call sites are counted and reported as
// debt (see architecture/inventory/*), and a file that has been migrated is
// added to API_ONLY below, after which any new direct call in it is an ERROR.
// Migrate a screen, add it here, and the regression is locked out.
const API_ONLY = new Set([
  'app/(app)/loads/page.tsx',
  '../carrieros-mobile/src/app/(tabs)/loads.tsx',
  '../carrieros-mobile/src/hooks/use-register-push-token.ts',
  '../carrieros-mobile/src/lib/offline-queue.ts',
  '../carrieros-mobile/src/lib/profile-api.ts',
  '../carrieros-mobile/src/components/pod-section.tsx',
  '../carrieros-mobile/src/components/share-location-section.tsx',
  '../carrieros-mobile/src/lib/ifta-tracking.ts',
  '../carrieros-mobile/src/lib/dvir-attachments.ts',
  '../carrieros-mobile/src/app/(tabs)/dvir-start.tsx',
  '../carrieros-mobile/src/app/(tabs)/history.tsx',
  '../carrieros-mobile/src/app/(tabs)/invoices.tsx',
  '../carrieros-mobile/src/app/(tabs)/my-load.tsx',
  '../carrieros-mobile/src/app/(tabs)/fleet.tsx',
  '../carrieros-mobile/src/app/dvir-history/index.tsx',
  '../carrieros-mobile/src/app/dvir/[loadId].tsx',
  '../carrieros-mobile/src/app/invoice/[id].tsx',
  '../carrieros-mobile/src/app/load/[id].tsx',
  '../carrieros-mobile/src/app/driver-profile/index.tsx',
  '../carrieros-mobile/src/app/vehicle/[id].tsx',
  '../carrieros-mobile/src/hooks/use-onboarding-status.tsx',
  '../carrieros-mobile/src/hooks/use-profile-role.ts',
  '../carrieros-mobile/src/lib/submitter.ts',
  '../carrieros-mobile/src/lib/entitlements.ts',
  '../carrieros-mobile/src/app/(tabs)/alerts.tsx',
  '../carrieros-mobile/src/lib/exceptions.ts',
  '../carrieros-mobile/src/app/(tabs)/customers.tsx',
  '../carrieros-mobile/src/app/customers/index.tsx',
  '../carrieros-mobile/src/app/customers/[id].tsx',
  '../carrieros-mobile/src/app/billing/index.tsx',
  '../carrieros-mobile/src/app/maintenance/index.tsx',
  '../carrieros-mobile/src/app/settlements/index.tsx',
  '../carrieros-mobile/src/components/ifta-section.tsx',
  '../carrieros-mobile/src/components/ifta-summary.tsx',
  '../carrieros-mobile/src/components/fuel-stops-section.tsx',
  '../carrieros-mobile/src/components/driver-chat-section.tsx',
  '../carrieros-mobile/src/app/(tabs)/home.tsx',
  '../carrieros-mobile/src/hooks/use-theme.tsx',
  '../carrieros-mobile/src/hooks/use-locale.tsx',
])
const DIRECT_DB = /\.from\(\s*['"`][A-Za-z_]+['"`]\s*\)|\.rpc\(\s*['"`]|supabase\s*\.\s*storage\b/
const debt = { web: { files: new Set(), sites: 0 }, mobile: { files: new Set(), sites: 0 } }

function scanFrontend(kind, dirs, exclude) {
  for (const dir of dirs) {
    for (const file of filesMatching(dir, ['ts', 'tsx'])) {
      if (exclude.some((e) => file.startsWith(e))) continue
      const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!DIRECT_DB.test(line) || /^\s*(\/\/|\*)/.test(line)) return
        if (API_ONLY.has(file)) {
          violations.push(`[api-only-frontend] ${file}:${i + 1}: ${line.trim()}\n  → This file is API-only (ADR 0003): read/write through /api/v1 (mobile: apiClient; web: the application services), not a direct table/RPC/storage call.`)
        } else {
          debt[kind].files.add(file)
          debt[kind].sites += 1
        }
      })
    }
  }
}
scanFrontend('web', ['app', 'components'], ['app/api', 'app/(admin)'])
scanFrontend('mobile', ['../carrieros-mobile/src'], ['../carrieros-mobile/src/lib/supabase.ts', '../carrieros-mobile/src/lib/api-client.ts', '../carrieros-mobile/src/types'])

// ── Rule J — dependency-audit gate ───────────────────────────────────────────
//
// Supply-chain risk today surfaces only via a manually-run `npm audit`, which
// nobody remembers to run on a cadence. This folds the check into the gate
// that already runs regularly, so a HIGH/CRITICAL CVE in a production
// dependency shows up here instead of staying silent until someone happens to
// audit by hand. Runs `npm audit --omit=dev --json` (the modern spelling of
// `--production`) against both carrieros-web and carrieros-mobile —
// production dependencies only, since a devDependency vulnerability (e.g. in
// a test runner) never ships to a customer and would just be noise here.
//
// Warn-only, and a different shape from every other check in this file: npm
// audit's result can change out from under an unmodified tree the moment the
// advisory database updates — zero code change required to go from 0 to N
// violations. A hard gate would spuriously break `verify:compliance` on an
// unrelated commit the day a new CVE is filed against an already-pinned
// version, which is not the kind of regression this file exists to catch.
// Run against the current tree: carrieros-web has 1 critical (next) + 5 high
// (browserslist, nanoid, nodemailer, postcss, sharp); carrieros-mobile has 8
// high, 0 critical — real, pre-existing exposure, not fixed by this change.
// See architecture-principles.md Rule J.
function checkDependencyAudit() {
  const targets = [
    { label: 'carrieros-web', dir: ROOT },
    { label: 'carrieros-mobile', dir: path.join(ROOT, '../carrieros-mobile') },
  ]
  for (const { label, dir } of targets) {
    if (!existsSync(path.join(dir, 'package.json'))) continue
    let json
    try {
      const out = execSync('npm audit --omit=dev --json', { cwd: dir, encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 })
      json = JSON.parse(out)
    } catch (e) {
      // npm audit exits non-zero the moment it finds any vulnerability — the
      // JSON report is still on stdout, so parse the error's stdout instead
      // of treating a non-zero exit as "audit failed to run".
      if (e.stdout) {
        try { json = JSON.parse(e.stdout) } catch { /* fall through to the "couldn't parse" warning below */ }
      }
    }
    if (!json?.metadata?.vulnerabilities) {
      warnings.push(`[rule-j-dependency-audit] ${label}: \`npm audit --omit=dev\` did not return parseable output this run — could not check for HIGH/CRITICAL production-dependency vulnerabilities. See architecture-principles.md Rule J.`)
      continue
    }
    const { high = 0, critical = 0 } = json.metadata.vulnerabilities
    if (high + critical === 0) continue
    const offenders = Object.entries(json.vulnerabilities || {})
      .filter(([, v]) => v.severity === 'high' || v.severity === 'critical')
      .map(([name, v]) => `${name} (${v.severity})`)
      .join(', ')
    warnings.push(`[rule-j-dependency-audit] ${label}: ${critical} critical, ${high} high severity ${high + critical === 1 ? 'vulnerability' : 'vulnerabilities'} in production dependencies: ${offenders}\n  → Run \`npm audit --omit=dev\` in ${label} and upgrade/patch the flagged packages. See architecture-principles.md Rule J. (warn-only — advisory-database churn, not a code regression; see check-architecture.mjs comment.)`)
  }
}
checkDependencyAudit()

// ── Rule K — migration expand/contract safety gate ──────────────────────────
//
// A migration that DROPs/RENAMEs/type-changes a column (or drops a table) in
// one step is safe only if every running instance of the app is stopped
// first. This codebase runs migrations and deploys app code independently
// (scripts/db/migrate.mjs), so for the duration of a rolling deploy old
// application code can still be running against the new schema. A
// single-step DROP COLUMN / RENAME COLUMN / data-type change / DROP TABLE
// breaks that old code immediately; the safe shape is always two migrations
// — expand (add the new column/table alongside the old, backfill, ship code
// that uses both) then contract (drop the old shape only once nothing reads
// it anymore). ADD COLUMN ... NOT NULL with no DEFAULT is the same hazard
// from the other direction: an in-flight INSERT from old app code that
// doesn't know the column exists fails immediately.
//
// Warn-only: some of these patterns are legitimate on a table nothing reads
// yet (e.g. added and dropped within the same release), and this is a plain
// text/regex scan of the .sql body with no way to know that from the file
// alone — a human call, not a mechanically-verifiable fact the way Rule E's
// migration-header check is. Run against the current 26 migrations: 0 hits
// today (every migration so far has only added columns/tables, and every
// NOT NULL addition already carries a DEFAULT) — a clean ratchet baseline to
// hold, not a pre-existing-debt list like Rule H/I's. See architecture-
// principles.md Rule K.
function checkMigrationSafety() {
  const dir = '../supabase/migrations'
  if (!existsSync(path.join(ROOT, dir))) return
  const files = filesMatching(dir, ['sql']).sort()
  const lineLevelPatterns = [
    { name: 'DROP COLUMN', re: /\bDROP\s+COLUMN\b/i },
    { name: 'ALTER COLUMN ... TYPE (data-type change)', re: /\bALTER\s+COLUMN\s+\S+\s+(TYPE|SET\s+DATA\s+TYPE)\b/i },
    { name: 'DROP TABLE', re: /\bDROP\s+TABLE\b/i },
    { name: 'RENAME COLUMN', re: /\bRENAME\s+COLUMN\b/i },
  ]
  for (const file of files) {
    const content = readFileSync(path.join(ROOT, file), 'utf8')
    content.split('\n').forEach((line, i) => {
      const codeOnly = line.replace(/--.*$/, '')
      for (const { name, re } of lineLevelPatterns) {
        if (re.test(codeOnly)) {
          warnings.push(`[rule-k-migration-expand-contract] ${file}:${i + 1}: ${line.trim()}\n  → ${name} is unsafe to run against a live table in one step — old app code from an in-flight deploy may still read/write the old shape. Split into an expand migration (add alongside, backfill) and a later contract migration (remove once nothing reads the old shape). See architecture-principles.md Rule K. (warn-only — see check-architecture.mjs comment.)`)
        }
      }
    })
    // ADD COLUMN ... NOT NULL with no DEFAULT is a statement-level check (the
    // statement can wrap multiple lines, e.g. a CHECK(...) clause), so scan
    // whole ALTER TABLE ... ADD COLUMN ...; statements rather than one line.
    const addColumnRe = /ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\s+[^;]*?;/gis
    let m
    while ((m = addColumnRe.exec(content))) {
      const stmt = m[0]
      if (/NOT\s+NULL/i.test(stmt) && !/DEFAULT\b/i.test(stmt)) {
        const lineNo = content.slice(0, m.index).split('\n').length
        warnings.push(`[rule-k-migration-expand-contract] ${file}:${lineNo}: ${stmt.replace(/\s+/g, ' ').trim()}\n  → ADD COLUMN ... NOT NULL with no DEFAULT breaks any in-flight INSERT from old app code that doesn't set the new column. Add a DEFAULT (even a temporary one, dropped in a later contract migration) or add the column nullable and enforce NOT NULL later once every writer sets it. See architecture-principles.md Rule K. (warn-only — see check-architecture.mjs comment.)`)
      }
    }
  }
}
checkMigrationSafety()

// ── Rule L — org-scoped-table isolation-test heuristic ──────────────────────
//
// Every table with a carrier_org_id column (this schema's consistent tenant-
// scoping convention: BIGINT REFERENCES organizations(id)) depends entirely
// on RLS to keep org A from reading/writing org B's rows — and the only
// thing that catches a regression in that policy is a test that actually
// proves it, the way tests/rls-isolation.test.ts does for loads/invoices/
// vehicles/drivers (two real orgs, a session as org B, assert zero rows / a
// silently-filtered write). This check finds every table with that column
// shape (parsed from CREATE TABLE / ALTER TABLE ... ADD COLUMN across
// supabase/migrations/*.sql) and cross-references it against
// carrieros-web/tests/ for a matching isolation test.
//
// Necessarily a heuristic, same posture as Rule H: it can't verify a test
// actually asserts cross-org denial, only that a file whose name or content
// mentions isolation/cross-org/cross-tenant (rls-isolation.test.ts,
// security-public-api.test.ts's "tenant isolation" describe block, etc. —
// the vocabulary this codebase's own tests already use) also references the
// table by name. A table only ever mentioned in a non-isolation test still
// counts as uncovered. Run against the current schema and test tree: 18
// org-scoped tables found; 4 have no matching isolation test today —
// customer_contacts, dvir_inspections, maintenance_reminders,
// vehicle_documents — a real, pre-existing gap, so `warn`, tracked as a
// living list per Rule I's precedent, not a hard gate. See architecture-
// principles.md Rule L.
function collectOrgScopedTables() {
  const dir = '../supabase/migrations'
  const tables = new Set()
  if (!existsSync(path.join(ROOT, dir))) return tables
  for (const file of filesMatching(dir, ['sql']).sort()) {
    const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n')
    let currentTable = null
    for (const line of lines) {
      const createMatch = line.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/i)
      if (createMatch && !currentTable) currentTable = createMatch[1]
      if (currentTable && /^\s*[A-Za-z_][A-Za-z0-9_]*_org_id\s+BIGINT\b/i.test(line)) {
        tables.add(currentTable)
      }
      if (currentTable && line.trim() === ');') currentTable = null
      const alterMatch = line.match(/ALTER\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+ADD\s+COLUMN\s+[A-Za-z_][A-Za-z0-9_]*_org_id\s+BIGINT/i)
      if (alterMatch) tables.add(alterMatch[1])
    }
  }
  return tables
}

function checkIsolationTestCoverage() {
  const testsDir = 'tests'
  if (!existsSync(path.join(ROOT, testsDir))) return
  const tables = collectOrgScopedTables()
  if (tables.size === 0) return
  const testFiles = filesMatching(testsDir, ['ts', 'tsx'])
  const isolationFiles = testFiles.filter((f) => {
    if (/isolation|cross-org|cross-tenant/i.test(f)) return true
    return /isolation|cross-org|cross-tenant/i.test(readFileSync(path.join(ROOT, f), 'utf8'))
  })
  const coverageText = isolationFiles.map((f) => readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
  for (const table of [...tables].sort()) {
    const re = new RegExp(`['"\`]${table}['"\`]`)
    if (!re.test(coverageText)) {
      warnings.push(`[rule-l-org-isolation-test] ${table}: no isolation test found referencing this table in an isolation-flagged file under carrieros-web/tests/ (files matching or containing /isolation|cross-org|cross-tenant/i — currently: ${isolationFiles.join(', ') || '(none)'}).\n  → This table has a carrier_org_id column and depends on RLS for tenant isolation. Add an org-A-vs-org-B cross-tenant test following tests/rls-isolation.test.ts's pattern. See architecture-principles.md Rule L. (warn-only — heuristic, living list; see check-architecture.mjs comment.)`)
    }
  }
}
checkIsolationTestCoverage()

if (violations.length > 0) {
  console.error(`\n✗ Architecture check failed (${violations.length} violation(s)):\n`)
  console.error(violations.join('\n\n'))
  console.error('')
  process.exit(1)
}

console.log(`\nAPI-only migration (ADR 0003) — remaining direct DB call sites: web ${debt.web.sites} in ${debt.web.files.size} files (excl. app/api, admin), mobile ${debt.mobile.sites} in ${debt.mobile.files.size} files. Migrated: ${API_ONLY.size} files.`)

if (warnings.length > 0) {
  console.log(`\n⚠ Architecture check: ${warnings.length} warning(s) (non-blocking — see each [label] for the specific rule):`)
  console.log(warnings.join('\n\n'))
  console.log('')
}

console.log('✓ Architecture check passed (decoupling + provider-boundary rules)')
