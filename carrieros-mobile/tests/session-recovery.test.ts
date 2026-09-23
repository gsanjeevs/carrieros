import { describe, expect, it, jest, beforeEach } from '@jest/globals';

let mockRefresh: () => Promise<{ error: { message: string } | null }>;
const mockSignOut = jest.fn(async (_opts: { scope: string }) => ({ error: null }));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { refreshSession: () => mockRefresh(), signOut: (o: { scope: string }) => mockSignOut(o) } },
}));

import { handleUnauthorized } from '@/lib/session-recovery';

describe('session recovery on 401', () => {
  beforeEach(() => {
    mockSignOut.mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('a stale-but-valid session recovers via refresh and is NOT signed out', async () => {
    mockRefresh = () => Promise.resolve({ error: null });
    await handleUnauthorized();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('a revoked session that cannot refresh is signed out LOCALLY (never globally)', async () => {
    mockRefresh = () => Promise.resolve({ error: { message: 'Session not found' } });
    await handleUnauthorized();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('a burst of simultaneous 401s recovers once, not once per request', async () => {
    let calls = 0;
    mockRefresh = () => {
      calls++;
      return new Promise((r) => setTimeout(() => r({ error: { message: 'Session not found' } }), 20));
    };
    await Promise.all([handleUnauthorized(), handleUnauthorized(), handleUnauthorized(), handleUnauthorized()]);
    expect(calls).toBe(1);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('never throws into the request path even if refresh itself explodes', async () => {
    mockRefresh = () => Promise.reject(new Error('network down'));
    await expect(handleUnauthorized()).resolves.toBeUndefined();
  });
});
