// src/app/dvir-history/index.tsx
// DVIR history hub — audit gap: mobile had a submission flow (dvir/[loadId])
// but no way to look back at past inspections. Standalone route (outside the
// (tabs) group), pushed from the driver's DVIR tab and from Owner/Solo's More
// screen, same pattern as ifta-report/index.tsx.
//
// Read-only. carrier_dvir_select (schema.sql) is org-wide with no role
// restriction, so drivers could technically see the whole fleet's
// inspections — GET /api/v1/dvir-inspections narrows to "my own" for a
// driver actor server-side (the same narrowing this screen used to do
// client-side) and returns the full org list for owner/solo/dispatcher/
// finance, matching how settlements/index.tsx splits "mine" vs. "everyone's"
// for the same roles.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import { useLocale } from '@/hooks/use-locale';
import { formatDate } from '@/lib/format-date';
import { formatNumber } from '@/lib/format-number';
import { apiClient } from '@/lib/api-client';
const GREEN = '#16a34a';
const AMBER = '#d97706';

type DefectRow = { id: number; area: string; description: string | null; severity: 'minor' | 'major' | null };
type InspectionRow = {
  id: number;
  type: 'pre_trip' | 'post_trip';
  condition: 'satisfactory' | 'defects_noted';
  odometer: number | null;
  signature_url: string | null;
  submitted_at: string;
  vehicle: { vehicle_number: string | null; nickname: string } | null;
  driver_name: string | null;
  defects: DefectRow[];
};

export default function DvirHistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const { t, locale } = useLocale();

  const [rows, setRows] = useState<InspectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!session?.user.id) return;
    setError('');
    // The server already returns a signed signature URL per inspection.
    const { data, error: apiErr } = await apiClient.http.GET('/api/v1/dvir-inspections');
    if (apiErr) setError(t('common.loadErrorRetry'));
    setRows((data?.inspections as InspectionRow[] | undefined) ?? []);
  }, [session?.user.id, t]);

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
    <ThemedView style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.heading}>{t('dvirHistory.title')}</ThemedText>
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <ThemedText
              type="small"
              themeColor={error ? undefined : 'textSecondary'}
              style={[styles.empty, error ? styles.error : undefined]}
            >
              {error || t('dvirHistory.empty')}
            </ThemedText>
          }
          renderItem={({ item }) => {
            const hasDefects = item.condition === 'defects_noted' || item.defects.length > 0;
            const driverName = item.driver_name;
            const vehicleLabel = item.vehicle?.nickname ?? item.vehicle?.vehicle_number ?? null;
            const signatureUrl = item.signature_url;
            return (
              <ThemedView style={[styles.card, { backgroundColor: theme.card }, styles.cardShadow]}>
                <ThemedView style={styles.cardHeader} type="transparent">
                  <ThemedView style={styles.badgeRow} type="transparent">
                    <ThemedView style={[styles.typeBadge, { backgroundColor: theme.backgroundElement }]}>
                      <ThemedText type="small" style={{ color: theme.text }}>
                        {t(item.type === 'pre_trip' ? 'dvirHistory.preTrip' : 'dvirHistory.postTrip')}
                      </ThemedText>
                    </ThemedView>
                    <ThemedView style={[styles.statusBadge, { backgroundColor: hasDefects ? `${AMBER}33` : `${GREEN}33` }]}>
                      <ThemedText type="small" style={{ color: hasDefects ? AMBER : GREEN }}>
                        {t(hasDefects ? 'dvirHistory.defectsNoted' : 'dvirHistory.satisfactory')}
                      </ThemedText>
                    </ThemedView>
                  </ThemedView>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatDate(item.submitted_at, locale)}
                  </ThemedText>
                </ThemedView>

                <ThemedText type="small" themeColor="textSecondary">
                  {[driverName, vehicleLabel, item.odometer != null ? `${formatNumber(item.odometer, locale)} mi` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </ThemedText>

                {hasDefects && item.defects.length > 0 && (
                  <ThemedView style={styles.defectList} type="transparent">
                    {item.defects.map((d) => (
                      <ThemedText key={d.id} type="small" themeColor="textSecondary">
                        {`• ${t(`dvir.areas.${d.area}` as never)}${d.description ? ` — ${d.description}` : ''}`}
                      </ThemedText>
                    ))}
                  </ThemedView>
                )}

                <ThemedView style={styles.signatureRow} type="transparent">
                  {signatureUrl ? (
                    <>
                      <Image source={{ uri: signatureUrl }} style={styles.signatureThumb} resizeMode="contain" />
                      <ThemedText type="small" themeColor="textSecondary">{t('dvirHistory.signed')}</ThemedText>
                    </>
                  ) : (
                    <ThemedText type="small" themeColor="textSecondary">{t('dvirHistory.notSigned')}</ThemedText>
                  )}
                </ThemedView>
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
  backLink: { paddingVertical: Spacing.two },
  heading: { fontSize: 24, marginBottom: Spacing.three },
  listContent: { gap: Spacing.two, paddingBottom: Spacing.four },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  error: { color: StatusColors.danger },
  card: { borderRadius: 16, padding: Spacing.three, gap: 6 },
  cardShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badgeRow: { flexDirection: 'row', gap: 6 },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  defectList: { gap: 2, marginTop: 2 },
  signatureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: 4 },
  // Fixed white, not themed: the stored signature PNG is dark ink on a
  // transparent background (see components/signature-pad.tsx), so its
  // thumbnail needs a light plate under it in BOTH themes to stay visible.
  signatureThumb: { width: 80, height: 32, backgroundColor: '#ffffff', borderRadius: 4 },
});
