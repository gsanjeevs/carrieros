// src/components/fuel-stops-section.tsx
// Fuel stop logging (mockup-18) -- Critical gap: fuel_stops has a mature web
// UI (components/FuelStopsSection.tsx, per-vehicle) but was completely
// absent from carrieros-mobile, where the mockup's whole flow actually
// lives (a driver logging a stop mid-trip). Reads go through
// GET /api/v1/loads/{id}/fuel-stops (gated by the fuel_log capability, same
// as logging one); the write already went through the API in an earlier
// batch.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PhotoSourceSheet } from '@/components/photo-source-sheet';
import { BrandColors, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { useSession } from '@/hooks/use-session';
import { usePhotoPicker, type PickedPhoto } from '@/hooks/use-photo-picker';
import { formatMoney } from '@/lib/format-money';
import { formatNumber } from '@/lib/format-number';
import { apiClient } from '@/lib/api-client';
import { keyForSubmission } from '@/lib/idempotency';
import { base64ToArrayBuffer } from '@/lib/base64';
import { uploadFuelStopReceipt } from '@/lib/fuel-receipt-upload';

const ORANGE = BrandColors.orange;

type FuelStop = {
  id: number;
  state: string;
  station: string | null;
  gallons: number;
  total_cost: number;
  has_receipt: boolean;
};

export function FuelStopsSection({
  loadId,
}: {
  loadId: number;
}) {
  const theme = useTheme();
  const { t, locale } = useLocale();
  const { session } = useSession();

  const [stops, setStops] = useState<FuelStop[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Separate from `error`: that one only renders while the form is open, but a
  // receipt-upload failure is discovered right as the form is closing on success.
  const [receiptWarning, setReceiptWarning] = useState('');
  const submissionKey = useRef<{ key: string; body: string } | null>(null);

  const [state, setState] = useState('');
  const [station, setStation] = useState('');
  const [gallons, setGallons] = useState('');
  const [pricePerGallon, setPricePerGallon] = useState('');
  const [receiptPhoto, setReceiptPhoto] = useState<PickedPhoto | null>(null);

  const photoPicker = usePhotoPicker({
    cameraDeniedMessage: t('loadDetail.fuelErrorCameraDenied'),
    libraryDeniedMessage: t('loadDetail.fuelErrorLibraryDenied'),
    noImageDataMessage: t('loadDetail.fuelErrorNoImageData'),
    takePhotoLabel: t('loadDetail.fuelTakePhoto'),
    chooseFromLibraryLabel: t('loadDetail.fuelChooseFromLibrary'),
    cancelLabel: t('common.cancel'),
    sheetTitle: t('loadDetail.fuelReceiptSheetTitle'),
  });

  const fetchStops = useCallback(async () => {
    const { data } = await apiClient.http.GET('/api/v1/loads/{id}/fuel-stops', { params: { path: { id: loadId } } });
    setStops((data?.fuel_stops as FuelStop[] | undefined) ?? []);
    setLoading(false);
  }, [loadId]);

  useEffect(() => {
    fetchStops();
  }, [fetchStops]);

  const gallonsNum = Number(gallons);
  const priceNum = Number(pricePerGallon);
  const computedTotal =
    gallons && pricePerGallon && Number.isFinite(gallonsNum) && Number.isFinite(priceNum)
      ? gallonsNum * priceNum
      : null;

  function resetForm() {
    setState('');
    setStation('');
    setGallons('');
    setPricePerGallon('');
    setReceiptPhoto(null);
    setError('');
  }

  async function submit() {
    if (!session?.user.id) return;
    if (!state.trim() || !gallons || Number.isNaN(gallonsNum) || gallonsNum <= 0) {
      setError(t('loadDetail.fuelValidationError'));
      return;
    }
    setSaving(true);
    setError('');

    // The server derives org, driver, vehicle, logger and (when no receipt total is
    // given) the cost; the client only sends what the driver entered.
    const body = {
      state: state.trim().toUpperCase(),
      station: station.trim() || null,
      gallons: gallonsNum,
      price_per_gallon: pricePerGallon ? priceNum : null,
    };

    let fuelStopId: number | null = null;
    try {
      const { data, response } = await apiClient.http.POST('/api/v1/loads/{id}/fuel-stops', {
        params: { path: { id: loadId }, header: { 'Idempotency-Key': keyForSubmission(submissionKey, body) } },
        body,
      });
      fuelStopId = response.ok && data ? data.id : null;
    } catch {
      fuelStopId = null; // couldn't reach the server; the same key is reused if the driver taps again
    }

    setSaving(false);
    if (fuelStopId == null) {
      setError(t('loadDetail.fuelSaveFailed'));
      return;
    }
    submissionKey.current = null;
    setReceiptWarning('');

    // The receipt photo is a nice-to-have on top of an already-saved fuel stop -- a failed
    // upload must never look like the fuel stop itself failed to save (same posture as
    // DVIR/POD photo uploads elsewhere in this app).
    if (receiptPhoto) {
      const uploadResult = await uploadFuelStopReceipt(loadId, fuelStopId, 'image/jpeg', base64ToArrayBuffer(receiptPhoto.base64));
      if (!uploadResult.ok) setReceiptWarning(t('loadDetail.fuelReceiptUploadFailed'));
    }

    setOpen(false);
    resetForm();
    await fetchStops();
  }

  const totalCost = stops.reduce((sum, s) => sum + Number(s.total_cost), 0);
  const totalGallons = stops.reduce((sum, s) => sum + Number(s.gallons), 0);

  if (loading) return null;

  return (
    <ThemedView type="backgroundElement" style={styles.section}>
      <ThemedView type="transparent" style={styles.headerRow}>
        <ThemedText type="smallBold" style={styles.sectionLabel}>{t('loadDetail.sectionFuel').toUpperCase()}</ThemedText>
        {!open && (
          <Pressable onPress={() => setOpen(true)}>
            <ThemedText type="small" style={{ color: ORANGE }}>{t('loadDetail.addFuelStop')}</ThemedText>
          </Pressable>
        )}
      </ThemedView>

      {stops.length > 0 && (
        <ThemedView type="transparent" style={styles.summaryRow}>
          <SummaryCell label={t('loadDetail.fuelTotalCost')} value={formatMoney(totalCost, locale)} />
          <SummaryCell label={t('loadDetail.fuelGallons')} value={formatNumber(totalGallons, locale)} />
          <SummaryCell label={t('loadDetail.fuelStops')} value={String(stops.length)} />
        </ThemedView>
      )}

      {stops.length === 0 && !open && (
        <ThemedText type="small" themeColor="textSecondary">{t('loadDetail.noFuelStopsYet')}</ThemedText>
      )}

      {receiptWarning ? <ThemedText type="small" style={styles.error}>{receiptWarning}</ThemedText> : null}

      {stops.map((s) => (
        <ThemedView type="transparent" key={s.id} style={styles.stopRow}>
          <ThemedView type="transparent" style={styles.stopRowLeft}>
            <ThemedText type="small">{s.state} — {s.station || '—'}</ThemedText>
            {s.has_receipt && (
              <ThemedText type="small" themeColor="textSecondary" accessibilityLabel={t('loadDetail.fuelReceiptAttached')}>
                📎
              </ThemedText>
            )}
          </ThemedView>
          <ThemedText type="small">{formatMoney(Number(s.total_cost), locale)} · {Number(s.gallons)} gal</ThemedText>
        </ThemedView>
      ))}

      {open && (
        <ThemedView type="transparent" style={styles.form}>
          <ThemedView type="transparent" style={styles.formRow}>
            <TextInput
              value={state}
              onChangeText={setState}
              placeholder={t('loadDetail.fuelStatePlaceholder')}
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="characters"
              maxLength={2}
              style={[styles.input, styles.inputSmall, { color: theme.text, borderColor: theme.border }]}
            />
            <TextInput
              value={station}
              onChangeText={setStation}
              placeholder={t('loadDetail.fuelStation')}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, styles.inputFlex, { color: theme.text, borderColor: theme.border }]}
            />
          </ThemedView>
          <ThemedView type="transparent" style={styles.formRow}>
            <TextInput
              value={gallons}
              onChangeText={setGallons}
              placeholder={t('loadDetail.fuelGallons')}
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              style={[styles.input, styles.inputFlex, { color: theme.text, borderColor: theme.border }]}
            />
            <TextInput
              value={pricePerGallon}
              onChangeText={setPricePerGallon}
              placeholder={t('loadDetail.fuelPricePerGallon')}
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              style={[styles.input, styles.inputFlex, { color: theme.text, borderColor: theme.border }]}
            />
          </ThemedView>

          {computedTotal != null && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('loadDetail.fuelComputedTotal', { amount: formatMoney(computedTotal, locale) })}
            </ThemedText>
          )}

          <ThemedView type="transparent" style={styles.receiptRow}>
            {receiptPhoto && <Image source={{ uri: receiptPhoto.uri }} style={styles.receiptThumbnail} />}
            <Pressable onPress={() => photoPicker.open(setReceiptPhoto)}>
              <ThemedText type="small" style={{ color: ORANGE }}>
                {receiptPhoto ? t('loadDetail.fuelRetakeReceiptPhoto') : t('loadDetail.fuelAddReceiptPhoto')}
              </ThemedText>
            </Pressable>
          </ThemedView>
          {photoPicker.error ? <ThemedText type="small" style={styles.error}>{photoPicker.error}</ThemedText> : null}

          {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

          <ThemedView type="transparent" style={styles.buttonRow}>
            <Pressable onPress={() => { setOpen(false); resetForm(); }} style={styles.cancelButton}>
              <ThemedText type="small" themeColor="textSecondary">{t('common.cancel')}</ThemedText>
            </Pressable>
            <Pressable onPress={submit} disabled={saving} style={[styles.submitButton, saving && styles.disabled]}>
              {saving ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('loadDetail.fuelSave')}</ThemedText>
              )}
            </Pressable>
          </ThemedView>
        </ThemedView>
      )}

      {/* Android bottom-sheet half of the camera/library chooser -- iOS uses
          ActionSheetIOS imperatively (see photoPicker.open/use-photo-picker.ts)
          and never opens this. */}
      <PhotoSourceSheet
        visible={photoPicker.androidSheetOpen}
        title={t('loadDetail.fuelReceiptSheetTitle')}
        takePhotoLabel={t('loadDetail.fuelTakePhoto')}
        chooseFromLibraryLabel={t('loadDetail.fuelChooseFromLibrary')}
        cancelLabel={t('common.cancel')}
        onClose={photoPicker.closeAndroidSheet}
        onTakePhoto={() => photoPicker.pickFromAndroidSheet('camera', setReceiptPhoto)}
        onChooseFromLibrary={() => photoPicker.pickFromAndroidSheet('library', setReceiptPhoto)}
      />
    </ThemedView>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView type="transparent" style={styles.summaryCell}>
      <ThemedText type="smallBold">{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two, marginBottom: Spacing.two },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel: { letterSpacing: 0.5 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'transparent' },
  summaryCell: { alignItems: 'center', gap: 2, backgroundColor: 'transparent' },
  stopRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  stopRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'transparent' },
  form: { gap: Spacing.two, marginTop: Spacing.two, backgroundColor: 'transparent' },
  formRow: { flexDirection: 'row', gap: Spacing.two, backgroundColor: 'transparent' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  inputSmall: { width: 64 },
  inputFlex: { flex: 1 },
  receiptRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, backgroundColor: 'transparent' },
  receiptThumbnail: { width: 40, height: 40, borderRadius: 6 },
  buttonRow: { flexDirection: 'row', gap: Spacing.two, backgroundColor: 'transparent' },
  cancelButton: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  submitButton: { flex: 2, backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  error: { color: StatusColors.danger },
});
