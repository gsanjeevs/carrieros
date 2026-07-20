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

// design-tokens.md "Surface / Neutral": surface.page — app background behind
// white cards. Local to this screen only, see note at the ThemedView below.
const PAGE_BACKGROUND = StatusColors.grayLight;

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
    // Page tint (surface.page, #f4f6f9) is applied here only, not through
    // theme.ts's shared `background` token — load-detail/DVIR rely on that
    // token staying white, so we don't want a global change bleeding into
    // them. See design-tokens.md "Cards (Mobile)": white cards need a
    // slightly-off-white page behind them for the shadow to read.
    <ThemedView style={[styles.container, { backgroundColor: PAGE_BACKGROUND }]}>
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
          renderItem={({ item }) => {
            const pill = LOAD_STATUS_PILL[item.status] ?? LOAD_STATUS_PILL.draft;
            const statusLabel = (STATUS_KEYS as readonly string[]).includes(item.status)
              ? t(`loads.status.${item.status}`)
              : item.status;

            return (
              <Pressable
                style={[styles.card, { backgroundColor: theme.background }, styles.cardShadow]}
                onPress={() => router.push({ pathname: '/load/[id]', params: { id: String(item.id) } })}
              >
                <ThemedView style={styles.cardHeader} type="background">
                  <ThemedText type="smallBold">{item.load_number}</ThemedText>
                  <ThemedView style={[styles.statusPill, { backgroundColor: pill.bg }]}>
                    <ThemedText type="small" style={[styles.statusPillText, { color: pill.text }]}>
                      {statusLabel}
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
                  <ThemedText type="default" themeColor="textSecondary" style={styles.routeArrow}>
                    {'  →  '}
                  </ThemedText>
                  <ThemedText type="default" style={styles.routeText}>
                    {item.delivery_city ?? '—'}{item.delivery_state ? `, ${item.delivery_state}` : ''}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            );
          }}
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
  // design-tokens.md "Cards (Mobile)": bg-white rounded-3xl p-4 mb-3 shadow-card
  card: { borderRadius: 16, padding: Spacing.three, gap: 4 },
  // shadow-card = 0 1px 6px rgba(0,0,0,0.06)
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
