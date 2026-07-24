// src/app/billing/index.tsx
// Billing — view-only, owner/solo. Tier, trial status, payment-method-on-
// file, and truck-count/overage are plain RLS-safe reads (carrier_details,
// tiers — no service-role secret needed), same tables web's billing/page.tsx
// reads. Add-Payment-Method / Change-Tier stay web-only: both are demo-mode
// stubs today (see billing/page.tsx's header comment — no real Stripe
// account exists yet) and a tier change is exactly the kind of considered
// action better made with full context on web, not from a phone.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';

const TIER_PRICE: Record<string, string> = {
  starter: '$49/mo',
  growth: '$99/mo',
  pro: '$199/mo',
  enterprise: '$349/mo',
};

type Details = {
  tier: string | null;
  billing_status: string | null;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
  card_brand: string | null;
  card_last4: string | null;
};

export default function BillingScreen() {
  const router = useRouter();
  const { session } = useSession();
  const { t } = useLocale();

  const [details, setDetails] = useState<Details | null>(null);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [includedTrucks, setIncludedTrucks] = useState(0);
  const [pricePerAdditional, setPricePerAdditional] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!session?.user.id) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', session.user.id)
      .single();

    if (!profile?.org_id) return;

    const [{ data: d }, { count }] = await Promise.all([
      supabase
        .from('carrier_details')
        .select('tier, billing_status, trial_ends_at, stripe_customer_id, card_brand, card_last4')
        .eq('org_id', profile.org_id)
        .single(),
      supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('carrier_org_id', profile.org_id)
        .eq('is_active', true),
    ]);

    setDetails(d ?? null);
    setVehicleCount(count ?? 0);

    if (d?.tier) {
      const { data: currentTierRow } = await supabase
        .from('tiers')
        .select('included_trucks, price_per_additional_truck')
        .eq('code', d.tier)
        .single();
      setIncludedTrucks(currentTierRow?.included_trucks ?? 0);
      setPricePerAdditional(Number(currentTierRow?.price_per_additional_truck ?? 0));
    }
  }, [session?.user.id]);

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

  const tier = details?.tier ?? 'starter';
  const hasPaymentMethod = Boolean(details?.stripe_customer_id);
  const isTrialing = details?.billing_status === 'trialing';
  const trialDaysLeft = details?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(details.trial_ends_at).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))
    : null;
  const overageCount = Math.max(0, vehicleCount - includedTrucks);
  const overageFee = overageCount * pricePerAdditional;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
          </Pressable>
          <ThemedText type="title" style={styles.heading}>{t('billing.title')}</ThemedText>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
              {t('billing.currentPlan').toUpperCase()}
            </ThemedText>
            <ThemedView style={styles.rowBetween}>
              <ThemedText type="default" style={{ textTransform: 'capitalize' }}>{t(`billing.tier_${tier}`)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{TIER_PRICE[tier] ?? ''}</ThemedText>
            </ThemedView>
          </ThemedView>

          {isTrialing && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
                {t('billing.trialStatus').toUpperCase()}
              </ThemedText>
              <ThemedText type="default">
                {trialDaysLeft !== null && trialDaysLeft > 0
                  ? t('billing.trialDaysLeft', { count: trialDaysLeft })
                  : t('billing.trialEnded')}
              </ThemedText>
            </ThemedView>
          )}

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
              {t('billing.paymentMethod').toUpperCase()}
            </ThemedText>
            <ThemedText type="default">
              {hasPaymentMethod
                ? t('billing.cardOnFile', { brand: (details?.card_brand ?? 'card').toUpperCase(), last4: details?.card_last4 ?? '••••' })
                : t('billing.noPaymentMethod')}
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
              {t('billing.fleetUsage').toUpperCase()}
            </ThemedText>
            <ThemedText type="default">
              {t('billing.trucksUsed', { count: vehicleCount, included: includedTrucks })}
            </ThemedText>
            {overageCount > 0 && (
              <ThemedText type="small" style={{ color: '#d97706', marginTop: 4 }}>
                {t('billing.overageFee', { count: overageCount, fee: overageFee.toFixed(2) })}
              </ThemedText>
            )}
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  scrollContent: { paddingBottom: Spacing.six, gap: Spacing.two },
  backLink: { paddingVertical: Spacing.two },
  heading: { fontSize: 24, marginBottom: Spacing.two },
  section: { borderRadius: 12, padding: Spacing.three, gap: 4, marginBottom: Spacing.two },
  sectionLabel: { marginBottom: 4, letterSpacing: 0.5 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' },
});
