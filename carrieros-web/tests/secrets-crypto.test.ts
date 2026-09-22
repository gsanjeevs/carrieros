// tests/secrets-crypto.test.ts — lib/crypto/secrets.ts (decisions.md T17's 2026-09-22 amendment).
// Pure unit tests, no Postgres/network involved -- this is a primitive that deserves direct coverage,
// not just integration-level confidence via the ai-config route.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  decryptSecret,
  encryptSecret,
  previewLastFour,
  SecretDecryptionError,
  SecretsEncryptionKeyError,
} from '@/lib/crypto/secrets'

// A second, different valid 32-byte key -- used for the "wrong key" test. Distinct from whatever
// tests/setup.ts loaded from .env.local so the two are guaranteed not to collide.
const OTHER_KEY = 'e8ddb6e9d38f3a88b1b19aee24deccfa7bfe89bef4e7e23fbb9816e558f99ec6'

describe('lib/crypto/secrets', () => {
  const originalKey = process.env.SECRETS_ENCRYPTION_KEY

  beforeEach(() => {
    // Every test in this file needs a real key configured to exercise encrypt/decrypt at all;
    // individual tests override or delete it as needed and restore it in afterEach.
    if (!originalKey) {
      throw new Error(
        'SECRETS_ENCRYPTION_KEY must be set in carrieros-web/.env.local to run this test file ' +
        '(generate with `openssl rand -hex 32`) -- see root CLAUDE.md / decisions.md T17 amendment.'
      )
    }
    process.env.SECRETS_ENCRYPTION_KEY = originalKey
  })

  afterEach(() => {
    process.env.SECRETS_ENCRYPTION_KEY = originalKey
  })

  it('round-trips: decryptSecret(encryptSecret(x)) === x', () => {
    const plaintext = 'sk-ant-api03-this-is-a-fake-test-key-not-real-1234567890'
    const packed = encryptSecret(plaintext)
    expect(packed).not.toContain(plaintext)
    expect(decryptSecret(packed)).toBe(plaintext)
  })

  it('produces a different ciphertext each time (random IV, never reused)', () => {
    const plaintext = 'sk-test-same-plaintext-twice'
    const a = encryptSecret(plaintext)
    const b = encryptSecret(plaintext)
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe(plaintext)
    expect(decryptSecret(b)).toBe(plaintext)
  })

  it('decrypting with the wrong key fails', () => {
    const packed = encryptSecret('sk-test-wrong-key-should-fail')
    process.env.SECRETS_ENCRYPTION_KEY = OTHER_KEY
    expect(() => decryptSecret(packed)).toThrow(SecretDecryptionError)
  })

  it('decrypting a tampered ciphertext fails auth-tag verification', () => {
    const packed = encryptSecret('sk-test-tamper-should-fail')
    const buf = Buffer.from(packed, 'base64')
    // Flip a byte well past the IV (bytes 0-11) and auth tag (bytes 12-27) so this mutates the
    // ciphertext itself, not just the tag -- either way GCM must reject it.
    buf[buf.length - 1] ^= 0xff
    const tampered = buf.toString('base64')
    expect(() => decryptSecret(tampered)).toThrow(SecretDecryptionError)
  })

  it('decrypting a truncated value fails cleanly instead of throwing an unrelated error', () => {
    expect(() => decryptSecret(Buffer.from('short').toString('base64'))).toThrow(SecretDecryptionError)
  })

  it('throws SecretsEncryptionKeyError when SECRETS_ENCRYPTION_KEY is unset', () => {
    delete process.env.SECRETS_ENCRYPTION_KEY
    expect(() => encryptSecret('sk-test-no-key')).toThrow(SecretsEncryptionKeyError)
  })

  it('throws SecretsEncryptionKeyError when SECRETS_ENCRYPTION_KEY is the wrong length', () => {
    process.env.SECRETS_ENCRYPTION_KEY = 'deadbeef' // valid hex, wrong length
    expect(() => encryptSecret('sk-test-short-key')).toThrow(SecretsEncryptionKeyError)
  })

  describe('previewLastFour', () => {
    it('returns the last 4 characters', () => {
      expect(previewLastFour('sk-ant-api03-abcd1234')).toBe('1234')
    })
    it('returns null for empty/whitespace input', () => {
      expect(previewLastFour('')).toBeNull()
      expect(previewLastFour('   ')).toBeNull()
    })
  })
})
