// tests/theme-status-pills.test.ts
// Table-driven regression test over the exported status-pill Records in
// src/constants/theme.ts (LOAD_STATUS_PILL/VEHICLE_STATUS_PILL/
// INVOICE_STATUS_PILL), each built from an exhaustive switch per Rule A of
// docs/architecture-principles.md. This is exactly the kind of test that
// would have caught the real 'cancelled' bug fixed earlier this session
// (LOAD_STATUS_PILL had no entry for it, so a cancelled load's pill
// silently fell back to the 'draft' gray one in history.tsx) before it
// shipped.
//
// The status value lists below are hardcoded to match the DB CHECK
// constraints (supabase/schema/schema.sql: loads.status, vehicles.status,
// invoices.status) rather than imported, since theme.ts's LoadStatus/
// VehicleStatus/InvoiceStatus unions aren't exported — this test is the
// second, independent source of truth the exhaustive-switch pattern is
// designed to be checked against.
import { LOAD_STATUS_PILL, VEHICLE_STATUS_PILL, INVOICE_STATUS_PILL } from '@/constants/theme';

const LOAD_STATUSES = [
  'draft', 'scheduled', 'dispatched', 'picked_up', 'in_transit',
  'delivered', 'invoiced', 'paid', 'cancelled', 'declined',
];
const VEHICLE_STATUSES = ['active', 'idle', 'in_shop'];
const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue'];

function expectValidPill(pill: { bg: string; text: string } | undefined, status: string) {
  expect(pill).toBeDefined();
  expect(typeof pill!.bg).toBe('string');
  expect(pill!.bg.length).toBeGreaterThan(0);
  expect(typeof pill!.text).toBe('string');
  expect(pill!.text.length).toBeGreaterThan(0);
}

describe('LOAD_STATUS_PILL', () => {
  it.each(LOAD_STATUSES)('has a valid {bg, text} pill for status "%s"', (status) => {
    expectValidPill(LOAD_STATUS_PILL[status], status);
  });

  it('has an entry for every known status and no more, no fewer', () => {
    expect(Object.keys(LOAD_STATUS_PILL).sort()).toEqual([...LOAD_STATUSES].sort());
  });
});

describe('VEHICLE_STATUS_PILL', () => {
  it.each(VEHICLE_STATUSES)('has a valid {bg, text} pill for status "%s"', (status) => {
    expectValidPill(VEHICLE_STATUS_PILL[status], status);
  });

  it('has an entry for every known status and no more, no fewer', () => {
    expect(Object.keys(VEHICLE_STATUS_PILL).sort()).toEqual([...VEHICLE_STATUSES].sort());
  });
});

describe('INVOICE_STATUS_PILL', () => {
  it.each(INVOICE_STATUSES)('has a valid {bg, text} pill for status "%s"', (status) => {
    expectValidPill(INVOICE_STATUS_PILL[status], status);
  });

  it('has an entry for every known status and no more, no fewer', () => {
    expect(Object.keys(INVOICE_STATUS_PILL).sort()).toEqual([...INVOICE_STATUSES].sort());
  });
});
