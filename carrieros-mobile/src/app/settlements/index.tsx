// src/app/settlements/index.tsx
// Settlements — view-only. Owner/solo/finance see the full org list; driver
// sees only their own rows (driver_own_settlements_select RLS does the
// scoping, same as web's settlements/page.tsx). "Run Settlement" stays
// web-only — it's a deliberate, infrequent, higher-stakes compute-then-write
// action best done with full context, not from a phone. Staff additionally
// need the driver_settlements Growth+ entitlement, same gate as web
// (STAFF_ROLES && !entitled shows an upgrade prompt instead of the list) —
// mirrored via src/lib/entitlements.ts's hasFeature().
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { useProfileRole } from '@/hooks/use-profile-role';
import { supabase } from '@/lib/supabase';
import { hasFeature } from '@/lib/entitlements';
const STAFF_ROLES = ['owner', 'solo', 'finance'];

type SettlementRow = {
  id: number;
  pay_method: string;
  gross_revenue: number | null;
  net_pay: number | null;
  payment_status: string;
  period_start: string;
  period_end: string;
  drivers: { driver_number: string; profiles: { first_name: string | null; last_name: string | null } | null } | null;
};

export default function SettlementsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useLocale();
  const { role, loading: roleLoading } = useProfileRole();

  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [entitled, setEntitled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isStaff = role ? STAFF_ROLES.includes(role) : false;

  const load = useCallback(async () => {
    if (isStaff) {
      const ok = await hasFeature(supabase, 'driver_settlements');
      setEntitled(ok);
      if (!ok) return;
    }
    const { data } = await supabase
      .from('driver_settlements')
      .select('id, pay_method, gross_revenue, net_pay, payment_status, period_start, period_end, drivers(driver_number, profiles(first_name, last_name))')
      .order('created_at', { ascending: false });
    setSettlements((data as unknown as SettlementRow[] | null) ?? []);
  }, [isStaff]);

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

  return (
    <ThemedView style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.heading}>{t('settlements.title')}</ThemedText>

        {isStaff && !entitled ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            {t('settlements.upgradeRequired')}
          </ThemedText>
        ) : (
          <FlatList
            data={settlements}
            keyExtractor={(item) => String(item.id)}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                {t('settlements.empty')}
              </ThemedText>
            }
            renderItem={({ item }) => {
              const driverName = item.drivers?.profiles
                ? [item.drivers.profiles.first_name, item.drivers.profiles.last_name].filter(Boolean).join(' ')
                : item.drivers?.driver_number;
              return (
                <ThemedView style={[styles.card, { backgroundColor: theme.card }, styles.cardShadow]}>
                  <ThemedView type="transparent" style={styles.rowBetween}>
                    <ThemedText type="smallBold">{driverName || '—'}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{t(`settlements.status_${item.payment_status}`)}</ThemedText>
                  </ThemedView>
                  <ThemedText type="small" themeColor="textSecondary">
                    {item.period_start} – {item.period_end}
                  </ThemedText>
                  <ThemedText type="default">
                    {item.net_pay != null ? `$${item.net_pay.toFixed(2)}` : '—'}
                  </ThemedText>
                </ThemedView>
              );
            }}
          />
        )}
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
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' },
});
