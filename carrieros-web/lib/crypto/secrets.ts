// lib/crypto/secrets.ts
// App-layer encryption for secrets that must never cross into a SQL statement in plaintext
// (decisions.md T17's 2026-09-22 amendment) -- specifically, LLM provider API keys stored in
// ai_provider_config's `*_api_key_encrypted` columns (migration 0032). AES-256-GCM via Node's
// built-in `crypto`, deliberately NOT Postgres `pgcrypto`: encryptSecret()/decryptSecret() run
// entirely in this process, so the plaintext key is never interpolated into a query string, and
// never visible to a query logger, a Postgres slow-query log, or a `pg_stat_statements` row.
//
// Packing format: base64( IV[12 bytes] || authTag[16 bytes] || ciphertext ) as one opaque string --
// the DB schema needs only a single TEXT column per secret, no separate iv/tag columns to keep in
// sync. The IV is randomly generated per encryptSecret() call (`randomBytes(12)`) and never reused --
// GCM's confidentiality guarantee depends on that.
//
// Key: SECRETS_ENCRYPTION_KEY, 32 raw bytes hex-encoded (64 hex characters) -- generate with
// `openssl rand -hex 32`, the same convention this repo already uses for CRON_SECRET /
// INTAKE_WEBHOOK_SECRET / PUBLIC_API_JWT_SECRET (carrieros-web/.env.example). Per T17's amendment
// this is real one-time infrastructure: set once, and routine key rotation afterward never touches
// the environment again (rotation happens by re-entering a key in /admin/ai-config, not by rotating
// this variable).
//
// Server-only. Never import this from a client component.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

/** Thrown when SECRETS_ENCRYPTION_KEY isn't set, or isn't a valid 32-byte hex string. Distinct from
 * SecretDecryptionError (below) so callers/observability can tell "this deployment isn't configured
 * for encrypted secrets at all" apart from "a stored value failed to decrypt." Never includes the
 * offending env var's value (there isn't one to include when it's unset; when it's malformed, the
 * message states the requirement, not the bad value). */
export class SecretsEncryptionKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretsEncryptionKeyError'
  }
}

/** Thrown by decryptSecret() when the ciphertext fails AES-GCM auth-tag verification -- either the
 * wrong key was used, or the stored value was truncated, corrupted, or tampered with. Never includes
 * the plaintext, the ciphertext, or any derivative of either in its message. */
export class SecretDecryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretDecryptionError'
  }
}

function getKey(): Buffer {
  const raw = process.env.SECRETS_ENCRYPTION_KEY
  if (!raw) {
    throw new SecretsEncryptionKeyError(
      'SECRETS_ENCRYPTION_KEY is not set -- required to encrypt/decrypt provider API keys stored in ' +
      'ai_provider_config. Generate one with `openssl rand -hex 32` and set it once as infrastructure.'
    )
  }
  const key = Buffer.from(raw, 'hex')
  if (key.length !== KEY_BYTES) {
    throw new SecretsEncryptionKeyError(
      `SECRETS_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (64 hex characters) -- ` +
      'generate with `openssl rand -hex 32`.'
    )
  }
  return key
}

/** Encrypts `plaintext` with AES-256-GCM under SECRETS_ENCRYPTION_KEY, returning a single base64
 * string packing a fresh random IV, the auth tag, and the ciphertext. Throws SecretsEncryptionKeyError
 * if the env var isn't configured. */
export function encryptSecret(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64')
}

/** Reverses encryptSecret(). Throws SecretsEncryptionKeyError if the env var isn't configured, or
 * SecretDecryptionError if `packed` doesn't decode/authenticate under the current key (wrong key,
 * or corrupted/tampered ciphertext -- AES-GCM's auth tag makes the two indistinguishable by design,
 * which is exactly the property that makes tampering detectable at all). */
export function decryptSecret(packed: string): string {
  const key = getKey()
  const buf = Buffer.from(packed, 'base64')
  if (buf.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new SecretDecryptionError('Stored value is too short to contain an IV and auth tag.')
  }
  const iv = buf.subarray(0, IV_BYTES)
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES)
  const ciphertext = buf.subarray(IV_BYTES + AUTH_TAG_BYTES)
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    // Deliberately no `err` detail folded into the message -- Node's GCM auth-tag-mismatch error is
    // generic today, but never risk a future Node version leaking anything ciphertext-derived here.
    throw new SecretDecryptionError(
      'Failed to decrypt stored value -- wrong SECRETS_ENCRYPTION_KEY, or the value was corrupted or tampered with.'
    )
  }
}

/** Last-4-characters preview for a plaintext secret, computed once at write time (never from
 * ciphertext -- see ai_provider_config's *_api_key_preview column comments, migration 0032). Returns
 * null for an empty/whitespace-only string so callers can treat that the same as "no key provided". */
export function previewLastFour(plaintext: string): string | null {
  const trimmed = plaintext.trim()
  return trimmed ? trimmed.slice(-4) : null
}
