import { DarkTheme, DefaultTheme, Slot, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppThemeProvider, useThemePreference } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import { useRegisterPushToken } from '@/hooks/use-register-push-token';
import { OnboardingStatusProvider, useOnboardingStatus } from '@/hooks/use-onboarding-status';
import { LocaleProvider } from '@/hooks/use-locale';
import { OfflineBanner } from '@/components/offline-banner';
import { OnboardingStatusError } from '@/components/onboarding-status-error';
import WelcomeScreen from './welcome';
import OnboardingScreen from './onboarding';
import { AppErrorScreen } from '@/components/app-error-screen';
import { installGlobalErrorHandler } from '@/lib/observability';

SplashScreen.preventAutoHideAsync();
installGlobalErrorHandler();

// expo-router renders this in place of any screen that throws while rendering.
export function ErrorBoundary(props: { error: Error; retry: () => Promise<unknown> }) {
  return <AppErrorScreen {...props} />;
}

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

  // Latch: keep rendering the wizard once it has started, even after
  // needsOnboarding flips false underneath it.
  //
  // The wizard has five steps but only step 1 (company details) creates the
  // org. As soon as it succeeds, submitCompany() calls
  // refreshOnboardingStatus() — deliberately, so the completion step's
  // router.replace('/') isn't fighting a stale "still needs onboarding".
  // But that flipped needsOnboarding false while the user was still on step
  // 1, so this gate swapped the wizard out for the (tabs) shell mid-flight
  // and steps 2-5 (vehicle, customer, billing, completion) never rendered at
  // all. Reproduced live on an iOS Simulator (2026-07-26): filling in step 1
  // and pressing Continue landed straight on the Dashboard, and the org row
  // it created (organizations.id 971) confirmed the submit itself had
  // worked — the wizard was being unmounted, not failing.
  //
  // Keyed by user id so signing out or switching accounts clears it for
  // free; cleared explicitly by the completion step via onFinish.
  const userId = session?.user.id;
  const [wizardUser, setWizardUser] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (needsOnboarding && userId) setWizardUser(userId);
  }, [needsOnboarding, userId]);
  const wizardActive = !!userId && wizardUser === userId;
  // Session loading always gates; onboarding-status loading only matters
  // once a session exists (the hook itself returns loading:false with no
  // session, so this can't deadlock a signed-out user on the splash screen).
  //
  // ...and it stops mattering entirely once the wizard is on screen. `check()`
  // sets loading:true on every run, including the refresh() that submitCompany
  // fires mid-wizard — which made this whole component `return null` for the
  // duration of that request, UNMOUNTING the wizard and taking its useState
  // with it. Reproduced live on an iOS Simulator (2026-07-26): with the latch
  // below already in place, step 1 correctly stayed in the wizard instead of
  // bailing to the Dashboard, but came back as a blank "Step 1 of 5" with
  // every field cleared, because `step` had been reset to its 'company'
  // initial value. The org row it created (organizations.id 972) proved the
  // submit had succeeded — the state loss was purely this unmount.
  //
  // Excluding onboardingLoading while wizardActive is safe: wizardActive can
  // only be true after a check has already completed and returned
  // needsOnboarding, so this never skips the initial "which screen?" gate.
  const stillResolving = loading || (!!session && onboardingLoading && !wizardActive);

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

  if (onboardingCheckError && !wizardActive) {
    // The "does this user have a company yet" check itself failed (network
    // error, Supabase unreachable) — distinct from a successful check that
    // confirmed no org exists. Rendering the onboarding wizard here would
    // be actively misleading for an already-onboarded user hitting a
    // transient failure, with no explanation and (before onboarding/
    // index.tsx got its own sign-out link) no way out. Show what actually
    // happened instead, with a retry and an escape hatch that always works.
    //
    // Skipped while the wizard is active, for the same reason the loading
    // gate above is: swapping this in mid-wizard would unmount the wizard and
    // discard everything the user had typed. A refresh() that fails during
    // setup doesn't change what we should be showing — they still need to
    // finish onboarding — and the wizard surfaces its own submit errors
    // inline (see the catch blocks in onboarding/index.tsx).
    return <OnboardingStatusError onRetry={refreshOnboardingStatus} />;
  }

  if (needsOnboarding || wizardActive) {
    // Rendered directly in both cases, rather than deferring to Slot when
    // the matched route already IS /onboarding. It's the same component
    // either way, and rendering it here is what lets onFinish be wired up —
    // without that the latch above would never clear and the wizard could
    // never hand off to the app.
    return <OnboardingScreen onFinish={() => setWizardUser(null)} />;
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

// React Navigation's own chrome (stack backgrounds, card transitions) is
// themed separately from our palette, so it needs the SAME resolved value —
// otherwise a navy screen animates in over a white navigation background.
// Split into its own component because it has to consume AppThemeProvider's
// context, which means it must render underneath it.
function NavigationThemeBridge({ children }: { children: React.ReactNode }) {
  const { resolved } = useThemePreference();
  return <ThemeProvider value={resolved === 'dark' ? DarkTheme : DefaultTheme}>{children}</ThemeProvider>;
}

export default function RootLayout() {
  return (
    // AppThemeProvider is outermost: everything below it, including the splash
    // overlay and the auth gate's own screens, should already be themed. It
    // reads its own useSession() rather than taking one as a prop, same
    // independent-concerns pattern as LocaleProvider below.
    <AppThemeProvider>
      <NavigationThemeBridge>
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
      </NavigationThemeBridge>
    </AppThemeProvider>
  );
}
