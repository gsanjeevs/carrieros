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
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useSession } from '@/hooks/use-session';
import { apiClient } from '@/lib/api-client';

interface OnboardingStatus {
  needsOnboarding: boolean;
  loading: boolean;
  // True when the "does this user have a company yet" check itself failed
  // (network error, Supabase unreachable, etc) — distinct from
  // needsOnboarding, which means the check SUCCEEDED and confirmed there's
  // no org yet. Conflating the two used to mean any transient failure
  // showed the onboarding wizard to an already-onboarded user, with no
  // indication anything had gone wrong and no way to sign out.
  error: boolean;
  refresh: () => Promise<void>;
}

const OnboardingStatusContext = createContext<OnboardingStatus | null>(null);

export function OnboardingStatusProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // `check` takes the user id as a PARAMETER rather than closing over
  // `session`, so it has zero dependencies and a permanently stable
  // identity — it never needs to be recreated, so nothing downstream of it
  // can be retriggered by it.
  //
  // This split exists because of a real bug reproduced live on an iOS
  // Simulator (2026-07-25): this function used to be named `refresh`,
  // close over `session` directly, and depend on `[session]` in its
  // useCallback (changed from the more obvious `[session?.user.id]` to
  // satisfy react-hooks/preserve-manual-memoization's nag about matching
  // the compiler's inferred dependency). That trade looked harmless but
  // wasn't: Supabase's onAuthStateChange hands useSession() a NEW session
  // object on every auth event, including ones that don't change the
  // logical user (token refreshes, duplicate INITIAL_SESSION/SIGNED_IN
  // firings right after signUp()). Depending on the whole object meant this
  // callback's identity churned on every one of those, retriggering the
  // effect below in a cycle that never settled -- 993 repeated
  // registration attempts logged in one run, continuously, not a one-time
  // crash. Depending on `session?.user.id` (a stable primitive string) is
  // what src/hooks/use-profile-role.ts already does safely elsewhere in
  // this codebase; satisfying the lint rule was the wrong call.
  const check = useCallback(async (_userId: string) => {
    setLoading(true);
    setError(false);
    try {
      // GET /api/v1/me answers FORBIDDEN ("no organization membership yet")
      // for a signed-in user with no profiles.org_id — that is needsOnboarding,
      // not a failure. A THROWN error (network unreachable, etc) is NOT the
      // same as that successful-but-not-onboarded answer — reproduced live on
      // an iOS Simulator (2026-07-25): before this distinction existed, both
      // cases set needsOnboarding(true), so a network hiccup showed an
      // already-onboarded user the onboarding wizard with no explanation and
      // no way out (that screen previously had no sign-out link either — see
      // src/app/onboarding/index.tsx).
      const { data, error: apiErr } = await apiClient.http.GET('/api/v1/me');
      if (apiErr) {
        if (apiErr.error_code === 'FORBIDDEN') {
          setNeedsOnboarding(true);
        } else {
          throw new Error(apiErr.error_code);
        }
      } else {
        setNeedsOnboarding(!data?.org_id);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // This effect's "no session" branch calls setState directly, the same
  // fetch-on-mount pattern already present ~25 times elsewhere in this
  // codebase (home.tsx, loads.tsx, customers screens, dvir-history, etc,
  // all predating this file) — see the mobile-lint-triage follow-up task
  // for the repo-wide call on that pattern; not fixing it ad hoc here.
  // The effect depends on `session?.user.id` (a stable primitive), not
  // `session` (a new object per auth event) or `check` (already
  // unconditionally stable, see the comment on `check` above) — see that
  // same comment for why this is the fix, not the bug.
  useEffect(() => {
    if (!session?.user.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNeedsOnboarding(false);
      setError(false);
      setLoading(false);
      return;
    }
    check(session.user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  // The compiler wants `[session]` here to match its own inferred
  // dependency. Tried exactly that already (see the long comment on
  // `check` above) and it caused a real, reproduced-on-device infinite
  // render loop: Supabase hands useSession() a new `session` object on
  // every auth event, including ones that don't change the logical user,
  // so depending on the object churns this callback's identity far more
  // than depending on the stable `session?.user.id` primitive. Keeping the
  // stable primitive is the fix, not the bug — do not "correct" this again
  // without re-reading that comment.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const refresh = useCallback(() => {
    if (!session?.user.id) return Promise.resolve();
    return check(session.user.id);
  }, [session?.user.id, check]);

  // Reproduced live on device (2026-07-25): without this memo, the Provider
  // constructs a fresh `{ needsOnboarding, loading, refresh }` object on
  // EVERY render, which re-renders every consumer (AuthGate included) even
  // when nothing meaningful changed. AuthGate renders a <Redirect> whenever
  // needsOnboarding is true — that redirect's own navigation effect
  // triggers another render, which (without this memo) built another new
  // object, which re-rendered AuthGate again, which redirected again... a
  // tight cycle that hit React's "Maximum update depth exceeded" limit
  // within a single commit. Confirmed by testing the real signup ->
  // onboarding handoff on an iOS Simulator, not caught by tsc/eslint/jest.
  const value = useMemo(
    () => ({ needsOnboarding, loading, error, refresh }),
    [needsOnboarding, loading, error, refresh]
  );

  return (
    <OnboardingStatusContext.Provider value={value}>
      {children}
    </OnboardingStatusContext.Provider>
  );
}

export function useOnboardingStatus() {
  const ctx = useContext(OnboardingStatusContext);
  if (!ctx) throw new Error('useOnboardingStatus must be used within OnboardingStatusProvider');
  return ctx;
}
