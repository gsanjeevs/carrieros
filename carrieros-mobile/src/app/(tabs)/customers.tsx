// src/app/(tabs)/customers.tsx
// "Customers" tab (Dispatcher tab 5, Finance tab 3) — read-only list of the
// carrier's customer orgs, via GET /api/v1/customers (customer_details +
// organizations, org scoped and gated by the customers_view capability
// server-side — see server/application/customer-query-service.ts).
import { useCallback, useEffect, useState } from 'react';
import { FlatList, ActivityIndicator, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ExceptionChip } from '@/components/exception-chip';
import { Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { apiClient } from '@/lib/api-client';
import { fetchExceptions, topExceptionByEntity, type ExceptionRow } from '@/lib/exceptions';

type CustomerRow = {
  org_id: number;
  contact_name: string | null;
  organization: { name: string; phone: string | null; email: string | null } | null;
};

export default function CustomersScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useLocale();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const [{ data, error: queryErr }, exceptionRows] = await Promise.all([
      apiClient.http.GET('/api/v1/customers'),
      fetchExceptions(),
    ]);
    if (queryErr) {
      console.error('[customers tab] list query failed:', queryErr);
      setError(t('common.loadErrorRetry'));
    }
    setCustomers((data?.customers as unknown as CustomerRow[] | undefined) ?? []);
    setExceptions(exceptionRows);
  }, [t]);

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
    <ThemedView style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.heading}>{t('customers.title')}</ThemedText>
        <FlatList
          data={customers}
          keyExtractor={(item) => String(item.org_id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <ThemedText
              type="small"
              themeColor={error ? undefined : 'textSecondary'}
              style={[styles.empty, error ? styles.error : undefined]}
            >
              {error || t('customers.empty')}
            </ThemedText>
          }
          renderItem={({ item }) => {
            const contact = item.organization?.phone ?? item.organization?.email;
            const topException = topExceptionByCustomer.get(item.org_id);
            return (
              <Pressable
                style={[styles.card, { backgroundColor: theme.card }, styles.cardShadow]}
                onPress={() => router.push({ pathname: '/customers/[id]', params: { id: String(item.org_id) } })}
              >
                <ThemedText type="smallBold">{item.organization?.name ?? t('common.unknownCustomer')}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {contact ?? t('customers.noContact')}
                </ThemedText>
                {topException ? <ExceptionChip item={topException} /> : null}
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
  heading: { fontSize: 24, marginBottom: Spacing.three },
  listContent: { gap: Spacing.two, paddingBottom: Spacing.four },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  error: { color: StatusColors.danger },
  card: { borderRadius: 16, padding: Spacing.three, gap: 4 },
  cardShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
});
