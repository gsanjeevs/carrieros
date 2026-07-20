import { DarkTheme, DefaultTheme, Redirect, Slot, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { useSession } from '@/hooks/use-session';

SplashScreen.preventAutoHideAsync();

// Auth guard: unauthenticated users can only reach /login; authenticated
// users are bounced away from /login. Everything else lives under the
// (tabs) group, which owns its own tab bar — this layout only decides
// whether the auth stack or the tabs stack is on screen.
function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;
  if (!session && pathname !== '/login') return <Redirect href="/login" />;
  if (session && pathname === '/login') return <Redirect href="/" />;

  return children;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AuthGate>
        <Slot />
      </AuthGate>
    </ThemeProvider>
  );
}
