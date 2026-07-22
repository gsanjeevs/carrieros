// src/app/(tabs)/index.tsx
// The (tabs) group's root route ("/") — AuthGate (src/app/_layout.tsx)
// redirects here after login without knowing the user's role, so this is
// the one place that resolves profiles.role and forwards to that role's
// actual first tab (see src/constants/tab-sets.ts — TAB_SETS[role][0]).
// Not a screen with its own content; previously this file WAS "My Loads"
// content, which moved to loads.tsx unchanged.
import { Redirect } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { TAB_SETS } from '@/constants/tab-sets';
import { useProfileRole } from '@/hooks/use-profile-role';

export default function TabsIndexRedirect() {
  const { role, loading } = useProfileRole();

  if (loading || !role) {
    return (
      <ThemedView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const firstTab = TAB_SETS[role][0].name;
  return <Redirect href={`/${firstTab}` as never} />;
}
