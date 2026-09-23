// src/app/(tabs)/alerts.tsx
// "Alerts" tab (Owner/Solo/Dispatcher/Finance) — live exception data from
// GET /api/v1/exceptions (get_exceptions(), org-scoped and role-filtered
// server-side), grouped by tier. Not a placeholder — this is the same
// exception feed the web dashboard's parity work is built on.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { apiClient } from '@/lib/api-client';

type ExceptionRow = {
  entity_type: string;
  entity_id: number;
  exception_type: string;
  tier: string;
  title: string;
  detail: string;
  due_at: string | null;
};

const TIER_ORDER = ['today', 'this_week', 'upcoming'];

export default function AlertsScreen() {
  const theme = useTheme();
  const { t } = useLocale();
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await apiClient.http.GET('/api/v1/exceptions');
    setRows((data?.exceptions as ExceptionRow[] | undefined) ?? []);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const tierLabel = (tier: string) =>
    tier === 'today' ? t('alerts.tierToday') : tier === 'this_week' ? t('alerts.tierThisWeek') : t('alerts.tierUpcoming');

  const grouped = TIER_ORDER.map((tier) => ({ tier, items: rows.filter((r) => r.tier === tier) })).filter(
    (g) => g.items.length > 0
  );

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <ThemedText type="title" style={styles.heading}>{t('alerts.title')}</ThemedText>

          {grouped.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {t('alerts.empty')}
            </ThemedText>
          ) : (
            grouped.map((group) => (
              <ThemedView key={group.tier} type="transparent">
                <ThemedText type="subtitle" style={styles.sectionHeading}>{tierLabel(group.tier)}</ThemedText>
                {group.items.map((item, idx) => (
                  <ThemedView
                    key={`${item.entity_type}-${item.entity_id}-${item.exception_type}-${idx}`}
                    style={[styles.card, { backgroundColor: theme.card }, styles.cardShadow]}
                  >
                    <ThemedText type="smallBold">{item.title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{item.detail}</ThemedText>
                  </ThemedView>
                ))}
              </ThemedView>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  scrollContent: { paddingBottom: Spacing.six },
  heading: { fontSize: 24, marginBottom: Spacing.two },
  sectionHeading: { fontSize: 18, marginTop: Spacing.three, marginBottom: Spacing.one },
  empty: { paddingVertical: Spacing.five, textAlign: 'center' },
  card: { borderRadius: 16, padding: Spacing.three, gap: 4, marginBottom: Spacing.two },
  cardShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
});
