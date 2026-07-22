// src/app/(tabs)/dvir-start.tsx
// Driver's tab 2 ("DVIR") — a landing screen only. The actual DVIR flow
// already exists at src/app/dvir/[loadId].tsx (a standalone pushed screen);
// this tab just gets the driver there for their current active load, or
// explains why it can't yet. Named "dvir-start" (not "dvir") to avoid any
// ambiguity with the app/dvir/[loadId] route segment outside this group.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, StatusColors } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';

const PAGE_BACKGROUND = StatusColors.grayLight;
const ORANGE = '#f97316';
const ACTIVE_LOAD_STATUSES = ['dispatched', 'picked_up', 'in_transit'];

export default function DvirStartScreen() {
  const router = useRouter();
  const { session } = useSession();
  const { t } = useLocale();
  const [loading, setLoading] = useState(true);
  const [activeLoadId, setActiveLoadId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!session?.user.id) return;
    const { data: driver } = await supabase
      .from('drivers')
      .select('id')
      .eq('profile_id', session.user.id)
      .single();
    if (!driver) return;

    const { data: activeLoad } = await supabase
      .from('loads_driver_view')
      .select('id')
      .eq('driver_id', driver.id)
      .in('status', ACTIVE_LOAD_STATUSES)
      .order('created_at', { ascending: false })
      .maybeSingle();

    setActiveLoadId(activeLoad?.id ?? null);
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
    <ThemedView style={[styles.container, { backgroundColor: PAGE_BACKGROUND }]}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.heading}>{t('dvirTab.heading')}</ThemedText>

        {activeLoadId ? (
          <ThemedView style={styles.buttonGroup}>
            <Pressable
              style={styles.actionButton}
              onPress={() => router.push({ pathname: '/dvir/[loadId]', params: { loadId: String(activeLoadId), type: 'pre_trip' } })}
            >
              <ThemedText type="smallBold" style={styles.actionButtonText}>{t('dvirTab.startPreTrip')}</ThemedText>
            </Pressable>
            <Pressable
              style={[styles.actionButton, styles.actionButtonSecondary]}
              onPress={() => router.push({ pathname: '/dvir/[loadId]', params: { loadId: String(activeLoadId), type: 'post_trip' } })}
            >
              <ThemedText type="smallBold" style={styles.actionButtonSecondaryText}>{t('dvirTab.startPostTrip')}</ThemedText>
            </Pressable>
          </ThemedView>
        ) : (
          <ThemedView style={styles.empty}>
            <ThemedText type="default" style={styles.emptyTitle}>{t('dvirTab.noActiveLoad')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyDetail}>
              {t('dvirTab.noActiveLoadDetail')}
            </ThemedText>
          </ThemedView>
        )}
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
  actionButtonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: ORANGE },
  actionButtonSecondaryText: { color: ORANGE },
  empty: { alignItems: 'center', marginTop: Spacing.six, gap: Spacing.two, paddingHorizontal: Spacing.three },
  emptyTitle: { fontWeight: '700', textAlign: 'center' },
  emptyDetail: { textAlign: 'center' },
});
