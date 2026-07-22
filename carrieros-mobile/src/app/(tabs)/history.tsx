// src/app/(tabs)/history.tsx
// Driver's tab 3 ("History") — their own past loads, most recent first.
// Includes 'cancelled' alongside delivered/invoiced/paid — it's still
// historical, and hiding cancelled loads would make the driver's record
// look incomplete.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
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
const HISTORY_STATUSES = ['delivered', 'invoiced', 'paid', 'cancelled'];

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

export default function HistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const { t } = useLocale();
  const [loads, setLoads] = useState<LoadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session?.user.id) return;
    const { data: driver } = await supabase
      .from('drivers')
      .select('id')
      .eq('profile_id', session.user.id)
      .single();
    if (!driver) return;

    const { data } = await supabase
      .from('loads_driver_view')
      .select('id, load_number, status, customer_name_raw, pickup_city, pickup_state, delivery_city, delivery_state')
      .eq('driver_id', driver.id)
      .in('status', HISTORY_STATUSES)
      .order('created_at', { ascending: false });

    setLoads((data as LoadRow[] | null) ?? []);
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
        <ThemedText type="title" style={styles.heading}>{t('history.title')}</ThemedText>
        <FlatList
          data={loads}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {t('history.empty')}
            </ThemedText>
          }
          renderItem={({ item }) => {
            const pill = LOAD_STATUS_PILL[item.status] ?? LOAD_STATUS_PILL.draft;
            return (
              <Pressable
                style={[styles.card, { backgroundColor: theme.background }, styles.cardShadow]}
                onPress={() => router.push({ pathname: '/load/[id]', params: { id: String(item.id) } })}
              >
                <ThemedView style={styles.cardHeader} type="background">
                  <ThemedText type="smallBold">{item.load_number}</ThemedText>
                  <ThemedView style={[styles.statusPill, { backgroundColor: pill.bg }]}>
                    <ThemedText type="small" style={[styles.statusPillText, { color: pill.text }]}>
                      {t(`loads.status.${item.status}`)}
                    </ThemedText>
                  </ThemedView>
                </ThemedView>
                <ThemedText type="small" themeColor="textSecondary">
                  {item.customer_name_raw ?? t('common.unknownCustomer')}
                </ThemedText>
                <ThemedView style={styles.routeRow} type="background">
                  <ThemedText type="default" style={styles.routeText}>
                    {item.pickup_city ?? '—'}{item.pickup_state ? `, ${item.pickup_state}` : ''}
                  </ThemedText>
                  <ThemedText type="default" themeColor="textSecondary" style={styles.routeArrow}>{'  →  '}</ThemedText>
                  <ThemedText type="default" style={styles.routeText}>
                    {item.delivery_city ?? '—'}{item.delivery_state ? `, ${item.delivery_state}` : ''}
                  </ThemedText>
                </ThemedView>
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
  routeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  routeText: { fontWeight: '600' },
  routeArrow: { fontSize: 13 },
});
