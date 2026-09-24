// src/app/billing/index.tsx
// Billing — view-only, owner/solo. Tier, trial status, payment-method-on-
// file, and truck-count/overage come from GET /api/v1/billing
// (carrier_details + tiers + vehicle count, gated server-side by the
// subscription_management capability — carrier_details RLS itself has no
// role restriction, see server/application/billing-query-service.ts).
//
// Add-Payment-Method / Change-Tier stay web-only, on purpose — this isn't
// just because Stripe is still a demo-mode stub (billing/page.tsx's header
// comment), it also matches mockup-27-billing-native.html's explicit
// reasoning: routing subscription changes to web sidesteps App Store/Play
// Store rules around in-app-purchase flows for subscriptions changed
// inside a native app, the same approach most SaaS apps with a web-first
// billing system use. So instead of an in-app tier picker, "Manage
// Subscription" hands off to carrieros.com/billing in the system browser
// (mockup screen 3) — the same real change-tier UI already live on web
// (UpgradeTierButton.tsx / POST /api/v1/billing/change-tier), just not
// duplicated here. Mockup screen 2's Face-ID step-up before that handoff
// is skipped: it needs a new native dependency (expo-local-authentication)
// this app doesn't have yet, so it's left as a documented follow-up rather
// than added speculatively in this pass.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Figure } from '@/components/figure-text';
import { BrandColors, Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useLocale } from '@/hooks/use-locale';
import { useProfileRole } from '@/hooks/use-profile-role';
import { roleHasCapability } from '@/lib/generated/role-capabilities';
import { apiClient } from '@/lib/api-client';

const ORANGE = BrandColors.orange;
const WEB_BILLING_URL = `${process.env.EXPO_PUBLIC_API_URL}/billing`;

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
  const { role } = useProfileRole();

  // Defense-in-depth for a direct deep link: the only nav entry point
  // (settings-content.tsx) already hides the link unless
  // subscription_management is held, and GET /api/v1/billing 403s
  // server-side regardless, but "Manage Subscription" is a real action
  // (it opens a browser), so it stays gated the same way other
  // capability-gated actions are (see vehicle/[id].tsx's canLogService).
  const canManageSubscription = roleHasCapability(role, 'subscription_management');

  const [details, setDetails] = useState<Details | null>(null);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [includedTrucks, setIncludedTrucks] = useState(0);
  const [pricePerAdditional, setPricePerAdditional] = useState(0);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    if (!session?.user.id) return;

    const { data } = await apiClient.http.GET('/api/v1/billing');
    if (!data) return;

    setDetails({
      tier: data.tier,
      billing_status: data.billing_status,
      trial_ends_at: data.trial_ends_at,
      stripe_customer_id: data.stripe_customer_id,
      card_brand: data.card_brand,
      card_last4: data.card_last4,
    });
    setVehicleCount(data.vehicle_count);
    setIncludedTrucks(data.included_trucks);
    setPricePerAdditional(data.price_per_additional_truck);
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
  const usagePct = includedTrucks > 0 ? Math.min(1, vehicleCount / includedTrucks) : 0;

  const handleManageSubscription = () => {
    Alert.alert(
      t('billing.manageSubscriptionHandoffTitle'),
      t('billing.manageSubscriptionHandoffMessage'),
      [
        { text: t('billing.manageSubscriptionHandoffCancel'), style: 'cancel' },
        {
          text: t('billing.manageSubscriptionHandoffConfirm'),
          onPress: async () => {
            setOpening(true);
            try {
              await WebBrowser.openBrowserAsync(WEB_BILLING_URL);
            } catch {
              Alert.alert(t('billing.manageSubscriptionOpenError'));
            } finally {
              setOpening(false);
            }
          },
        },
      ],
    );
  };

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
            <ThemedView type="transparent" style={styles.rowBetween}>
              <ThemedText type="default" style={{ textTransform: 'capitalize' }}>{t(`billing.tier_${tier}`)}</ThemedText>
              <Figure type="small" themeColor="textSecondary">{TIER_PRICE[tier] ?? ''}</Figure>
            </ThemedView>
          </ThemedView>

          {isTrialing && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
                {t('billing.trialStatus').toUpperCase()}
              </ThemedText>
              <ThemedView type="transparent" style={styles.trialChip}>
                <ThemedText type="small" style={styles.trialChipText}>
                  {trialDaysLeft !== null && trialDaysLeft > 0
                    ? t('billing.trialDaysLeft', { count: trialDaysLeft })
                    : t('billing.trialEnded')}
                </ThemedText>
              </ThemedView>
            </ThemedView>
          )}

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
              {t('billing.paymentMethod').toUpperCase()}
            </ThemedText>
            <Figure type="default">
              {hasPaymentMethod
                ? t('billing.cardOnFile', { brand: (details?.card_brand ?? 'card').toUpperCase(), last4: details?.card_last4 ?? '••••' })
                : t('billing.noPaymentMethod')}
            </Figure>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
              {t('billing.fleetUsage').toUpperCase()}
            </ThemedText>
            <Figure type="default">
              {t('billing.trucksUsed', { count: vehicleCount, included: includedTrucks })}
            </Figure>
            <ThemedView type="transparent" style={styles.usageTrack}>
              <ThemedView type="transparent" style={[styles.usageFill, { width: `${usagePct * 100}%` }]} />
            </ThemedView>
            {overageCount > 0 && (
              <Figure type="small" style={{ color: '#d97706', marginTop: 4 }}>
                {t('billing.overageFee', { count: overageCount, fee: overageFee.toFixed(2) })}
              </Figure>
            )}
          </ThemedView>

          {canManageSubscription && (
            <Pressable
              onPress={handleManageSubscription}
              disabled={opening}
              style={({ pressed }) => [styles.manageButton, (pressed || opening) && styles.manageButtonPressed]}
            >
              {opening ? (
                <ActivityIndicator color={ORANGE} />
              ) : (
                <ThemedText type="smallBold" style={styles.manageButtonText}>
                  {t('billing.manageSubscription')}
                </ThemedText>
              )}
            </Pressable>
          )}
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
  trialChip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(244,121,32,0.15)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 2,
  },
  trialChipText: { color: ORANGE, fontWeight: '700' },
  usageTrack: {
    height: 8,
    backgroundColor: '#e8ecf0',
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 8,
  },
  usageFill: { height: '100%', backgroundColor: ORANGE, borderRadius: 4 },
  manageButton: {
    borderWidth: 2,
    borderColor: '#0f1e35',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  manageButtonPressed: { opacity: 0.6 },
  manageButtonText: { color: '#0f1e35' },
});
