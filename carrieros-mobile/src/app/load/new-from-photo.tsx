// src/app/load/new-from-photo.tsx
// Mobile load intake AI-extraction path (audit gap) — web has a
// paste-text-to-AI-extraction flow (app/loads/new/paste + ExtractionReview)
// but mobile only had manual entry (load/new.tsx). This mirrors that same
// two-step shape (extract, then review/edit before creating) but captures a
// photo instead of pasted text, via the same picker/base64 pattern already
// used in dvir/[loadId].tsx and pod-section.tsx.
//
// Calls POST /api/extract-load-image (lib/extract-load.ts's
// extractLoadFromImage — a real vision-model call, distinct from the
// text-only extractLoadFromText the paste/email paths use) with the raw
// base64 photo, then lets the driver/dispatcher correct the result before
// POSTing to /api/loads with intake_method: 'pdf' — same endpoint load/new.tsx
// already uses, so load_number generation and the role check stay
// server-side and aren't duplicated here.
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { apiFetch } from '@/lib/api';

const ORANGE = '#f97316';

type FormState = {
  customer_name_raw: string;
  load_number_raw: string;
  pickup_address: string;
  pickup_city: string;
  pickup_state: string;
  pickup_zip: string;
  pickup_date: string;
  pickup_time: string;
  delivery_address: string;
  delivery_city: string;
  delivery_state: string;
  delivery_zip: string;
  delivery_date: string;
  delivery_time: string;
  commodity: string;
  weight_lbs: string;
  rate: string;
  total_miles: string;
};

const EMPTY: FormState = {
  customer_name_raw: '', load_number_raw: '',
  pickup_address: '', pickup_city: '', pickup_state: '', pickup_zip: '', pickup_date: '', pickup_time: '',
  delivery_address: '', delivery_city: '', delivery_state: '', delivery_zip: '', delivery_date: '', delivery_time: '',
  commodity: '', weight_lbs: '', rate: '', total_miles: '',
};

// Extraction result fields land as string | number | null off the wire —
// this narrows each one into the FormState's plain-string shape used by
// TextInput, same coercion ExtractionReview.tsx does on web.
function toFormState(extracted: Record<string, unknown>): FormState {
  const str = (k: string) => (extracted[k] != null ? String(extracted[k]) : '');
  return {
    customer_name_raw: str('customer_name_raw'),
    load_number_raw: str('load_number_raw'),
    pickup_address: str('pickup_address'),
    pickup_city: str('pickup_city'),
    pickup_state: str('pickup_state'),
    pickup_zip: str('pickup_zip'),
    pickup_date: str('pickup_date'),
    pickup_time: str('pickup_time'),
    delivery_address: str('delivery_address'),
    delivery_city: str('delivery_city'),
    delivery_state: str('delivery_state'),
    delivery_zip: str('delivery_zip'),
    delivery_date: str('delivery_date'),
    delivery_time: str('delivery_time'),
    commodity: str('commodity'),
    weight_lbs: str('weight_lbs'),
    rate: str('rate'),
    total_miles: str('total_miles'),
  };
}

export default function NewLoadFromPhotoScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useLocale();

  const [extracting, setExtracting] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function field(key: keyof FormState, value: string) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function pickAndExtract(source: 'camera' | 'library') {
    setError('');

    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setError(source === 'camera' ? t('dvir.errorCameraDenied') : t('dvir.errorLibraryDenied'));
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.7,
      base64: true,
    };

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled) return;

    const asset = result.assets?.[0];
    if (!asset?.base64) {
      setError(t('dvir.errorNoImageData'));
      return;
    }

    setExtracting(true);
    try {
      const res = await apiFetch('/api/extract-load-image', {
        method: 'POST',
        body: JSON.stringify({
          image_base64: asset.base64,
          media_type: asset.mimeType ?? 'image/jpeg',
        }),
      });
      if (!res.ok) {
        setError(t('loadNew.scanErrorExtractFailed'));
        return;
      }
      const extracted = await res.json();
      setForm(toFormState(extracted));
    } catch {
      setError(t('loadNew.scanErrorExtractFailed'));
    } finally {
      setExtracting(false);
    }
  }

  async function submit() {
    if (!form) return;
    setSubmitting(true);
    setError('');

    const res = await apiFetch('/api/loads', {
      method: 'POST',
      body: JSON.stringify({
        customer_name_raw: form.customer_name_raw || null,
        load_number_raw: form.load_number_raw || null,
        pickup_address: form.pickup_address || null,
        pickup_city: form.pickup_city || null,
        pickup_state: form.pickup_state || null,
        pickup_zip: form.pickup_zip || null,
        pickup_date: form.pickup_date || null,
        pickup_time: form.pickup_time || null,
        delivery_address: form.delivery_address || null,
        delivery_city: form.delivery_city || null,
        delivery_state: form.delivery_state || null,
        delivery_zip: form.delivery_zip || null,
        delivery_date: form.delivery_date || null,
        delivery_time: form.delivery_time || null,
        commodity: form.commodity || null,
        weight_lbs: form.weight_lbs || null,
        rate: form.rate || null,
        total_miles: form.total_miles || null,
        intake_method: 'pdf',
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
      <ThemedView style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
          {t(labelKey)}
        </ThemedText>
        <TextInput
          style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          value={form ? form[valueKey] : ''}
          onChangeText={(v) => field(valueKey, v)}
          keyboardType={keyboardType ?? 'default'}
        />
      </ThemedView>
    );
  }

  // Step 1: capture — no photo taken/extracted yet.
  if (!form) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <Pressable onPress={() => router.back()} style={styles.backLink}>
              <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
            </Pressable>

            <ThemedText type="title" style={styles.heading}>{t('loadNew.scanHeading')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.subheading}>
              {t('loadNew.scanSubheading')}
            </ThemedText>

            {extracting ? (
              <ThemedView style={styles.extractingBox} type="backgroundElement">
                <ActivityIndicator color={ORANGE} />
                <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
                  {t('loadNew.scanExtracting')}
                </ThemedText>
              </ThemedView>
            ) : (
              <ThemedView style={styles.photoButtonRow}>
                <Pressable style={styles.photoButton} onPress={() => pickAndExtract('camera')}>
                  <ThemedText type="smallBold" themeColor="text">{t('loadNew.scanTakePhoto')}</ThemedText>
                </Pressable>
                <Pressable style={styles.photoButton} onPress={() => pickAndExtract('library')}>
                  <ThemedText type="smallBold" themeColor="text">{t('loadNew.scanChooseFromLibrary')}</ThemedText>
                </Pressable>
              </ThemedView>
            )}

            {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    );
  }

  // Step 2: review/edit the extracted fields before creating the load.
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Pressable onPress={() => setForm(null)} style={styles.backLink}>
            <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
          </Pressable>

          <ThemedText type="title" style={styles.heading}>{t('loadNew.scanReviewHeading')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subheading}>
            {t('loadNew.scanReviewSubheading')}
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.section}>
            <Field labelKey="loadNew.customer" valueKey="customer_name_raw" />
            <Field labelKey="loadNew.loadNumber" valueKey="load_number_raw" />
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
              {t('loadDetail.sectionPickup').toUpperCase()}
            </ThemedText>
            <Field labelKey="loadNew.address" valueKey="pickup_address" />
            <Field labelKey="loadNew.city" valueKey="pickup_city" />
            <Field labelKey="loadNew.state" valueKey="pickup_state" placeholder="e.g. TX" />
            <Field labelKey="loadNew.zip" valueKey="pickup_zip" />
            <Field labelKey="loadNew.date" valueKey="pickup_date" placeholder="YYYY-MM-DD" />
            <Field labelKey="loadNew.time" valueKey="pickup_time" placeholder="HH:MM" />
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
              {t('loadDetail.sectionDelivery').toUpperCase()}
            </ThemedText>
            <Field labelKey="loadNew.address" valueKey="delivery_address" />
            <Field labelKey="loadNew.city" valueKey="delivery_city" />
            <Field labelKey="loadNew.state" valueKey="delivery_state" placeholder="e.g. CA" />
            <Field labelKey="loadNew.zip" valueKey="delivery_zip" />
            <Field labelKey="loadNew.date" valueKey="delivery_date" placeholder="YYYY-MM-DD" />
            <Field labelKey="loadNew.time" valueKey="delivery_time" placeholder="HH:MM" />
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
              <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('loadNew.scanConfirmCreate')}</ThemedText>
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
  heading: { fontSize: 22, marginBottom: Spacing.one },
  subheading: { marginBottom: Spacing.three },
  extractingBox: { borderRadius: 12, padding: Spacing.five, alignItems: 'center' },
  photoButtonRow: { flexDirection: 'row', gap: Spacing.two },
  photoButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: ORANGE,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  section: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two, marginBottom: Spacing.two },
  sectionLabel: { marginBottom: 4, letterSpacing: 0.5 },
  field: { gap: 4 },
  fieldLabel: {},
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  error: { color: '#dc2626', marginTop: Spacing.two },
  submitButton: { backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  submitButtonDisabled: { opacity: 0.5 },
});
