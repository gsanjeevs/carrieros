import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';

type Role = 'owner' | 'solo' | 'driver' | 'dispatcher' | 'finance';

// Rate is intentionally never selected for the driver role — this must
// query loads_driver_view (which omits the column entirely), not loads.
// See decisions.md BR-1 / carrier_os schema §4.3.
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

// Status keys map 1:1 to src/messages/*.json loads.status.* — see t() calls
// below rather than a hardcoded label map.
const STATUS_KEYS = [
  'draft',
  'scheduled',
  'dispatched',
  'picked_up',
  'in_transit',
  'delivered',
  'invoiced',
  'paid',
] as const;

export default function MyLoadsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const { t } = useLocale();
  const [role, setRole] = useState<Role | null>(null);
  const [loads, setLoads] = useState<LoadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session?.user.id) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();

    const currentRole = (profile?.role ?? 'solo') as Role;
    setRole(currentRole);

    const cols = 'id, load_number, status, customer_name_raw, pickup_city, pickup_state, delivery_city, delivery_state';
    const { data } =
      currentRole === 'driver'
        ? await supabase.from('loads_driver_view').select(cols).order('created_at', { ascending: false })
        : await supabase.from('loads').select(cols).order('created_at', { ascending: false });

    setLoads((data as LoadRow[]) ?? []);
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
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.heading}>
          {role === 'driver' ? t('loads.titleDriver') : t('loads.titleOffice')}
        </ThemedText>

        <FlatList
          data={loads}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {t('loads.empty')}
            </ThemedText>
          }
          renderItem={({ item }) => (
            <Pressable
              style={[styles.card, { backgroundColor: theme.backgroundElement }]}
              onPress={() => router.push({ pathname: '/load/[id]', params: { id: String(item.id) } })}
            >
              <ThemedView style={styles.cardHeader} type="backgroundElement">
                <ThemedText type="smallBold">{item.load_number}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {(STATUS_KEYS as readonly string[]).includes(item.status)
                    ? t(`loads.status.${item.status}`)
                    : item.status}
                </ThemedText>
              </ThemedView>
              <ThemedText type="small" themeColor="textSecondary">
                {item.customer_name_raw ?? t('common.unknownCustomer')}
              </ThemedText>
              <ThemedText type="default">
                {item.pickup_city ?? '—'}{item.pickup_state ? `, ${item.pickup_state}` : ''}
                {'  →  '}
                {item.delivery_city ?? '—'}{item.delivery_state ? `, ${item.delivery_state}` : ''}
              </ThemedText>
            </Pressable>
          )}
          ListFooterComponent={
            <Pressable onPress={() => supabase.auth.signOut()} style={styles.signOut}>
              <ThemedText type="link" themeColor="textSecondary">{t('loads.signOut')}</ThemedText>
            </Pressable>
          }
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
  signOut: { alignItems: 'center', paddingVertical: Spacing.four, marginTop: Spacing.three },
  card: { borderRadius: 12, padding: Spacing.three, gap: 4 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between' },
});
