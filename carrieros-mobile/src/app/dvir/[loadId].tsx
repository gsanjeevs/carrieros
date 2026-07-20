// src/app/dvir/[loadId].tsx
// Pre/post-trip DVIR (FMCSA 49 CFR 396.11). Standalone pushed screen, same
// pattern as src/app/load/[id].tsx.
//
// Known simplification: no signature-pad library is installed, so this uses
// a "certify" checkbox in place of a captured signature. dvir_inspections
// .signature_url stays null. Revisit once a signature capture approach is
// chosen — don't treat the checkbox as the permanent design.
//
// Also deferred: defect photos (dvir_defects.photo_path). expo-camera/
// expo-image-picker are installed but unused here — wiring that up needs a
// Supabase Storage bucket, which doesn't exist yet (see tech-spec §9).
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

const ORANGE = '#f97316';
const RED = '#dc2626';
const GREEN = '#16a34a';

const AREAS = [
  { key: 'brakes', label: 'Brakes' },
  { key: 'lights', label: 'Lights' },
  { key: 'tires', label: 'Tires' },
  { key: 'steering', label: 'Steering' },
  { key: 'horn', label: 'Horn' },
  { key: 'mirrors', label: 'Mirrors' },
  { key: 'coupling_devices', label: 'Coupling Devices' },
  { key: 'emergency_equipment', label: 'Emergency Equipment' },
] as const;

type AreaKey = (typeof AREAS)[number]['key'];
type AreaState = { defect: boolean; description: string; severity: 'minor' | 'major' };

export default function DVIRScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { loadId, type } = useLocalSearchParams<{ loadId: string; type: 'pre_trip' | 'post_trip' }>();
  const { session } = useSession();

  const [areas, setAreas] = useState<Record<AreaKey, AreaState>>(() =>
    Object.fromEntries(AREAS.map((a) => [a.key, { defect: false, description: '', severity: 'minor' as const }])) as Record<AreaKey, AreaState>
  );
  const [odometer, setOdometer] = useState('');
  const [certified, setCertified] = useState(false);
  const [noTruckWarning, setNoTruckWarning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Just a heads-up if no truck can be resolved — doesn't block submit,
    // truck_id is nullable on dvir_inspections.
    async function checkTruck() {
      if (!session?.user.id) return;
      const { data: driver } = await supabase
        .from('drivers')
        .select('default_truck_id')
        .eq('profile_id', session.user.id)
        .single();
      const { data: load } = await supabase
        .from('loads_driver_view')
        .select('truck_id')
        .eq('id', Number(loadId))
        .single();
      if (!load?.truck_id && !driver?.default_truck_id) setNoTruckWarning(true);
    }
    checkTruck();
  }, [session?.user.id, loadId]);

  function toggleDefect(key: AreaKey) {
    setAreas((prev) => ({ ...prev, [key]: { ...prev[key], defect: !prev[key].defect } }));
  }

  function updateDescription(key: AreaKey, description: string) {
    setAreas((prev) => ({ ...prev, [key]: { ...prev[key], description } }));
  }

  function toggleSeverity(key: AreaKey) {
    setAreas((prev) => ({
      ...prev,
      [key]: { ...prev[key], severity: prev[key].severity === 'minor' ? 'major' : 'minor' },
    }));
  }

  async function submit() {
    if (!session?.user.id || !loadId) return;
    if (!certified) {
      setError('You must certify this inspection before submitting.');
      return;
    }

    const defectAreas = AREAS.filter((a) => areas[a.key].defect);
    const missingDescription = defectAreas.some((a) => !areas[a.key].description.trim());
    if (missingDescription) {
      setError('Add a description for every area flagged as a defect.');
      return;
    }

    setSubmitting(true);
    setError('');

    const { data: driver, error: driverErr } = await supabase
      .from('drivers')
      .select('id, carrier_org_id, default_truck_id')
      .eq('profile_id', session.user.id)
      .single();

    if (driverErr || !driver) {
      setError('Could not find your driver record.');
      setSubmitting(false);
      return;
    }

    const { data: load } = await supabase
      .from('loads_driver_view')
      .select('truck_id')
      .eq('id', Number(loadId))
      .single();

    const truckId = load?.truck_id ?? driver.default_truck_id ?? null;
    const condition = defectAreas.length > 0 ? 'defects_noted' : 'satisfactory';

    const { data: inspection, error: inspectionErr } = await supabase
      .from('dvir_inspections')
      .insert({
        carrier_org_id: driver.carrier_org_id,
        truck_id: truckId,
        load_id: Number(loadId),
        driver_id: driver.id,
        type,
        condition,
        odometer: odometer ? Number(odometer) : null,
      })
      .select('id')
      .single();

    if (inspectionErr || !inspection) {
      setError('Could not submit inspection. Try again.');
      setSubmitting(false);
      return;
    }

    if (defectAreas.length > 0) {
      const { error: defectsErr } = await supabase.from('dvir_defects').insert(
        defectAreas.map((a) => ({
          inspection_id: inspection.id,
          area: a.key,
          description: areas[a.key].description.trim(),
          severity: areas[a.key].severity,
        }))
      );
      if (defectsErr) {
        setError('Inspection saved, but defect details failed to save. Notify your dispatcher directly.');
        setSubmitting(false);
        return;
      }
    }

    setSubmitting(false);
    setDone(true);
  }

  if (done) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="title" style={{ color: GREEN, fontSize: 22 }}>Inspection submitted</ThemedText>
        <Pressable onPress={() => router.back()} style={styles.doneButton}>
          <ThemedText type="smallBold" style={{ color: '#ffffff' }}>Back to Load</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <ThemedText type="link" themeColor="textSecondary">← Back</ThemedText>
          </Pressable>

          <ThemedText type="title" style={styles.heading}>
            {type === 'post_trip' ? 'Post-Trip Inspection' : 'Pre-Trip Inspection'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subheading}>
            Tap any area to log a defect
          </ThemedText>

          {noTruckWarning && (
            <ThemedText type="small" style={styles.warning}>
              No truck on file for this load — the inspection will be saved without one. Ask your dispatcher to assign a truck.
            </ThemedText>
          )}

          {AREAS.map((a) => {
            const state = areas[a.key];
            return (
              <ThemedView key={a.key} type="backgroundElement" style={styles.areaCard}>
                <Pressable onPress={() => toggleDefect(a.key)} style={styles.areaHeader}>
                  <ThemedText type="default">{a.label}</ThemedText>
                  <ThemedView
                    style={[
                      styles.areaPill,
                      { backgroundColor: state.defect ? `${RED}33` : `${GREEN}33` },
                    ]}
                  >
                    <ThemedText type="small" style={{ color: state.defect ? RED : GREEN }}>
                      {state.defect ? 'Defect' : 'Pass'}
                    </ThemedText>
                  </ThemedView>
                </Pressable>

                {state.defect && (
                  <ThemedView style={styles.defectDetails}>
                    <TextInput
                      style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
                      placeholder="Describe the defect"
                      placeholderTextColor={theme.textSecondary}
                      value={state.description}
                      onChangeText={(v) => updateDescription(a.key, v)}
                      multiline
                    />
                    <Pressable onPress={() => toggleSeverity(a.key)} style={styles.severityRow}>
                      <ThemedText type="small" themeColor="textSecondary">Severity:</ThemedText>
                      <ThemedText type="smallBold" style={{ color: state.severity === 'major' ? RED : theme.text }}>
                        {state.severity === 'major' ? 'Major — do not drive' : 'Minor'}
                      </ThemedText>
                    </Pressable>
                  </ThemedView>
                )}
              </ThemedView>
            );
          })}

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: 4 }}>
              Odometer (optional)
            </ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
              placeholder="e.g. 128450"
              placeholderTextColor={theme.textSecondary}
              value={odometer}
              onChangeText={setOdometer}
              keyboardType="number-pad"
            />
          </ThemedView>

          <Pressable onPress={() => setCertified((c) => !c)} style={styles.certifyRow}>
            <ThemedView
              style={[
                styles.checkbox,
                { borderColor: theme.backgroundSelected, backgroundColor: certified ? ORANGE : 'transparent' },
              ]}
            />
            <ThemedText type="small" style={styles.certifyText}>
              I certify this inspection is accurate to the best of my knowledge.
            </ThemedText>
          </Pressable>

          {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

          <Pressable
            onPress={submit}
            disabled={submitting}
            style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <ThemedText type="smallBold" style={{ color: '#ffffff' }}>Submit Inspection</ThemedText>
            )}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.three },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  scrollContent: { paddingBottom: Spacing.six, gap: Spacing.two },
  backLink: { paddingVertical: Spacing.two },
  heading: { fontSize: 22 },
  subheading: { marginBottom: Spacing.two },
  warning: { color: '#d97706', marginBottom: Spacing.two },
  areaCard: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  areaHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  areaPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  defectDetails: { gap: Spacing.two },
  severityRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  section: { borderRadius: 12, padding: Spacing.three },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  certifyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2 },
  certifyText: { flex: 1 },
  error: { color: '#dc2626', marginBottom: Spacing.two },
  submitButton: { backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  submitButtonDisabled: { opacity: 0.5 },
  doneButton: { marginTop: Spacing.three, backgroundColor: ORANGE, borderRadius: 8, paddingHorizontal: 24, paddingVertical: 12 },
});
