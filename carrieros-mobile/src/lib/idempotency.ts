// src/lib/idempotency.ts
// Keys that make a retried command safe: the server stores the first outcome per
// key and returns it on a replay instead of applying the action twice. They only
// need to be unique per user action, not unpredictable, so Math.random is fine
// (and avoids depending on a crypto polyfill being present in every runtime).
export function newIdempotencyKey(): string {
  const random = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${Date.now().toString(16)}-${random()}${random()}`;
}
