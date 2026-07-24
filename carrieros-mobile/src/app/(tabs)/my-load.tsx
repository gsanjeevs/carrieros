// src/app/(tabs)/my-load.tsx
// Driver's tab 1 ("My Load") — the driver-role equivalent of Home. A single
// hero card for the current active load (not a list — drivers only ever
// have one active load at a time), a "next load" preview, and compliance
// chips for their own CDL/med-cert expiry.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LOAD_STATUS_PILL, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';

const PAGE_BACKGROUND = StatusColors.grayLight;
const ACTIVE_LOAD_STATUSES = ['dispatched', 'picked_up', 'in_transit'];
// Compliance chip thresholds — 30 days mirrors get_exceptions()'s own CDL
// "expiring soon" horizon (see supabase/schema/schema.sql), reused here for
// the same visual convention.
const EXPIRY_WARNING_DAYS = 30;

type LoadRow = {
  id: number;
  load_number: string;
  status: string;
  customer_name_raw: string | null;
  pickup_city: string | null;
  pickup_state: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  pickup_date: string | null;
};

type ComplianceStatus = 'expired' | 'expiring' | 'valid' | 'none';

function complianceStatus(dateStr: string | null): ComplianceStatus {
  if (!dateStr) return 'none';
  const days = (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (days < 0) return 'expired';
  if (days <= EXPIRY_WARNING_DAYS) return 'expiring';
  return 'valid';
}

function ComplianceChip({ label, status, t }: { label: string; status: ComplianceStatus; t: (k: string) => string }) {
  const colors: Record<ComplianceStatus, { bg: string; text: string }> = {
    expired: { bg: StatusColors.dangerLight, text: StatusColors.dangerDark },
    expiring: { bg: StatusColors.warningLight, text: StatusColors.warningDark },
    valid: { bg: StatusColors.successLight, text: StatusColors.successDark },
    none: { bg: StatusColors.grayLight, text: StatusColors.gray },
  };
  const statusLabel =
    status === 'expired'
      ? t('myLoadTab.expired')
      : status === 'expiring'
        ? t('myLoadTab.expiringSoon')
        : status === 'valid'
          ? t('myLoadTab.valid')
          : t('myLoadTab.noExpiry');
  const c = colors[status];
  return (
    <ThemedView style={[styles.chip, { backgroundColor: c.bg }]}>
      <ThemedText type="small" style={[styles.chipText, { color: c.text }]}>
        {label}: {statusLabel}
      </ThemedText>
    </ThemedView>
  );
}

export default function MyLoadScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const { t } = useLocale();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeLoad, setActiveLoad] = useState<LoadRow | null>(null);
  const [nextLoad, setNextLoad] = useState<LoadRow | null>(null);
  const [cdlExpiry, setCdlExpiry] = useState<string | null>(null);
  const [medCertExpiry, setMedCertExpiry] = useState<string | null>(null);
  const [needsPreTripDvir, setNeedsPreTripDvir] = useState(false);

  const load = useCallback(async () => {
    if (!session?.user.id) return;

    const { data: driver } = await supabase
      .from('drivers')
      .select('id, cdl_expiry, med_cert_expiry')
      .eq('profile_id', session.user.id)
      .single();

    if (!driver) return;
    setCdlExpiry(driver.cdl_expiry);
    setMedCertExpiry(driver.med_cert_expiry);

    const cols = 'id, load_number, status, customer_name_raw, pickup_city, pickup_state, delivery_city, delivery_state, pickup_date';

    const [{ data: active }, { data: next }] = await Promise.all([
      supabase
        .from('loads_driver_view')
        .select(cols)
        .eq('driver_id', driver.id)
        .in('status', ACTIVE_LOAD_STATUSES)
        .order('created_at', { ascending: false })
        .maybeSingle(),
      supabase
        .from('loads_driver_view')
        .select(cols)
        .eq('driver_id', driver.id)
        .eq('status', 'scheduled')
        .order('pickup_date', { ascending: true })
        .maybeSingle(),
    ]);

    setActiveLoad((active as LoadRow | null) ?? null);
    setNextLoad((next as LoadRow | null) ?? null);

    // Pre-trip DVIR nudge (audit gap) — only for a load that hasn't left yet
    // (dispatched, not already picked_up/in_transit) and only if no pre_trip
    // inspection has been filed for it yet.
    if (active && active.status === 'dispatched' && active.id != null) {
      const { data: existingDvir } = await supabase
        .from('dvir_inspections')
        .select('id')
        .eq('load_id', active.id)
        .eq('type', 'pre_trip')
        .maybeSingle();
      setNeedsPreTripDvir(!existingDvir);
    } else {
      setNeedsPreTripDvir(false);
    }
  }, [session?.user.id]);

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
    <ThemedView style={[styles.container, { backgroundColor: PAGE_BACKGROUND }]}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <ThemedText type="title" style={styles.heading}>{t('myLoadTab.heading')}</ThemedText>

          {activeLoad ? (
            <Pressable
              style={[styles.heroCard, { backgroundColor: theme.background }, styles.cardShadow]}
              onPress={() => router.push({ pathname: '/load/[id]', params: { id: String(activeLoad.id) } })}
            >
              <ThemedView style={styles.cardHeader} type="background">
                <ThemedText type="subtitle">{activeLoad.load_number}</ThemedText>
                <ThemedView
                  style={[styles.statusPill, { backgroundColor: (LOAD_STATUS_PILL[activeLoad.status] ?? LOAD_STATUS_PILL.draft).bg }]}
                >
                  <ThemedText
                    type="small"
                    style={[styles.statusPillText, { color: (LOAD_STATUS_PILL[activeLoad.status] ?? LOAD_STATUS_PILL.draft).text }]}
                  >
                    {t(`loads.status.${activeLoad.status}`)}
                  </ThemedText>
                </ThemedView>
              </ThemedView>
              <ThemedText type="small" themeColor="textSecondary">
                {activeLoad.customer_name_raw ?? t('common.unknownCustomer')}
              </ThemedText>
              <ThemedView style={styles.routeRow} type="background">
                <ThemedText type="default" style={styles.routeText}>
                  {activeLoad.pickup_city ?? '—'}{activeLoad.pickup_state ? `, ${activeLoad.pickup_state}` : ''}
                </ThemedText>
                <ThemedText type="default" themeColor="textSecondary" style={styles.routeArrow}>{'  →  '}</ThemedText>
                <ThemedText type="default" style={styles.routeText}>
                  {activeLoad.delivery_city ?? '—'}{activeLoad.delivery_state ? `, ${activeLoad.delivery_state}` : ''}
                </ThemedText>
              </ThemedView>
            </Pressable>
          ) : (
            <ThemedView style={[styles.heroCard, { backgroundColor: theme.background }, styles.cardShadow]}>
              <ThemedText type="default" style={styles.emptyTitle}>{t('myLoadTab.noActiveLoad')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t('myLoadTab.noActiveLoadDetail')}</ThemedText>
            </ThemedView>
          )}

          {needsPreTripDvir && activeLoad && (
            <Pressable
              style={styles.dvirNudge}
              onPress={() => router.push({ pathname: '/dvir/[loadId]', params: { loadId: String(activeLoad.id), type: 'pre_trip' } })}
            >
              <ThemedText type="small" style={styles.dvirNudgeText}>{t('myLoadTab.preTripDvirNudge')}</ThemedText>
              <ThemedText type="smallBold" style={styles.dvirNudgeText}>{'›'}</ThemedText>
            </Pressable>
          )}

          <ThemedText type="subtitle" style={styles.sectionHeading}>{t('myLoadTab.nextLoad')}</ThemedText>
          {nextLoad ? (
            <Pressable
              style={[styles.card, { backgroundColor: theme.background }, styles.cardShadow]}
              onPress={() => router.push({ pathname: '/load/[id]', params: { id: String(nextLoad.id) } })}
            >
              <ThemedText type="smallBold">{nextLoad.load_number}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {nextLoad.pickup_city ?? '—'}{nextLoad.pickup_state ? `, ${nextLoad.pickup_state}` : ''}
                {nextLoad.pickup_date ? `  ·  ${nextLoad.pickup_date}` : ''}
              </ThemedText>
            </Pressable>
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {t('myLoadTab.noNextLoad')}
            </ThemedText>
          )}

          <ThemedText type="subtitle" style={styles.sectionHeading}>{t('myLoadTab.compliance')}</ThemedText>
          <ThemedView style={styles.chipRow} type="background">
            <ComplianceChip label={t('myLoadTab.cdl')} status={complianceStatus(cdlExpiry)} t={t} />
            <ComplianceChip label={t('myLoadTab.medCert')} status={complianceStatus(medCertExpiry)} t={t} />
          </ThemedView>
          {(!cdlExpiry || !medCertExpiry) && (
            <Pressable onPress={() => router.push('/driver-profile')} style={styles.completeProfileLink}>
              <ThemedText type="link">{t('driverProfile.completeProfileNudge')}</ThemedText>
            </Pressable>
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
  sectionHeading: { fontSize: 18, marginTop: Spacing.three, marginBottom: Spacing.one },
  empty: { paddingVertical: Spacing.two },
  emptyTitle: { fontWeight: '700', marginBottom: 4 },
  heroCard: { borderRadius: 16, padding: Spacing.four, gap: 6 },
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
  routeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  routeText: { fontWeight: '600' },
  routeArrow: { fontSize: 13 },
  chipRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  chipText: { fontWeight: '700' },
  completeProfileLink: { marginTop: Spacing.two },
  dvirNudge: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f9731622',
    borderWidth: 1,
    borderColor: '#f97316',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.two,
  },
  dvirNudgeText: { color: '#f97316' },
});
