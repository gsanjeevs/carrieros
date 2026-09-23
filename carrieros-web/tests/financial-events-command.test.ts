// tests/financial-events-command.test.ts
// Integration tests for the six SECURITY DEFINER command functions migration
// 0033 adds/extends: create_invoice_command, mark_invoice_sent_command,
// mark_invoice_paid, create_driver_settlement_command,
// update_settlement_payment_status_command, record_load_expense_command.
//
// Same rationale as tests/shipment-milestone-command.test.ts: atomicity,
// idempotent replay, and tenant/role isolation under SECURITY DEFINER are
// enforced by Postgres itself and can't be meaningfully asserted with mocks.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminClient,
  createTestOrg,
  createTestUser,
  signInAs,
  cleanupTestOrg,
  type TestOrg,
  type TestUser,
} from './helpers'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

const admin = adminClient()

let orgA: TestOrg
let orgB: TestOrg
let ownerA: TestUser
let driverA: TestUser
let ownerB: TestUser
let ownerAClient: SupabaseClient<Database>
let driverAClient: SupabaseClient<Database>
let ownerBClient: SupabaseClient<Database>

async function createLoad(orgId: number, status = 'delivered', rate = 1500) {
  const { data, error } = await admin
    .from('loads')
    .insert({ carrier_org_id: orgId, load_number: `FIN-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, status, rate })
    .select('id')
    .single()
  if (error || !data) throw new Error(`createLoad: ${error?.message}`)
  return Number(data.id)
}

async function outboxRow(idempotencyKey: string) {
  const { data } = await admin.from('outbox_events').select('*').eq('idempotency_key', idempotencyKey).maybeSingle()
  return data
}

beforeAll(async () => {
  orgA = await createTestOrg(admin, 'carrier', { tier: 'growth' })
  orgB = await createTestOrg(admin, 'carrier', { tier: 'growth' })
  ownerA = await createTestUser(admin, orgA.orgId, 'owner')
  driverA = await createTestUser(admin, orgA.orgId, 'driver')
  ownerB = await createTestUser(admin, orgB.orgId, 'owner')
  ownerAClient = (await signInAs(ownerA)).client
  driverAClient = (await signInAs(driverA)).client
  ownerBClient = (await signInAs(ownerB)).client
}, 60_000)

afterAll(async () => {
  await cleanupTestOrg(admin, orgA.orgId)
  await cleanupTestOrg(admin, orgB.orgId)
})

describe('create_invoice_command', () => {
  it('atomically inserts the invoice, advances the load, and writes a correctly-shaped outbox row', async () => {
    const loadId = await createLoad(orgA.orgId, 'delivered', 2000)
    const idempotencyKey = `test:invoice:create:${loadId}`

    const { data, error } = await ownerAClient.rpc('create_invoice_command' as never, {
      p_load_id: loadId,
      p_customer_org_id: null,
      p_invoice_number: `INV-${loadId}`,
      p_amount: 2000,
      p_due_date: '2026-12-01',
      p_payment_method: 'other',
      p_factoring_company: null,
      p_advance_load_status: true,
      p_correlation_id: 'test-corr',
      p_idempotency_key: idempotencyKey,
    } as never)
    expect(error).toBeNull()
    const outcome = data as unknown as { outcome: string; invoice_id: number }
    expect(outcome.outcome).toBe('APPLIED')

    const { data: load } = await admin.from('loads').select('status').eq('id', loadId).single()
    expect(load?.status).toBe('invoiced')

    const row = await outboxRow(idempotencyKey)
    expect(row).not.toBeNull()
    expect(row?.event_type).toBe('InvoiceCreated')
    expect(row?.aggregate_type).toBe('Invoice')
    expect(row?.org_id).toBe(orgA.orgId)
    expect((row?.payload as { loadId: number }).loadId).toBe(loadId)
  })

  it('idempotent replay: the same key does not create a second invoice or a second outbox row', async () => {
    const loadId = await createLoad(orgA.orgId, 'delivered', 3000)
    const idempotencyKey = `test:invoice:create:replay:${loadId}`
    const args = {
      p_load_id: loadId,
      p_customer_org_id: null,
      p_invoice_number: `INV-R-${loadId}`,
      p_amount: 3000,
      p_due_date: '2026-12-01',
      p_payment_method: 'other',
      p_factoring_company: null,
      p_advance_load_status: true,
      p_correlation_id: 'test-corr',
      p_idempotency_key: idempotencyKey,
    }
    const first = await ownerAClient.rpc('create_invoice_command' as never, args as never)
    expect(first.error).toBeNull()
    const second = await ownerAClient.rpc('create_invoice_command' as never, args as never)
    expect(second.error).toBeNull()
    expect((second.data as unknown as { outcome: string }).outcome).toBe('REPLAYED')

    const { count } = await admin.from('invoices').select('id', { count: 'exact', head: true }).eq('load_id', loadId)
    expect(count).toBe(1)
    const { count: outboxCount } = await admin
      .from('outbox_events')
      .select('id', { count: 'exact', head: true })
      .eq('idempotency_key', idempotencyKey)
    expect(outboxCount).toBe(1)
  })

  it('a driver cannot create an invoice', async () => {
    const loadId = await createLoad(orgA.orgId, 'delivered')
    const { error } = await driverAClient.rpc('create_invoice_command' as never, {
      p_load_id: loadId,
      p_customer_org_id: null,
      p_invoice_number: `INV-D-${loadId}`,
      p_amount: 100,
      p_due_date: '2026-12-01',
      p_payment_method: 'other',
      p_factoring_company: null,
      p_advance_load_status: false,
      p_correlation_id: 'test-corr',
      p_idempotency_key: `test:invoice:create:driver:${loadId}`,
    } as never)
    expect(error).not.toBeNull()
    const { count } = await admin.from('invoices').select('id', { count: 'exact', head: true }).eq('load_id', loadId)
    expect(count).toBe(0)
  })
})

describe('mark_invoice_sent_command', () => {
  it('atomically flips status and writes an InvoiceSent outbox row', async () => {
    const loadId = await createLoad(orgA.orgId, 'delivered')
    const { data: inv } = await admin
      .from('invoices')
      .insert({ carrier_org_id: orgA.orgId, load_id: loadId, invoice_number: `SEND-${loadId}`, amount: 500, status: 'draft' })
      .select('id')
      .single()
    const invoiceId = Number(inv!.id)
    const idempotencyKey = `test:invoice:sent:${invoiceId}`

    const { data, error } = await ownerAClient.rpc('mark_invoice_sent_command' as never, {
      p_invoice_id: invoiceId,
      p_sent_at: new Date().toISOString(),
      p_correlation_id: 'test-corr',
      p_idempotency_key: idempotencyKey,
    } as never)
    expect(error).toBeNull()
    expect((data as unknown as { outcome: string }).outcome).toBe('APPLIED')

    const { data: row } = await admin.from('invoices').select('status').eq('id', invoiceId).single()
    expect(row?.status).toBe('sent')

    const outbox = await outboxRow(idempotencyKey)
    expect(outbox?.event_type).toBe('InvoiceSent')
    // Caught in review: this payload originally carried no `amount` at all,
    // which made the financial-events export silently report every
    // InvoiceSent event as $0.
    expect((outbox?.payload as { amount: number }).amount).toBe(500)
  })
})

describe('mark_invoice_paid (extended by 0033 with outbox emission)', () => {
  it('writes an InvoicePaid outbox row and replaying does not duplicate it', async () => {
    const loadId = await createLoad(orgA.orgId, 'delivered')
    const { data: inv } = await admin
      .from('invoices')
      .insert({ carrier_org_id: orgA.orgId, load_id: loadId, invoice_number: `PAID-${loadId}`, amount: 700, status: 'sent' })
      .select('id')
      .single()
    const invoiceId = Number(inv!.id)
    const idempotencyKey = `invoice:${invoiceId}:paid`

    const first = await ownerAClient.rpc('mark_invoice_paid' as never, {
      p_invoice_id: invoiceId,
      p_paid_at: new Date().toISOString(),
      p_correlation_id: 'test-corr',
      p_idempotency_key: idempotencyKey,
    } as never)
    expect(first.error).toBeNull()
    expect((first.data as unknown as { outcome: string }).outcome).toBe('APPLIED')

    const outbox = await outboxRow(idempotencyKey)
    expect(outbox?.event_type).toBe('InvoicePaid')
    // Same gap as InvoiceSent above: this payload originally carried no
    // `amount`, so the export reported every InvoicePaid event as $0.
    expect((outbox?.payload as { amount: number }).amount).toBe(700)

    const second = await ownerAClient.rpc('mark_invoice_paid' as never, {
      p_invoice_id: invoiceId,
      p_paid_at: new Date().toISOString(),
      p_correlation_id: 'test-corr',
      p_idempotency_key: idempotencyKey,
    } as never)
    expect(second.error).toBeNull()
    const { count } = await admin.from('outbox_events').select('id', { count: 'exact', head: true }).eq('idempotency_key', idempotencyKey)
    expect(count).toBe(1)
  })
})

describe('create_driver_settlement_command', () => {
  it('writes the settlement and a DriverSettlementCreated outbox row', async () => {
    const driverUser = await createTestUser(admin, orgA.orgId, 'driver')
    const { data: driverRow } = await admin
      .from('drivers')
      .insert({
        carrier_org_id: orgA.orgId,
        profile_id: driverUser.userId,
        driver_number: `FIN-${Date.now()}`,
        invite_status: 'accepted',
        settlement_type: 'flat_per_load',
        settlement_rate: 200,
      })
      .select('id')
      .single()
    const driverId = Number(driverRow!.id)
    const idempotencyKey = `test:settlement:create:${driverId}`

    const { data, error } = await ownerAClient.rpc('create_driver_settlement_command' as never, {
      p_driver_id: driverId,
      p_pay_method: 'flat_per_load',
      p_rate_value: 200,
      p_gross_revenue: 1000,
      p_net_pay: 400,
      p_loads_count: 2,
      p_period_start: '2026-08-01',
      p_period_end: '2026-08-15',
      p_correlation_id: 'test-corr',
      p_idempotency_key: idempotencyKey,
    } as never)
    expect(error).toBeNull()
    const outcome = data as unknown as { outcome: string; id: number; payment_status: string }
    expect(outcome.outcome).toBe('APPLIED')
    expect(outcome.payment_status).toBe('pending')

    const outbox = await outboxRow(idempotencyKey)
    expect(outbox?.event_type).toBe('DriverSettlementCreated')
    expect(outbox?.aggregate_type).toBe('DriverSettlement')
    expect((outbox?.payload as { netPay: number }).netPay).toBe(400)
  })

  it('a driver cannot create a settlement for themselves', async () => {
    const { error } = await driverAClient.rpc('create_driver_settlement_command' as never, {
      p_driver_id: 1,
      p_pay_method: 'flat_per_load',
      p_rate_value: 200,
      p_gross_revenue: 1000,
      p_net_pay: 400,
      p_loads_count: 2,
      p_period_start: '2026-08-01',
      p_period_end: '2026-08-15',
      p_correlation_id: 'test-corr',
      p_idempotency_key: `test:settlement:create:driver-forbidden:${Date.now()}`,
    } as never)
    expect(error).not.toBeNull()
  })
})

describe('update_settlement_payment_status_command', () => {
  it('CAS pending -> sent writes a DriverSettlementPaymentStatusChanged outbox row; a stale expected_status is rejected', async () => {
    const { data: settlement } = await admin
      .from('driver_settlements')
      .insert({ carrier_org_id: orgA.orgId, pay_method: 'flat_per_load', gross_revenue: 500, net_pay: 500, payment_status: 'pending' })
      .select('id')
      .single()
    const settlementId = Number(settlement!.id)
    const idempotencyKey = `test:settlement:${settlementId}:sent`

    const stale = await ownerAClient.rpc('update_settlement_payment_status_command' as never, {
      p_settlement_id: settlementId,
      p_expected_status: 'sent', // wrong: it's still pending
      p_new_status: 'cleared',
      p_correlation_id: 'test-corr',
      p_idempotency_key: `test:settlement:${settlementId}:stale`,
    } as never)
    expect(stale.error).not.toBeNull()

    const { data, error } = await ownerAClient.rpc('update_settlement_payment_status_command' as never, {
      p_settlement_id: settlementId,
      p_expected_status: 'pending',
      p_new_status: 'sent',
      p_correlation_id: 'test-corr',
      p_idempotency_key: idempotencyKey,
    } as never)
    expect(error).toBeNull()
    expect((data as unknown as { payment_status: string }).payment_status).toBe('sent')

    const outbox = await outboxRow(idempotencyKey)
    expect(outbox?.event_type).toBe('DriverSettlementPaymentStatusChanged')
  })
})

describe('record_load_expense_command', () => {
  it('atomically inserts the expense and writes a LoadExpenseRecorded outbox row', async () => {
    const loadId = await createLoad(orgA.orgId, 'dispatched')
    const idempotencyKey = `test:expense:${loadId}`

    const { data, error } = await ownerAClient.rpc('record_load_expense_command' as never, {
      p_load_id: loadId,
      p_expense_type: 'toll',
      p_amount: 42.5,
      p_note: 'I-95 toll',
      p_correlation_id: 'test-corr',
      p_idempotency_key: idempotencyKey,
    } as never)
    expect(error).toBeNull()
    expect((data as unknown as { outcome: string }).outcome).toBe('APPLIED')

    const { count } = await admin.from('load_expenses').select('id', { count: 'exact', head: true }).eq('load_id', loadId)
    expect(count).toBe(1)

    const outbox = await outboxRow(idempotencyKey)
    expect(outbox?.event_type).toBe('LoadExpenseRecorded')
    expect((outbox?.payload as { expenseType: string }).expenseType).toBe('toll')
  })

  it('cross-tenant: an org B owner cannot log an expense on org A\'s load (NOT_FOUND, not FORBIDDEN)', async () => {
    const loadId = await createLoad(orgA.orgId, 'dispatched')
    const { error } = await ownerBClient.rpc('record_load_expense_command' as never, {
      p_load_id: loadId,
      p_expense_type: 'toll',
      p_amount: 10,
      p_note: null,
      p_correlation_id: 'test-corr',
      p_idempotency_key: `test:expense:cross-tenant:${loadId}`,
    } as never)
    expect(error).not.toBeNull()
    const { count } = await admin.from('load_expenses').select('id', { count: 'exact', head: true }).eq('load_id', loadId)
    expect(count).toBe(0)
  })

  it('idempotent replay does not duplicate the expense', async () => {
    const loadId = await createLoad(orgA.orgId, 'dispatched')
    const idempotencyKey = `test:expense:replay:${loadId}`
    const args = {
      p_load_id: loadId,
      p_expense_type: 'lumper',
      p_amount: 75,
      p_note: null,
      p_correlation_id: 'test-corr',
      p_idempotency_key: idempotencyKey,
    }
    await ownerAClient.rpc('record_load_expense_command' as never, args as never)
    await ownerAClient.rpc('record_load_expense_command' as never, args as never)
    const { count } = await admin.from('load_expenses').select('id', { count: 'exact', head: true }).eq('load_id', loadId)
    expect(count).toBe(1)
  })
})
