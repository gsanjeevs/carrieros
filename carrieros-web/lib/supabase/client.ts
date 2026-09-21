// lib/supabase/client.ts
// Use in Client Components (hooks, event handlers)
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // Passkey/WebAuthn (decisions.md T15) — @supabase/supabase-js 2.110.7's
        // passkey methods (auth.signInWithPasskey, auth.registerPasskey,
        // auth.passkey.*) throw at call time unless this is set; it only
        // gates method availability, no other client behavior changes when
        // enabled. Paired with supabase/config.toml's [auth.passkey] enabled
        // flag, which turns on the server-side endpoints these methods call.
        experimental: { passkey: true },
      },
    }
  )
}
