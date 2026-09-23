// src/app/(tabs)/dvir-start.tsx
// Driver's tab 2 ("DVIR") — a landing screen only. The actual DVIR flow
// already exists at src/app/dvir/[loadId].tsx (a standalone pushed screen);
// this tab just gets the driver there for their current active load, or
// explains why it can't yet. Named "dvir-start" (not "dvir") to avoid any
// ambiguity with the app/dvir/[loadId] route segment outside this group.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useLocale } from '@/hooks/use-locale';
import { apiClient } from '@/lib/api-client';
const ORANGE = BrandColors.orange;

export default function DvirStartScreen() {
  const router = useRouter();
  const { session } = useSession();
  const { t } = useLocale();
  const [loading, setLoading] = useState(true);
  const [activeLoadId, setActiveLoadId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!session?.user.id) return;
    // /api/v1/loads already restricts a driver to their own loads (loads_driver_view under the hood),
    // so this screen no longer resolves its own drivers row first.
    const { data } = await apiClient.http.GET('/api/v1/loads', { params: { query: { status_group: 'in_progress' } } });
    setActiveLoadId(data?.loads[0]?.id ?? null);
  }, [session?.user.id]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.heading}>{t('dvirTab.heading')}</ThemedText>

        {activeLoadId ? (
          <ThemedView type="transparent" style={styles.buttonGroup}>
            {/* iOS/Android deliberately diverge here (spec §1.1): Android
                gets a visible ripple over the orange fill on press, iOS
                relies on Pressable's platform-default opacity dim -- making
                iOS ripple-less isn't a bug to "fix" by disabling Android's,
                it's the correct per-platform default. */}
            <Pressable
              style={({ pressed }) => [styles.actionButton, pressed && Platform.OS === 'ios' && styles.actionButtonPressed]}
              android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
              onPress={() => router.push({ pathname: '/dvir/[loadId]', params: { loadId: String(activeLoadId), type: 'pre_trip' } })}
            >
              <ThemedText type="smallBold" style={styles.actionButtonText}>{t('dvirTab.startPreTrip')}</ThemedText>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.actionButton, styles.actionButtonSecondary, pressed && Platform.OS === 'ios' && styles.actionButtonPressed]}
              android_ripple={{ color: `${ORANGE}22` }}
              onPress={() => router.push({ pathname: '/dvir/[loadId]', params: { loadId: String(activeLoadId), type: 'post_trip' } })}
            >
              <ThemedText type="smallBold" style={styles.actionButtonSecondaryText}>{t('dvirTab.startPostTrip')}</ThemedText>
            </Pressable>
          </ThemedView>
        ) : (
          <ThemedView type="transparent" style={styles.empty}>
            <ThemedText type="default" style={styles.emptyTitle}>{t('dvirTab.noActiveLoad')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyDetail}>
              {t('dvirTab.noActiveLoadDetail')}
            </ThemedText>
          </ThemedView>
        )}

        <Pressable onPress={() => router.push('/dvir-history')} style={styles.historyLink}>
          <ThemedText type="link">{t('dvirTab.viewHistory')}</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  heading: { fontSize: 24, marginBottom: Spacing.four },
  buttonGroup: { gap: Spacing.three },
  actionButton: {
    backgroundColor: ORANGE,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  actionButtonText: { color: '#ffffff' },
  actionButtonPressed: { opacity: 0.85 },
  actionButtonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: ORANGE },
  actionButtonSecondaryText: { color: ORANGE },
  empty: { alignItems: 'center', marginTop: Spacing.six, gap: Spacing.two, paddingHorizontal: Spacing.three },
  emptyTitle: { fontWeight: '700', textAlign: 'center' },
  emptyDetail: { textAlign: 'center' },
  historyLink: { alignItems: 'center', marginTop: Spacing.four, paddingVertical: Spacing.two },
});
