// src/app/onboarding/index.tsx
// mockup-06's onboarding wizard, built natively for mobile — previously
// mobile had NO onboarding UI at all; this flow (plus welcome.tsx and
// signup.tsx) was the missing piece that made mobile signup a dead end.
// Reuses the exact same API routes carrieros-web's app/onboarding/page.tsx
// already calls (POST /api/onboarding, /api/vehicles, /api/customers,
// /api/billing/add-payment-method via apiFetch's Bearer-token auth), so
// there is no new backend work here — this is a client only.
//
// Deliberate deviations from the literal mockup-06 screen set:
// - No separate "your name" screen: mockup-06 predates web's later
//   'profile' step (it has none), so first/last name + role are folded
//   into the Company screen instead of adding a screen the mockup itself
//   doesn't show.
// - No logo-upload step: also not in mockup-06 (web added it separately
//   to fill a gap — organizations.logo_path had no UI anywhere). Can be
//   added later from Settings; not blocking.
// - No plan/tier picker: that's mockup-09 (signup/trial), not mockup-06.
//   POST /api/onboarding defaults an omitted tier to 'starter'.
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { useOnboardingStatus } from '@/hooks/use-onboarding-status';
import { apiFetch } from '@/lib/api';
import { supabase } from '@/lib/supabase';

const ORANGE = BrandColors.orange;

const STEPS = ['company', 'vehicle', 'customer', 'billing', 'completion'] as const;
type Step = (typeof STEPS)[number];

type CompanyForm = {
  company_name: string;
  dot_number: string;
  ein: string;
  country: 'US' | 'CA' | 'MX';
  state: string;
  city: string;
  zip: string;
  first_name: string;
  last_name: string;
  role: 'owner' | 'solo';
};

const EMPTY_COMPANY: CompanyForm = {
  company_name: '', dot_number: '', ein: '', country: 'US', state: '', city: '', zip: '',
  first_name: '', last_name: '', role: 'owner',
};

type VehicleForm = { nickname: string; year: string; make: string; model: string };
const EMPTY_VEHICLE: VehicleForm = { nickname: '', year: '', make: '', model: '' };

type CustomerForm = { name: string; contact_name: string; phone: string; email: string };
const EMPTY_CUSTOMER: CustomerForm = { name: '', contact_name: '', phone: '', email: '' };

// Module-scope, not defined inside OnboardingScreen: a component redeclared
// on every render gets a fresh identity each time, so React can't tell it's
// "the same" component across renders and remounts the whole subtree —
// every TextInput here would lose focus on each keystroke. Caught by
// eslint-config-expo's react-hooks/static-components rule (part of standing
// up mobile ESLint, 2026-07-25) rather than found by hand.
function OnboardingField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'words' | 'characters';
}) {
  const theme = useTheme();
  return (
    <ThemedView style={styles.field} type="background">
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{label}</ThemedText>
      <TextInput
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize ?? 'sentences'}
      />
    </ThemedView>
  );
}

export default function OnboardingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useLocale();
  const { refresh: refreshOnboardingStatus } = useOnboardingStatus();

  const [step, setStep] = useState<Step>('company');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [companyForm, setCompanyForm] = useState<CompanyForm>(EMPTY_COMPANY);
  const [vehicleForm, setVehicleForm] = useState<VehicleForm>(EMPTY_VEHICLE);
  const [customerForm, setCustomerForm] = useState<CustomerForm>(EMPTY_CUSTOMER);

  const [addedVehicle, setAddedVehicle] = useState(false);
  const [addedCustomer, setAddedCustomer] = useState(false);
  const [addedPaymentMethod, setAddedPaymentMethod] = useState(false);
  const [card, setCard] = useState<{ brand: string; last4: string } | null>(null);

  const stepIndex = STEPS.indexOf(step);
  const canSubmitCompany =
    companyForm.company_name.trim().length > 0 &&
    companyForm.state.trim().length > 0 &&
    companyForm.first_name.trim().length > 0 &&
    companyForm.last_name.trim().length > 0;

  // Every submit function below is wrapped in try/catch/finally rather than
  // a bare await — reproduced live on an iOS Simulator (2026-07-25): a
  // network failure (fetch() rejecting rather than resolving with a non-ok
  // response) skipped straight past `setLoading(false)`, leaving the button
  // stuck showing its spinner forever with no way to retry. finally()
  // guarantees loading always resolves regardless of which way the request
  // failed.
  async function submitCompany() {
    if (!canSubmitCompany) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          company_name: companyForm.company_name.trim(),
          dot_number: companyForm.dot_number.trim() || undefined,
          ein: companyForm.ein.trim() || undefined,
          country: companyForm.country,
          state: companyForm.state.trim().toUpperCase(),
          city: companyForm.city.trim() || undefined,
          zip: companyForm.zip.trim() || undefined,
          first_name: companyForm.first_name.trim(),
          last_name: companyForm.last_name.trim(),
          role: companyForm.role,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error_code === 'ALREADY_ONBOARDED' ? t('onboarding.alreadyOnboarded') : t('onboarding.setupFailed'));
        return;
      }
      // The org now exists — refresh the SHARED onboarding-status the
      // moment it's true, not later at the completion screen. AuthGate
      // reads this same context; if it were still stale by the time "Go to
      // dashboard" / "Add first load" navigates away, AuthGate would still
      // think onboarding is needed.
      await refreshOnboardingStatus();
      setStep('vehicle');
    } catch {
      setError(t('common.loadErrorRetry'));
    } finally {
      setLoading(false);
    }
  }

  async function submitVehicle() {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          nickname: vehicleForm.nickname.trim(),
          year: vehicleForm.year ? Number(vehicleForm.year) : undefined,
          make: vehicleForm.make.trim() || undefined,
          model: vehicleForm.model.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setError(t('onboarding.setupFailed'));
        return;
      }
      setAddedVehicle(true);
      setStep('customer');
    } catch {
      setError(t('common.loadErrorRetry'));
    } finally {
      setLoading(false);
    }
  }

  async function submitCustomer() {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: customerForm.name.trim(),
          contact_name: customerForm.contact_name.trim() || undefined,
          phone: customerForm.phone.trim() || undefined,
          email: customerForm.email.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setError(t('onboarding.setupFailed'));
        return;
      }
      setAddedCustomer(true);
      setStep('billing');
    } catch {
      setError(t('common.loadErrorRetry'));
    } finally {
      setLoading(false);
    }
  }

  async function addPaymentMethod() {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/billing/add-payment-method', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setError(t('onboarding.setupFailed'));
        return;
      }
      setCard({ brand: json.card_brand, last4: json.card_last4 });
      setAddedPaymentMethod(true);
    } catch {
      setError(t('common.loadErrorRetry'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <ThemedView style={styles.headerRow} type="background">
            <ThemedView style={styles.headerSpacer} type="background" />
            <ThemedView style={styles.logoRow} type="background">
              <ThemedText type="title" style={{ color: ORANGE, fontSize: 22 }}>Carrier</ThemedText>
              <ThemedText type="title" style={{ fontSize: 22 }}>OS</ThemedText>
            </ThemedView>
            {/* Onboarding previously had NO way to leave — a user stuck here
                (wrong account, abandoned signup, wants to try a different
                email) had no path back to Welcome/Login at all, since
                AuthGate renders this screen directly rather than through the
                (tabs) shell that owns the app's only other Sign out link. */}
            <ThemedView style={styles.headerSignOut} type="background">
              <Pressable onPress={() => supabase.auth.signOut()} hitSlop={12}>
                <ThemedText type="small" themeColor="textSecondary">{t('onboarding.signOut')}</ThemedText>
              </Pressable>
            </ThemedView>
          </ThemedView>

          <ThemedView style={styles.progressTrack} type="backgroundElement">
            <ThemedView
              style={[styles.progressFill, { width: `${((stepIndex + 1) / STEPS.length) * 100}%`, backgroundColor: ORANGE }]}
            />
          </ThemedView>
          <ThemedText type="small" themeColor="textSecondary" style={styles.progressLabel}>
            {t('onboarding.stepLabel', { current: stepIndex + 1, total: STEPS.length })}
          </ThemedText>

          {step === 'company' && (
            <ThemedView style={styles.stepBody} type="background">
              <ThemedText type="subtitle" style={styles.stepTitle}>{t('onboarding.companyDetails')}</ThemedText>

              <OnboardingField
                label={`${t('onboarding.companyName')} *`}
                value={companyForm.company_name}
                onChangeText={(v) => setCompanyForm((f) => ({ ...f, company_name: v }))}
                placeholder="Acme Trucking LLC"
              />
              <OnboardingField
                label={t('onboarding.dotNumber')}
                value={companyForm.dot_number}
                onChangeText={(v) => setCompanyForm((f) => ({ ...f, dot_number: v }))}
                placeholder="1234567"
                keyboardType="numeric"
              />
              <OnboardingField
                label={t('onboarding.ein')}
                value={companyForm.ein}
                onChangeText={(v) => setCompanyForm((f) => ({ ...f, ein: v }))}
                placeholder="12-3456789"
              />

              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                {t('onboarding.country')} *
              </ThemedText>
              <ThemedView style={styles.pillRow} type="background">
                {(['US', 'CA', 'MX'] as const).map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setCompanyForm((f) => ({ ...f, country: c }))}
                    style={[styles.pill, companyForm.country === c && styles.pillActive]}
                  >
                    <ThemedText
                      type="small"
                      style={companyForm.country === c ? styles.pillTextActive : { color: theme.textSecondary }}
                    >
                      {t(`onboarding.country${c}`)}
                    </ThemedText>
                  </Pressable>
                ))}
              </ThemedView>

              <OnboardingField
                label={`${t('onboarding.stateProvince')} *`}
                value={companyForm.state}
                onChangeText={(v) => setCompanyForm((f) => ({ ...f, state: v }))}
                placeholder="e.g. TX"
                autoCapitalize="characters"
              />
              <OnboardingField
                label={t('onboarding.city')}
                value={companyForm.city}
                onChangeText={(v) => setCompanyForm((f) => ({ ...f, city: v }))}
                placeholder="Los Angeles"
              />
              <OnboardingField
                label={t('onboarding.zip')}
                value={companyForm.zip}
                onChangeText={(v) => setCompanyForm((f) => ({ ...f, zip: v }))}
                placeholder="90001"
                keyboardType="numeric"
              />

              <ThemedText type="subtitle" style={styles.sectionHeading}>{t('onboarding.yourInfo')}</ThemedText>
              <OnboardingField
                label={`${t('onboarding.firstName')} *`}
                value={companyForm.first_name}
                onChangeText={(v) => setCompanyForm((f) => ({ ...f, first_name: v }))}
                placeholder="John"
                autoCapitalize="words"
              />
              <OnboardingField
                label={`${t('onboarding.lastName')} *`}
                value={companyForm.last_name}
                onChangeText={(v) => setCompanyForm((f) => ({ ...f, last_name: v }))}
                placeholder="Smith"
                autoCapitalize="words"
              />

              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                {t('onboarding.yourRole')}
              </ThemedText>
              <ThemedView style={styles.pillRow} type="background">
                {(['owner', 'solo'] as const).map((r) => (
                  <Pressable
                    key={r}
                    onPress={() => setCompanyForm((f) => ({ ...f, role: r }))}
                    style={[styles.rolePill, companyForm.role === r && styles.pillActive]}
                  >
                    <ThemedText
                      type="small"
                      style={companyForm.role === r ? styles.pillTextActive : { color: theme.textSecondary }}
                    >
                      {t(r === 'owner' ? 'onboarding.roleOwner' : 'onboarding.roleSolo')}
                    </ThemedText>
                  </Pressable>
                ))}
              </ThemedView>

              {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

              <Pressable
                onPress={submitCompany}
                disabled={loading || !canSubmitCompany}
                style={[styles.button, (loading || !canSubmitCompany) && styles.buttonDisabled]}
              >
                {loading ? <ActivityIndicator color="#ffffff" /> : (
                  <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('onboarding.continue')}</ThemedText>
                )}
              </Pressable>
            </ThemedView>
          )}

          {step === 'vehicle' && (
            <ThemedView style={styles.stepBody} type="background">
              <ThemedText type="subtitle" style={styles.stepTitle}>{t('onboarding.stepVehicleTitle')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.stepSub}>
                {t('onboarding.stepVehicleSubtitle')}
              </ThemedText>

              <OnboardingField
                label={t('onboarding.vehicleNickname')}
                value={vehicleForm.nickname}
                onChangeText={(v) => setVehicleForm((f) => ({ ...f, nickname: v }))}
                placeholder="Big Red"
              />
              <OnboardingField
                label={t('onboarding.vehicleYear')}
                value={vehicleForm.year}
                onChangeText={(v) => setVehicleForm((f) => ({ ...f, year: v }))}
                placeholder="2022"
                keyboardType="numeric"
              />
              <OnboardingField
                label={t('onboarding.vehicleMake')}
                value={vehicleForm.make}
                onChangeText={(v) => setVehicleForm((f) => ({ ...f, make: v }))}
                placeholder="Freightliner"
              />
              <OnboardingField
                label={t('onboarding.vehicleModel')}
                value={vehicleForm.model}
                onChangeText={(v) => setVehicleForm((f) => ({ ...f, model: v }))}
                placeholder="Cascadia"
              />

              {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

              <ThemedView style={styles.buttonRow} type="background">
                <Pressable onPress={() => setStep('customer')} disabled={loading} style={styles.secondaryButton}>
                  <ThemedText type="smallBold" themeColor="text">{t('onboarding.skipForNow')}</ThemedText>
                </Pressable>
                <Pressable
                  onPress={submitVehicle}
                  disabled={loading || !vehicleForm.nickname.trim()}
                  style={[styles.button, styles.buttonFlex, (loading || !vehicleForm.nickname.trim()) && styles.buttonDisabled]}
                >
                  {loading ? <ActivityIndicator color="#ffffff" /> : (
                    <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('onboarding.continue')}</ThemedText>
                  )}
                </Pressable>
              </ThemedView>
            </ThemedView>
          )}

          {step === 'customer' && (
            <ThemedView style={styles.stepBody} type="background">
              <ThemedText type="subtitle" style={styles.stepTitle}>{t('onboarding.stepCustomerTitle')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.stepSub}>
                {t('onboarding.stepCustomerSubtitle')}
              </ThemedText>

              <OnboardingField
                label={t('onboarding.customerName')}
                value={customerForm.name}
                onChangeText={(v) => setCustomerForm((f) => ({ ...f, name: v }))}
                placeholder="Pacific Produce Distributors"
              />
              <OnboardingField
                label={t('onboarding.customerContactName')}
                value={customerForm.contact_name}
                onChangeText={(v) => setCustomerForm((f) => ({ ...f, contact_name: v }))}
                placeholder="Jane Doe"
              />
              <OnboardingField
                label={t('onboarding.customerPhone')}
                value={customerForm.phone}
                onChangeText={(v) => setCustomerForm((f) => ({ ...f, phone: v }))}
                placeholder="(555) 123-4567"
                keyboardType="phone-pad"
              />
              <OnboardingField
                label={t('onboarding.customerEmail')}
                value={customerForm.email}
                onChangeText={(v) => setCustomerForm((f) => ({ ...f, email: v }))}
                placeholder="dispatch@example.com"
                keyboardType="email-address"
              />

              {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

              <ThemedView style={styles.buttonRow} type="background">
                <Pressable onPress={() => setStep('billing')} disabled={loading} style={styles.secondaryButton}>
                  <ThemedText type="smallBold" themeColor="text">{t('onboarding.skipForNow')}</ThemedText>
                </Pressable>
                <Pressable
                  onPress={submitCustomer}
                  disabled={loading || !customerForm.name.trim()}
                  style={[styles.button, styles.buttonFlex, (loading || !customerForm.name.trim()) && styles.buttonDisabled]}
                >
                  {loading ? <ActivityIndicator color="#ffffff" /> : (
                    <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('onboarding.continue')}</ThemedText>
                  )}
                </Pressable>
              </ThemedView>
            </ThemedView>
          )}

          {step === 'billing' && (
            <ThemedView style={styles.stepBody} type="background">
              <ThemedText type="subtitle" style={styles.stepTitle}>{t('onboarding.stepBillingTitle')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.stepSub}>
                {t('onboarding.stepBillingSubtitle')}
              </ThemedText>

              <ThemedView style={styles.billingRow} type="backgroundElement">
                <ThemedView style={styles.billingText} type="backgroundElement">
                  <ThemedText type="smallBold">
                    {card ? t('onboarding.cardOnFile', { brand: card.brand, last4: card.last4 }) : t('onboarding.noPaymentMethodYet')}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{t('onboarding.trialNotice')}</ThemedText>
                </ThemedView>
                {!card && (
                  <Pressable onPress={addPaymentMethod} disabled={loading} style={styles.smallButton}>
                    {loading ? <ActivityIndicator color="#ffffff" /> : (
                      <ThemedText type="small" style={{ color: '#ffffff' }}>{t('onboarding.addPaymentMethod')}</ThemedText>
                    )}
                  </Pressable>
                )}
              </ThemedView>

              {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

              <ThemedView style={styles.buttonRow} type="background">
                {!card && (
                  <Pressable onPress={() => setStep('completion')} disabled={loading} style={styles.secondaryButton}>
                    <ThemedText type="smallBold" themeColor="text">{t('onboarding.skipForNow')}</ThemedText>
                  </Pressable>
                )}
                <Pressable onPress={() => setStep('completion')} style={[styles.button, styles.buttonFlex]}>
                  <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('onboarding.continue')}</ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>
          )}

          {step === 'completion' && (
            <ThemedView style={styles.stepBody} type="background">
              <ThemedView style={styles.completionHero} type="background">
                <ThemedText style={styles.completionIcon}>🎉</ThemedText>
                <ThemedText type="subtitle" style={styles.stepTitle}>{t('onboarding.allSet')}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.stepSub}>
                  {t('onboarding.allSetSubtitle')}
                </ThemedText>
              </ThemedView>

              {[
                { done: true, label: t('onboarding.checklistCompany') },
                { done: addedVehicle, label: t('onboarding.checklistVehicle') },
                { done: addedCustomer, label: t('onboarding.checklistCustomer') },
                { done: addedPaymentMethod, label: t('onboarding.checklistBilling') },
              ].map((item) => (
                <ThemedView key={item.label} style={styles.checklistRow} type="backgroundElement">
                  <ThemedText style={{ color: item.done ? StatusColors.success : theme.textSecondary }}>
                    {item.done ? '✓' : '○'}
                  </ThemedText>
                  <ThemedText type="small" themeColor={item.done ? 'text' : 'textSecondary'}>{item.label}</ThemedText>
                </ThemedView>
              ))}

              <ThemedView style={styles.buttonRow} type="background">
                <Pressable onPress={() => router.replace('/')} style={styles.secondaryButton}>
                  <ThemedText type="smallBold" themeColor="text">{t('onboarding.goToDashboard')}</ThemedText>
                </Pressable>
                <Pressable onPress={() => router.replace('/load/new')} style={[styles.button, styles.buttonFlex]}>
                  <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('onboarding.addFirstLoad')}</ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four },
  scrollContent: { paddingBottom: Spacing.six },
  headerRow: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: Spacing.three, marginBottom: Spacing.three,
  },
  headerSpacer: { flex: 1 },
  logoRow: { flexDirection: 'row', flex: 2, justifyContent: 'center' },
  headerSignOut: { flex: 1, alignItems: 'flex-end' },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  progressLabel: { textAlign: 'right', marginTop: 4, marginBottom: Spacing.four },
  stepBody: { gap: 4 },
  stepTitle: { fontSize: 18, marginBottom: 4 },
  stepSub: { marginBottom: Spacing.three },
  sectionHeading: { fontSize: 15, marginTop: Spacing.three, marginBottom: 4 },
  field: { gap: 4, marginBottom: Spacing.two },
  fieldLabel: { marginBottom: 4, marginTop: Spacing.one },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  pillRow: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.two },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: 'transparent', backgroundColor: 'transparent' },
  rolePill: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: 'transparent' },
  pillActive: { backgroundColor: ORANGE },
  pillTextActive: { color: '#ffffff', fontWeight: '700' },
  error: { color: StatusColors.danger, marginTop: Spacing.two, marginBottom: Spacing.two },
  button: { marginTop: Spacing.three, backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  buttonFlex: { flex: 1, marginTop: 0 },
  buttonDisabled: { opacity: 0.5 },
  buttonRow: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.three, alignItems: 'center' },
  secondaryButton: { paddingVertical: 14, paddingHorizontal: Spacing.three, borderRadius: 8 },
  smallButton: { backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  billingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  billingText: { flex: 1, gap: 2 },
  completionHero: { alignItems: 'center', gap: 4, marginBottom: Spacing.three },
  completionIcon: { fontSize: 44 },
  checklistRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 8, padding: Spacing.two, marginBottom: 4 },
});
