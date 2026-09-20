import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, LOAD_STATUS_PILL, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import { useLocale } from '@/hooks/use-locale';
import { apiClient } from '@/lib/api-client';
import { supabase } from '@/lib/supabase'; // auth only (sign-out); data goes through apiClient
import { useLiveRefresh } from '@/lib/generated/live-refresh';

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
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!session?.user.id) return;
    setError('');

    // Both calls go through the shared API. `rate` and the driver-only
    // restriction are decided server-side, so this screen no longer has to know
    // about loads_driver_view.
    const [me, loadsResult] = await Promise.all([
      apiClient.http.GET('/api/v1/me'),
      apiClient.http.GET('/api/v1/loads'),
    ]);

    setRole((me.data?.role ?? 'solo') as Role);
    const loadsErr = loadsResult.error;
    const data = loadsResult.data?.loads;

    if (loadsErr) setError(t('common.loadErrorRetry'));
    setLoads((data as LoadRow[]) ?? []);
  }, [session?.user.id, t]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // Backend changes (dispatcher assigns a load, status moves) update this list
  // without a pull-to-refresh.
  useLiveRefresh(apiClient, ['loads'], () => void load());

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
    // Page surface comes from the theme (`background`), with cards on
    // `card` above it. This used to be a screen-local `#f4f6f9` literal
    // back when mobile was light-only; that hardcoded tint stayed grey in
    // dark mode, so it now goes through the token like every other screen.
    <ThemedView style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.headerRow} type="transparent">
          <ThemedText type="title" style={styles.heading}>
            {role === 'driver' ? t('loads.titleDriver') : t('loads.titleOffice')}
          </ThemedText>
          {(role === 'owner' || role === 'solo' || role === 'dispatcher') && (
            <ThemedView style={styles.newLoadButtonGroup} type="transparent">
              <Pressable onPress={() => router.push('/load/new-from-photo')} style={styles.scanButton}>
                <ThemedText type="smallBold" themeColor="text">{t('loadNew.scanAction')}</ThemedText>
              </Pressable>
              <Pressable onPress={() => router.push('/load/new')} style={styles.newLoadButton}>
                <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('loadNew.newLoadAction')}</ThemedText>
              </Pressable>
            </ThemedView>
          )}
        </ThemedView>

        <FlatList
          data={loads}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <ThemedText
              type="small"
              themeColor={error ? undefined : 'textSecondary'}
              style={[styles.empty, error ? styles.error : undefined]}
            >
              {error || t('loads.empty')}
            </ThemedText>
          }
          renderItem={({ item }) => {
            const pill = LOAD_STATUS_PILL[item.status] ?? LOAD_STATUS_PILL.draft;
            const statusLabel = (STATUS_KEYS as readonly string[]).includes(item.status)
              ? t(`loads.status.${item.status}`)
              : item.status;

            return (
              <Pressable
                style={[styles.card, { backgroundColor: theme.card }, styles.cardShadow]}
                onPress={() => router.push({ pathname: '/load/[id]', params: { id: String(item.id) } })}
              >
                <ThemedView style={styles.cardHeader} type="transparent">
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
                <ThemedView style={styles.routeRow} type="transparent">
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.three },
  heading: { fontSize: 24 },
  newLoadButtonGroup: { flexDirection: 'row', gap: Spacing.two },
  scanButton: { borderWidth: 1, borderColor: BrandColors.orange, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  newLoadButton: { backgroundColor: BrandColors.orange, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  listContent: { gap: Spacing.two, paddingBottom: Spacing.four },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  // Matches load/[id].tsx's error text color.
  error: { color: StatusColors.danger },
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
