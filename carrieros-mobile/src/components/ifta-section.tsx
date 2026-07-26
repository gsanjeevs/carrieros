// src/components/ifta-section.tsx
// IFTA mileage log (mockup-20), Growth+ tier (has_feature('ifta_mileage_log')
// -- already seeded in schema.sql, no schema change needed for gating).
// Three pieces of the mockup folded into one section rather than separate
// screens, since they're all "this load's IFTA state" from a driver's POV:
//   1. GPS tracking banner + auto start/stop (src/lib/ifta-tracking.ts)
//   2. This trip's state crossings (read-only list)
//   3. Odometer fallback -- shown once, right after the load is marked
//      delivered, only if check_ifta_completeness() says GPS coverage was
//      <60% of total_miles (same RPC/threshold the schema function defines).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { useSession } from '@/hooks/use-session';
import { hasFeature } from '@/lib/entitlements';
import { startIftaTracking, stopIftaTracking, type StartResult } from '@/lib/ifta-tracking';
import { supabase } from '@/lib/supabase';

const AMBER = '#d97706';
const GREEN = '#16a34a';
const ORANGE = BrandColors.orange;

type Crossing = { id: number; state: string; odometer_est: number | null; source: string };

export function IftaSection({
  loadId,
  vehicleId,
  carrierOrgId,
  loadStatus,
  totalMiles,
}: {
  loadId: number;
  vehicleId: number | null;
  carrierOrgId: number;
  loadStatus: string;
  totalMiles: number | null;
}) {
  const theme = useTheme();
  const { t } = useLocale();
  const { session } = useSession();

  const [entitled, setEntitled] = useState(false);
  const [checked, setChecked] = useState(false);
  const [crossings, setCrossings] = useState<Crossing[]>([]);
  const [trackingResult, setTrackingResult] = useState<StartResult | null>(null);
  const [fallbackRows, setFallbackRows] = useState<{ state: string; miles: string }[]>([]);
  const [fallbackNeeded, setFallbackNeeded] = useState(false);
  const [savingFallback, setSavingFallback] = useState(false);
  const startedRef = useRef(false);
  const checkedCompletenessRef = useRef(false);

  const isActive = ['dispatched', 'picked_up', 'in_transit'].includes(loadStatus);

  const fetchCrossings = useCallback(async () => {
    const { data } = await supabase
      .from('ifta_state_crossings')
      .select('id, state, odometer_est, source')
      .eq('load_id', loadId)
      .order('crossed_at', { ascending: true });
    setCrossings(data ?? []);
  }, [loadId]);

  useEffect(() => {
    (async () => {
      const gate = await hasFeature(supabase, 'ifta_mileage_log');
      setEntitled(gate);
      setChecked(true);
      if (gate) await fetchCrossings();
    })();
  }, [fetchCrossings]);

  // Auto start/stop GPS tracking with the load's active window.
  useEffect(() => {
    if (!entitled || !session?.user.id) return;

    if (isActive && !startedRef.current) {
      startedRef.current = true;
      (async () => {
        const { data: driver } = await supabase
          .from('drivers')
          .select('id')
          .eq('carrier_org_id', carrierOrgId)
          .eq('profile_id', session.user.id)
          .maybeSingle();
        if (!driver) return;
        const result = await startIftaTracking({ loadId, vehicleId, driverId: driver.id, carrierOrgId });
        setTrackingResult(result);
      })();
    }

    if (!isActive && startedRef.current) {
      startedRef.current = false;
      stopIftaTracking();
    }
  }, [entitled, isActive, session?.user.id, loadId, vehicleId, carrierOrgId]);

  // Completeness check, once, right after delivery.
  useEffect(() => {
    if (!entitled || loadStatus !== 'delivered' || checkedCompletenessRef.current) return;
    checkedCompletenessRef.current = true;
    (async () => {
      const { data: complete } = await supabase.rpc('check_ifta_completeness', { p_load_id: loadId });
      if (complete === false) {
        setFallbackNeeded(true);
        setFallbackRows(
          crossings.length > 0
            ? crossings.map((c) => ({ state: c.state, miles: String(c.odometer_est ?? '') }))
            : [{ state: '', miles: '' }]
        );
      }
    })();
  }, [entitled, loadStatus, loadId, crossings]);

  function addFallbackRow() {
    setFallbackRows((rows) => [...rows, { state: '', miles: '' }]);
  }

  function updateFallbackRow(i: number, field: 'state' | 'miles', value: string) {
    setFallbackRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  async function saveFallback() {
    setSavingFallback(true);
    const rows = fallbackRows
      .filter((r) => r.state.trim() && r.miles && !Number.isNaN(Number(r.miles)))
      .map((r) => ({
        carrier_org_id: carrierOrgId,
        vehicle_id: vehicleId,
        load_id: loadId,
        state: r.state.trim().toUpperCase(),
        odometer_est: Number(r.miles),
        crossed_at: new Date().toISOString(),
        source: 'manual' as const,
      }));

    if (rows.length === 0) {
      setSavingFallback(false);
      return;
    }

    // Manual entry overrides GPS entirely for this load -- no mixing
    // sources, per mockup-20's dev notes.
    await supabase.from('ifta_state_crossings').delete().eq('load_id', loadId).eq('source', 'gps');
    await supabase.from('ifta_state_crossings').insert(rows);

    setSavingFallback(false);
    setFallbackNeeded(false);
    await fetchCrossings();
  }

  if (!checked || !entitled) return null;

  return (
    <ThemedView type="backgroundElement" style={styles.section}>
      <ThemedText type="smallBold" style={styles.sectionLabel}>{t('loadDetail.sectionIfta').toUpperCase()}</ThemedText>

      {isActive && trackingResult && (
        <ThemedView type="transparent" style={[styles.banner, { borderColor: trackingResult.started ? GREEN : AMBER }]}>
          <ThemedText type="small" style={{ color: trackingResult.started ? GREEN : AMBER }}>
            {trackingResult.started
              ? t('loadDetail.iftaTrackingActive')
              : t('loadDetail.iftaTrackingPermissionNeeded')}
          </ThemedText>
        </ThemedView>
      )}

      {crossings.length === 0 && !fallbackNeeded && (
        <ThemedText type="small" themeColor="textSecondary">{t('loadDetail.iftaNoCrossingsYet')}</ThemedText>
      )}

      {crossings.map((c) => (
        <ThemedView type="transparent" key={c.id} style={styles.crossingRow}>
          <ThemedText type="small">
            {c.state}{c.source === 'manual' ? ` (${t('loadDetail.iftaManualTag')})` : ''}
          </ThemedText>
          <ThemedText type="small">{c.odometer_est ?? '—'} {t('loadDetail.unitMi')}</ThemedText>
        </ThemedView>
      ))}

      {fallbackNeeded && (
        <ThemedView type="transparent" style={styles.fallback}>
          <ThemedText type="small" style={{ color: AMBER }}>
            {t('loadDetail.iftaFallbackWarning')}
          </ThemedText>

          {fallbackRows.map((row, i) => (
            <ThemedView type="transparent" key={i} style={styles.formRow}>
              <TextInput
                value={row.state}
                onChangeText={(v) => updateFallbackRow(i, 'state', v)}
                placeholder={t('loadDetail.fuelStatePlaceholder')}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="characters"
                maxLength={2}
                style={[styles.input, styles.inputSmall, { color: theme.text, borderColor: theme.border }]}
              />
              <TextInput
                value={row.miles}
                onChangeText={(v) => updateFallbackRow(i, 'miles', v)}
                placeholder={t('loadDetail.miles')}
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                style={[styles.input, styles.inputFlex, { color: theme.text, borderColor: theme.border }]}
              />
            </ThemedView>
          ))}

          <Pressable onPress={addFallbackRow}>
            <ThemedText type="small" style={{ color: ORANGE }}>{t('loadDetail.iftaAddState')}</ThemedText>
          </Pressable>

          <Pressable onPress={saveFallback} disabled={savingFallback} style={[styles.submitButton, savingFallback && styles.disabled]}>
            {savingFallback ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('loadDetail.iftaSaveFallback')}</ThemedText>
            )}
          </Pressable>

          {totalMiles ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('loadDetail.iftaTripTotal', { miles: totalMiles })}
            </ThemedText>
          ) : null}
        </ThemedView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two, marginBottom: Spacing.two },
  sectionLabel: { letterSpacing: 0.5 },
  banner: { borderWidth: 1, borderRadius: 8, padding: Spacing.two },
  crossingRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  fallback: { gap: Spacing.two, backgroundColor: 'transparent' },
  formRow: { flexDirection: 'row', gap: Spacing.two, backgroundColor: 'transparent' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  inputSmall: { width: 64 },
  inputFlex: { flex: 1 },
  submitButton: { backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  disabled: { opacity: 0.5 },
});
