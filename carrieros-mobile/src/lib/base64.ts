// src/lib/base64.ts
// base64 -> ArrayBuffer.
//
// Why this exists: supabase-js's Storage upload path is only reliable in
// React Native when you hand it an ArrayBuffer/Uint8Array plus an explicit
// `contentType`. Passing a `Blob` (or a `fetch(uri).then(r => r.blob())`
// result) uploads a 0-byte object on RN, because RN's Blob is a native
// handle that the underlying XHR/fetch can't serialize the way the browser
// does. expo-image-picker can hand us base64 directly (`base64: true`), so
// we decode that ourselves and skip Blob entirely.
//
// `atob` exists on Hermes and on web, but the manual fallback keeps this
// working on any JS engine without one.
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64ToBinaryString(input: string): string {
  if (typeof atob === 'function') return atob(input);

  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  let out = '';
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64_ALPHABET.indexOf(clean[i]) << 18) |
      (B64_ALPHABET.indexOf(clean[i + 1]) << 12) |
      ((clean[i + 2] ? B64_ALPHABET.indexOf(clean[i + 2]) : 0) << 6) |
      (clean[i + 3] ? B64_ALPHABET.indexOf(clean[i + 3]) : 0);
    out += String.fromCharCode((n >> 16) & 0xff);
    if (clean[i + 2]) out += String.fromCharCode((n >> 8) & 0xff);
    if (clean[i + 3]) out += String.fromCharCode(n & 0xff);
  }
  return out;
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // Tolerate a full data URI ("data:image/jpeg;base64,....") as well as a
  // bare payload — expo-image-picker returns the bare form, but the web
  // FileReader path elsewhere can produce the prefixed one.
  const payload = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const binary = decodeBase64ToBinaryString(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
