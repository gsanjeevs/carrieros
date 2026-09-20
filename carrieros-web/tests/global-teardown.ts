// tests/global-teardown.ts — safety net for orphaned test orgs.
//
// Every test's own afterAll calls cleanupTestOrg() (see helpers.ts), but a
// killed process (a crashed dev server mid-run, a Ctrl+C, an OOM) skips
// afterAll entirely and leaves the org behind. Found 213+ "Test Org
// {timestamp}_{n}_{random}" rows accumulated in the local DB this way. This
// runs once after the whole suite (pass or fail) and sweeps any such org
// older than 10 minutes — old enough that it can't belong to a still-running
// parallel test file in this same run.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import path from 'node:path'
import type { Database } from '@/types/supabase'

// Vitest's `globalSetup` runs a function before the suite; if it returns a
// function, that returned function runs once after the whole suite (pass or
// fail) — there is no separate `globalTeardown` config key, unlike Jest.
export default async function globalSetup() {
  return async function teardown() {
    config({ path: path.resolve(__dirname, '..', '.env.local') })
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return

    const admin = createClient<Database>(url, key)
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    const { data: orphans } = await admin
      .from('organizations')
      .select('id')
      .like('name', 'Test Org %')
      .lt('created_at', cutoff)
    if (!orphans || orphans.length === 0) return

    console.log(`[global-teardown] sweeping ${orphans.length} orphaned test org(s)`)
    const ids = orphans.map((o) => o.id)

    // Full dependency graph pulled from pg_constraint (organizations/drivers/
    // loads/profiles as parents) — every table below has a "no action" FK
    // back to one of those that blocks deletion unless cleared first. See
    // tests/helpers.ts's cleanupTestOrg for the single-org version and the
    // pg_constraint query that found these.
    for (const table of ['dvir_inspections', 'ifta_state_crossings', 'driver_settlements', 'fuel_stops', 'maintenance_reminders'] as const) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from(table as any).delete().in('carrier_org_id', ids) as any)
    }
    await admin.from('invoices').delete().in('carrier_org_id', ids)
    await admin.from('invoices').delete().in('customer_org_id', ids)
    await admin.from('documents').delete().in('carrier_org_id', ids)
    await admin.from('customer_contacts').delete().in('carrier_org_id', ids)
    await admin.from('customer_contacts').delete().in('org_id', ids)
    // customer_details.carrier_org_id has NO cascade (only org_id does) — a
    // 'customer'-type test org can be referenced by another org's row via
    // carrier_org_id, which blocks deleting the referenced org. Clear both
    // directions, across ALL swept ids, before touching any organizations row.
    await admin.from('customer_details').delete().in('org_id', ids)
    await admin.from('customer_details').delete().in('carrier_org_id', ids)
    await admin.from('drivers').delete().in('carrier_org_id', ids)
    await admin.from('loads').delete().in('carrier_org_id', ids)
    await admin.from('loads').delete().in('customer_org_id', ids)

    const { data: profileRows } = await admin.from('profiles').select('id').in('org_id', ids)
    const profileIds = (profileRows ?? []).map((p) => p.id)

    // None of these 15 profiles(id) FKs cascade (all "no action" — confirmed
    // via pg_constraint) — any live row in any of them blocks deleting the
    // profile, which in turn blocks deleting the organization. Real orphaned
    // dev/test orgs can have data in any of these (documents, settlements,
    // driver messages, admin notes, etc.), not just the tables the automated
    // test suite itself happens to touch.
    if (profileIds.length > 0) {
      const referencingTables: { table: string; col: string }[] = [
        { table: 'drivers', col: 'profile_id' },
        { table: 'load_events', col: 'created_by' },
        { table: 'documents', col: 'uploaded_by' },
        { table: 'customer_contacts', col: 'portal_profile_id' },
        { table: 'service_logs', col: 'logged_by' },
        { table: 'vehicle_documents', col: 'uploaded_by' },
        { table: 'org_documents', col: 'uploaded_by' },
        { table: 'driver_documents', col: 'uploaded_by' },
        { table: 'fuel_stops', col: 'logged_by' },
        { table: 'load_expenses', col: 'logged_by' },
        { table: 'driver_messages', col: 'sender_id' },
        { table: 'driver_settlements', col: 'created_by' },
        { table: 'admin_notes', col: 'admin_id' },
        { table: 'admin_events', col: 'admin_id' },
        { table: 'org_flag_overrides', col: 'set_by' },
      ]
      for (const { table, col } of referencingTables) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from(table as any).delete().in(col, profileIds) as any)
      }
    }

    for (const id of ids) {
      const { data: profiles } = await admin.from('profiles').select('id').eq('org_id', id)
      for (const p of profiles ?? []) {
        await admin.auth.admin.deleteUser(p.id).catch(() => {})
      }
      // Delete the profiles row directly rather than relying solely on
      // auth.users cascade — a profile whose auth user was already removed
      // (e.g. a prior partial cleanup) would otherwise silently survive and
      // block the organizations delete below.
      await admin.from('profiles').delete().eq('org_id', id)

      const { error } = await admin.from('organizations').delete().eq('id', id)
      if (error) console.error(`[global-teardown] org ${id} failed:`, error.message)
    }
  }
}
