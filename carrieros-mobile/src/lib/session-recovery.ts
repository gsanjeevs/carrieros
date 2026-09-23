// src/lib/session-recovery.ts
// What to do when the API answers 401 to a token the app believed was good.
//
// Found on the iPhone simulator: a session revoked server-side (signed out
// elsewhere, admin action) leaves the phone half-alive. Direct database reads keep
// working on the unexpired JWT, but the API validates the SESSION, so every API
// call fails 401 -- and the screens just say "failed", forever, while the user still
// looks signed in.
//
// Recovery: try to refresh once (a genuinely stale token recovers); if the session
// itself is gone, sign out LOCALLY so the auth gate returns the user to login. Local
// scope only: it must not revoke the user's other devices' sessions.
import { logError } from '@/lib/observability';
import { supabase } from '@/lib/supabase';

let inFlight: Promise<void> | null = null;

export function handleUnauthorized(): Promise<void> {
  // Several requests fail together when a session dies; recover once, not per request.
  inFlight ??= (async () => {
    try {
      const { error } = await supabase.auth.refreshSession();
      if (error) {
        logError({ where: 'session-recovery' }, { message: 'session unrecoverable, signing out locally', cause: error.message });
        await supabase.auth.signOut({ scope: 'local' });
      }
    } catch (e) {
      logError({ where: 'session-recovery' }, e);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
