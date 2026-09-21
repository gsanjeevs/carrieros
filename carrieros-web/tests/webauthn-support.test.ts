import { describe, it, expect } from 'vitest'
import { isPasskeySupported } from '@/lib/webauthn-support'

describe('isPasskeySupported', () => {
  it('is false with no window (SSR)', () => {
    expect(isPasskeySupported(undefined)).toBe(false)
  })

  it('is false when not a secure context', () => {
    expect(isPasskeySupported({ isSecureContext: false, PublicKeyCredential: function () {} })).toBe(false)
  })

  it('is false when PublicKeyCredential is missing (old browser)', () => {
    expect(isPasskeySupported({ isSecureContext: true })).toBe(false)
  })

  it('is true when secure context + PublicKeyCredential are both present', () => {
    expect(isPasskeySupported({ isSecureContext: true, PublicKeyCredential: function () {} })).toBe(true)
  })
})
