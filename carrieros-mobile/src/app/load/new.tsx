// src/app/load/new.tsx
// Create a new load from mobile — owner/solo/dispatcher only. Mirrors
// carrieros-web/components/ManualLoadForm.tsx's field set. Submits through
// the existing POST /api/loads route (via apiFetch, src/lib/api.ts) rather
// than inserting directly against `loads` — that route owns load_number
// generation (next_entity_val(), atomic) and the role check; duplicating
// either client-side would risk a race on the sequence or a stale copy of
// the permission rule.
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { apiFetch } from '@/lib/api';

const ORANGE = BrandColors.orange;

type FormState = {
  customer_name_raw: string;
  pickup_city: string;
  pickup_state: string;
  pickup_date: string;
  delivery_city: string;
  delivery_state: string;
  delivery_date: string;
  commodity: string;
  weight_lbs: string;
  rate: string;
  total_miles: string;
};

const EMPTY: FormState = {
  customer_name_raw: '',
  pickup_city: '',
  pickup_state: '',
  pickup_date: '',
  delivery_city: '',
  delivery_state: '',
  delivery_date: '',
  commodity: '',
  weight_lbs: '',
  rate: '',
  total_miles: '',
};

export default function NewLoadScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useLocale();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function field(key: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    setSubmitting(true);
    setError('');

    const res = await apiFetch('/api/loads', {
      method: 'POST',
      body: JSON.stringify({
        customer_name_raw: form.customer_name_raw || null,
        pickup_city: form.pickup_city || null,
        pickup_state: form.pickup_state || null,
        pickup_date: form.pickup_date || null,
        delivery_city: form.delivery_city || null,
        delivery_state: form.delivery_state || null,
        delivery_date: form.delivery_date || null,
        commodity: form.commodity || null,
        weight_lbs: form.weight_lbs || null,
        rate: form.rate || null,
        total_miles: form.total_miles || null,
      }),
    });

    if (!res.ok) {
      setError(t('loadNew.errorCreateFailed'));
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    router.back();
  }

  function Field({
    labelKey,
    valueKey,
    placeholder,
    keyboardType,
  }: {
    labelKey: string;
    valueKey: keyof FormState;
    placeholder?: string;
    keyboardType?: 'default' | 'numeric';
  }) {
    return (
      <ThemedView type="transparent" style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
          {t(labelKey)}
        </ThemedText>
        <TextInput
          style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          value={form[valueKey]}
          onChangeText={(v) => field(valueKey, v)}
          keyboardType={keyboardType ?? 'default'}
        />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
          </Pressable>

          <ThemedText type="title" style={styles.heading}>{t('loadNew.heading')}</ThemedText>

          <ThemedView type="backgroundElement" style={styles.section}>
            <Field labelKey="loadNew.customer" valueKey="customer_name_raw" />
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
              {t('loadDetail.sectionPickup').toUpperCase()}
            </ThemedText>
            <Field labelKey="loadNew.city" valueKey="pickup_city" />
            <Field labelKey="loadNew.state" valueKey="pickup_state" placeholder="e.g. TX" />
            <Field labelKey="loadNew.date" valueKey="pickup_date" placeholder="YYYY-MM-DD" />
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
              {t('loadDetail.sectionDelivery').toUpperCase()}
            </ThemedText>
            <Field labelKey="loadNew.city" valueKey="delivery_city" />
            <Field labelKey="loadNew.state" valueKey="delivery_state" placeholder="e.g. CA" />
            <Field labelKey="loadNew.date" valueKey="delivery_date" placeholder="YYYY-MM-DD" />
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
              {t('loadDetail.sectionDetails').toUpperCase()}
            </ThemedText>
            <Field labelKey="loadDetail.commodity" valueKey="commodity" />
            <Field labelKey="loadDetail.weight" valueKey="weight_lbs" keyboardType="numeric" />
            <Field labelKey="loadDetail.miles" valueKey="total_miles" keyboardType="numeric" />
            <Field labelKey="loadNew.rate" valueKey="rate" keyboardType="numeric" />
          </ThemedView>

          {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

          <Pressable
            onPress={submit}
            disabled={submitting}
            style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('loadNew.submit')}</ThemedText>
            )}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  scrollContent: { paddingBottom: Spacing.six, gap: Spacing.two },
  backLink: { paddingVertical: Spacing.two },
  heading: { fontSize: 22, marginBottom: Spacing.two },
  section: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two, marginBottom: Spacing.two },
  sectionLabel: { marginBottom: 4, letterSpacing: 0.5 },
  field: { gap: 4 },
  fieldLabel: {},
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  error: { color: StatusColors.danger, marginBottom: Spacing.two },
  submitButton: { backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  submitButtonDisabled: { opacity: 0.5 },
});
