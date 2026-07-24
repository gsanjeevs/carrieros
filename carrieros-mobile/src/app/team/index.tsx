// src/app/team/index.tsx
// Team roster — view-only, owner/solo. Invite/role-change/remove need the
// service-role Admin Auth API (see app/api/team/[id]/route.ts on the web
// side), which must never ship to a mobile client, so those actions stay
// web-only. This reads the new GET /api/team route via apiFetch — the same
// role check and email/status computation web's team/page.tsx already does
// server-side, just exposed as JSON for mobile.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { apiFetch } from '@/lib/api';

const PAGE_BACKGROUND = StatusColors.grayLight;

type Member = {
  id: string;
  role: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  accepted: boolean;
  created_at: string | null;
};

export default function TeamScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useLocale();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await apiFetch('/api/team');
    if (res.ok) {
      setMembers(await res.json());
    } else {
      setError(t('team.loadError'));
    }
  }, [t]);

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
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.heading}>{t('team.title')}</ThemedText>

        {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

        <FlatList
          data={members}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {t('team.empty')}
            </ThemedText>
          }
          renderItem={({ item }) => {
            const name = [item.first_name, item.last_name].filter(Boolean).join(' ') || item.email || '—';
            return (
              <ThemedView style={[styles.card, { backgroundColor: theme.background }, styles.cardShadow]}>
                <ThemedText type="smallBold">{name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{item.email ?? '—'}</ThemedText>
                <ThemedView style={styles.metaRow}>
                  <ThemedText type="small" themeColor="textSecondary">{t(`team.role_${item.role}`)}</ThemedText>
                  <ThemedText type="small" style={{ color: item.accepted ? '#16a34a' : '#d97706' }}>
                    {item.accepted ? t('team.statusActive') : t('team.statusPending')}
                  </ThemedText>
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
  error: { color: '#dc2626', marginBottom: Spacing.two },
  card: { borderRadius: 16, padding: Spacing.three, gap: 4 },
  cardShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'transparent', marginTop: 4 },
});
