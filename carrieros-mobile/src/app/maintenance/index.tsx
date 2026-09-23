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
//
// Native polish (design/mobile-native-interaction-spec.md §2.1): the
// All/Overdue/Due Soon filter is a platform-diverging control -- iOS gets a
// sliding segmented-control look (no first-class @react-native-segmented-
// control/segmented-control dependency is installed, so this is a styled
// equivalent, not the literal native UISegmentedControl bridge -- see the
// mobile-native-polish commit notes for why), Android gets a Chip toggle
// group, since segmented controls aren't a first-class Android pattern.
// Swipe-left-to-"Log Service" on a row reuses the shared SwipeableRow
// primitive (spec §1.2/§2.1/§3.2 -- one component, three call sites).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SwipeableRow } from '@/components/swipeable-row';
import { BrandColors, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';

import { formatNumber } from '@/lib/format-number';
import { apiClient } from '@/lib/api-client';
import { haptics } from '@/lib/haptics';

const ORANGE = BrandColors.orange;

type ReminderRow = {
  id: number;
  vehicle_id: number;
  reminder_type: string;
  next_due_date: string | null;
  next_due_miles: number | null;
  vehicle: { vehicle_number: string | null; nickname: string | null } | null;
};

type Status = 'overdue' | 'dueSoon' | 'ok' | 'noDate';
type Filter = 'all' | 'overdue' | 'dueSoon';

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
  const [filter, setFilter] = useState<Filter>('all');
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

  function selectFilter(next: Filter) {
    if (next === filter) return;
    haptics.light();
    setFilter(next);
  }

  const counts = useMemo(() => {
    let overdue = 0;
    let dueSoon = 0;
    for (const r of reminders) {
      const status = computeStatus(r.next_due_date);
      if (status === 'overdue') overdue += 1;
      if (status === 'dueSoon') dueSoon += 1;
    }
    return { all: reminders.length, overdue, dueSoon };
  }, [reminders]);

  const visibleReminders = useMemo(() => {
    if (filter === 'all') return reminders;
    return reminders.filter((r) => computeStatus(r.next_due_date) === filter);
  }, [reminders, filter]);

  function logService(vehicleId: number) {
    router.push({ pathname: '/vehicle/[id]', params: { id: String(vehicleId), logService: '1' } });
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

        {Platform.OS === 'ios' ? (
          <ThemedView style={[styles.iosSegmented, { backgroundColor: theme.backgroundElement }]}>
            {(['all', 'overdue', 'dueSoon'] as const).map((f) => (
              <Pressable
                key={f}
                onPress={() => selectFilter(f)}
                style={[styles.iosSegmentedItem, filter === f && [styles.iosSegmentedItemActive, { backgroundColor: theme.card }]]}
              >
                <ThemedText type="small" style={filter === f ? { color: theme.text, fontWeight: '700' } : undefined} themeColor={filter === f ? undefined : 'textSecondary'}>
                  {f === 'all' ? t('maintenanceOverview.filterAll', { count: counts.all }) : null}
                  {f === 'overdue' ? `${t('maintenanceOverview.status_overdue')} (${counts.overdue})` : null}
                  {f === 'dueSoon' ? `${t('maintenanceOverview.status_dueSoon')} (${counts.dueSoon})` : null}
                </ThemedText>
              </Pressable>
            ))}
          </ThemedView>
        ) : (
          <ThemedView type="transparent" style={styles.androidChipRow}>
            {(['all', 'overdue', 'dueSoon'] as const).map((f) => (
              <Pressable
                key={f}
                android_ripple={{ color: `${ORANGE}22`, borderless: false }}
                onPress={() => selectFilter(f)}
                style={[
                  styles.androidChip,
                  { borderColor: filter === f ? ORANGE : theme.border },
                  filter === f && { backgroundColor: `${ORANGE}1a` },
                ]}
              >
                <ThemedText type="small" style={{ color: filter === f ? ORANGE : theme.textSecondary, fontWeight: filter === f ? '700' : '400' }}>
                  {f === 'all' ? t('maintenanceOverview.filterAll', { count: counts.all }) : null}
                  {f === 'overdue' ? `${t('maintenanceOverview.status_overdue')} (${counts.overdue})` : null}
                  {f === 'dueSoon' ? `${t('maintenanceOverview.status_dueSoon')} (${counts.dueSoon})` : null}
                </ThemedText>
              </Pressable>
            ))}
          </ThemedView>
        )}

        <FlatList
          data={visibleReminders}
          keyExtractor={(item) => String(item.id)}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={BrandColors.orange}
              colors={[BrandColors.orange]}
            />
          }
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

            const row = (
              <Pressable
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: theme.card },
                  styles.cardShadow,
                  pressed && (Platform.OS === 'android' ? styles.cardPressedAndroid : styles.cardPressed),
                ]}
                android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
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

            // Swipe-left-to-"Log Service" (spec §2.1) -- one action, teal
            // (utility) not green, reserving green for OK/Approve per §5.2's
            // semantic color mapping.
            return (
              <SwipeableRow
                side="right"
                label={t('maintenanceOverview.logAction')}
                color={StatusColors.teal}
                hapticTier="medium"
                onAction={() => logService(item.vehicle_id)}
                containerStyle={styles.swipeContainer}
              >
                {row}
              </SwipeableRow>
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
  // iOS: UISegmentedControl-style sliding selection surface (spec §2.1) --
  // an in-house equivalent since @react-native-segmented-control isn't an
  // installed dependency; visually/interactionally matches (rounded track,
  // raised active segment, haptic on change) even though it isn't the literal
  // native bridge component.
  iosSegmented: { flexDirection: 'row', borderRadius: 10, padding: 3, marginBottom: Spacing.three },
  iosSegmentedItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  iosSegmentedItemActive: { shadowColor: '#000000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3, elevation: 1 },
  // Android: Material 3 Chip toggle group -- separate pill-shaped chips, not
  // a single sliding track, since that's the idiomatic Android equivalent
  // per spec §2.1 (segmented controls aren't a first-class Android pattern).
  androidChipRow: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.three, flexWrap: 'wrap' },
  androidChip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  listContent: { gap: Spacing.two, paddingBottom: Spacing.four },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  swipeContainer: { marginBottom: 0 },
  card: { borderRadius: 16, padding: Spacing.three, gap: 4 },
  cardShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  // Pressed-state elevation (spec §5.3): opacity dim on both platforms, plus
  // an Android-only elevation reduction to mimic Material's "sink on press"
  // (iOS relies on the ripple-less opacity dim alone, matching dvir-start's
  // CTA-button divergence rationale extended to list rows).
  cardPressed: { opacity: 0.85 },
  cardPressedAndroid: { opacity: 0.85, elevation: 1 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontWeight: '700' },
});
