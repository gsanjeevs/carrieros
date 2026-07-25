// src/app/driver-profile/index.tsx
// Driver self-onboarding — audit gap: the owner had to enter every driver's
// CDL/emergency-contact details up front (drivers/InviteDriverButton.tsx on
// web only collects email/phone/name/default truck), and nothing let the
// driver themselves fill in the rest after accepting the invite. schema.sql's
// driver_own_record_update RLS policy already permits a driver to edit their
// own cdl_number/cdl_class/cdl_state/endorsements/emergency contact/default
// vehicle — it just had no UI anywhere. This screen is that UI.
//
// Deliberately NOT editable here (driver_self_update_allowed() blocks it at
// the RLS layer, so the UI doesn't offer it): cdl_expiry, med_cert_expiry,
// is_active, driver_number — those are compliance/employment fields only the
// owner may set (schema.sql comment: "not the fields defining their
// employment or compliance standing").
//
// Saving also flips drivers.invite_status to 'accepted' — the only place
// that ever happens today; previously that column was written once at
// invite time and never updated again.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';

const PAGE_BACKGROUND = StatusColors.grayLight;
const ORANGE = BrandColors.orange;
const CDL_CLASSES = ['A', 'B', 'C'] as const;
const ENDORSEMENT_CODES = ['hazmat', 'tanker', 'doubles', 'airbrakes', 'passenger'] as const;

type Vehicle = { id: number; vehicle_number: string | null; nickname: string };

type DriverRow = {
  cdl_number: string | null;
  cdl_class: 'A' | 'B' | 'C' | null;
  cdl_state: string | null;
  cdl_expiry: string | null;
  med_cert_expiry: string | null;
  endorsements: string[] | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  default_vehicle_id: number | null;
};

export default function DriverProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const { t } = useLocale();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  const [cdlNumber, setCdlNumber] = useState('');
  const [cdlClass, setCdlClass] = useState<'A' | 'B' | 'C' | null>(null);
  const [cdlState, setCdlState] = useState('');
  const [endorsements, setEndorsements] = useState<string[]>([]);
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [emergencyRelation, setEmergencyRelation] = useState('');
  const [defaultVehicleId, setDefaultVehicleId] = useState<number | null>(null);
  const [readOnly, setReadOnly] = useState<{ cdlExpiry: string | null; medCertExpiry: string | null }>({
    cdlExpiry: null,
    medCertExpiry: null,
  });

  const load = useCallback(async () => {
    if (!session?.user.id) return;
    const { data: driver } = await supabase
      .from('drivers')
      .select(
        'cdl_number, cdl_class, cdl_state, cdl_expiry, med_cert_expiry, endorsements, emergency_contact_name, emergency_contact_phone, emergency_contact_relation, default_vehicle_id'
      )
      .eq('profile_id', session.user.id)
      .single();

    if (driver as DriverRow | null) {
      const d = driver as DriverRow;
      setCdlNumber(d.cdl_number ?? '');
      setCdlClass(d.cdl_class);
      setCdlState(d.cdl_state ?? '');
      setEndorsements(d.endorsements ?? []);
      setEmergencyName(d.emergency_contact_name ?? '');
      setEmergencyPhone(d.emergency_contact_phone ?? '');
      setEmergencyRelation(d.emergency_contact_relation ?? '');
      setDefaultVehicleId(d.default_vehicle_id);
      setReadOnly({ cdlExpiry: d.cdl_expiry, medCertExpiry: d.med_cert_expiry });
    }

    const { data: vehicleRows } = await supabase
      .from('vehicles')
      .select('id, vehicle_number, nickname')
      .eq('is_active', true)
      .order('vehicle_number', { ascending: true });
    setVehicles(vehicleRows ?? []);
  }, [session?.user.id]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  function toggleEndorsement(code: string) {
    setEndorsements((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function save() {
    if (!session?.user.id) return;
    setSaving(true);
    setError('');
    setSaved(false);

    // Deliberately omits cdl_expiry/med_cert_expiry/is_active/driver_number —
    // driver_self_update_allowed() requires those stay unchanged, which an
    // UPDATE naturally satisfies as long as this payload never sets them.
    const { error: updateErr } = await supabase
      .from('drivers')
      .update({
        cdl_number: cdlNumber.trim() || null,
        cdl_class: cdlClass,
        cdl_state: cdlState.trim() || null,
        endorsements,
        emergency_contact_name: emergencyName.trim() || null,
        emergency_contact_phone: emergencyPhone.trim() || null,
        emergency_contact_relation: emergencyRelation.trim() || null,
        default_vehicle_id: defaultVehicleId,
        invite_status: 'accepted',
      })
      .eq('profile_id', session.user.id);

    setSaving(false);
    if (updateErr) {
      setError(t('driverProfile.errorSaveFailed'));
      return;
    }
    setSaved(true);
  }

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: PAGE_BACKGROUND }]}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
          </Pressable>
          <ThemedText type="title" style={styles.heading}>{t('driverProfile.title')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subheading}>
            {t('driverProfile.subheading')}
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold" style={styles.sectionLabel}>{t('driverProfile.cdlSection').toUpperCase()}</ThemedText>

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{t('driverProfile.cdlNumber')}</ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
              value={cdlNumber}
              onChangeText={setCdlNumber}
              placeholder={t('driverProfile.cdlNumberPlaceholder')}
              placeholderTextColor={theme.textSecondary}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{t('driverProfile.cdlClass')}</ThemedText>
            <ThemedView style={styles.chipRow} type="background">
              {CDL_CLASSES.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setCdlClass(c)}
                  style={[
                    styles.chip,
                    { borderColor: cdlClass === c ? ORANGE : theme.backgroundSelected, backgroundColor: cdlClass === c ? `${ORANGE}22` : 'transparent' },
                  ]}
                >
                  <ThemedText type="small" style={cdlClass === c ? { color: ORANGE } : undefined}>{c}</ThemedText>
                </Pressable>
              ))}
            </ThemedView>

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{t('driverProfile.cdlState')}</ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
              value={cdlState}
              onChangeText={(v) => setCdlState(v.toUpperCase().slice(0, 2))}
              placeholder="CA"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="characters"
              maxLength={2}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{t('driverProfile.endorsements')}</ThemedText>
            <ThemedView style={styles.chipRow} type="background">
              {ENDORSEMENT_CODES.map((code) => {
                const selected = endorsements.includes(code);
                return (
                  <Pressable
                    key={code}
                    onPress={() => toggleEndorsement(code)}
                    style={[
                      styles.chip,
                      { borderColor: selected ? ORANGE : theme.backgroundSelected, backgroundColor: selected ? `${ORANGE}22` : 'transparent' },
                    ]}
                  >
                    <ThemedText type="small" style={selected ? { color: ORANGE } : undefined}>
                      {t(`driverProfile.endorsement_${code}` as never)}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ThemedView>

            <ThemedText type="small" themeColor="textSecondary" style={styles.readOnlyNote}>
              {t('driverProfile.readOnlyNote', {
                cdlExpiry: readOnly.cdlExpiry ?? t('driverProfile.notOnFile'),
                medCertExpiry: readOnly.medCertExpiry ?? t('driverProfile.notOnFile'),
              })}
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold" style={styles.sectionLabel}>{t('driverProfile.emergencyContactSection').toUpperCase()}</ThemedText>

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{t('driverProfile.emergencyName')}</ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
              value={emergencyName}
              onChangeText={setEmergencyName}
              placeholderTextColor={theme.textSecondary}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{t('driverProfile.emergencyPhone')}</ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
              value={emergencyPhone}
              onChangeText={setEmergencyPhone}
              keyboardType="phone-pad"
              placeholderTextColor={theme.textSecondary}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{t('driverProfile.emergencyRelation')}</ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
              value={emergencyRelation}
              onChangeText={setEmergencyRelation}
              placeholder={t('driverProfile.emergencyRelationPlaceholder')}
              placeholderTextColor={theme.textSecondary}
            />
          </ThemedView>

          {vehicles.length > 0 && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold" style={styles.sectionLabel}>{t('driverProfile.defaultVehicle').toUpperCase()}</ThemedText>
              <ThemedView style={styles.chipRow} type="background">
                <Pressable
                  onPress={() => setDefaultVehicleId(null)}
                  style={[
                    styles.chip,
                    { borderColor: defaultVehicleId === null ? ORANGE : theme.backgroundSelected, backgroundColor: defaultVehicleId === null ? `${ORANGE}22` : 'transparent' },
                  ]}
                >
                  <ThemedText type="small" style={defaultVehicleId === null ? { color: ORANGE } : undefined}>{t('driverProfile.noDefaultVehicle')}</ThemedText>
                </Pressable>
                {vehicles.map((v) => (
                  <Pressable
                    key={v.id}
                    onPress={() => setDefaultVehicleId(v.id)}
                    style={[
                      styles.chip,
                      { borderColor: defaultVehicleId === v.id ? ORANGE : theme.backgroundSelected, backgroundColor: defaultVehicleId === v.id ? `${ORANGE}22` : 'transparent' },
                    ]}
                  >
                    <ThemedText type="small" style={defaultVehicleId === v.id ? { color: ORANGE } : undefined}>
                      {v.nickname || v.vehicle_number}
                    </ThemedText>
                  </Pressable>
                ))}
              </ThemedView>
            </ThemedView>
          )}

          {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}
          {saved ? <ThemedText type="small" style={styles.saved}>{t('driverProfile.saved')}</ThemedText> : null}

          <Pressable onPress={save} disabled={saving} style={[styles.saveButton, saving && styles.saveButtonDisabled]}>
            {saving ? <ActivityIndicator color="#ffffff" /> : (
              <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('driverProfile.save')}</ThemedText>
            )}
          </Pressable>
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
  heading: { fontSize: 22 },
  subheading: { marginBottom: Spacing.two },
  section: { borderRadius: 12, padding: Spacing.three, gap: 4 },
  sectionLabel: { letterSpacing: 0.5, marginBottom: 4 },
  fieldLabel: { marginTop: Spacing.two, marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  readOnlyNote: { marginTop: Spacing.two },
  error: { color: '#dc2626' },
  saved: { color: '#16a34a' },
  saveButton: { backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: Spacing.two },
  saveButtonDisabled: { opacity: 0.5 },
});
