// src/app/(tabs)/fleet.tsx
// "Fleet" tab (Owner/Solo/Dispatcher) — read-only vehicle list. Vehicle
// creation/editing stays web-only (existing documented decision), so this
// screen has no add/edit UI.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ExceptionChip } from '@/components/exception-chip';
import { BrandColors, Spacing, StatusColors, VEHICLE_STATUS_PILL } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';
import { fetchExceptions, topExceptionByEntity, type ExceptionRow } from '@/lib/exceptions';

const PAGE_BACKGROUND = StatusColors.grayLight;

type VehicleRow = {
  id: number;
  vehicle_number: string | null;
  nickname: string;
  status: string;
  photo_path: string | null;
};

export default function FleetScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useLocale();
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [{ data }, exceptionRows] = await Promise.all([
      supabase
        .from('vehicles')
        .select('id, vehicle_number, nickname, status, photo_path')
        .eq('is_active', true)
        .order('vehicle_number', { ascending: true }),
      fetchExceptions(),
    ]);
    const rows = (data as VehicleRow[] | null) ?? [];
    setVehicles(rows);
    setExceptions(exceptionRows);

    // Photo-driven cards (mockup-22) — resolve a signed URL per vehicle
    // that actually has one; vehicles with no photo keep the plain card
    // (no fabricated placeholder image).
    const withPhoto = rows.filter((v) => v.photo_path);
    if (withPhoto.length > 0) {
      const entries = await Promise.all(
        withPhoto.map(async (v) => {
          const { data: signed } = await supabase.storage.from('documents').createSignedUrl(v.photo_path!, 3600);
          return [v.id, signed?.signedUrl] as const;
        })
      );
      setPhotoUrls(new Map(entries.filter((e): e is [number, string] => !!e[1])));
    } else {
      setPhotoUrls(new Map());
    }
  }, []);

  const topExceptionByVehicle = topExceptionByEntity(exceptions, 'vehicle');

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
        <ThemedView style={styles.headerRow} type="background">
          <ThemedText type="title" style={styles.heading}>{t('fleet.title')}</ThemedText>
          <Pressable onPress={() => router.push('/maintenance')} style={styles.maintenanceLink}>
            <ThemedText type="smallBold" style={{ color: BrandColors.orange }}>{t('fleet.maintenanceLink')}</ThemedText>
          </Pressable>
        </ThemedView>
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
            const photoUrl = photoUrls.get(item.id);
            return (
              <Pressable
                style={[styles.card, { backgroundColor: theme.background }, styles.cardShadow]}
                onPress={() => router.push({ pathname: '/vehicle/[id]', params: { id: String(item.id) } })}
              >
                {photoUrl && <Image source={{ uri: photoUrl }} style={styles.cardPhoto} resizeMode="cover" />}
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
                {(() => {
                  const topException = topExceptionByVehicle.get(item.id);
                  return topException ? <ExceptionChip item={topException} /> : null;
                })()}
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heading: { fontSize: 24, marginBottom: Spacing.three },
  maintenanceLink: { paddingVertical: Spacing.two },
  listContent: { gap: Spacing.two, paddingBottom: Spacing.four },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  card: { borderRadius: 16, padding: Spacing.three, gap: 4, overflow: 'hidden' },
  cardPhoto: { width: '100%', height: 110, borderRadius: 10, marginBottom: 4 },
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
