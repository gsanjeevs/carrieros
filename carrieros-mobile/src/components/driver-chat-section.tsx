// src/components/driver-chat-section.tsx
// Driver <-> back-office chat for a load (audit gap #13, Growth+
// driver_chat feature). Reads driver_messages directly (RLS-scoped, same
// as PodSection's own direct-table pattern); sending and translating go
// through carrieros-web's API routes via src/lib/api.ts's bearer-token
// fetch, since that's where the role/tier gating and language-inheritance
// logic already lives (see that route's own header comment) — not
// duplicated here.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { apiClient } from '@/lib/api-client';
import { apiFetch } from '@/lib/api';

const ORANGE = BrandColors.orange;

type MessageRow = {
  id: number;
  sender_id: string | null;
  body: string;
  original_language: string | null;
  sent_at: string;
  read_at: string | null;
};

export function DriverChatSection({ loadId }: { loadId: number }) {
  const { t, locale } = useLocale();
  const theme = useTheme();
  const { session } = useSession();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [translated, setTranslated] = useState<Record<number, string>>({});
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('driver_messages')
      .select('id, sender_id, body, original_language, sent_at, read_at')
      .eq('load_id', loadId)
      .order('sent_at', { ascending: true });
    const rows = (data as MessageRow[]) ?? [];
    setMessages(rows);

    // Mark-as-read (audit gap: driver_messages.read_at existed but nothing
    // ever set it) — same rule as web's DriverMessageThread.tsx.
    const unreadIds = rows.filter((m) => m.sender_id !== session?.user.id && !m.read_at).map((m) => m.id);
    if (unreadIds.length > 0) {
      // Best effort: a read receipt that fails to send must never break the chat. The server
      // only marks other people's messages on THIS load, so the ids are a request, not an authority.
      try {
        await apiClient.http.POST('/api/v1/loads/{id}/messages/read', {
          params: { path: { id: loadId } },
          body: { message_ids: unreadIds },
        });
      } catch {
        /* retried on the next load() */
      }
    }
  }, [loadId, session?.user.id]);

  useEffect(() => {
    load();

    // Polling-gap audit fix (matches web's DriverMessageThread.tsx) — a
    // Postgres Changes subscription scoped to this load_id, RLS-protected
    // same as the direct-table read above, instead of a 5s poll interval.
    const channel = supabase
      .channel(`driver-messages-load-${loadId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'driver_messages', filter: `load_id=eq.${loadId}` },
        (payload) => {
          const row = payload.new as MessageRow;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, loadId]);

  async function send() {
    if (!draft.trim()) return;
    setSending(true);
    setError('');
    try {
      const res = await apiFetch('/api/driver-messages', {
        method: 'POST',
        body: JSON.stringify({ load_id: loadId, body: draft.trim() }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error_code === 'TIER_UPGRADE_REQUIRED' ? t('chat.upgradeRequired') : t('chat.sendFailed'));
        return;
      }
      setDraft('');
      await load();
    } catch {
      setError(t('chat.sendFailed'));
    } finally {
      setSending(false);
    }
  }

  async function translate(messageId: number) {
    try {
      const res = await apiFetch(`/api/driver-messages/${messageId}/translate`, {
        method: 'POST',
        body: JSON.stringify({ target_language: locale }),
      });
      if (res.ok) {
        const j = await res.json();
        setTranslated((prev) => ({ ...prev, [messageId]: j.translated_body }));
      }
    } catch {
      // Translation is a nice-to-have on top of an already-delivered
      // message — a failure here shouldn't surface as a blocking error.
    }
  }

  return (
    <ThemedView type="backgroundElement" style={styles.section}>
      <ThemedText type="smallBold" style={styles.heading}>{t('chat.title')}</ThemedText>

      <ScrollView ref={scrollRef} style={styles.messageList} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
        {messages.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">{t('chat.noMessages')}</ThemedText>
        ) : (
          messages.map((m) => {
            // sender_id NULL = system message (schema.sql's own column
            // comment) — centered/muted, not a chat bubble from either side.
            if (m.sender_id === null) {
              return (
                <ThemedView key={m.id} type="transparent" style={styles.systemMessageRow}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.systemMessageText}>{m.body}</ThemedText>
                </ThemedView>
              );
            }
            const isMine = m.sender_id === session?.user.id;
            const showTranslate = m.original_language && m.original_language !== locale;
            return (
              <ThemedView
                key={m.id}
                type="transparent"
                style={[styles.bubbleRow, { justifyContent: isMine ? 'flex-end' : 'flex-start' }]}
              >
                {/* Own bubbles are brand orange in both themes, so their text
                    stays literal white. The counterpart's bubble is a plain
                    surface and must follow the theme. */}
                <ThemedView style={[styles.bubble, { backgroundColor: isMine ? ORANGE : theme.backgroundElement }]}>
                  <ThemedText type="small" style={{ color: isMine ? '#ffffff' : theme.text }}>
                    {translated[m.id] ?? m.body}
                  </ThemedText>
                  {showTranslate && !translated[m.id] && (
                    <Pressable onPress={() => translate(m.id)}>
                      <ThemedText type="small" style={{ color: isMine ? '#ffffff' : theme.text, textDecorationLine: 'underline', marginTop: 2 }}>
                        {t('chat.translate')}
                      </ThemedText>
                    </Pressable>
                  )}
                </ThemedView>
              </ThemedView>
            );
          })
        )}
      </ScrollView>

      {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

      <ThemedView style={styles.inputRow} type="transparent">
        <TextInput
          style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          placeholder={t('chat.placeholder')}
          placeholderTextColor={theme.textMuted}
          value={draft}
          onChangeText={setDraft}
          editable={!sending}
        />
        <Pressable style={[styles.sendButton, sending && styles.sendButtonDisabled]} onPress={send} disabled={sending}>
          {sending ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('chat.send')}</ThemedText>}
        </Pressable>
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two, marginBottom: Spacing.two },
  heading: { marginBottom: 2 },
  messageList: { maxHeight: 220 },
  bubbleRow: { flexDirection: 'row', marginVertical: 3 },
  systemMessageRow: { alignItems: 'center', marginVertical: 3 },
  systemMessageText: { fontStyle: 'italic' },
  bubble: { maxWidth: '80%', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  inputRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sendButton: { backgroundColor: ORANGE, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  sendButtonDisabled: { opacity: 0.5 },
  error: { color: StatusColors.danger },
});
