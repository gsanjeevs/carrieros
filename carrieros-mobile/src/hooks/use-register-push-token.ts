// src/hooks/use-register-push-token.ts
// PRD P0: "driver receives push notification on assignment." Registers for
// an Expo push token once a session exists and saves it to
// profiles.push_token (carrieros-web's app/api/loads/[id]/route.ts reads
// it back when dispatching a load). Reads its own useSession(), same
// pattern as LocaleProvider in _layout.tsx.
//
// DEMO-MODE SEAM: getExpoPushTokenAsync() requires an EAS project id
// (app.json's expo.extra.eas.projectId), which is not configured in this
// project. This hook is real and correct — permission request, token
// fetch, and the save-to-profiles call all genuinely work — but the token
// fetch itself will reject with no EAS project registered, so no real
// device in this project ever gets a token stored yet. Registering a real
// EAS project would make this fully live with zero code changes here.
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';

import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

export function useRegisterPushToken() {
  const { session } = useSession();

  useEffect(() => {
    if (!session?.user.id) return;
    let cancelled = false;

    async function register() {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync();
        let status = existing;
        if (status !== 'granted') {
          const req = await Notifications.requestPermissionsAsync();
          status = req.status;
        }
        if (status !== 'granted') return;

        const { data: token } = await Notifications.getExpoPushTokenAsync();
        if (cancelled || !token) return;

        await supabase
          .from('profiles')
          .update({ push_token: token })
          .eq('id', session!.user.id);
      } catch (err) {
        // No EAS project configured (or simulator/no-push-capable device) —
        // expected in this project today, see file header. Never crash the
        // app over a missing push registration.
        console.log('[push] token registration skipped:', err instanceof Error ? err.message : err);
      }
    }

    register();
    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);
}
