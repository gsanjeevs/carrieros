// src/hooks/use-onboarding-status.ts
// Whether the signed-in user has a profiles row with an org_id yet — the
// same "no org yet" condition carrieros-web's app/(app)/layout.tsx checks
// before rendering the authenticated app shell. Added alongside
// src/app/onboarding/index.tsx: previously mobile had no concept of this at
// all — src/hooks/use-profile-role.ts falls back to a 'solo' role for a
// user with no profile row, so a freshly signed-up user would have rendered
// the Solo dashboard with no data anywhere (every query is org_id-scoped),
// silently broken rather than routed to setup.
//
// A Context, not a plain hook: _layout.tsx's AuthGate and
// src/app/onboarding/index.tsx both need this value, and they need to see
// the SAME check result. A plain hook called from both would give each its
// own independent state — src/app/onboarding/index.tsx's completion step
// calls refresh() the instant POST /api/onboarding succeeds, and if AuthGate
// held a separate, still-stale "needsOnboarding: true" from its own copy,
// router.replace('/') on the completion screen would immediately bounce
// back to /onboarding — a redirect loop trapping the user right after they
// finish setting up.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

interface OnboardingStatus {
  needsOnboarding: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

const OnboardingStatusContext = createContext<OnboardingStatus | null>(null);

export function OnboardingStatusProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // `loading` flips true here (inside the async function), not via a
    // direct setState call in the effect body below — the effect only
    // calls this function reference, which is what react-hooks/
    // set-state-in-effect wants ("adjust state from an event/callback,
    // not synchronously during the effect").
    setLoading(true);
    if (!session?.user.id) {
      setNeedsOnboarding(false);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', session.user.id)
      .maybeSingle();
    setNeedsOnboarding(!data?.org_id);
    setLoading(false);
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <OnboardingStatusContext.Provider value={{ needsOnboarding, loading, refresh }}>
      {children}
    </OnboardingStatusContext.Provider>
  );
}

export function useOnboardingStatus() {
  const ctx = useContext(OnboardingStatusContext);
  if (!ctx) throw new Error('useOnboardingStatus must be used within OnboardingStatusProvider');
  return ctx;
}
