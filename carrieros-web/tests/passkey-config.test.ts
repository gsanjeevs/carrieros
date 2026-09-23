// tests/passkey-config.test.ts — decisions.md T15's web passkey/WebAuthn build has two flags that
// both have to be on for the feature to work at all, in two different files, with no compiler link
// between them: supabase/config.toml's [auth.passkey] (server-side GoTrue endpoints) and
// lib/supabase/client.ts's `auth.experimental.passkey` (client-side method availability). Same drift
// risk password-policy.test.ts already guards for minimum_password_length — catch it here too rather
// than leaving it to be rediscovered as "passkeys silently don't work" after config.toml drifts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('passkey/WebAuthn configuration (decisions.md T15)', () => {
  it('supabase/config.toml enables [auth.passkey] and sets [auth.webauthn] rp_id/rp_origins', () => {
    const toml = readFileSync(path.resolve(__dirname, '../../supabase/config.toml'), 'utf8')

    // Slices from a `[section]` header up to (not including) the next
    // top-level `[...]` header, so each assertion below is scoped to
    // actually being inside that section, not just somewhere in the file.
    function section(name: string): string {
      const start = toml.indexOf(`[${name}]`)
      expect(start, `[${name}] section missing from supabase/config.toml`).toBeGreaterThanOrEqual(0)
      const nextHeader = toml.indexOf('\n[', start + 1)
      return toml.slice(start, nextHeader === -1 ? undefined : nextHeader)
    }

    expect(section('auth.passkey')).toMatch(/^enabled\s*=\s*true/m)

    const webauthn = section('auth.webauthn')
    expect(webauthn).toMatch(/^rp_id\s*=\s*"\S+"/m)
    expect(webauthn).toMatch(/^rp_origins\s*=\s*\[.+\]/m)
  })

  it('lib/supabase/client.ts opts in to the experimental passkey client API', () => {
    const src = readFileSync(path.resolve(__dirname, '../lib/supabase/client.ts'), 'utf8')
    // The browser client is the one that has to carry this flag — passkey
    // ceremonies run via navigator.credentials, browser-only.
    expect(src).toMatch(/experimental:\s*{\s*passkey:\s*true\s*}/)
  })
})
