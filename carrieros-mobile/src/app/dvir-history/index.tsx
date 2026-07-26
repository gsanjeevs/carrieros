// src/app/dvir-history/index.tsx
// DVIR history hub — audit gap: mobile had a submission flow (dvir/[loadId])
// but no way to look back at past inspections. Standalone route (outside the
// (tabs) group), pushed from the driver's DVIR tab and from Owner/Solo's More
// screen, same pattern as ifta-report/index.tsx.
//
// Read-only. carrier_dvir_select (schema.sql) is org-wide with no role
// restriction, so drivers could technically see the whole fleet's
// inspections — this screen deliberately narrows to "my own" for drivers via
// a client-side filter on driver_id, and shows the full org list for
// owner/solo/dispatcher/finance, matching how settlements/index.tsx splits
// "mine" vs. "everyone's" for the same roles.
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
import { supabase } from '@/lib/supabase';
import { resolveSubmitter } from '@/lib/submitter';
const GREEN = '#16a34a';
const AMBER = '#d97706';
const BUCKET = 'documents';

type DefectRow = { id: number; area: string; description: string | null; severity: 'minor' | 'major' };
type InspectionRow = {
  id: number;
  type: 'pre_trip' | 'post_trip';
  condition: 'satisfactory' | 'defects_noted';
  odometer: number | null;
  signature_url: string | null;
  submitted_at: string;
  vehicles: { vehicle_number: string | null; nickname: string } | null;
  drivers: { profiles: { first_name: string | null; last_name: string | null } | null } | null;
  dvir_defects: DefectRow[];
};

export default function DvirHistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const { t, locale } = useLocale();

  const [rows, setRows] = useState<InspectionRow[]>([]);
  const [signatureUrls, setSignatureUrls] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!session?.user.id) return;
    setError('');
    const submitter = await resolveSubmitter(session.user.id);
    if (!submitter) return;

    let query = supabase
      .from('dvir_inspections')
      .select(
        'id, type, condition, odometer, signature_url, submitted_at, vehicles(vehicle_number, nickname), drivers(profiles(first_name, last_name)), dvir_defects(id, area, description, severity)'
      )
      .eq('carrier_org_id', submitter.carrierOrgId)
      .order('submitted_at', { ascending: false })
      .limit(50);

    if (submitter.role === 'driver' && submitter.driverId) {
      query = query.eq('driver_id', submitter.driverId);
    }

    const { data, error: queryErr } = await query;
    if (queryErr) {
      console.error('[dvir-history] list query failed:', queryErr.message);
      setError(t('common.loadErrorRetry'));
    }
    const inspections = (data as unknown as InspectionRow[] | null) ?? [];
    setRows(inspections);

    const withSignature = inspections.filter((i) => i.signature_url);
    if (withSignature.length > 0) {
      const entries = await Promise.all(
        withSignature.map(async (i) => {
          const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(i.signature_url!, 3600);
          return [i.id, signed?.signedUrl] as const;
        })
      );
      setSignatureUrls(new Map(entries.filter((e): e is [number, string] => !!e[1])));
    } else {
      setSignatureUrls(new Map());
    }
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
            const hasDefects = item.condition === 'defects_noted' || item.dvir_defects.length > 0;
            const driverName = item.drivers?.profiles
              ? [item.drivers.profiles.first_name, item.drivers.profiles.last_name].filter(Boolean).join(' ')
              : null;
            const vehicleLabel = item.vehicles?.nickname ?? item.vehicles?.vehicle_number ?? null;
            const signatureUrl = signatureUrls.get(item.id);
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
                    {new Date(item.submitted_at).toLocaleDateString(locale)}
                  </ThemedText>
                </ThemedView>

                <ThemedText type="small" themeColor="textSecondary">
                  {[driverName, vehicleLabel, item.odometer != null ? `${item.odometer.toLocaleString()} mi` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </ThemedText>

                {hasDefects && item.dvir_defects.length > 0 && (
                  <ThemedView style={styles.defectList} type="transparent">
                    {item.dvir_defects.map((d) => (
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
