// src/app/customers/index.tsx
// Customers access for Owner/Solo — pushed from the More screen
// (src/components/settings-content.tsx), not a native tab. Owner/Solo are
// already at 5 tabs (Home, Loads, Alerts, Fleet, More); a 6th tab would
// trigger iOS's native tab-bar overflow ("More") and collide with this
// app's own More tab, so this reuses (tabs)/customers.tsx's read — same
// customer_details/organizations query, same carrier_customer_select RLS
// scoping — via a stack route instead.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ExceptionChip } from '@/components/exception-chip';
import { Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';
import { fetchExceptions, topExceptionByEntity, type ExceptionRow } from '@/lib/exceptions';

type CustomerRow = {
  org_id: number;
  contact_name: string | null;
  organizations: { name: string; phone: string | null; email: string | null } | null;
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
      supabase
        .from('customer_details')
        // customer_details has two FKs to organizations (its own carrier_org_id
        // and this org_id) -- PostgREST can't infer which one without an
        // explicit hint and returns 300 Multiple Choices otherwise, which
        // silently came back as an empty list here. Same fkey name web's
        // customers/page.tsx already had to specify.
        .select('org_id, contact_name, organizations!customer_details_org_id_fkey(name, phone, email)')
        .order('org_id', { ascending: true }),
      fetchExceptions(),
    ]);
    if (queryErr) {
      console.error('[customers] list query failed:', queryErr.message);
      setError(t('common.loadErrorRetry'));
    }
    setCustomers((data as unknown as CustomerRow[] | null) ?? []);
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
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
        </Pressable>
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
            const contact = item.organizations?.phone ?? item.organizations?.email;
            const topException = topExceptionByCustomer.get(item.org_id);
            return (
              <Pressable
                style={[styles.card, { backgroundColor: theme.card }, styles.cardShadow]}
                onPress={() => router.push({ pathname: '/customers/[id]', params: { id: String(item.org_id) } })}
              >
                <ThemedText type="smallBold">{item.organizations?.name ?? t('common.unknownCustomer')}</ThemedText>
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
  backLink: { paddingVertical: Spacing.two },
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
