#!/usr/bin/env node
// scripts/db/migrate.mjs
// Applies pending migrations from supabase/migrations in version order.
//
// Design notes, because the obvious shortcuts are all wrong here:
//
//  * Each migration runs inside ONE transaction together with its
//    schema_migrations insert. A migration that fails leaves the database
//    exactly as it was — there is no half-applied state to reason about, and no
//    "which statement did it get to?" forensics during an incident.
//  * Already-applied migrations are checksum-verified on every run. Editing a
//    merged migration is the single most common way teams end up with
//    environments that claim the same schema version but do not have the same
//    schema; refusing to run is the only safe response.
//  * Ordering is by the filename's numeric prefix, not lexicographic and not
//    mtime. `10_x.sql` must sort after `9_x.sql`.
//
// Usage:
//   node scripts/db/migrate.mjs                 apply pending migrations
//   node scripts/db/migrate.mjs --status        show applied/pending, apply nothing
//   node scripts/db/migrate.mjs --dry-run       list what WOULD be applied
//   node scripts/db/migrate.mjs --baseline      record pending as applied WITHOUT
//                                               running them (adopting an existing
//                                               database whose schema already
//                                               matches the baseline)
//   node scripts/db/migrate.mjs --database X    target database name
//
// Connection: uses `docker exec <container> psql` to match how this repo
// already talks to its local Supabase (see CLAUDE.md). Override with
// PG_CONTAINER, or set DATABASE_URL to use a direct psql connection instead.

import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../..')
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase/migrations')

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const DATABASE = value('database', process.env.PGDATABASE || 'postgres')
const CONTAINER = process.env.PG_CONTAINER || 'supabase_db_carrieros'
const DIRECT_URL = process.env.DATABASE_URL || null

function psql(sql, { file = null } = {}) {
  // -v ON_ERROR_STOP=1 is what turns "psql printed some errors but exited 0"
  // into a real failure. Without it a broken migration reports success.
  const psqlArgs = ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-q']

  try {
    if (DIRECT_URL) {
      // A real host-filesystem temp file, not `-f /dev/stdin`: piping the SQL
      // as execFileSync's `input` and having psql open `/dev/stdin` as a path
      // works fine on macOS, but fails on GitHub Actions' Linux runners with
      // `psql: error: /dev/stdin: No such device or address` -- re-opening an
      // anonymous pipe via its /proc/self/fd path is a genuine Linux-specific
      // restriction, not something wrong with the SQL or the connection.
      // Confirmed live 2026-09-21: this exact migration applied fine locally
      // (macOS), then failed only on the GitHub runner with this error. Only
      // affects this DIRECT_URL branch -- psql runs as a direct child process
      // here, sharing the host filesystem, so a real path just works.
      let tmpFile = null
      try {
        if (file) {
          const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'carrieros-migrate-'))
          tmpFile = path.join(tmpDir, 'migration.sql')
          writeFileSync(tmpFile, file, 'utf8')
          psqlArgs.push('-f', tmpFile)
        } else {
          psqlArgs.push('-t', '-A', '-c', sql)
        }
        return execFileSync('psql', [DIRECT_URL, ...psqlArgs], {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        })
      } finally {
        if (tmpFile) unlinkSync(tmpFile)
      }
    }

    // Docker path (local dev): the temp-file trick above doesn't apply --
    // `docker exec` runs psql *inside* the container, which can't see a file
    // written to the host's tmpdir, so this keeps using `-f /dev/stdin` with
    // the SQL piped in via `-i`. Never observed to hit the Linux
    // /proc/self/fd restriction above in any local run.
    if (file) psqlArgs.push('-f', '/dev/stdin')
    else psqlArgs.push('-t', '-A', '-c', sql)
    return execFileSync(
      'docker',
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DATABASE, ...psqlArgs],
      { input: file ?? undefined, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    )
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).join('\n').trim()
    throw new Error(detail || err.message)
  }
}

// Rule E (docs/architecture-principles.md) — a schema change needs an
// impact-analysis step, not just a passing typecheck. Every migration in this
// repo already carries a header comment explaining what changed and why (the
// shortest today, 0003, is 5 lines) — this requires the SAME already-common
// practice going forward instead of leaving it to habit. Not a new format:
// no migration in the repo needs editing to satisfy this.
const MIN_HEADER_LINES = 3

function validateMigrationHeader(file, body) {
  const lines = body.split('\n')
  const expectedFirstLine = `-- ${file}`
  if (lines[0] !== expectedFirstLine) {
    throw new Error(
      `${file} must start with the header comment "${expectedFirstLine}" (Rule E, docs/architecture-principles.md). ` +
        `Every migration names itself on its first line — see any existing file under supabase/migrations/.`
    )
  }
  let headerLines = 0
  for (const line of lines) {
    if (line.startsWith('--')) headerLines++
    else break
  }
  if (headerLines < MIN_HEADER_LINES) {
    throw new Error(
      `${file}'s header comment is only ${headerLines} line(s) before the first SQL statement. Rule E ` +
        `(docs/architecture-principles.md) requires a short header describing the change's impact — what changed ` +
        `and why — the same way every existing migration does (shortest today: ` +
        `0003_revoke_anon_truncate_and_definer_execute.sql, 5 lines). Add a couple of lines of context above the SQL.`
    )
  }
}

function discoverMigrations() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))

  const parsed = files.map((file) => {
    const m = /^(\d+)_(.+)\.sql$/.exec(file)
    if (!m) {
      throw new Error(
        `Migration filename "${file}" does not match <digits>_<name>.sql. ` +
          `Ordering is derived from that numeric prefix, so an unparseable name has no defined position.`
      )
    }
    const body = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    validateMigrationHeader(file, body)
    return {
      file,
      ordinal: Number(m[1]),
      version: m[1],
      name: m[2],
      body,
      checksum: createHash('sha256').update(body).digest('hex'),
    }
  })

  // Duplicate ordinals mean two migrations claim the same position, so the
  // order two environments apply them in can differ. Caught here rather than
  // discovered later as unexplained drift.
  const seen = new Map()
  for (const mig of parsed) {
    if (seen.has(mig.ordinal)) {
      throw new Error(
        `Duplicate migration ordinal ${mig.ordinal}: "${seen.get(mig.ordinal)}" and "${mig.file}". ` +
          `Renumber one of them.`
      )
    }
    seen.set(mig.ordinal, mig.file)
  }

  return parsed.sort((a, b) => a.ordinal - b.ordinal)
}

function appliedMigrations() {
  const exists = psql(
    `select to_regclass('public.schema_migrations') is not null`
  ).trim()
  if (exists !== 't') return null // infrastructure not installed yet

  const rows = psql(`select version, name, checksum from schema_migrations order by version`)
  return rows
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [version, name, checksum] = line.split('|')
      return { version, name, checksum }
    })
}

function verifyImmutability(migrations, applied) {
  const byVersion = new Map(applied.map((a) => [a.version, a]))
  const drifted = []
  for (const mig of migrations) {
    const rec = byVersion.get(mig.version)
    if (rec && rec.checksum !== mig.checksum) {
      drifted.push({ file: mig.file, recorded: rec.checksum, actual: mig.checksum })
    }
  }
  if (drifted.length) {
    const detail = drifted
      .map((d) => `  ${d.file}\n    recorded ${d.recorded}\n    on disk  ${d.actual}`)
      .join('\n')
    throw new Error(
      `Applied migrations were modified after the fact:\n${detail}\n\n` +
        `Migrations are immutable once applied. This database and the repo no longer agree on what\n` +
        `"${drifted[0].file}" contains, so no environment can be trusted to match another.\n` +
        `Fix forward with a NEW migration; do not edit a merged one.`
    )
  }
}

function apply(mig, { record = true, run = true }) {
  const started = Date.now()
  if (run) {
    // The migration body and its bookkeeping row commit together. If the body
    // fails, the row is never written, so a retry re-applies cleanly.
    const wrapped = [
      'BEGIN;',
      mig.body,
      `INSERT INTO schema_migrations (version, name, checksum, duration_ms)
       VALUES ('${mig.version}', '${mig.name.replace(/'/g, "''")}', '${mig.checksum}', 0);`,
      'COMMIT;',
    ].join('\n')
    psql(null, { file: wrapped })
  } else if (record) {
    psql(
      `INSERT INTO schema_migrations (version, name, checksum, duration_ms)
       VALUES ('${mig.version}', '${mig.name.replace(/'/g, "''")}', '${mig.checksum}', 0)
       ON CONFLICT (version) DO NOTHING;`
    )
  }
  const ms = Date.now() - started
  psql(`UPDATE schema_migrations SET duration_ms = ${ms} WHERE version = '${mig.version}'`)
  return ms
}

function main() {
  const migrations = discoverMigrations()
  if (!migrations.length) {
    console.log('No migrations found in supabase/migrations.')
    return
  }

  let applied = appliedMigrations()

  // Bootstrap: 0000 installs schema_migrations itself, so on a virgin database
  // there is no table to read yet.
  if (applied === null) {
    const infra = migrations[0]
    if (infra.ordinal !== 0) {
      throw new Error(
        `schema_migrations does not exist and the lowest migration is ${infra.file}. ` +
          `Migration 0000 must create the bookkeeping table.`
      )
    }
    if (flag('status') || flag('dry-run')) {
      console.log('Database has no schema_migrations table — nothing applied yet.')
      console.log(`Pending (${migrations.length}):`)
      for (const m of migrations) console.log(`  ${m.version}  ${m.name}`)
      return
    }
    console.log(`→ ${infra.file} (bootstrapping migration bookkeeping)`)
    psql(null, { file: infra.body })
    psql(
      `INSERT INTO schema_migrations (version, name, checksum)
       VALUES ('${infra.version}', '${infra.name}', '${infra.checksum}')`
    )
    applied = appliedMigrations()
  }

  verifyImmutability(migrations, applied)

  const appliedVersions = new Set(applied.map((a) => a.version))
  const pending = migrations.filter((m) => !appliedVersions.has(m.version))

  if (flag('status')) {
    console.log(`Applied (${applied.length}):`)
    for (const a of applied) console.log(`  ${a.version}  ${a.name}`)
    console.log(`Pending (${pending.length}):`)
    for (const p of pending) console.log(`  ${p.version}  ${p.name}`)
    return
  }

  if (!pending.length) {
    console.log(`Up to date — ${applied.length} migration(s) applied, 0 pending.`)
    return
  }

  if (flag('dry-run')) {
    console.log(`Would apply ${pending.length} migration(s):`)
    for (const p of pending) console.log(`  ${p.version}  ${p.name}`)
    return
  }

  const baselining = flag('baseline')
  if (baselining) {
    console.log(
      `--baseline: recording ${pending.length} migration(s) as applied WITHOUT executing them.\n` +
        `Only correct when this database's schema already matches them.`
    )
  }

  for (const mig of pending) {
    process.stdout.write(`→ ${mig.file} ... `)
    const ms = apply(mig, { run: !baselining, record: true })
    console.log(`${baselining ? 'recorded' : 'applied'} (${ms}ms)`)
  }
  console.log(`Done — ${pending.length} migration(s) ${baselining ? 'recorded' : 'applied'}.`)
}

try {
  main()
} catch (err) {
  console.error(`\nMigration failed:\n${err.message}\n`)
  process.exit(1)
}
