// src/app/maintenance/index.tsx
// Fleet-wide maintenance overview (audit gap) — src/app/vehicle/[id].tsx
// already has full per-vehicle service logging + reminder scheduling +
// service history, but nothing surfaced upcoming reminders ACROSS the whole
// fleet in one place the way carrieros-web/app/(app)/maintenance/page.tsx
// does. Read-only here (log-service stays on the per-vehicle screen this
// pushes to, matching that screen's own "full reminder authoring stays a
// web-only action for now" scope note) — GET /api/v1/maintenance-reminders,
// org scoped only, same as carrier_reminders_select RLS (no role
// restriction) and batch 1's own per-vehicle fleet reads.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';

import { formatNumber } from '@/lib/format-number';
import { apiClient } from '@/lib/api-client';

type ReminderRow = {
  id: number;
  vehicle_id: number;
  reminder_type: string;
  next_due_date: string | null;
  next_due_miles: number | null;
  vehicle: { vehicle_number: string | null; nickname: string | null } | null;
};

type Status = 'overdue' | 'dueSoon' | 'ok' | 'noDate';

function computeStatus(nextDueDate: string | null): Status {
  if (!nextDueDate) return 'noDate';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntil = Math.round((new Date(nextDueDate).getTime() - today.getTime()) / 86_400_000);
  if (daysUntil < 0) return 'overdue';
  if (daysUntil <= 14) return 'dueSoon';
  return 'ok';
}

const STATUS_PILL: Record<Status, { bg: string; text: string }> = {
  overdue: { bg: StatusColors.dangerLight, text: StatusColors.dangerDark },
  dueSoon: { bg: StatusColors.warningLight, text: StatusColors.warningDark },
  ok: { bg: StatusColors.successLight, text: StatusColors.successDark },
  noDate: { bg: StatusColors.grayLight, text: StatusColors.gray },
};

// Overdue first, then soonest due, undated reminders last — matches the
// priority a fleet manager actually cares about, not creation order.
const STATUS_SORT_ORDER: Record<Status, number> = { overdue: 0, dueSoon: 1, ok: 2, noDate: 3 };

export default function MaintenanceOverviewScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, locale } = useLocale();

  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await apiClient.http.GET('/api/v1/maintenance-reminders');

    const rows = (data?.reminders as unknown as ReminderRow[] | undefined) ?? [];
    rows.sort((a, b) => {
      const orderDiff = STATUS_SORT_ORDER[computeStatus(a.next_due_date)] - STATUS_SORT_ORDER[computeStatus(b.next_due_date)];
      if (orderDiff !== 0) return orderDiff;
      if (a.next_due_date && b.next_due_date) return a.next_due_date.localeCompare(b.next_due_date);
      return 0;
    });
    setReminders(rows);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

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
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.heading}>{t('maintenanceOverview.title')}</ThemedText>
        <FlatList
          data={reminders}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {t('maintenanceOverview.empty')}
            </ThemedText>
          }
          renderItem={({ item }) => {
            const status = computeStatus(item.next_due_date);
            const pill = STATUS_PILL[status];
            const vehicleLabel = item.vehicle?.nickname || item.vehicle?.vehicle_number || '—';
            const dueLabel = [
              item.next_due_date ?? null,
              item.next_due_miles ? t('maintenanceOverview.milesValue', { miles: formatNumber(item.next_due_miles, locale) }) : null,
            ].filter(Boolean).join(' · ') || t('maintenanceOverview.noDueDate');
            return (
              <Pressable
                style={[styles.card, { backgroundColor: theme.card }, styles.cardShadow]}
                onPress={() => router.push({ pathname: '/vehicle/[id]', params: { id: String(item.vehicle_id) } })}
              >
                <ThemedView style={styles.cardHeader} type="transparent">
                  <ThemedText type="smallBold">{item.reminder_type}</ThemedText>
                  <ThemedView style={[styles.statusPill, { backgroundColor: pill.bg }]}>
                    <ThemedText type="small" style={[styles.statusPillText, { color: pill.text }]}>
                      {t(`maintenanceOverview.status_${status}` as never)}
                    </ThemedText>
                  </ThemedView>
                </ThemedView>
                <ThemedText type="small" themeColor="textSecondary">{vehicleLabel}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{dueLabel}</ThemedText>
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  backLink: { paddingVertical: Spacing.two },
  heading: { fontSize: 24, marginBottom: Spacing.three },
  listContent: { gap: Spacing.two, paddingBottom: Spacing.four },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  card: { borderRadius: 16, padding: Spacing.three, gap: 4 },
  cardShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontWeight: '700' },
});
