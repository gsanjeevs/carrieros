import AsyncStorage from '@react-native-async-storage/async-storage';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock-this-device-only',
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    // Enforce the real platform limit so a chunking bug would fail here.
    if (v.length > 2048) throw new Error('value exceeds SecureStore limit');
    mockStore.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => { mockStore.delete(k); }),
}));

import { secureSessionStorage } from '@/lib/secure-session-storage';

beforeEach(async () => {
  mockStore.clear();
  await AsyncStorage.clear();
});

describe('secureSessionStorage', () => {
  it('round-trips a value far larger than the 2KB SecureStore limit', async () => {
    const session = JSON.stringify({ access_token: 'a'.repeat(3000), refresh_token: 'r'.repeat(500) });
    await secureSessionStorage.setItem('sb-session', session);
    expect(await secureSessionStorage.getItem('sb-session')).toBe(session);
    expect(mockStore.get('sb-session.count')).toBe('2');
  });

  it('overwriting with a shorter value leaves no stale chunks', async () => {
    await secureSessionStorage.setItem('k', 'x'.repeat(5000));
    await secureSessionStorage.setItem('k', 'short');
    expect(await secureSessionStorage.getItem('k')).toBe('short');
    expect([...mockStore.keys()].sort()).toEqual(['k.0', 'k.count']);
  });

  it('migrates an existing AsyncStorage session, then deletes the plaintext copy', async () => {
    await AsyncStorage.setItem('sb-session', 'legacy-session');
    expect(await secureSessionStorage.getItem('sb-session')).toBe('legacy-session');
    expect(await AsyncStorage.getItem('sb-session')).toBeNull();
    expect(await secureSessionStorage.getItem('sb-session')).toBe('legacy-session'); // now from keychain
  });

  it('treats a partial write (missing chunk) as no session', async () => {
    mockStore.set('k.count', '2');
    mockStore.set('k.0', 'only-first-chunk');
    expect(await secureSessionStorage.getItem('k')).toBeNull();
  });

  it('removeItem clears keychain and AsyncStorage', async () => {
    await secureSessionStorage.setItem('k', 'v');
    await secureSessionStorage.removeItem('k');
    expect(await secureSessionStorage.getItem('k')).toBeNull();
    expect(mockStore.size).toBe(0);
  });
});
