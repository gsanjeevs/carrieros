// src/lib/secure-session-storage.ts
// Supabase session storage backed by the OS keychain/keystore (expo-secure-store)
// instead of AsyncStorage, which is plain, unencrypted app storage. The session
// holds a refresh token, i.e. the ability to act as the user, so it should not
// sit in a file that a device backup or a rooted/jailbroken device can read.
//
// Two wrinkles this adapter exists to handle:
//  * SecureStore values are limited to ~2 KB and a Supabase session JSON
//    (access + refresh token + user) is larger, so values are split into
//    chunks: `<key>.count` plus `<key>.0`, `<key>.1`, ...
//  * Existing installs have their session in AsyncStorage. On first read we
//    move it into SecureStore and delete the old copy, so upgrading does not
//    sign everyone out.
//
// keychainAccessible is AFTER_FIRST_UNLOCK (not the WHEN_UNLOCKED default)
// because background IFTA location tracking has to work with the screen
// locked; the value is still encrypted at rest and excluded from migrations
// to other devices (THIS_DEVICE_ONLY).
//
// Web (Expo web preview) has no keychain; callers should not use this there.
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CHUNK_SIZE = 1800;
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const countKey = (key: string) => `${key}.count`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

async function readChunked(key: string): Promise<string | null> {
  const rawCount = await SecureStore.getItemAsync(countKey(key), OPTIONS);
  if (rawCount === null) return null;
  const count = Number(rawCount);
  if (!Number.isInteger(count) || count < 0) return null;
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(chunkKey(key, i), OPTIONS);
    if (part === null) return null; // partial write: treat as no session
    parts.push(part);
  }
  return parts.join('');
}

async function removeChunked(key: string): Promise<void> {
  const rawCount = await SecureStore.getItemAsync(countKey(key), OPTIONS);
  const count = rawCount === null ? 0 : Number(rawCount);
  for (let i = 0; i < count; i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, i), OPTIONS);
  }
  await SecureStore.deleteItemAsync(countKey(key), OPTIONS);
}

async function writeChunked(key: string, value: string): Promise<void> {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) chunks.push(value.slice(i, i + CHUNK_SIZE));
  await removeChunked(key); // clear a previous, possibly longer, value first
  for (let i = 0; i < chunks.length; i++) {
    await SecureStore.setItemAsync(chunkKey(key, i), chunks[i], OPTIONS);
  }
  // Written last: a crash mid-write leaves no count, so readers see "no session".
  await SecureStore.setItemAsync(countKey(key), String(chunks.length), OPTIONS);
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const secure = await readChunked(key);
    if (secure !== null) return secure;

    const legacy = await AsyncStorage.getItem(key);
    if (legacy !== null) {
      await writeChunked(key, legacy);
      await AsyncStorage.removeItem(key);
      return legacy;
    }
    return null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await writeChunked(key, value);
    await AsyncStorage.removeItem(key); // never leave a plaintext copy behind
  },
  async removeItem(key: string): Promise<void> {
    await removeChunked(key);
    await AsyncStorage.removeItem(key);
  },
};
