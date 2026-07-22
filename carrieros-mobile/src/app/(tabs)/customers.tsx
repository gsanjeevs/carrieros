// src/app/(tabs)/customers.tsx
// "Customers" tab (Dispatcher tab 5, Finance tab 3) — read-only list of the
// carrier's customer orgs. customer_details.carrier_org_id is the carrier
// scoping join (per-carrier customer roster, not a global org directory);
// RLS's carrier_customer_select policy already limits rows to this
// carrier's own customers, so no client-side org filter is needed.
import { useCallback, useEffect, useState } from 'react';
import { FlatList, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ExceptionChip } from '@/components/exception-chip';
import { Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';
import { fetchExceptions, topExceptionByEntity, type ExceptionRow } from '@/lib/exceptions';

const PAGE_BACKGROUND = StatusColors.grayLight;

type CustomerRow = {
  org_id: number;
  contact_name: string | null;
  organizations: { name: string; phone: string | null; email: string | null } | null;
};

export default function CustomersScreen() {
  const theme = useTheme();
  const { t } = useLocale();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [{ data }, exceptionRows] = await Promise.all([
      supabase
        .from('customer_details')
        .select('org_id, contact_name, organizations(name, phone, email)')
        .order('org_id', { ascending: true }),
      fetchExceptions(),
    ]);
    setCustomers((data as unknown as CustomerRow[] | null) ?? []);
    setExceptions(exceptionRows);
  }, []);

  const topExceptionByCustomer = topExceptionByEntity(exceptions, 'customer');

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
        <ThemedText type="title" style={styles.heading}>{t('customers.title')}</ThemedText>
        <FlatList
          data={customers}
          keyExtractor={(item) => String(item.org_id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {t('customers.empty')}
            </ThemedText>
          }
          renderItem={({ item }) => {
            const contact = item.organizations?.phone ?? item.organizations?.email;
            const topException = topExceptionByCustomer.get(item.org_id);
            return (
              <ThemedView style={[styles.card, { backgroundColor: theme.background }, styles.cardShadow]}>
                <ThemedText type="smallBold">{item.organizations?.name ?? t('common.unknownCustomer')}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {contact ?? t('customers.noContact')}
                </ThemedText>
                {topException ? <ExceptionChip item={topException} /> : null}
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
});
