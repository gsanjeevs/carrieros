// src/components/fuel-stops-section.tsx
// Fuel stop logging (mockup-18) -- Critical gap: fuel_stops has a mature web
// UI (components/FuelStopsSection.tsx, per-vehicle) but was completely
// absent from carrieros-mobile, where the mockup's whole flow actually
// lives (a driver logging a stop mid-trip). RLS already has
// driver_fuel_stops_insert (schema.sql) scoped to the driver's own
// drivers.id -- no schema change needed, this is a pure UI addition.
// Direct table insert/select (R3b category 2 -- plain RLS-protected CRUD),
// same as the web component, not a Next.js route.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { useSession } from '@/hooks/use-session';
import { formatMoney } from '@/lib/format-money';
import { formatNumber } from '@/lib/format-number';
import { supabase } from '@/lib/supabase'; // reads only; the write goes through the API
import { apiClient } from '@/lib/api-client';
import { keyForSubmission } from '@/lib/idempotency';

const ORANGE = BrandColors.orange;

type FuelStop = {
  id: number;
  state: string;
  station: string | null;
  gallons: number;
  total_cost: number;
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
  const submissionKey = useRef<{ key: string; body: string } | null>(null);

  const [state, setState] = useState('');
  const [station, setStation] = useState('');
  const [gallons, setGallons] = useState('');
  const [pricePerGallon, setPricePerGallon] = useState('');

  const fetchStops = useCallback(async () => {
    const { data } = await supabase
      .from('fuel_stops')
      .select('id, state, station, gallons, total_cost')
      .eq('load_id', loadId)
      .order('stop_date', { ascending: true });
    setStops(data ?? []);
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

    let ok = false;
    try {
      const { response } = await apiClient.http.POST('/api/v1/loads/{id}/fuel-stops', {
        params: { path: { id: loadId }, header: { 'Idempotency-Key': keyForSubmission(submissionKey, body) } },
        body,
      });
      ok = response.ok;
    } catch {
      ok = false; // couldn't reach the server; the same key is reused if the driver taps again
    }
    const insertErr = ok ? null : true;

    setSaving(false);
    if (insertErr) {
      setError(t('loadDetail.fuelSaveFailed'));
      return;
    }
    submissionKey.current = null;
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

      {stops.map((s) => (
        <ThemedView type="transparent" key={s.id} style={styles.stopRow}>
          <ThemedText type="small">{s.state} — {s.station || '—'}</ThemedText>
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
  form: { gap: Spacing.two, marginTop: Spacing.two, backgroundColor: 'transparent' },
  formRow: { flexDirection: 'row', gap: Spacing.two, backgroundColor: 'transparent' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  inputSmall: { width: 64 },
  inputFlex: { flex: 1 },
  buttonRow: { flexDirection: 'row', gap: Spacing.two, backgroundColor: 'transparent' },
  cancelButton: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  submitButton: { flex: 2, backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  error: { color: StatusColors.danger },
});
