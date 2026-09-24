// src/app/messages/index.tsx
// Message Inbox — dispatcher/owner-facing aggregate view across every
// load's chat thread (GET /api/v1/messages), newest-activity-first with
// unread counts. Never existed before: every prior messaging UI
// (driver-chat-section.tsx) was scoped to one load's thread. Access is
// gated server-side to the `loads_manage` capability (owner/solo/
// dispatcher) — drivers get a 403 — so this screen mirrors that gate
// client-side with roleHasCapability, same posture as settlements/index.tsx's
// `settlements_manage` gate, and pushed from the More screen
// (settings-content.tsx) rather than a native tab, same reasoning
// customers/index.tsx documents (Owner/Solo are already at 5 tabs).
// Tapping a conversation opens that load's existing chat thread, which
// lives inline in load/[id].tsx (DriverChatSection) — there is no separate
// per-load chat route.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { formatDateTime } from '@/lib/format-date';
import { apiClient } from '@/lib/api-client';

type ConversationRow = {
  load_id: number;
  load_number: string;
  last_message_body: string;
  last_message_at: string;
  unread_count: number;
};

export default function MessagesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, locale } = useLocale();

  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const { data, error: queryErr } = await apiClient.http.GET('/api/v1/messages');
    if (queryErr) {
      console.error('[messages] inbox query failed:', queryErr);
      setError(t('common.loadErrorRetry'));
    }
    setConversations((data?.conversations as ConversationRow[] | undefined) ?? []);
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
    <ThemedView style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.heading}>{t('messages.title')}</ThemedText>
        <FlatList
          data={conversations}
          keyExtractor={(item) => String(item.load_id)}
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
            <ThemedText
              type="small"
              themeColor={error ? undefined : 'textSecondary'}
              style={[styles.empty, error ? styles.error : undefined]}
            >
              {error || t('messages.empty')}
            </ThemedText>
          }
          renderItem={({ item }) => {
            const hasUnread = item.unread_count > 0;
            return (
              <Pressable
                style={[styles.card, { backgroundColor: theme.card }, styles.cardShadow]}
                onPress={() => router.push({ pathname: '/load/[id]', params: { id: String(item.load_id) } })}
              >
                <ThemedView type="transparent" style={styles.cardHeader}>
                  <ThemedText type="smallBold">{item.load_number}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatDateTime(item.last_message_at, locale, { dateStyle: 'short', timeStyle: 'short' })}
                  </ThemedText>
                </ThemedView>
                <ThemedView type="transparent" style={styles.cardBody}>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.preview}>
                    {item.last_message_body}
                  </ThemedText>
                  {hasUnread && (
                    <ThemedView style={styles.unreadBadge}>
                      <ThemedText type="small" style={styles.unreadBadgeText}>
                        {item.unread_count > 99 ? '99+' : String(item.unread_count)}
                      </ThemedText>
                    </ThemedView>
                  )}
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
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' },
  cardBody: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two, backgroundColor: 'transparent' },
  preview: { flex: 1 },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BrandColors.orange,
  },
  unreadBadgeText: { color: '#ffffff', fontWeight: '700' },
});
