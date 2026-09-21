// lib/webauthn-support.ts
// Feature-detection for passkey/WebAuthn support in the current browser
// (decisions.md T15). Passkey UI must degrade gracefully — hide the option,
// never crash — on browsers/contexts that don't support it: no HTTPS (or the
// localhost exception), old browsers with no Credential Management API, and
// WebAuthn-capable-but-no-authenticator-available devices.
//
// Written to accept the global objects as parameters (defaulting to the real
// `window`/`navigator` when available) rather than reaching into globals
// directly, so this is unit-testable under Node without a jsdom/browser test
// environment — this repo's vitest config runs `environment: 'node'` and has
// no DOM shim installed.

type MinimalWindow = {
  isSecureContext?: boolean
  PublicKeyCredential?: unknown
}

const realWindow: MinimalWindow | undefined = typeof window !== 'undefined' ? window : undefined

/**
 * True if the browser can support WebAuthn ceremonies at all: a secure
 * context (HTTPS, or the browser's localhost/127.0.0.1 exception) and the
 * `PublicKeyCredential` global the Credential Management API exposes.
 *
 * This does NOT guarantee a platform authenticator (Touch ID, Windows Hello,
 * etc.) or any roaming authenticator is actually available — only that the
 * API surface exists to attempt a ceremony. Supabase's client-side
 * `signInWithPasskey`/`registerPasskey` will still surface a real error
 * (e.g. `WebAuthnError` with `ERROR_CEREMONY_ABORTED`) if the user cancels
 * or no authenticator responds; that's a normal, expected outcome to show as
 * an inline error, not something to pre-empt here.
 */
export function isPasskeySupported(w: MinimalWindow | undefined = realWindow): boolean {
  return !!w && w.isSecureContext === true && typeof w.PublicKeyCredential !== 'undefined'
}
