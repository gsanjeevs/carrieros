import { describe, expect, it } from '@jest/globals';
import { keyForSubmission, newIdempotencyKey } from '@/lib/idempotency';

describe('idempotency keys', () => {
  it('mints keys that are long enough for the API and different each time', () => {
    const a = newIdempotencyKey();
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(128);
    expect(newIdempotencyKey()).not.toBe(a);
  });

  it('reuses the key when the same data is resubmitted (retry after a timeout)', () => {
    const ref = { current: null as { key: string; body: string } | null };
    const first = keyForSubmission(ref, { gallons: 10, state: 'NV' });
    expect(keyForSubmission(ref, { gallons: 10, state: 'NV' })).toBe(first);
  });

  it('mints a new key when the data changed, since the server rejects one key with different data', () => {
    const ref = { current: null as { key: string; body: string } | null };
    const first = keyForSubmission(ref, { gallons: 10 });
    expect(keyForSubmission(ref, { gallons: 12 })).not.toBe(first);
  });

  it('mints a new key after the ref is cleared by a successful submit', () => {
    const ref = { current: null as { key: string; body: string } | null };
    const first = keyForSubmission(ref, { gallons: 10 });
    ref.current = null;
    expect(keyForSubmission(ref, { gallons: 10 })).not.toBe(first);
  });
});
