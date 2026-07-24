// src/components/ifta-summary.tsx
// The Growth+ quarterly IFTA state-mileage summary content (get_ifta_quarterly_summary
// RPC), shared by two different screens that reach it two different ways:
//   - (tabs)/reports.tsx — Finance's own tab (in their TAB_SETS)
//   - app/ifta-report/index.tsx — a standalone route Owner/Solo reach via
//     settings-content.tsx's "Business" links, same pattern as
//     customers/team/billing/settlements. Owner/Solo's Tabs navigator has no
//     TabTrigger for 'reports' (expo-router/ui only registers routes that
//     are in the current role's TAB_SETS), so router.push('/reports') from
//     their settings screen would silently fall back to their first tab --
//     a standalone route outside the (tabs) group sidesteps that entirely.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useLocale } from '@/hooks/use-locale';
import { useSession } from '@/hooks/use-session';
import { hasFeature } from '@/lib/entitlements';
import { supabase } from '@/lib/supabase';

type StateMiles = { state: string; total_miles: number };

function currentQuarter(): string {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + 1;
  return `${now.getFullYear()}-Q${q}`;
}

export function IftaSummary() {
  const { t } = useLocale();
  const { session } = useSession();

  const [loading, setLoading] = useState(true);
  const [entitled, setEntitled] = useState(false);
  const [rows, setRows] = useState<StateMiles[]>([]);
  const quarter = currentQuarter();

  const load = useCallback(async () => {
    if (!session?.user.id) {
      setLoading(false);
      return;
    }
    const gate = await hasFeature(supabase, 'ifta_mileage_log');
    setEntitled(gate);
    if (!gate) {
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', session.user.id)
      .single();
    if (!profile?.org_id) {
      setLoading(false);
      return;
    }

    const { data } = await supabase.rpc('get_ifta_quarterly_summary', {
      p_carrier_org_id: profile.org_id,
      p_quarter: quarter,
    });
    setRows((data ?? []).sort((a: StateMiles, b: StateMiles) => b.total_miles - a.total_miles));
    setLoading(false);
  }, [session?.user.id, quarter]);

  useEffect(() => {
    load();
  }, [load]);

  const totalMiles = rows.reduce((sum, r) => sum + Number(r.total_miles), 0);

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!entitled) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="subtitle" style={styles.heading}>{t('reports.comingSoon')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.detail}>
          {t('reports.comingSoonDetail')}
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <ThemedText type="title" style={styles.pageTitle}>{t('reports.iftaTitle')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.pageSub}>
        {t('reports.iftaQuarter', { quarter })}
      </ThemedText>

      <ThemedView type="backgroundElement" style={styles.summaryStrip}>
        <ThemedText type="title">{totalMiles.toLocaleString()}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{t('reports.iftaTotalMiles')}</ThemedText>
      </ThemedView>

      {rows.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
          {t('reports.iftaNoData')}
        </ThemedText>
      ) : (
        <ThemedView type="backgroundElement" style={styles.table}>
          {rows.map((r) => (
            <ThemedView key={r.state} style={styles.stateRow}>
              <ThemedText type="smallBold">{r.state}</ThemedText>
              <ThemedText type="small">
                {Number(r.total_miles).toLocaleString()} {t('loadDetail.unitMi')}
                {' · '}
                {totalMiles > 0 ? Math.round((Number(r.total_miles) / totalMiles) * 100) : 0}%
              </ThemedText>
            </ThemedView>
          ))}
        </ThemedView>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.two },
  heading: { textAlign: 'center' },
  detail: { textAlign: 'center', maxWidth: 280 },
  scrollContent: { paddingVertical: Spacing.three, paddingHorizontal: Spacing.three, gap: Spacing.two },
  pageTitle: {},
  pageSub: { marginBottom: Spacing.two },
  summaryStrip: { borderRadius: 12, padding: Spacing.three, alignItems: 'center', gap: 2, marginBottom: Spacing.two },
  table: { borderRadius: 12, padding: Spacing.three, gap: 6 },
  stateRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  empty: { textAlign: 'center', marginTop: Spacing.three },
});
