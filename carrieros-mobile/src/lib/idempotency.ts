// src/lib/idempotency.ts
// Keys that make a retried command safe: the server stores the first outcome per
// key and returns it on a replay instead of applying the action twice. They only
// need to be unique per user action, not unpredictable, so Math.random is fine
// (and avoids depending on a crypto polyfill being present in every runtime).
export function newIdempotencyKey(): string {
  const random = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${Date.now().toString(16)}-${random()}${random()}`;
}

/**
 * One key per distinct submission. A retry of the SAME data (a timeout, then the user
 * taps again) reuses the key so the server applies it once; if the user edited the form
 * in between, the data differs, so a new key is minted (the server rejects one key
 * reused with different data). Clear the ref after a successful submit.
 */
export function keyForSubmission(
  ref: { current: { key: string; body: string } | null },
  body: unknown
): string {
  const serialized = JSON.stringify(body);
  if (!ref.current || ref.current.body !== serialized) {
    ref.current = { key: newIdempotencyKey(), body: serialized };
  }
  return ref.current.key;
}
