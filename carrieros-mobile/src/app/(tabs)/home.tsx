// src/app/(tabs)/home.tsx
// "Home" tab for Owner/Solo/Dispatcher/Finance — 4 different content sets
// behind one route, branching on profiles.role (see
// src/hooks/use-profile-role.ts). This is NOT the old (tabs)/index.tsx
// (that content moved to loads.tsx unchanged) — this is a real dashboard
// per role, per the mobile-parity design pass. All content comes from one
// GET /api/v1/dashboard call (server/application/dashboard-query-service.ts
// assembles the same per-role reads this screen used to make as 3-5
// separate round trips) instead of querying loads/vehicles/drivers/invoices
// directly.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LOAD_STATUS_PILL, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { useProfileRole } from '@/hooks/use-profile-role';
import { formatDate } from '@/lib/format-date';
import { formatMoney } from '@/lib/format-money';
import { apiClient } from '@/lib/api-client';

// Stale-load threshold (decisions.md, mobile-parity plan): a load whose
// `loads.updated_at` hasn't moved in 4+ hours is flagged on the Dispatcher
// ops board. `updated_at` is the timestamp this schema actually exposes on
// `loads` for "last touched" — load_events has per-event created_at but no
// single "latest event per load" column/view to join against cheaply here.
const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;

type LoadRow = {
  id: number;
  load_number: string;
  status: string;
  customer_name_raw: string | null;
  pickup_city: string | null;
  pickup_state: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
};

type OpsLoadRow = LoadRow & { driver_id: number | null; vehicle_id: number | null; updated_at: string | null };

type InvoiceRow = {
  id: number;
  invoice_number: string;
  amount: number;
  due_date: string | null;
  paid_at: string | null;
};

function LoadCard({ load, onPress, staleLabel }: { load: LoadRow; onPress: () => void; staleLabel?: string }) {
  const theme = useTheme();
  const { t } = useLocale();
  const pill = LOAD_STATUS_PILL[load.status] ?? LOAD_STATUS_PILL.draft;
  return (
    <Pressable style={[styles.card, { backgroundColor: theme.card }, styles.cardShadow]} onPress={onPress}>
      <ThemedView style={styles.cardHeader} type="transparent">
        <ThemedText type="smallBold">{load.load_number}</ThemedText>
        <ThemedView style={styles.cardHeaderRight} type="transparent">
          {staleLabel ? (
            <ThemedView style={[styles.statusPill, { backgroundColor: StatusColors.dangerLight }]}>
              <ThemedText type="small" style={[styles.statusPillText, { color: StatusColors.dangerDark }]}>
                {staleLabel}
              </ThemedText>
            </ThemedView>
          ) : null}
          <ThemedView style={[styles.statusPill, { backgroundColor: pill.bg }]}>
            <ThemedText type="small" style={[styles.statusPillText, { color: pill.text }]}>
              {t(`loads.status.${load.status}`)}
            </ThemedText>
          </ThemedView>
        </ThemedView>
      </ThemedView>
      <ThemedText type="small" themeColor="textSecondary">
        {load.customer_name_raw ?? t('common.unknownCustomer')}
      </ThemedText>
      <ThemedView style={styles.routeRow} type="transparent">
        <ThemedText type="default" style={styles.routeText}>
          {load.pickup_city ?? '—'}{load.pickup_state ? `, ${load.pickup_state}` : ''}
        </ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.routeArrow}>{'  →  '}</ThemedText>
        <ThemedText type="default" style={styles.routeText}>
          {load.delivery_city ?? '—'}{load.delivery_state ? `, ${load.delivery_state}` : ''}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  const theme = useTheme();
  return (
    <ThemedView style={[styles.statTile, { backgroundColor: theme.card }, styles.cardShadow]}>
      <ThemedText type="title" style={styles.statValue}>{String(value)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
    </ThemedView>
  );
}

function SectionHeading({ text }: { text: string }) {
  return (
    <ThemedText type="subtitle" style={styles.sectionHeading}>{text}</ThemedText>
  );
}

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, locale } = useLocale();
  const { role, loading: roleLoading } = useProfileRole();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Owner/Solo
  const [activeLoadsCount, setActiveLoadsCount] = useState(0);
  const [fleetCounts, setFleetCounts] = useState<{ active: number; idle: number; in_shop: number }>({
    active: 0,
    idle: 0,
    in_shop: 0,
  });
  const [recentLoads, setRecentLoads] = useState<LoadRow[]>([]);
  const [soloActiveLoad, setSoloActiveLoad] = useState<LoadRow | null>(null);

  // Dispatcher
  const [opsLoads, setOpsLoads] = useState<OpsLoadRow[]>([]);
  const [availableDrivers, setAvailableDrivers] = useState(0);
  const [availableVehicles, setAvailableVehicles] = useState(0);

  // Finance
  const [outstandingTotal, setOutstandingTotal] = useState(0);
  const [outstandingCount, setOutstandingCount] = useState(0);
  const [mostOverdue, setMostOverdue] = useState<InvoiceRow[]>([]);
  const [recentPayments, setRecentPayments] = useState<InvoiceRow[]>([]);

  const load = useCallback(async () => {
    if (!role) return;
    setError('');

    const { data, error: err } = await apiClient.http.GET('/api/v1/dashboard');
    if (err || !data) {
      setError(t('common.loadErrorRetry'));
      return;
    }

    setActiveLoadsCount(data.active_loads_count ?? 0);
    setFleetCounts(data.fleet_counts ?? { active: 0, idle: 0, in_shop: 0 });
    setRecentLoads((data.recent_loads as LoadRow[] | undefined) ?? []);
    setSoloActiveLoad((data.solo_active_load as LoadRow | null | undefined) ?? null);

    setOpsLoads((data.ops_loads as OpsLoadRow[] | undefined) ?? []);
    setAvailableDrivers(data.available_drivers ?? 0);
    setAvailableVehicles(data.available_vehicles ?? 0);

    setOutstandingCount(data.outstanding_count ?? 0);
    setOutstandingTotal(data.outstanding_total ?? 0);
    setMostOverdue((data.most_overdue_invoices as InvoiceRow[] | undefined) ?? []);
    setRecentPayments((data.recent_payments as InvoiceRow[] | undefined) ?? []);
  }, [role, t]);

  useEffect(() => {
    if (roleLoading) return;
    load().finally(() => setLoading(false));
  }, [roleLoading, load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (roleLoading || loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const heading =
    role === 'dispatcher' ? t('home.titleDispatcher') : role === 'finance' ? t('home.titleFinance') : t('home.titleOwner');

  return (
    <ThemedView style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <ThemedText type="title" style={styles.heading}>{heading}</ThemedText>

          {error ? (
            <ThemedText type="small" style={styles.error}>{error}</ThemedText>
          ) : null}

          {role === 'solo' && soloActiveLoad ? (
            <>
              <SectionHeading text={t('home.myLoadToday')} />
              <LoadCard
                load={soloActiveLoad}
                onPress={() => router.push({ pathname: '/load/[id]', params: { id: String(soloActiveLoad.id) } })}
              />
            </>
          ) : null}

          {(role === 'owner' || role === 'solo') && (
            <>
              <ThemedView style={styles.statRow} type="transparent">
                <StatTile label={t('home.activeLoads')} value={activeLoadsCount} />
              </ThemedView>

              <SectionHeading text={t('home.fleetStatus')} />
              <ThemedView style={styles.statRow} type="transparent">
                <StatTile label={t('home.statusActive')} value={fleetCounts.active} />
                <StatTile label={t('home.statusIdle')} value={fleetCounts.idle} />
                <StatTile label={t('home.statusInShop')} value={fleetCounts.in_shop} />
              </ThemedView>

              <SectionHeading text={t('home.recentLoads')} />
              {recentLoads.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                  {t('home.noRecentLoads')}
                </ThemedText>
              ) : (
                recentLoads.map((l) => (
                  <LoadCard
                    key={l.id}
                    load={l}
                    onPress={() => router.push({ pathname: '/load/[id]', params: { id: String(l.id) } })}
                  />
                ))
              )}
            </>
          )}

          {role === 'dispatcher' && (
            <>
              <ThemedView style={styles.statRow} type="transparent">
                <StatTile label={t('home.availableDrivers')} value={availableDrivers} />
                <StatTile label={t('home.availableVehicles')} value={availableVehicles} />
              </ThemedView>

              <SectionHeading text={t('home.activeLoads')} />
              {opsLoads.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                  {t('home.noActiveLoads')}
                </ThemedText>
              ) : (
                opsLoads.map((l) => {
                  const isStale =
                    l.updated_at != null && Date.now() - new Date(l.updated_at).getTime() > STALE_THRESHOLD_MS;
                  return (
                    <LoadCard
                      key={l.id}
                      load={l}
                      staleLabel={isStale ? t('home.staleFlag') : undefined}
                      onPress={() => router.push({ pathname: '/load/[id]', params: { id: String(l.id) } })}
                    />
                  );
                })
              )}
            </>
          )}

          {role === 'finance' && (
            <>
              <ThemedView style={styles.statRow} type="transparent">
                <StatTile label={t('home.outstanding')} value={`${formatMoney(outstandingTotal, locale)} (${outstandingCount})`} />
              </ThemedView>

              <SectionHeading text={t('home.mostOverdue')} />
              {mostOverdue.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                  {t('home.noOverdueInvoices')}
                </ThemedText>
              ) : (
                mostOverdue.map((inv) => (
                  <ThemedView key={inv.id} style={[styles.invoiceRow, { backgroundColor: theme.card }, styles.cardShadow]}>
                    <ThemedText type="smallBold">{inv.invoice_number}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatMoney(Number(inv.amount), locale)} · {t('home.due')} {inv.due_date ?? '—'}
                    </ThemedText>
                  </ThemedView>
                ))
              )}

              <SectionHeading text={t('home.recentPayments')} />
              {recentPayments.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                  {t('home.noRecentPayments')}
                </ThemedText>
              ) : (
                recentPayments.map((inv) => (
                  <ThemedView key={inv.id} style={[styles.invoiceRow, { backgroundColor: theme.card }, styles.cardShadow]}>
                    <ThemedText type="smallBold">{inv.invoice_number}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatMoney(Number(inv.amount), locale)} · {inv.paid_at ? formatDate(inv.paid_at, locale) : '—'}
                    </ThemedText>
                  </ThemedView>
                ))
              )}
            </>
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
  scrollContent: { paddingBottom: Spacing.six, gap: Spacing.two },
  heading: { fontSize: 24, marginBottom: Spacing.two },
  error: { color: StatusColors.danger, marginBottom: Spacing.two },
  sectionHeading: { fontSize: 18, marginTop: Spacing.three, marginBottom: Spacing.one },
  empty: { paddingVertical: Spacing.two },
  statRow: { flexDirection: 'row', gap: Spacing.two },
  statTile: { flex: 1, borderRadius: 16, padding: Spacing.three, gap: 2, alignItems: 'flex-start' },
  statValue: { fontSize: 28, lineHeight: 32 },
  card: { borderRadius: 16, padding: Spacing.three, gap: 4, marginBottom: Spacing.two },
  cardShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontWeight: '700' },
  routeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  routeText: { fontWeight: '600' },
  routeArrow: { fontSize: 13 },
  invoiceRow: { borderRadius: 16, padding: Spacing.three, gap: 4, marginBottom: Spacing.two },
});
