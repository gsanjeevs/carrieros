#!/usr/bin/env node
// Mechanical gate for docs/architecture-principles.md's decoupling rules
// (Rule B/D/G) and the UI-component-library convention. Pure static grep —
// no DB, no build step — so it can run in a pre-commit hook in well under a
// second. See CLAUDE.md "Gated checks" section for how this is wired in.
//
// Each check below passed with zero violations when written (verified by
// grepping the real tree before adding it as a hard gate) — so any hit here
// is a real new regression, not pre-existing debt to grandfather.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = process.cwd()

function filesMatching(dir, exts) {
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

// Rule B — hot-table query encapsulation. `lib/queries/profiles.ts` is the
// only module that exists so far; `loads`/`drivers` still have dozens of ad
// hoc `.from()` call sites (86 combined, found while scoping this check) —
// too large to gate as zero-violation today, so this is `warn`-only:
// visible, trackable in the design-system changelog over time, but doesn't
// block a commit. Once a table gets its own lib/queries/<table>.ts and call
// sites migrate, tighten this to `error` for that table the same way
// ERROR_SURFACES tightens the UI lint guard.
for (const table of ['profiles', 'loads', 'drivers']) {
  checkPattern({
    label: `query-encapsulation-${table}`,
    dirs: ['app', 'lib'],
    exts: ['ts', 'tsx'],
    exclude: ['lib/queries'],
    forbiddenPattern: new RegExp(`\\.from\\(['"]${table}['"]\\)`),
    message: `Prefer a shared lib/queries/${table}.ts function over an ad hoc .from('${table}') call site. See architecture-principles.md Rule B. (warn-only — not yet a hard gate, see script comment.)`,
    severity: 'warn',
  })
}

if (violations.length > 0) {
  console.error(`\n✗ Architecture check failed (${violations.length} violation(s)):\n`)
  console.error(violations.join('\n\n'))
  console.error('')
  process.exit(1)
}

if (warnings.length > 0) {
  console.log(`\n⚠ Architecture check: ${warnings.length} warning(s) (non-blocking, Rule B query-encapsulation debt):`)
  console.log(warnings.join('\n\n'))
  console.log('')
}

console.log('✓ Architecture check passed (decoupling + provider-boundary rules)')
