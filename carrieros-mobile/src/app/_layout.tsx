import { DarkTheme, DefaultTheme, Redirect, Slot, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { useSession } from '@/hooks/use-session';
import { useRegisterPushToken } from '@/hooks/use-register-push-token';
import { OnboardingStatusProvider, useOnboardingStatus } from '@/hooks/use-onboarding-status';
import { LocaleProvider } from '@/hooks/use-locale';
import { OfflineBanner } from '@/components/offline-banner';

SplashScreen.preventAutoHideAsync();

// Unauthenticated routes: /welcome (mockup-06 Screen 1 — the actual entry
// point now, replacing the old hardcoded "/login only" rule), /login, and
// /signup. Anything else while signed out redirects to /welcome.
const PUBLIC_ROUTES = ['/welcome', '/login', '/signup'];

// Auth guard — three states, not two, since src/app/onboarding/index.tsx and
// src/hooks/use-onboarding-status.ts were added: unauthenticated users can
// only reach PUBLIC_ROUTES; authenticated users with no org_id yet (a
// profiles row is only created once /onboarding's company step succeeds)
// are held on /onboarding and bounced there from anywhere else; fully
// onboarded users are bounced away from all of the above into the (tabs)
// app shell, which owns its own tab bar — this layout only decides which
// of the three stacks is on screen.
function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession();
  const { needsOnboarding, loading: onboardingLoading } = useOnboardingStatus();
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
  if (!session && !isPublicRoute) return <Redirect href="/welcome" />;
  if (session && needsOnboarding && !isOnboardingRoute) return <Redirect href="/onboarding" />;
  // Deliberately does NOT include isOnboardingRoute here: the company step
  // calls refresh() (see src/app/onboarding/index.tsx) the instant org_id
  // exists, while the user still has vehicle/customer/billing/completion
  // left to go through on the SAME /onboarding screen. If this redirected
  // away from /onboarding as soon as needsOnboarding flips false, the user
  // would get bounced out of their own wizard mid-flow, right after
  // finishing just the first step. Leaving /onboarding is that screen's own
  // job (its completion step calls router.replace('/') /
  // router.replace('/load/new') once the user is actually done).
  if (session && !needsOnboarding && isPublicRoute) return <Redirect href="/" />;

  return (
    <>
      {session && !needsOnboarding && <OfflineBanner />}
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
