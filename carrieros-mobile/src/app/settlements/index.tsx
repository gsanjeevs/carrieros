// src/app/settlements/index.tsx
// Settlements — view-only. Owner/solo/finance see the full org list; driver
// sees only their own rows. GET /api/v1/settlements does this scoping
// server-side (driver_own_settlements_select RLS-equivalent, same as web's
// settlements/page.tsx), and returns `entitled: false` instead of rows when
// staff lack the driver_settlements Growth+ entitlement — same "upgrade
// prompt instead of the list" shape this screen already rendered.
// "Run Settlement" stays web-only — it's a deliberate, infrequent,
// higher-stakes compute-then-write action best done with full context, not
// from a phone.
//
// "Staff" is no longer a hand-written role array here: it comes from the
// generated `settlements_manage` capability (src/lib/generated/role-capabilities.ts,
// sourced from the role_capabilities table), whose holders are exactly
// owner/solo/finance — the same set the old STAFF_ROLES literal listed.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Figure } from '@/components/figure-text';
import { BrandColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { useProfileRole } from '@/hooks/use-profile-role';
import { apiClient } from '@/lib/api-client';
import { formatMoney } from '@/lib/format-money';
import { roleHasCapability } from '@/lib/generated/role-capabilities';
import { haptics } from '@/lib/haptics';

type SettlementRow = {
  id: number;
  pay_method: string;
  gross_revenue: number | null;
  net_pay: number | null;
  payment_status: string;
  period_start: string;
  period_end: string;
  driver: { driver_number: string | null; first_name: string | null; last_name: string | null } | null;
};

export default function SettlementsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, locale } = useLocale();
  const { role, loading: roleLoading } = useProfileRole();

  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [entitled, setEntitled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Long-press-a-dollar-amount-to-copy (spec §3.1) -- a driver relaying net
  // pay over a phone call is a real use case worth the one-line addition.
  // copiedId briefly labels which row was just copied instead of a global
  // Toast component (none exists in this app yet).
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const isStaff = roleHasCapability(role, 'settlements_manage');

  const load = useCallback(async () => {
    const { data } = await apiClient.http.GET('/api/v1/settlements');
    setEntitled(data?.entitled ?? true);
    setSettlements((data?.settlements as unknown as SettlementRow[] | undefined) ?? []);
  }, []);

  useEffect(() => {
    if (roleLoading) return;
    load().finally(() => setLoading(false));
  }, [roleLoading, load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function copyAmount(id: number, amount: number) {
    await Clipboard.setStringAsync(formatMoney(amount, locale));
    await haptics.light();
    setCopiedId(id);
    setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
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
                {t('settlements.empty')}
              </ThemedText>
            }
            renderItem={({ item }) => {
              const driverName = item.driver
                ? [item.driver.first_name, item.driver.last_name].filter(Boolean).join(' ') || item.driver.driver_number
                : undefined;
              return (
                <ThemedView style={[styles.card, { backgroundColor: theme.card }, styles.cardShadow]}>
                  <ThemedView type="transparent" style={styles.rowBetween}>
                    <ThemedText type="smallBold">{driverName || '—'}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{t(`settlements.status_${item.payment_status}`)}</ThemedText>
                  </ThemedView>
                  <ThemedText type="small" themeColor="textSecondary">
                    {item.period_start} – {item.period_end}
                  </ThemedText>
                  {item.net_pay != null ? (
                    <Pressable onLongPress={() => copyAmount(item.id, item.net_pay!)} delayLongPress={400}>
                      <Figure type="default">{formatMoney(item.net_pay, locale)}</Figure>
                      {copiedId === item.id && (
                        <ThemedText type="small" themeColor="textSecondary">{t('settlements.copied')}</ThemedText>
                      )}
                    </Pressable>
                  ) : (
                    <ThemedText type="default">—</ThemedText>
                  )}
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
