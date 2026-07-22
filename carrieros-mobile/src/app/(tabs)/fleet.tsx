// src/app/(tabs)/fleet.tsx
// "Fleet" tab (Owner/Solo/Dispatcher) — read-only vehicle list. Vehicle
// creation/editing stays web-only (existing documented decision), so this
// screen has no add/edit UI.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, StatusColors, VEHICLE_STATUS_PILL } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';

const PAGE_BACKGROUND = StatusColors.grayLight;

type VehicleRow = {
  id: number;
  vehicle_number: string | null;
  nickname: string;
  status: string;
};

export default function FleetScreen() {
  const theme = useTheme();
  const { t } = useLocale();
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('vehicles')
      .select('id, vehicle_number, nickname, status')
      .eq('is_active', true)
      .order('vehicle_number', { ascending: true });
    setVehicles((data as VehicleRow[] | null) ?? []);
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
    <ThemedView style={[styles.container, { backgroundColor: PAGE_BACKGROUND }]}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.heading}>{t('fleet.title')}</ThemedText>
        <FlatList
          data={vehicles}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {t('fleet.empty')}
            </ThemedText>
          }
          renderItem={({ item }) => {
            const pill = VEHICLE_STATUS_PILL[item.status] ?? VEHICLE_STATUS_PILL.idle;
            const statusLabel =
              item.status === 'active'
                ? t('home.statusActive')
                : item.status === 'in_shop'
                  ? t('home.statusInShop')
                  : t('home.statusIdle');
            return (
              <ThemedView style={[styles.card, { backgroundColor: theme.background }, styles.cardShadow]}>
                <ThemedView style={styles.cardHeader} type="background">
                  <ThemedText type="smallBold">{item.nickname}</ThemedText>
                  <ThemedView style={[styles.statusPill, { backgroundColor: pill.bg }]}>
                    <ThemedText type="small" style={[styles.statusPillText, { color: pill.text }]}>
                      {statusLabel}
                    </ThemedText>
                  </ThemedView>
                </ThemedView>
                {item.vehicle_number ? (
                  <ThemedText type="small" themeColor="textSecondary">{item.vehicle_number}</ThemedText>
                ) : null}
              </ThemedView>
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
