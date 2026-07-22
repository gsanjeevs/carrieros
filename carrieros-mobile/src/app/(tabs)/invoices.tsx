// src/app/(tabs)/invoices.tsx
// "Invoices" tab (Finance) — read-only invoice list. No invoice-detail
// screen exists in mobile yet (out of scope per the mobile-parity plan), so
// rows are non-interactive.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { INVOICE_STATUS_PILL, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';

const PAGE_BACKGROUND = StatusColors.grayLight;

type InvoiceRow = {
  id: number;
  invoice_number: string;
  amount: number;
  status: string;
  due_date: string | null;
};

export default function InvoicesScreen() {
  const theme = useTheme();
  const { t } = useLocale();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('invoices')
      .select('id, invoice_number, amount, status, due_date')
      .order('created_at', { ascending: false });
    setInvoices((data as InvoiceRow[] | null) ?? []);
  }, []);

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
        <ThemedText type="title" style={styles.heading}>{t('invoices.title')}</ThemedText>
        <FlatList
          data={invoices}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {t('invoices.empty')}
            </ThemedText>
          }
          renderItem={({ item }) => {
            const pill = INVOICE_STATUS_PILL[item.status] ?? INVOICE_STATUS_PILL.draft;
            return (
              <ThemedView style={[styles.card, { backgroundColor: theme.background }, styles.cardShadow]}>
                <ThemedView style={styles.cardHeader} type="background">
                  <ThemedText type="smallBold">{item.invoice_number}</ThemedText>
                  <ThemedView style={[styles.statusPill, { backgroundColor: pill.bg }]}>
                    <ThemedText type="small" style={[styles.statusPillText, { color: pill.text }]}>
                      {t(`invoices.status.${item.status}`)}
                    </ThemedText>
                  </ThemedView>
                </ThemedView>
                <ThemedText type="small" themeColor="textSecondary">
                  ${Number(item.amount).toLocaleString()}
                  {item.due_date ? `  ·  ${t('invoices.due')} ${item.due_date}` : ''}
                </ThemedText>
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
});
