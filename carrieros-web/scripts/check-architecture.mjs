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

function checkPattern({ label, dirs, exts, forbiddenPattern, message, exclude, severity = 'error' }) {
  const sink = severity === 'warn' ? warnings : violations
  for (const dir of dirs) {
    for (const file of filesMatching(dir, exts)) {
      if (exclude && exclude.some((e) => file.startsWith(e))) continue
      const content = readFileSync(path.join(ROOT, file), 'utf8')
      const lines = content.split('\n')
      lines.forEach((line, i) => {
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

if (violations.length > 0) {
  console.error(`\n✗ Architecture check failed (${violations.length} violation(s)):\n`)
  console.error(violations.join('\n\n'))
  console.error('')
  process.exit(1)
}

console.log(`\nAPI-only migration (ADR 0003) — remaining direct DB call sites: web ${debt.web.sites} in ${debt.web.files.size} files (excl. app/api, admin), mobile ${debt.mobile.sites} in ${debt.mobile.files.size} files. Migrated: ${API_ONLY.size} files.`)

if (warnings.length > 0) {
  console.log(`\n⚠ Architecture check: ${warnings.length} warning(s) (non-blocking, Rule B query-encapsulation debt):`)
  console.log(warnings.join('\n\n'))
  console.log('')
}

console.log('✓ Architecture check passed (decoupling + provider-boundary rules)')
