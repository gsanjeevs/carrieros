// src/app/customers/[id].tsx
// Customer detail screen — High gap: mobile had a customers LIST but no
// detail screen at all (audit finding, mockup-07 screen 2). Read-only,
// same posture as settlements/index.tsx's mobile view-only screens; editing
// notes/tags stays web-only. Health score reuses the same
// get_customer_health_score() RPC + customer_health_score entitlement the
// web detail page already gates on.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { hasFeature } from '@/lib/entitlements';
import { formatMoney } from '@/lib/format-money';
import { supabase } from '@/lib/supabase';

type CustomerDetail = {
  org_id: number;
  customer_number: string | null;
  contact_name: string | null;
  tags: string[] | null;
  notes: string | null;
  organizations: { name: string; phone: string | null; email: string | null; city: string | null; state: string | null } | null;
};

type LoadRow = {
  id: number;
  load_number: string;
  status: string | null;
  rate: number | null;
  delivery_date: string | null;
};

function healthColor(score: number): string {
  if (score >= 80) return '#16a34a';
  if (score >= 50) return '#f59e0b';
  return '#f43f5e';
}

export default function CustomerDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, locale } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loads, setLoads] = useState<LoadRow[]>([]);
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const orgId = Number(id);

    const [{ data: customerData }, { data: loadsData }, entitled] = await Promise.all([
      supabase
        .from('customer_details')
        // See customers/index.tsx's comment — customer_details has two FKs
        // to organizations, so this embed needs the explicit fkey hint or
        // PostgREST returns an ambiguous-relationship error.
        .select('org_id, customer_number, contact_name, tags, notes, organizations!customer_details_org_id_fkey(name, phone, email, city, state)')
        .eq('org_id', orgId)
        .single(),
      supabase
        .from('loads')
        .select('id, load_number, status, rate, delivery_date')
        .eq('customer_org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(10),
      hasFeature(supabase, 'customer_health_score'),
    ]);

    setCustomer(customerData as unknown as CustomerDetail);
    setLoads(loadsData ?? []);

    if (entitled) {
      const { data: scoreData } = await supabase.rpc('get_customer_health_score', { customer_org_id: orgId });
      setHealthScore(scoreData != null ? Number(scoreData) : null);
    }
  }, [id]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!customer) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="default" themeColor="textSecondary">{t('customers.notFound')}</ThemedText>
      </ThemedView>
    );
  }

  const org = customer.organizations;
  const totalRevenue = loads.reduce((sum, l) => sum + Number(l.rate ?? 0), 0);

  return (
    <ThemedView style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
          </Pressable>

          <ThemedView type="transparent" style={styles.headerRow}>
            <ThemedView style={{ flex: 1, backgroundColor: 'transparent' }}>
              <ThemedText type="title">{org?.name ?? '—'}</ThemedText>
              {customer.contact_name && (
                <ThemedText type="small" themeColor="textSecondary">{customer.contact_name}</ThemedText>
              )}
            </ThemedView>
            {healthScore != null && (
              <ThemedView type="transparent" style={[styles.healthBadge, { borderColor: healthColor(healthScore) }]}>
                <ThemedText type="smallBold" style={{ color: healthColor(healthScore) }}>{healthScore}</ThemedText>
              </ThemedView>
            )}
          </ThemedView>

          <ThemedText type="small" themeColor="textSecondary">
            {[org?.phone, org?.email].filter(Boolean).join(' · ') || t('customers.noContact')}
          </ThemedText>
          {[org?.city, org?.state].filter(Boolean).join(', ') ? (
            <ThemedText type="small" themeColor="textSecondary">{[org?.city, org?.state].filter(Boolean).join(', ')}</ThemedText>
          ) : null}

          {customer.tags && customer.tags.length > 0 && (
            <ThemedView type="transparent" style={styles.tagRow}>
              {customer.tags.map((tag) => (
                <ThemedView type="transparent" key={tag} style={styles.tag}>
                  <ThemedText type="small" style={{ color: BrandColors.orange }}>{tag}</ThemedText>
                </ThemedView>
              ))}
            </ThemedView>
          )}

          <ThemedView type="transparent" style={styles.statsRow}>
            <StatBox label={t('customers.loads')} value={String(loads.length)} />
            <StatBox label={t('customers.revenue')} value={formatMoney(totalRevenue, locale)} />
          </ThemedView>

          {customer.notes && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold" style={styles.sectionLabel}>{t('customers.notes').toUpperCase()}</ThemedText>
              <ThemedText type="small">{customer.notes}</ThemedText>
            </ThemedView>
          )}

          <ThemedText type="smallBold" style={styles.sectionLabel}>{t('customers.recentLoads').toUpperCase()}</ThemedText>
          {loads.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">{t('customers.noLoadsYet')}</ThemedText>
          ) : (
            loads.map((l) => (
              <ThemedView key={l.id} type="backgroundElement" style={styles.loadRow}>
                <ThemedText type="small">{l.load_number}</ThemedText>
                <ThemedText type="small">{l.rate != null ? formatMoney(Number(l.rate), locale) : '—'}</ThemedText>
              </ThemedView>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.statBox}>
      <ThemedText type="smallBold">{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  scrollContent: { paddingBottom: Spacing.six, gap: Spacing.two },
  backLink: { paddingVertical: Spacing.two },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', backgroundColor: 'transparent' },
  healthBadge: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, backgroundColor: 'transparent' },
  tag: { backgroundColor: 'rgba(249,115,22,0.15)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statsRow: { flexDirection: 'row', gap: Spacing.two, backgroundColor: 'transparent' },
  statBox: { flex: 1, borderRadius: 12, padding: Spacing.two, alignItems: 'center', gap: 2 },
  section: { borderRadius: 12, padding: Spacing.three, gap: 6 },
  sectionLabel: { letterSpacing: 0.5, marginTop: 4 },
  loadRow: { flexDirection: 'row', justifyContent: 'space-between', borderRadius: 10, padding: Spacing.two },
});
