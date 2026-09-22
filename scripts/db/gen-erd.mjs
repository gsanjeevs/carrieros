#!/usr/bin/env node
// scripts/db/gen-erd.mjs
// Generates architecture/erd.md (Mermaid entity-relationship diagrams) from the
// LIVE schema, so the ERD cannot drift from the database the way a hand-drawn one
// does. Same generator pattern as regen-types.sh / gen-role-capabilities.mjs /
// gen-api-client.ts.
//
//   node scripts/db/gen-erd.mjs           write architecture/erd.md
//   node scripts/db/gen-erd.mjs --check   exit 1 if the committed file is stale
//
// Connection: same as migrate.mjs (docker exec into supabase_db_carrieros, or
// DATABASE_URL for a direct psql connection).
//
// A table that exists but is not listed in DOMAINS below lands in an "Unassigned"
// diagram and is reported, so adding a table forces a decision about where it belongs.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(ROOT, 'architecture/erd.md')
const CHECK = process.argv.includes('--check')
const CONTAINER = process.env.PG_CONTAINER || 'supabase_db_carrieros'
const DIRECT_URL = process.env.DATABASE_URL || null
const DATABASE = process.env.PGDATABASE || 'postgres'

const DOMAINS = [
  ['Tenancy, identity & entitlements', 'Organizations (carrier / customer / platform), their users, roles and the tier/feature model that gates what each org may use.',
    ['organizations', 'carrier_details', 'customer_details', 'customer_contacts', 'profiles', 'roles', 'languages', 'role_capabilities', 'tiers', 'features', 'org_sequences', 'org_flag_overrides', 'org_feature_overrides', 'platform_flags']],
  ['Fleet', 'Vehicles, drivers, their documents, and maintenance.',
    ['vehicles', 'vehicle_types', 'vehicle_classifications', 'vehicle_type_classifications', 'vehicle_documents', 'drivers', 'driver_documents', 'org_documents', 'maintenance_reminders', 'service_logs']],
  ['Loads & dispatch', 'The core shipment record, its timeline, expenses, documents (POD etc.), exceptions and driver chat.',
    ['loads', 'load_events', 'load_expenses', 'documents', 'exception_events', 'driver_messages', 'driver_message_translations']],
  ['Billing & settlements', 'Customer invoices, driver settlements and their deductions, and subscription billing events.',
    ['invoices', 'driver_settlements', 'settlement_deductions', 'billing_events']],
  ['Compliance & IFTA', 'Fuel purchases and state crossings for IFTA reporting, and driver vehicle inspection reports (DVIR).',
    ['fuel_stops', 'ifta_state_crossings', 'ifta_tax_rates', 'dvir_inspections', 'dvir_defects']],
  ['Platform & infrastructure', 'SuperAdmin activity, the tenant audit trail, transactional outbox, live-update change feed, idempotency keys, the public developer API\'s OAuth clients/rate limits, in-app support ticketing (decisions.md T16), the platform-wide LLM provider config (decisions.md T17), and migration bookkeeping.',
    ['admin_events', 'admin_notes', 'audit_events', 'outbox_events', 'change_events', 'idempotency_keys', 'oauth_clients', 'oauth_client_rate_limits', 'support_tickets', 'support_ticket_messages', 'ai_provider_config', 'schema_migrations']],
]

function psql(sql) {
  const args = ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-q', '-t', '-A', '-F', '\t', '-c', sql]
  return DIRECT_URL
    ? execFileSync('psql', [DIRECT_URL, ...args], { encoding: 'utf8' })
    : execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DATABASE, ...args], { encoding: 'utf8' })
}
const rows = (sql) => psql(sql).split('\n').filter(Boolean).map((l) => l.split('\t'))

const TYPE = {
  'character varying': 'varchar', 'timestamp with time zone': 'timestamptz', 'timestamp without time zone': 'timestamp',
  'double precision': 'float8', 'time without time zone': 'time', 'USER-DEFINED': 'custom',
}
const mtype = (t) => (TYPE[t] ?? t).replace(/\s+/g, '_')

const tables = rows(`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`).map((r) => r[0])
const columns = rows(`select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema='public' order by table_name, ordinal_position`)
const pks = new Set(rows(`select tc.table_name||'.'||kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu using (constraint_name, table_schema) where tc.table_schema='public' and tc.constraint_type='PRIMARY KEY'`).map((r) => r[0]))
// pg_constraint rather than information_schema: information_schema only reports parents the
// connecting role can see, which silently drops foreign keys into the auth schema (auth.users).
const fks = rows(`select c.conrelid::regclass::text, a.attname, replace(c.confrelid::regclass::text, '.', '_'), case when a.attnotnull then 'NO' else 'YES' end
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where c.contype = 'f' and c.connamespace = 'public'::regnamespace
  order by 1, 2, 3`)
const fkCols = new Set(fks.map((f) => `${f[0]}.${f[1]}`))

const colsBy = new Map()
for (const [t, c, type, nullable] of columns) {
  if (!colsBy.has(t)) colsBy.set(t, [])
  colsBy.get(t).push({ c, type: mtype(type), nullable: nullable === 'YES' })
}

const assigned = new Set(DOMAINS.flatMap((d) => d[2]))
const unassigned = tables.filter((t) => !assigned.has(t))
const domains = unassigned.length ? [...DOMAINS, ['Unassigned', 'Tables not yet placed in a domain: add them to DOMAINS in scripts/db/gen-erd.mjs.', unassigned]] : DOMAINS

function diagram(members) {
  const inDomain = new Set(members)
  const out = ['```mermaid', 'erDiagram']
  for (const t of members) {
    out.push(`  ${t} {`)
    // Primary key first, then alphabetical: physical column order differs between a long-lived
    // database (columns added by later ALTERs) and one built fresh from migrations, and the
    // diagram must not depend on which one it was generated from.
    const ordered = [...(colsBy.get(t) ?? [])].sort(
      (a, b) => Number(pks.has(`${t}.${b.c}`)) - Number(pks.has(`${t}.${a.c}`)) || a.c.localeCompare(b.c)
    )
    for (const { c, type } of ordered) {
      const key = pks.has(`${t}.${c}`) ? ' PK' : fkCols.has(`${t}.${c}`) ? ' FK' : ''
      out.push(`    ${type} ${c}${key}`)
    }
    out.push('  }')
  }
  // Relationships owned by a table in this domain. A parent in another domain shows as a bare box.
  const seen = new Set()
  for (const [child, col, parent, nullable] of fks) {
    if (!inDomain.has(child)) continue
    const id = `${parent}|${child}|${col}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(`  ${parent} ${nullable === 'YES' ? '|o' : '||'}--o{ ${child} : "${col}"`)
  }
  out.push('```')
  return out.join('\n')
}

const total = { tables: tables.length, fks: fks.length }
const md = [
  '# CarrierOS entity-relationship diagrams',
  '',
  '> **Generated** by `node scripts/db/gen-erd.mjs` from the live schema. Do not edit by hand:',
  '> change the database via a migration, then re-run the generator. CI runs it with `--check`.',
  '',
  `${total.tables} tables, ${total.fks} foreign keys, split into ${domains.length} domain diagrams (one diagram of every table is unreadable).`,
  'A box drawn without columns belongs to another domain; find it in its own section.',
  '`||` = the FK is required (NOT NULL); `|o` = the FK is optional (nullable). `PK`/`FK` mark keys.',
  '',
  'Conventions worth knowing: every tenant-owned row carries `carrier_org_id` or `org_id` and is isolated by',
  'row-level security; vocabularies are `TEXT` + `CHECK`, not Postgres enums (so generated types are plain',
  '`string`); the loads_driver_view view (loads without `rate`) is not a table and is not drawn.',
  '',
  ...domains.flatMap(([title, blurb, members]) => [`## ${title}`, '', blurb, '', `Tables: ${members.map((m) => `\`${m}\``).join(', ')}`, '', diagram(members), '']),
].join('\n')

if (unassigned.length) console.warn(`Unassigned tables (add to DOMAINS): ${unassigned.join(', ')}`)

if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (current !== md) {
    console.error('architecture/erd.md is out of date. Run `node scripts/db/gen-erd.mjs` and commit the result.')
    process.exit(1)
  }
  console.log('ERD is up to date.')
} else {
  writeFileSync(OUT, md)
  console.log(`Wrote architecture/erd.md (${total.tables} tables, ${total.fks} foreign keys, ${domains.length} diagrams)`)
}
