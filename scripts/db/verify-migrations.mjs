#!/usr/bin/env node
// scripts/db/verify-migrations.mjs
// Proves three things that nothing else in this repo proved before:
//
//   1. A brand-new database can be built from supabase/migrations alone.
//   2. The result matches supabase/schema/schema.sql, the reviewed snapshot.
//      (Drift here means the snapshot is stale or a migration did something
//      other than what its author believed.)
//   3. An EXISTING database baselined at 0001 can be upgraded to head — the
//      path a real environment takes, which "create from scratch" never
//      exercises.
//
// Everything happens in throwaway databases on the local container. The script
// refuses to touch anything it did not create, and drops them afterwards.
//
// Usage: node scripts/db/verify-migrations.mjs [--keep]

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../..')
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase/migrations')
const CONTAINER = process.env.PG_CONTAINER || 'supabase_db_carrieros'
const KEEP = process.argv.includes('--keep')

// Scratch databases carry this prefix and the script will only ever DROP a name
// that starts with it — a guard against a typo'd env var turning this into a
// destructive command against a real database.
const SCRATCH_PREFIX = 'migrationcheck_'

function sh(args, { input = null, db = 'postgres', allowFail = false } = {}) {
  try {
    return execFileSync(
      'docker',
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', db, '--no-psqlrc', '-q', ...args],
      { input: input ?? undefined, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    )
  } catch (err) {
    if (allowFail) return [err.stdout, err.stderr].filter(Boolean).join('\n')
    throw new Error([err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message)
  }
}

function dropScratch(name) {
  if (!name.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to drop "${name}" — not a scratch database.`)
  }
  sh(['-c', `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`], { allowFail: true })
}

function createScratch(name) {
  dropScratch(name)
  sh(['-c', `CREATE DATABASE ${name}`])
  // The schema references Supabase-managed objects (auth.users, auth.uid(),
  // storage.*) that live outside our migrations. Stubbed so a bare Postgres can
  // replay the file — same approach the existing supabase/schema/README.md
  // recipe uses, kept identical so both agree on what "clean" means.
  sh(['-v', 'ON_ERROR_STOP=1', '-f', '/dev/stdin'], {
    db: name,
    input: `
      create schema if not exists auth;
      create table auth.users (id uuid primary key, email text);
      create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
      create schema if not exists storage;
      create table storage.buckets (id text primary key, name text, public bool, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text, metadata jsonb);
      create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
      end $$;
    `,
  })
}

/**
 * A normalised, comparable fingerprint of a database's shape. Deliberately not
 * pg_dump: dump output reorders freely between runs and embeds volatile detail,
 * which produces diffs that are noise. This queries catalogs directly and sorts
 * everything, so a difference in the output is a real difference in the schema.
 */
function fingerprint(db) {
  const q = (sql) => sh(['-t', '-A', '-F', '|', '-c', sql], { db }).trim()

  return {
    tables: q(`
      select table_name from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE'
      order by table_name`),
    columns: q(`
      select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'-')
      from information_schema.columns where table_schema='public'
      order by table_name, column_name`),
    constraints: q(`
      select conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid)
      from pg_constraint
      where connamespace='public'::regnamespace
      order by 1`),
    indexes: q(`
      select indexname||':'||indexdef from pg_indexes
      where schemaname='public' order by indexname`),
    policies: q(`
      select tablename||':'||policyname||':'||cmd||':'||coalesce(qual,'-')||':'||coalesce(with_check,'-')
      from pg_policies where schemaname='public'
      order by tablename, policyname`),
    rlsEnabled: q(`
      select relname||':'||relrowsecurity from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' order by relname`),
    functions: q(`
      select p.proname||':'||pg_get_function_identity_arguments(p.oid)||':'||
             case when p.prosecdef then 'DEFINER' else 'INVOKER' end
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' order by 1`),
    triggers: q(`
      select event_object_table||':'||trigger_name||':'||action_timing||':'||event_manipulation
      from information_schema.triggers where trigger_schema='public'
      order by 1`),
    grants: q(`
      select table_name||':'||grantee||':'||privilege_type
      from information_schema.role_table_grants
      where table_schema='public' and grantee in ('anon','authenticated','service_role')
      order by 1`),
  }
}

function diffFingerprints(a, b, labelA, labelB) {
  const problems = []
  for (const key of Object.keys(a)) {
    const setA = new Set(a[key].split('\n').filter(Boolean))
    const setB = new Set(b[key].split('\n').filter(Boolean))
    const onlyA = [...setA].filter((x) => !setB.has(x))
    const onlyB = [...setB].filter((x) => !setA.has(x))
    if (onlyA.length || onlyB.length) {
      problems.push({ key, onlyA, onlyB, labelA, labelB })
    }
  }
  return problems
}

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort((x, y) => Number(/^(\d+)/.exec(x)[1]) - Number(/^(\d+)/.exec(y)[1]))
}

function applyFiles(db, files) {
  for (const f of files) {
    const body = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')
    sh(['-v', 'ON_ERROR_STOP=1', '-f', '/dev/stdin'], { db, input: body })
  }
}

const results = []
function check(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
    console.log(`  ✓ ${name}`)
  } catch (err) {
    results.push({ name, ok: false, error: err.message })
    console.log(`  ✗ ${name}\n      ${err.message.split('\n').join('\n      ')}`)
  }
}

console.log('Verifying migrations\n')

const dbFromMigrations = `${SCRATCH_PREFIX}fresh`
const dbFromSnapshot = `${SCRATCH_PREFIX}snapshot`
const dbUpgrade = `${SCRATCH_PREFIX}upgrade`

try {
  const files = migrationFiles()

  check('migration filenames are ordered and uniquely numbered', () => {
    const ordinals = files.map((f) => Number(/^(\d+)/.exec(f)[1]))
    const dupes = ordinals.filter((o, i) => ordinals.indexOf(o) !== i)
    if (dupes.length) throw new Error(`duplicate ordinal(s): ${[...new Set(dupes)].join(', ')}`)
    if (ordinals[0] !== 0) throw new Error(`first migration must be 0000, got ${files[0]}`)
  })

  check('a clean database can be built from migrations alone', () => {
    createScratch(dbFromMigrations)
    applyFiles(dbFromMigrations, files)
  })

  check('migration bookkeeping table exists after a clean build', () => {
    const out = sh(['-t', '-A', '-c', `select to_regclass('public.schema_migrations') is not null`], {
      db: dbFromMigrations,
    }).trim()
    if (out !== 't') throw new Error('schema_migrations missing after clean build')
  })

  check('migrations reproduce the reviewed schema.sql snapshot', () => {
    createScratch(dbFromSnapshot)
    sh(['-v', 'ON_ERROR_STOP=1', '-f', '/dev/stdin'], {
      db: dbFromSnapshot,
      input: readFileSync(path.join(REPO_ROOT, 'supabase/schema/schema.sql'), 'utf8'),
    })
    const fromMigrations = fingerprint(dbFromMigrations)
    const fromSnapshot = fingerprint(dbFromSnapshot)

    // schema_migrations exists only on the migrations side by construction.
    const strip = (fp) => {
      const out = {}
      for (const [k, v] of Object.entries(fp)) {
        out[k] = v
          .split('\n')
          .filter((line) => !line.includes('schema_migrations'))
          .join('\n')
      }
      return out
    }

    const problems = diffFingerprints(
      strip(fromMigrations),
      strip(fromSnapshot),
      'migrations',
      'schema.sql'
    )
    if (problems.length) {
      const detail = problems
        .map(
          (p) =>
            `${p.key}: ${p.onlyA.length} only in migrations, ${p.onlyB.length} only in schema.sql\n` +
            [...p.onlyA.slice(0, 3).map((x) => `    + ${x}`), ...p.onlyB.slice(0, 3).map((x) => `    - ${x}`)].join('\n')
        )
        .join('\n  ')
      throw new Error(`schema drift between migrations and snapshot:\n  ${detail}`)
    }
  })

  check('an existing database baselined at 0001 can upgrade to head', () => {
    createScratch(dbUpgrade)
    // Simulate a real environment: it has the BASELINE schema (0001), applied
    // the old ad-hoc way, and has never seen the migration runner.
    //
    // Deliberately replays 0001 rather than the current schema.sql. The
    // snapshot tracks head, so using it here would mean "upgrade a database
    // that is already up to date", which proves nothing and fails the moment a
    // migration adds a table — as it did on first run of migration 0005.
    sh(['-v', 'ON_ERROR_STOP=1', '-f', '/dev/stdin'], {
      db: dbUpgrade,
      input: readFileSync(path.join(MIGRATIONS_DIR, '0001_baseline_schema.sql'), 'utf8'),
    })
    // Adopt it, then apply everything after the baseline.
    const infra = files[0]
    sh(['-v', 'ON_ERROR_STOP=1', '-f', '/dev/stdin'], {
      db: dbUpgrade,
      input: readFileSync(path.join(MIGRATIONS_DIR, infra), 'utf8'),
    })
    sh([
      '-c',
      `insert into schema_migrations (version, name, checksum)
       values ('0000','migration_infrastructure','adopted'), ('0001','baseline_schema','adopted')`,
    ], { db: dbUpgrade })

    const post = files.filter((f) => Number(/^(\d+)/.exec(f)[1]) > 1)
    applyFiles(dbUpgrade, post)

    // schema_migrations itself is excluded: on a fresh build 0000 creates it
    // before the baseline's blanket GRANT sweeps it up, while an adopted
    // database creates it after — so its grants legitimately differ by
    // construction. (That asymmetry is what surfaced the blanket grant's reach
    // and led to migration 0002; the table's own privileges are asserted
    // directly by the grants check below rather than by this diff.)
    const stripBookkeeping = (fp) => {
      const out = {}
      for (const [k, v] of Object.entries(fp)) {
        out[k] = v.split('\n').filter((line) => !line.includes('schema_migrations')).join('\n')
      }
      return out
    }

    // The whole point: upgraded and freshly-created must converge.
    const problems = diffFingerprints(
      stripBookkeeping(fingerprint(dbUpgrade)),
      stripBookkeeping(fingerprint(dbFromMigrations)),
      'upgraded',
      'fresh'
    )
    if (problems.length) {
      const detail = problems
        .map((p) => `${p.key}: ${p.onlyA.length} only in upgraded, ${p.onlyB.length} only in fresh`)
        .join('\n  ')
      throw new Error(`upgraded database does not match a freshly-created one:\n  ${detail}`)
    }
  })
  check('reference catalogs are not writable by `authenticated`', () => {
    // Asserted positively rather than inferred from the fingerprint diff: a
    // diff only proves two databases agree, not that either is correct. If a
    // future migration re-runs a blanket GRANT, this fails immediately.
    const writable = sh(
      [
        '-t',
        '-A',
        '-c',
        `select table_name||':'||privilege_type
           from information_schema.role_table_grants
          where table_schema='public' and grantee='authenticated'
            and privilege_type in ('INSERT','UPDATE','DELETE')
            and table_name in ('tiers','features','languages','ifta_tax_rates','roles',
                               'vehicle_types','vehicle_classifications',
                               'vehicle_type_classifications','platform_flags')
          order by 1`,
      ],
      { db: dbFromMigrations }
    ).trim()
    if (writable) {
      throw new Error(`reference catalogs still writable by authenticated:\n    ${writable.split('\n').join('\n    ')}`)
    }
  })

  check('migration bookkeeping is not readable by `authenticated` or `anon`', () => {
    const leaked = sh(
      [
        '-t',
        '-A',
        '-c',
        `select grantee||':'||privilege_type from information_schema.role_table_grants
          where table_schema='public' and table_name='schema_migrations'
            and grantee in ('authenticated','anon') order by 1`,
      ],
      { db: dbFromMigrations }
    ).trim()
    if (leaked) throw new Error(`schema_migrations exposed: ${leaked.replace(/\n/g, ', ')}`)
  })

  check('every table with RLS enabled has a policy, or is a declared deny-all table', () => {
    // A table with RLS on and no policy denies everything. That is USUALLY a
    // half-finished change — the symptom (silent zero rows) is identical to the
    // missing-grant bug that motivated the blanket GRANT — so it is worth
    // failing on. But deny-all is occasionally the intent: infrastructure that
    // only an elevated relay connection may touch.
    //
    // Those are listed explicitly rather than pattern-matched, so exempting a
    // table is a deliberate, reviewable act rather than something a name can
    // opt into by accident.
    const DENY_ALL_BY_DESIGN = new Set([
      'schema_migrations', // migration bookkeeping (0000/0002)
      'outbox_events', // relayed by the worker's own connection (0005)
      'change_events', // read only by the API's SSE stream via service_role (0012)
      'org_feature_overrides', // per-org feature grants/denies, server-only (0021)
    ])

    const orphans = sh(
      [
        '-t',
        '-A',
        '-c',
        `select c.relname from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname='public' and c.relkind='r' and c.relrowsecurity
            and not exists (select 1 from pg_policies p
                             where p.schemaname='public' and p.tablename=c.relname)
          order by 1`,
      ],
      { db: dbFromMigrations }
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      .filter((t) => !DENY_ALL_BY_DESIGN.has(t))

    if (orphans.length) throw new Error(`RLS enabled but no policy: ${orphans.join(', ')}`)
  })

  check('deny-all infrastructure tables are unreachable by client roles', () => {
    // The other half of the exemption above: if a table may skip having a
    // policy, it must genuinely be inaccessible — otherwise the exemption is
    // itself the hole.
    const reachable = sh(
      [
        '-t',
        '-A',
        '-c',
        `select table_name||':'||grantee||':'||privilege_type
           from information_schema.role_table_grants
          where table_schema='public'
            and table_name in ('schema_migrations','outbox_events','change_events','org_feature_overrides')
            and grantee in ('anon','authenticated')
          order by 1`,
      ],
      { db: dbFromMigrations }
    ).trim()
    if (reachable) {
      throw new Error(`deny-all table granted to a client role:\n    ${reachable.split('\n').join('\n    ')}`)
    }
  })

  check('no client role holds TRUNCATE on any public table', () => {
    // TRUNCATE ignores RLS. 0003 revoked it from tables that existed at the time, but
    // default privileges re-grant it to every table created later, which is how audit_events
    // (append-only) ended up with it. This fails the next migration that creates a table and
    // forgets, instead of leaving it for an audit to find.
    const leaked = sh(
      [
        '-t',
        '-A',
        '-c',
        `select table_name||':'||grantee from information_schema.role_table_grants
          where table_schema='public' and privilege_type='TRUNCATE'
            and grantee in ('anon','authenticated') order by 1`,
      ],
      { db: dbFromMigrations }
    ).trim()
    if (leaked) throw new Error(`TRUNCATE granted to a client role:\n    ${leaked.split('\n').join('\n    ')}`)
  })
} finally {
  if (!KEEP) {
    for (const db of [dbFromMigrations, dbFromSnapshot, dbUpgrade]) dropScratch(db)
  } else {
    console.log(`\n--keep: left ${dbFromMigrations}, ${dbFromSnapshot}, ${dbUpgrade} in place.`)
  }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
