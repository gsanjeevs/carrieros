// src/app/onboarding/index.tsx
// mockup-06's onboarding wizard, built natively for mobile — previously
// mobile had NO onboarding UI at all; this flow (plus welcome.tsx and
// signup.tsx) was the missing piece that made mobile signup a dead end.
// Reuses the exact same API routes carrieros-web's app/onboarding/page.tsx
// already calls (POST /api/onboarding, /api/vehicles, /api/customers,
// /api/billing/add-payment-method via apiFetch's Bearer-token auth), so
// there is no new backend work here — this is a client only.
//
// Rebuilt against mockup-06 on 2026-07-26 after a direct screen-by-screen
// comparison. The first pass matched the mockup's FIELDS but almost none of
// its visual language, which is why it never looked like the mockup: no
// uppercase micro-labels, no filled/focused field states, no entity cards,
// no callouts, no section titles, and a completion screen missing its
// centrepiece. Those now come from src/components/ui/field.tsx and
// ui/mockup-primitives.tsx — see those files for the class-by-class mapping.
//
// Deliberate deviations from the literal mockup-06 screen set:
// - First/last name + role are folded into the Company screen: mockup-06
//   predates web's later 'profile' step and has no screen for them, so
//   folding beats inventing a sixth screen. Address fields likewise —
//   they're needed for timezone/currency derivation server-side.
// - No card-number/expiry/CVV fields, though mockup-06 screen 5 draws them.
//   decisions.md T12 forbids handling raw card data in-app; payment details
//   go through the provider. The trial callout and the security badges from
//   that screen ARE here — it's only the raw inputs that are excluded.
// - Logo upload is still absent. It's the one mockup element left unbuilt:
//   it needs storage-bucket plumbing (organizations.logo_path has no writer
//   anywhere yet), which is a bigger change than a re-skin and would have
//   held up everything else. Tracked separately rather than half-built.
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  AddAnother,
  Button,
  Callout,
  ChecklistItem,
  EntityCard,
  SectionTitle,
  StepProgress,
} from '@/components/ui/mockup-primitives';
import { BrandColors, Fonts, Radius, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { useOnboardingStatus } from '@/hooks/use-onboarding-status';
import { apiFetch } from '@/lib/api';
import { supabase } from '@/lib/supabase';

const ORANGE = BrandColors.orange;

const STEPS = ['company', 'vehicle', 'customer', 'billing', 'completion'] as const;
type Step = (typeof STEPS)[number];

// Mockup `.phone-bar .title` — each screen names itself in the bar. The old
// header showed the CarrierOS logo on every step instead, so the bar carried
// no information about where you were.
const STEP_TITLE_KEY: Record<Step, string> = {
  company: 'onboarding.barCompany',
  vehicle: 'onboarding.barVehicle',
  customer: 'onboarding.barCustomer',
  billing: 'onboarding.barBilling',
  completion: 'onboarding.barComplete',
};

// Mockup-06 screen 2 has a "Default Payment Terms" field ("Net 30", hint
// "You can change this per invoice"). POST /api/onboarding has always
// accepted default_net_terms_days and validated it against exactly this
// list — mobile simply never sent it, so every mobile-onboarded carrier
// silently got the Net 30 fallback.
const NET_TERMS = [15, 30, 45, 60] as const;

type CompanyForm = {
  company_name: string;
  dot_number: string;
  ein: string;
  country: 'US' | 'CA' | 'MX';
  state: string;
  city: string;
  zip: string;
  default_net_terms_days: number;
  first_name: string;
  last_name: string;
  role: 'owner' | 'solo';
};

const EMPTY_COMPANY: CompanyForm = {
  company_name: '', dot_number: '', ein: '', country: 'US', state: '', city: '', zip: '',
  default_net_terms_days: 30,
  first_name: '', last_name: '', role: 'owner',
};

type VehicleForm = { nickname: string; year: string; make: string; model: string };
const EMPTY_VEHICLE: VehicleForm = { nickname: '', year: '', make: '', model: '' };

type CustomerForm = { name: string; contact_name: string; phone: string; email: string };
const EMPTY_CUSTOMER: CustomerForm = { name: '', contact_name: '', phone: '', email: '' };

// The local OnboardingField that used to live here (a plain sentence-case
// label over a bare TextInput) was replaced by the shared
// components/ui/field.tsx `Field`, which adds the mockup's uppercase
// micro-label, required marker, hint line, and filled/focused states. It was
// module-scope to avoid remounting on every render (react-hooks/
// static-components) — Field is now imported, so that hazard is gone for good
// rather than being re-avoided by convention in each screen.

// onFinish is supplied by _layout.tsx's AuthGate, which renders this screen
// directly rather than as a route. Optional because this file is also a real
// expo-router route (/onboarding), and route components are mounted with no
// props — in that case the completion buttons just navigate, with no latch to
// release.
export default function OnboardingScreen({ onFinish }: { onFinish?: () => void }) {
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

  // The carrier's dedicated inbound address, returned by POST /api/onboarding.
  // Optional: the server returns null if it couldn't mint a unique one, and
  // the completion screen simply omits the panel in that case rather than
  // showing a broken address.
  const [loadEmail, setLoadEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // What the user actually named things, kept so the completion checklist can
  // show the mockup's per-item subtitles ("Peterbilt 389 · IL 4B2918") rather
  // than four identical generic rows.
  const [savedCompanyName, setSavedCompanyName] = useState('');
  const [savedVehicleLabel, setSavedVehicleLabel] = useState('');
  const [savedCustomerName, setSavedCustomerName] = useState('');

  const [addedVehicle, setAddedVehicle] = useState(false);
  const [addedCustomer, setAddedCustomer] = useState(false);
  const [addedPaymentMethod, setAddedPaymentMethod] = useState(false);
  const [card, setCard] = useState<{ brand: string; last4: string } | null>(null);

  const stepIndex = STEPS.indexOf(step);

  // Back is available on the optional middle steps only. Not on 'company'
  // (nothing before it) and not on 'completion' — by then the org exists and
  // stepping back into a form that would re-POST it is a trap, which is
  // exactly why the mockup's own completion screen has no back control.
  const canGoBack = step === 'vehicle' || step === 'customer' || step === 'billing';
  function goBack() {
    const prev = STEPS[Math.max(0, stepIndex - 1)];
    setError('');
    setStep(prev);
  }
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
  //
  // Each catch reports a CONNECTION problem specifically, not a generic
  // "something went wrong." fetch() only rejects for transport-level
  // failures — server unreachable, DNS, no network; an HTTP error status
  // resolves normally and is handled by the `!res.ok` branch above. So
  // reaching a catch here always means the request never got to the server,
  // and saying that is strictly more actionable. These previously showed
  // common.loadErrorRetry ("...Pull down to try again"), which was wrong
  // twice over: it named the wrong operation (this is a submit, not a load)
  // and told the user to pull-to-refresh on a screen that has no such
  // gesture. Reproduced live on an iOS Simulator (2026-07-26): with
  // carrieros-web not running, every Continue tap showed that message, which
  // is why this read as "throwing an error without telling me why."
  //
  // The console.warn matters as much as the copy — a bare `catch {}` threw
  // the only diagnostic detail away, so neither the user NOR the logs said
  // what actually failed.
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
          default_net_terms_days: companyForm.default_net_terms_days,
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
      setLoadEmail(json.load_email ?? null);
      setSavedCompanyName(companyForm.company_name.trim());
      // The org now exists — refresh the SHARED onboarding-status the
      // moment it's true, not later at the completion screen. AuthGate
      // reads this same context; if it were still stale by the time "Go to
      // dashboard" / "Add first load" navigates away, AuthGate would still
      // think onboarding is needed.
      await refreshOnboardingStatus();
      setStep('vehicle');
    } catch (err) {
      console.warn('[onboarding] request failed:', err);
      setError(t('common.connectionError'));
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
      setSavedVehicleLabel(
        [vehicleForm.year, vehicleForm.make, vehicleForm.model].map((s) => s.trim()).filter(Boolean).join(' ') ||
          vehicleForm.nickname.trim()
      );
      setStep('customer');
    } catch (err) {
      console.warn('[onboarding] request failed:', err);
      setError(t('common.connectionError'));
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
      setSavedCustomerName(customerForm.name.trim());
      setStep('billing');
    } catch (err) {
      console.warn('[onboarding] request failed:', err);
      setError(t('common.connectionError'));
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
    } catch (err) {
      console.warn('[onboarding] request failed:', err);
      setError(t('common.connectionError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Mockup `.phone-bar` — back / title / action, in that order. The
              previous header was a centred logo with Sign out crammed beside
              it, which left no home for a Back control at all: once you
              advanced a step there was no way to return and correct a typo.
              The logo moves out of the per-step chrome entirely; the step
              title carries the context instead, as the mockup does. */}
          <View style={[styles.phoneBar, { borderBottomColor: theme.divider }]}>
            <View style={styles.barSide}>
              {canGoBack ? (
                <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button">
                  <ThemedText type="small" style={styles.barAction}>‹ {t('common.back')}</ThemedText>
                </Pressable>
              ) : null}
            </View>
            <ThemedText type="smallBold" style={styles.barTitle} numberOfLines={1}>
              {t(STEP_TITLE_KEY[step])}
            </ThemedText>
            {/* Onboarding previously had NO way to leave — a user stuck here
                (wrong account, abandoned signup, wants to try a different
                email) had no path back to Welcome/Login at all, since
                AuthGate renders this screen directly rather than through the
                (tabs) shell that owns the app's only other Sign out link. */}
            <View style={[styles.barSide, styles.barSideRight]}>
              <Pressable onPress={() => supabase.auth.signOut()} hitSlop={12} accessibilityRole="button">
                <ThemedText type="small" themeColor="textSecondary">{t('onboarding.signOut')}</ThemedText>
              </Pressable>
            </View>
          </View>

          <StepProgress
            current={stepIndex + 1}
            total={STEPS.length}
            complete={step === 'completion'}
            label={
              step === 'completion'
                ? t('onboarding.setupComplete')
                : t('onboarding.stepLabel', { current: stepIndex + 1, total: STEPS.length })
            }
          />

          {step === 'company' && (
            <ThemedView style={styles.stepBody} type="background">
              <SectionTitle>{t('onboarding.companyDetails')}</SectionTitle>
              <ThemedText type="small" themeColor="textSecondary" style={styles.stepSub}>
                {t('onboarding.companyDetailsSubtitle')}
              </ThemedText>

              <Field
                label={t('onboarding.companyName')}
                required
                value={companyForm.company_name}
                onChangeText={(v) => setCompanyForm((f) => ({ ...f, company_name: v }))}
                placeholder="Acme Trucking LLC"
              />
              <Field
                label={t('onboarding.dotNumber')}
                value={companyForm.dot_number}
                onChangeText={(v) => setCompanyForm((f) => ({ ...f, dot_number: v }))}
                placeholder="1234567"
                keyboardType="numeric"
              />
              <Field
                label={t('onboarding.ein')}
                value={companyForm.ein}
                onChangeText={(v) => setCompanyForm((f) => ({ ...f, ein: v }))}
                placeholder="12-3456789"
                hint={t('onboarding.einHint')}
              />

              <View style={styles.field}>
                <FieldLabel label={t('onboarding.country')} required />
                <View style={styles.pillRow}>
                  {(['US', 'CA', 'MX'] as const).map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => setCompanyForm((f) => ({ ...f, country: c }))}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: companyForm.country === c }}
                      style={[
                        styles.pill,
                        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                        companyForm.country === c && styles.pillActive,
                      ]}
                    >
                      <ThemedText
                        type="small"
                        style={companyForm.country === c ? styles.pillTextActive : { color: theme.textSecondary }}
                      >
                        {t(`onboarding.country${c}`)}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              </View>

              <Field
                label={t('onboarding.stateProvince')}
                required
                value={companyForm.state}
                onChangeText={(v) => setCompanyForm((f) => ({ ...f, state: v }))}
                placeholder="TX"
                autoCapitalize="characters"
              />
              {/* City and ZIP sit side by side: they're short, related, and
                  stacking them full-width made this form far longer than the
                  mockup's, which is a real part of why it felt different. */}
              <View style={styles.fieldRow}>
                <View style={styles.fieldRowItem}>
                  <Field
                    label={t('onboarding.city')}
                    value={companyForm.city}
                    onChangeText={(v) => setCompanyForm((f) => ({ ...f, city: v }))}
                    placeholder="Los Angeles"
                  />
                </View>
                <View style={styles.fieldRowItem}>
                  <Field
                    label={t('onboarding.zip')}
                    value={companyForm.zip}
                    onChangeText={(v) => setCompanyForm((f) => ({ ...f, zip: v }))}
                    placeholder="90001"
                    keyboardType="numeric"
                  />
                </View>
              </View>

              {/* Mockup `.field-group` "Default Payment Terms" + its hint. */}
              <View style={styles.field}>
                <FieldLabel label={t('onboarding.paymentTerms')} />
                <View style={styles.pillRow}>
                  {NET_TERMS.map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => setCompanyForm((f) => ({ ...f, default_net_terms_days: n }))}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: companyForm.default_net_terms_days === n }}
                      style={[
                        styles.pill,
                        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                        companyForm.default_net_terms_days === n && styles.pillActive,
                      ]}
                    >
                      <ThemedText
                        type="small"
                        style={
                          companyForm.default_net_terms_days === n
                            ? styles.pillTextActive
                            : { color: theme.textSecondary }
                        }
                      >
                        {t('onboarding.netTerms', { days: n })}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
                <ThemedText type="small" themeColor="textMuted" style={styles.inlineHint}>
                  {t('onboarding.paymentTermsHint')}
                </ThemedText>
              </View>

              <SectionTitle>{t('onboarding.yourInfo')}</SectionTitle>
              <View style={styles.fieldRow}>
                <View style={styles.fieldRowItem}>
                  <Field
                    label={t('onboarding.firstName')}
                    required
                    value={companyForm.first_name}
                    onChangeText={(v) => setCompanyForm((f) => ({ ...f, first_name: v }))}
                    placeholder="John"
                    autoCapitalize="words"
                  />
                </View>
                <View style={styles.fieldRowItem}>
                  <Field
                    label={t('onboarding.lastName')}
                    required
                    value={companyForm.last_name}
                    onChangeText={(v) => setCompanyForm((f) => ({ ...f, last_name: v }))}
                    placeholder="Smith"
                    autoCapitalize="words"
                  />
                </View>
              </View>

              <View style={styles.field}>
                <FieldLabel label={t('onboarding.yourRole')} />
                <View style={styles.pillRow}>
                  {(['owner', 'solo'] as const).map((r) => (
                    <Pressable
                      key={r}
                      onPress={() => setCompanyForm((f) => ({ ...f, role: r }))}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: companyForm.role === r }}
                      style={[
                        styles.pill,
                        styles.pillWide,
                        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                        companyForm.role === r && styles.pillActive,
                      ]}
                    >
                      <ThemedText
                        type="small"
                        style={companyForm.role === r ? styles.pillTextActive : { color: theme.textSecondary }}
                      >
                        {t(r === 'owner' ? 'onboarding.roleOwner' : 'onboarding.roleSolo')}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              </View>

              {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

              {loading ? (
                <View style={styles.loadingButton}><ActivityIndicator color="#ffffff" /></View>
              ) : (
                <Button
                  label={t('onboarding.nextAddTruck')}
                  onPress={submitCompany}
                  disabled={!canSubmitCompany}
                />
              )}
            </ThemedView>
          )}

          {step === 'vehicle' && (
            <ThemedView style={styles.stepBody} type="background">
              <SectionTitle>{t('onboarding.stepVehicleTitle')}</SectionTitle>
              <ThemedText type="small" themeColor="textSecondary" style={styles.stepSub}>
                {t('onboarding.stepVehicleSubtitle')}
              </ThemedText>

              {/* Mockup `.entity-card` + `.add-another`: once a truck is
                  saved, show it back confirmed rather than silently clearing
                  the form. Previously adding a truck produced no visible
                  result at all, so there was no way to tell it had worked. */}
              {addedVehicle ? (
                <>
                  <EntityCard
                    icon="🚛"
                    name={savedVehicleLabel || vehicleForm.nickname || t('onboarding.vehicleAdded')}
                    sub={vehicleForm.nickname ? `${t('onboarding.vehicleNickname')}: ${vehicleForm.nickname}` : undefined}
                  />
                  <AddAnother
                    label={t('onboarding.addAnotherTruck')}
                    onPress={() => {
                      setVehicleForm(EMPTY_VEHICLE);
                      setAddedVehicle(false);
                    }}
                  />
                </>
              ) : (
                <>
                  <Field
                    label={t('onboarding.vehicleNickname')}
                    value={vehicleForm.nickname}
                    onChangeText={(v) => setVehicleForm((f) => ({ ...f, nickname: v }))}
                    placeholder="Big Red"
                    hint={t('onboarding.vehicleNicknameHint')}
                  />
                  <View style={styles.fieldRow}>
                    <View style={styles.fieldRowItem}>
                      <Field
                        label={t('onboarding.vehicleYear')}
                        value={vehicleForm.year}
                        onChangeText={(v) => setVehicleForm((f) => ({ ...f, year: v }))}
                        placeholder="2022"
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={styles.fieldRowItem}>
                      <Field
                        label={t('onboarding.vehicleMake')}
                        value={vehicleForm.make}
                        onChangeText={(v) => setVehicleForm((f) => ({ ...f, make: v }))}
                        placeholder="Freightliner"
                      />
                    </View>
                  </View>
                  <Field
                    label={t('onboarding.vehicleModel')}
                    value={vehicleForm.model}
                    onChangeText={(v) => setVehicleForm((f) => ({ ...f, model: v }))}
                    placeholder="Cascadia"
                  />
                </>
              )}

              {/* Mockup `.callout` — the plan's truck limit, stated up front
                  rather than discovered later at a paywall. */}
              <Callout>
                <ThemedText type="small" style={styles.calloutText}>{t('onboarding.truckPlanLimits')}</ThemedText>
              </Callout>

              {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

              <View style={styles.buttonRow}>
                <Button
                  label={t('onboarding.skipForNow')}
                  variant="secondary"
                  onPress={() => setStep('customer')}
                  disabled={loading}
                  style={styles.buttonSecondaryFlex}
                />
                {loading ? (
                  <View style={[styles.loadingButton, styles.buttonPrimaryFlex]}>
                    <ActivityIndicator color="#ffffff" />
                  </View>
                ) : (
                  <Button
                    label={addedVehicle ? t('onboarding.nextAddCustomer') : t('onboarding.continue')}
                    onPress={addedVehicle ? () => setStep('customer') : submitVehicle}
                    disabled={!addedVehicle && !vehicleForm.nickname.trim()}
                    style={styles.buttonPrimaryFlex}
                  />
                )}
              </View>
            </ThemedView>
          )}

          {step === 'customer' && (
            <ThemedView style={styles.stepBody} type="background">
              <SectionTitle>{t('onboarding.stepCustomerTitle')}</SectionTitle>
              <ThemedText type="small" themeColor="textSecondary" style={styles.stepSub}>
                {t('onboarding.stepCustomerSubtitle')}
              </ThemedText>

              {addedCustomer ? (
                <>
                  <EntityCard
                    icon="🏢"
                    name={savedCustomerName || t('onboarding.customerAdded')}
                    sub={[customerForm.contact_name, customerForm.email].filter(Boolean).join(' · ') || undefined}
                  />
                  <AddAnother
                    label={t('onboarding.addAnotherCustomer')}
                    onPress={() => {
                      setCustomerForm(EMPTY_CUSTOMER);
                      setAddedCustomer(false);
                    }}
                  />
                </>
              ) : (
                <>
                  <Field
                    label={t('onboarding.customerName')}
                    value={customerForm.name}
                    onChangeText={(v) => setCustomerForm((f) => ({ ...f, name: v }))}
                    placeholder="Pacific Produce Distributors"
                  />
                  <Field
                    label={t('onboarding.customerContactName')}
                    value={customerForm.contact_name}
                    onChangeText={(v) => setCustomerForm((f) => ({ ...f, contact_name: v }))}
                    placeholder="Jane Doe"
                  />
                  <View style={styles.fieldRow}>
                    <View style={styles.fieldRowItem}>
                      <Field
                        label={t('onboarding.customerPhone')}
                        value={customerForm.phone}
                        onChangeText={(v) => setCustomerForm((f) => ({ ...f, phone: v }))}
                        placeholder="(555) 123-4567"
                        keyboardType="phone-pad"
                      />
                    </View>
                    <View style={styles.fieldRowItem}>
                      <Field
                        label={t('onboarding.customerEmail')}
                        value={customerForm.email}
                        onChangeText={(v) => setCustomerForm((f) => ({ ...f, email: v }))}
                        placeholder="dispatch@example.com"
                        keyboardType="email-address"
                        autoCapitalize="none"
                      />
                    </View>
                  </View>
                </>
              )}

              {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

              <View style={styles.buttonRow}>
                <Button
                  label={t('onboarding.skipForNow')}
                  variant="secondary"
                  onPress={() => setStep('billing')}
                  disabled={loading}
                  style={styles.buttonSecondaryFlex}
                />
                {loading ? (
                  <View style={[styles.loadingButton, styles.buttonPrimaryFlex]}>
                    <ActivityIndicator color="#ffffff" />
                  </View>
                ) : (
                  <Button
                    label={addedCustomer ? t('onboarding.continue') : t('onboarding.continue')}
                    onPress={addedCustomer ? () => setStep('billing') : submitCustomer}
                    disabled={!addedCustomer && !customerForm.name.trim()}
                    style={styles.buttonPrimaryFlex}
                  />
                )}
              </View>
            </ThemedView>
          )}

          {step === 'billing' && (
            <ThemedView style={styles.stepBody} type="background">
              <SectionTitle>{t('onboarding.stepBillingTitle')}</SectionTitle>
              <ThemedText type="small" themeColor="textSecondary" style={styles.stepSub}>
                {t('onboarding.stepBillingSubtitle')}
              </ThemedText>

              {/* Mockup's green trial callout. The card-number / expiry / CVV
                  inputs drawn beside it in the mockup are deliberately absent
                  — decisions.md T12 forbids handling raw card data in-app.
                  "Add payment method" hands off to the provider instead. */}
              <Callout tone="success" icon="🎁">
                <ThemedText type="smallBold" style={styles.calloutStrong}>{t('onboarding.trialHeadline')}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.calloutText}>
                  {t('onboarding.trialDetail')}
                </ThemedText>
              </Callout>

              <View
                style={[styles.billingRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              >
                <View style={styles.billingText}>
                  <ThemedText type="smallBold">
                    {card ? t('onboarding.cardOnFile', { brand: card.brand, last4: card.last4 }) : t('onboarding.noPaymentMethodYet')}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.billingSub}>
                    {t('onboarding.trialNotice')}
                  </ThemedText>
                </View>
                {!card && !loading && (
                  <Button label={t('onboarding.addPaymentMethod')} onPress={addPaymentMethod} style={styles.billingButton} />
                )}
                {!card && loading && <ActivityIndicator color={ORANGE} />}
              </View>

              {/* Mockup's security badge row — the reassurance that sits under
                  the payment step. Kept even though the card fields aren't,
                  because it's about the handoff, not the inputs. */}
              <View style={styles.badgeRow}>
                {[t('onboarding.badgeSsl'), t('onboarding.badgePci'), t('onboarding.badgeStripe')].map((b) => (
                  <ThemedText key={b} type="small" themeColor="textMuted" style={styles.badge}>{b}</ThemedText>
                ))}
              </View>

              {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

              <View style={styles.buttonRow}>
                {!card && (
                  <Button
                    label={t('onboarding.skipForNow')}
                    variant="secondary"
                    onPress={() => setStep('completion')}
                    disabled={loading}
                    style={styles.buttonSecondaryFlex}
                  />
                )}
                <Button
                  label={t('onboarding.continue')}
                  onPress={() => setStep('completion')}
                  style={styles.buttonPrimaryFlex}
                />
              </View>
            </ThemedView>
          )}

          {step === 'completion' && (
            <ThemedView style={styles.stepBody} type="background">
              <View style={styles.completionHero}>
                <ThemedText style={styles.completionIcon}>🎉</ThemedText>
                <ThemedText type="title" style={styles.completionTitle}>{t('onboarding.allSet')}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.completionSub}>
                  {loadEmail ? t('onboarding.allSetLoadEmailSubtitle') : t('onboarding.allSetSubtitle')}
                </ThemedText>
              </View>

              {/* Mockup-06's centrepiece: the carrier's dedicated inbound
                  address. It was missing entirely — and so was any writer for
                  carrier_details.load_email, which is why (see the generator
                  in web's api/onboarding/route.ts). Rendered only when the
                  server actually minted one. */}
              {loadEmail ? (
                <View style={styles.loadEmailPanel}>
                  <ThemedText type="small" style={styles.loadEmailLabel}>{t('onboarding.yourLoadEmail')}</ThemedText>
                  <ThemedText type="smallBold" style={styles.loadEmailAddress} selectable>
                    {loadEmail}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.loadEmailHint}>
                    {t('onboarding.loadEmailHint')}
                  </ThemedText>
                  <Button
                    label={copied ? t('onboarding.copied') : t('onboarding.copyAddress')}
                    variant={copied ? 'success' : 'primary'}
                    onPress={async () => {
                      await Clipboard.setStringAsync(loadEmail);
                      setCopied(true);
                    }}
                    style={styles.copyButton}
                  />
                </View>
              ) : null}

              <SectionTitle>{t('onboarding.setupChecklist')}</SectionTitle>

              {/* Mockup `.checklist-item`: each row carries a subtitle naming
                  what was actually created, and the final row is an ACTIVE
                  next step rather than another completed tick. The old
                  version rendered four identical ✓/○ rows with no detail. */}
              <ChecklistItem
                state="done"
                title={t('onboarding.checklistCompany')}
                sub={savedCompanyName || undefined}
              />
              <ChecklistItem
                state={addedVehicle ? 'done' : 'pending'}
                title={t('onboarding.checklistVehicle')}
                sub={addedVehicle ? savedVehicleLabel || undefined : t('onboarding.skipped')}
              />
              <ChecklistItem
                state={addedCustomer ? 'done' : 'pending'}
                title={t('onboarding.checklistCustomer')}
                sub={addedCustomer ? savedCustomerName || undefined : t('onboarding.skipped')}
              />
              <ChecklistItem
                state={addedPaymentMethod ? 'done' : 'pending'}
                title={t('onboarding.checklistBilling')}
                sub={
                  addedPaymentMethod && card
                    ? t('onboarding.cardOnFile', { brand: card.brand, last4: card.last4 })
                    : t('onboarding.trialActiveNoCard')
                }
              />
              <ChecklistItem
                state="active"
                title={t('onboarding.checklistFirstLoad')}
                sub={t('onboarding.checklistFirstLoadSub')}
                actionLabel={t('onboarding.start')}
                onAction={() => { onFinish?.(); router.replace('/load/new'); }}
              />

              <View style={styles.buttonRow}>
                {/* onFinish() releases AuthGate's wizard latch before
                    navigating — see the latch comment in _layout.tsx. It has
                    to run first, or the gate would re-render this wizard
                    straight back over the destination. */}
                <Button
                  label={t('onboarding.goToDashboard')}
                  variant="secondary"
                  onPress={() => { onFinish?.(); router.replace('/'); }}
                  style={styles.buttonSecondaryFlex}
                />
                <Button
                  label={t('onboarding.addFirstLoad')}
                  variant="success"
                  onPress={() => { onFinish?.(); router.replace('/load/new'); }}
                  style={styles.buttonPrimaryFlex}
                />
              </View>
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

  // Mockup `.phone-bar` — a three-slot bar. The side slots are equal-width
  // so the title stays optically centred no matter how long the back/sign-out
  // labels are in a given locale (Urdu's "سائن آؤٹ کریں" is far wider than
  // "Sign out", and the old centred-logo layout visibly drifted).
  phoneBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: Spacing.two,
    marginTop: Spacing.two,
    marginBottom: Spacing.three,
    borderBottomWidth: 1,
  },
  barSide: { flex: 1 },
  barSideRight: { alignItems: 'flex-end' },
  barTitle: { flex: 2, textAlign: 'center', fontSize: 14 },
  barAction: { color: ORANGE, fontWeight: '600' },

  // gap replaces the per-element margins the old version used, so vertical
  // rhythm is set in one place instead of drifting per field.
  stepBody: { gap: Spacing.three, marginTop: Spacing.three },
  stepSub: { lineHeight: 18, marginTop: -Spacing.two },

  field: { gap: 5 },
  // Two-up row for short related fields (city/ZIP, first/last, year/make).
  fieldRow: { flexDirection: 'row', gap: Spacing.three },
  fieldRowItem: { flex: 1 },
  inlineHint: { fontSize: 10, lineHeight: 14 },

  pillRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  pillWide: { flex: 1, alignItems: 'center' },
  // Active pills carry the brand colour AND a matching border, so the
  // selected state doesn't shift the element's size the way a border-only
  // change would.
  pillActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  pillTextActive: { color: '#ffffff', fontWeight: '700' },

  error: { color: StatusColors.danger },

  // Buttons: primary and secondary share a row and split it 1:2, so the
  // pair reads as one control group. Previously "Skip for now" was bare
  // text at a different height from the button beside it.
  buttonRow: { flexDirection: 'row', gap: Spacing.three, alignItems: 'stretch' },
  buttonSecondaryFlex: { flex: 1 },
  buttonPrimaryFlex: { flex: 2 },
  // Matches Button's own metrics so swapping in a spinner doesn't resize the
  // row mid-request.
  loadingButton: {
    backgroundColor: ORANGE,
    borderRadius: Radius.sm,
    paddingVertical: 13,
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },

  calloutStrong: { color: StatusColors.successDark },
  calloutText: { lineHeight: 17 },

  billingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.card,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  billingText: { flex: 1, gap: 2 },
  billingSub: { lineHeight: 16 },
  billingButton: { paddingVertical: 9, paddingHorizontal: 14 },

  badgeRow: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.four, flexWrap: 'wrap' },
  badge: { fontSize: 10 },

  completionHero: { alignItems: 'center', gap: 6 },
  completionIcon: { fontSize: 48, lineHeight: 56 },
  completionTitle: { fontSize: 22, textAlign: 'center' },
  completionSub: { textAlign: 'center', lineHeight: 18 },

  // Mockup's load-email panel: orange-tinted, bordered, centred. Literal
  // rgba for the same reason as the other tints — it has to sit correctly
  // over both navy and white.
  loadEmailPanel: {
    backgroundColor: 'rgba(244,121,32,.1)',
    borderWidth: 1.5,
    borderColor: 'rgba(244,121,32,.35)',
    borderRadius: Radius.sm,
    padding: Spacing.three,
    alignItems: 'center',
    gap: 4,
  },
  loadEmailLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: ORANGE,
  },
  loadEmailAddress: { fontSize: 13, fontFamily: Fonts.mono, textAlign: 'center' },
  loadEmailHint: { fontSize: 10, textAlign: 'center', lineHeight: 14 },
  copyButton: { alignSelf: 'stretch', marginTop: 6, paddingVertical: 9 },
});
