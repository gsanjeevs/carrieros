import { describe, expect, it, jest, beforeEach } from '@jest/globals';

let mockPatch: () => Promise<{ error?: unknown }>;
let mockPut: () => Promise<{ error?: unknown }>;
jest.mock('@/lib/api-client', () => ({
  apiClient: { http: { PATCH: () => mockPatch(), PUT: () => mockPut() } },
}));

import { registerPushToken, savePreferences } from '@/lib/profile-api';

describe('profile-api', () => {
  beforeEach(() => {
    mockPatch = () => Promise.resolve({});
    mockPut = () => Promise.resolve({});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('savePreferences never throws into the UI: a network failure is logged, not raised', async () => {
    mockPatch = () => Promise.reject(new TypeError('Network request failed'));
    await expect(savePreferences({ theme_preference: 'dark' })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('savePreferences logs a server rejection without throwing', async () => {
    mockPatch = () => Promise.resolve({ error: { error_code: 'VALIDATION_ERROR' } });
    await expect(savePreferences({ preferred_language: 'en' })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('registerPushToken throws on rejection so its caller can log the skipped registration', async () => {
    mockPut = () => Promise.resolve({ error: { error_code: 'VALIDATION_ERROR' } });
    await expect(registerPushToken('tok')).rejects.toThrow(/rejected/);
  });
});
