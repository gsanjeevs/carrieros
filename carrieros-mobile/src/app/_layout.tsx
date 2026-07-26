import { DarkTheme, DefaultTheme, Slot, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { useSession } from '@/hooks/use-session';
import { useRegisterPushToken } from '@/hooks/use-register-push-token';
import { OnboardingStatusProvider, useOnboardingStatus } from '@/hooks/use-onboarding-status';
import { LocaleProvider } from '@/hooks/use-locale';
import { OfflineBanner } from '@/components/offline-banner';
import { OnboardingStatusError } from '@/components/onboarding-status-error';
import WelcomeScreen from './welcome';
import OnboardingScreen from './onboarding';

SplashScreen.preventAutoHideAsync();

// Unauthenticated routes: /welcome (mockup-06 Screen 1 — the actual entry
// point now, replacing the old hardcoded "/login only" rule), /login, and
// /signup.
const PUBLIC_ROUTES = ['/welcome', '/login', '/signup'];

// Auth guard — three states, not two, since src/app/onboarding/index.tsx and
// src/hooks/use-onboarding-status.ts were added: unauthenticated users can
// only reach PUBLIC_ROUTES; authenticated users with no org_id yet (a
// profiles row is only created once /onboarding's company step succeeds)
// see the onboarding wizard; fully onboarded users see the (tabs) app shell.
//
// Deliberately does NOT navigate (no router.replace/<Redirect> anywhere in
// this file) — it substitutes which COMPONENT renders, directly, without
// touching the router. Reproduced live on an iOS Simulator (2026-07-25):
// both the declarative <Redirect> and an effect-based router.replace()
// caused a genuine infinite loop — router.replace('/onboarding') was, for
// reasons not fully isolated, triggering a full remount of everything
// mounted below RootLayout (OnboardingStatusProvider's own state reset to
// its initial "no session yet" values each cycle, confirmed via added
// console.log instrumentation, with zero corresponding Metro/"iOS Bundled"
// events — a pure React-level remount storm, not a JS reload), which
// re-ran the auth-status check, which flipped needsOnboarding back on,
// which called replace('/onboarding') again, forever. Rendering the
// target screen's component directly sidesteps React Navigation's
// route-change machinery for this decision entirely; the router is still
// used everywhere a user explicitly taps something (Welcome's "Get
// Started", Signup's post-signup handoff, the onboarding completion
// step's "Go to dashboard"/"Add first load") — those are normal,
// one-directional pushes/replaces that were never the problem.
function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession();
  const { needsOnboarding, loading: onboardingLoading, error: onboardingCheckError, refresh: refreshOnboardingStatus } = useOnboardingStatus();
  const pathname = usePathname();
  useRegisterPushToken();

  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  const isOnboardingRoute = pathname === '/onboarding';
  // Session loading always gates; onboarding-status loading only matters
  // once a session exists (the hook itself returns loading:false with no
  // session, so this can't deadlock a signed-out user on the splash screen).
  const stillResolving = loading || (!!session && onboardingLoading);

  useEffect(() => {
    if (!stillResolving) SplashScreen.hideAsync();
  }, [stillResolving]);

  if (stillResolving) return null;

  if (!session) {
    // Trust file-based routing for the public routes themselves (so
    // Welcome's "Get Started" -> /signup and Signup's "Back" -> /welcome
    // still work as real navigations); only substitute Welcome directly
    // when the current route isn't one of those (e.g. a stale/persisted
    // nav state pointing somewhere protected while signed out).
    return isPublicRoute ? <>{children}</> : <WelcomeScreen />;
  }

  if (onboardingCheckError) {
    // The "does this user have a company yet" check itself failed (network
    // error, Supabase unreachable) — distinct from a successful check that
    // confirmed no org exists. Rendering the onboarding wizard here would
    // be actively misleading for an already-onboarded user hitting a
    // transient failure, with no explanation and (before onboarding/
    // index.tsx got its own sign-out link) no way out. Show what actually
    // happened instead, with a retry and an escape hatch that always works.
    return <OnboardingStatusError onRetry={refreshOnboardingStatus} />;
  }

  if (needsOnboarding) {
    // Same idea: if the matched route already IS /onboarding, let it
    // render normally through Slot; otherwise render it directly rather
    // than navigating there.
    return isOnboardingRoute ? <>{children}</> : <OnboardingScreen />;
  }

  // Fully onboarded. If the current route is one of the public/onboarding
  // screens (e.g. returning to an app that still has that nav state
  // persisted from before this session finished setup), fall through to
  // the real (tabs) shell instead of re-rendering Welcome/Onboarding.
  if (isPublicRoute || isOnboardingRoute) {
    return (
      <>
        <OfflineBanner />
        <Slot />
      </>
    );
  }

  return (
    <>
      <OfflineBanner />
      {children}
    </>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {/* LocaleProvider sits alongside AuthGate (not instead of it): it reads
          its own useSession() so locale resolution and auth redirects are
          independent concerns, same as the rest of this file. */}
      <LocaleProvider>
        <OnboardingStatusProvider>
          <AuthGate>
            <Slot />
          </AuthGate>
        </OnboardingStatusProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
