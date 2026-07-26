// src/app/dvir/[loadId].tsx
// Pre/post-trip DVIR (FMCSA 49 CFR 396.11). Standalone pushed screen, same
// pattern as src/app/load/[id].tsx.
//
// Signature is captured via components/signature-pad.tsx (react-native-svg +
// react-native-view-shot) and uploaded to the same `documents` bucket as
// defect photos, then attached to dvir_inspections.signature_url with an
// UPDATE — the inspection id doesn't exist until after the initial INSERT,
// mirroring the defect-photo upload sequencing below. This UPDATE is exactly
// what driver_dvir_modify (schema.sql, 2026-07-20) was added to allow.
//
// Defect photos (dvir_defects.photo_path) upload to the PRIVATE `documents`
// bucket at `{carrier_org_id}/dvir/{inspection_id}/{file}` — storage RLS keys
// INSERT/SELECT off the first path segment matching the caller's org. The
// inspection id doesn't exist until the dvir_inspections row is inserted, so
// photos are held in local state and uploaded *after* that insert, and before
// the dvir_defects rows that reference their paths.
//
// The DVIR itself is the compliance artifact: a failed photo upload must NOT
// abort the inspection. Those defects are saved with a null photo_path and
// the driver gets a warning instead.
//
// Blob is deliberately avoided — see src/lib/base64.ts (RN Blob uploads
// 0 bytes). Same pick/upload approach as src/components/pod-section.tsx.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SignaturePad, type SignaturePadHandle } from '@/components/signature-pad';
import { BrandColors, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import { useLocale } from '@/hooks/use-locale';
import { base64ToArrayBuffer } from '@/lib/base64';
import { supabase } from '@/lib/supabase';
import { resolveSubmitter } from '@/lib/submitter';

const ORANGE = BrandColors.orange;
const RED = StatusColors.danger;
const GREEN = '#16a34a';
const BUCKET = 'documents';

// Keys map 1:1 to src/messages/*.json dvir.areas.* — labels are resolved via
// t() at render time, not hardcoded here.
const AREAS = [
  { key: 'brakes' },
  { key: 'lights' },
  { key: 'tires' },
  { key: 'steering' },
  { key: 'horn' },
  { key: 'mirrors' },
  { key: 'coupling_devices' },
  { key: 'emergency_equipment' },
] as const;

type AreaKey = (typeof AREAS)[number]['key'];
// `photo` holds the picked image locally until submit — one per defect,
// matching the single-path dvir_defects.photo_path column. `uri` is only for
// the pre-submit preview thumbnail; `base64` is what actually gets uploaded.
type DefectPhoto = { uri: string; base64: string };
type AreaState = {
  defect: boolean;
  description: string;
  severity: 'minor' | 'major';
  photo: DefectPhoto | null;
};

export default function DVIRScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { loadId, type } = useLocalSearchParams<{ loadId: string; type: 'pre_trip' | 'post_trip' }>();
  const { session } = useSession();
  const { t } = useLocale();

  const [areas, setAreas] = useState<Record<AreaKey, AreaState>>(() =>
    Object.fromEntries(
      AREAS.map((a) => [a.key, { defect: false, description: '', severity: 'minor' as const, photo: null }])
    ) as Record<AreaKey, AreaState>
  );
  const [odometer, setOdometer] = useState('');
  const [hasSignature, setHasSignature] = useState(false);
  const signaturePadRef = useRef<SignaturePadHandle>(null);
  const [noVehicleWarning, setNoVehicleWarning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  // Non-fatal: photos that failed to upload after the inspection was already
  // saved. Shown on the confirmation screen, not treated as a submit failure.
  const [photoWarningCount, setPhotoWarningCount] = useState(0);
  const [signatureWarning, setSignatureWarning] = useState(false);

  // resolveSubmitter (who's filing this inspection, and under which carrier
  // org) now lives in src/lib/submitter.ts — POD upload needs the same
  // driver-vs-solo branch. See that file for why solo has no `drivers` row.

  useEffect(() => {
    // Just a heads-up if no vehicle can be resolved — doesn't block submit,
    // vehicle_id is nullable on dvir_inspections.
    async function checkVehicle() {
      if (!session?.user.id) return;
      const submitter = await resolveSubmitter(session.user.id);
      const { data: load } = await supabase
        .from('loads_driver_view')
        .select('vehicle_id')
        .eq('id', Number(loadId))
        .single();
      if (!load?.vehicle_id && !submitter?.defaultVehicleId) setNoVehicleWarning(true);
    }
    checkVehicle();
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

  // Mirrors pod-section.tsx's pick(): permissions are no-ops on web, but must
  // be requested before launching on native. base64:true is required — see the
  // Blob note in src/lib/base64.ts.
  async function pickPhoto(key: AreaKey, source: 'camera' | 'library') {
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

    setAreas((prev) => ({
      ...prev,
      [key]: { ...prev[key], photo: { uri: asset.uri, base64: asset.base64! } },
    }));
  }

  function removePhoto(key: AreaKey) {
    setAreas((prev) => ({ ...prev, [key]: { ...prev[key], photo: null } }));
  }

  async function submit() {
    if (!session?.user.id || !loadId) return;
    if (!hasSignature) {
      setError(t('dvir.errorMustSign'));
      return;
    }

    const defectAreas = AREAS.filter((a) => areas[a.key].defect);
    const missingDescription = defectAreas.some((a) => !areas[a.key].description.trim());
    if (missingDescription) {
      setError(t('dvir.errorMissingDescription'));
      return;
    }

    setSubmitting(true);
    setError('');

    const submitter = await resolveSubmitter(session.user.id);

    if (!submitter) {
      setError(t('dvir.errorResolveAccount'));
      setSubmitting(false);
      return;
    }

    const { data: load } = await supabase
      .from('loads_driver_view')
      .select('vehicle_id')
      .eq('id', Number(loadId))
      .single();

    const vehicleId = load?.vehicle_id ?? submitter.defaultVehicleId ?? null;
    const condition = defectAreas.length > 0 ? 'defects_noted' : 'satisfactory';

    const { data: inspection, error: inspectionErr } = await supabase
      .from('dvir_inspections')
      .insert({
        carrier_org_id: submitter.carrierOrgId,
        vehicle_id: vehicleId,
        load_id: Number(loadId),
        driver_id: submitter.driverId,
        type,
        condition,
        odometer: odometer ? Number(odometer) : null,
      })
      .select('id')
      .single();

    if (inspectionErr || !inspection) {
      setError(t('dvir.errorSubmitFailed'));
      setSubmitting(false);
      return;
    }

    // Signature upload/attach mirrors the defect-photo pattern below: it can
    // only happen now that we have an inspection id for the storage path,
    // and a failure here is non-fatal — the inspection itself is already
    // recorded, so a warning is shown instead of aborting the submit.
    let signatureFailed = false;
    const signatureBase64 = await signaturePadRef.current?.capture();
    if (signatureBase64) {
      const path = `${submitter.carrierOrgId}/dvir/${inspection.id}/signature-${Date.now()}.png`;
      try {
        const { error: sigUploadErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, base64ToArrayBuffer(signatureBase64), { contentType: 'image/png', upsert: false });
        if (sigUploadErr) {
          signatureFailed = true;
        } else {
          const { error: sigAttachErr } = await supabase
            .from('dvir_inspections')
            .update({ signature_url: path })
            .eq('id', inspection.id);
          if (sigAttachErr) signatureFailed = true;
        }
      } catch {
        signatureFailed = true;
      }
    }

    if (defectAreas.length > 0) {
      // Photos can only be uploaded now that we have an inspection id for the
      // path. A failure here is deliberately non-fatal: the defect row is
      // still written, just with photo_path null.
      let failedPhotos = 0;
      const rows = [];

      for (const a of defectAreas) {
        const state = areas[a.key];
        let photoPath: string | null = null;

        if (state.photo) {
          const path = `${submitter.carrierOrgId}/dvir/${inspection.id}/${a.key}-${Date.now()}.jpg`;
          try {
            const { error: uploadErr } = await supabase.storage
              .from(BUCKET)
              .upload(path, base64ToArrayBuffer(state.photo.base64), {
                contentType: 'image/jpeg',
                upsert: false,
              });
            if (uploadErr) failedPhotos += 1;
            else photoPath = path;
          } catch {
            failedPhotos += 1;
          }
        }

        rows.push({
          inspection_id: inspection.id,
          area: a.key,
          description: state.description.trim(),
          severity: state.severity,
          photo_path: photoPath,
        });
      }

      const { error: defectsErr } = await supabase.from('dvir_defects').insert(rows);
      if (defectsErr) {
        setError(t('dvir.errorDefectsSaveFailed'));
        setSubmitting(false);
        return;
      }

      setPhotoWarningCount(failedPhotos);
    }

    setSignatureWarning(signatureFailed);
    setSubmitting(false);
    setDone(true);
  }

  if (done) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="title" style={{ color: GREEN, fontSize: 22 }}>{t('dvir.submitted')}</ThemedText>
        {photoWarningCount > 0 && (
          <ThemedText type="small" style={[styles.warning, styles.doneWarning]}>
            {t('dvir.photoUploadFailedWarning', { count: photoWarningCount })}
          </ThemedText>
        )}
        {signatureWarning && (
          <ThemedText type="small" style={[styles.warning, styles.doneWarning]}>
            {t('dvir.signatureUploadFailedWarning')}
          </ThemedText>
        )}
        <Pressable onPress={() => router.back()} style={styles.doneButton}>
          <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('dvir.backToLoad')}</ThemedText>
        </Pressable>
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

          <ThemedText type="title" style={styles.heading}>
            {type === 'post_trip' ? t('dvir.postTripHeading') : t('dvir.preTripHeading')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subheading}>
            {t('dvir.subheading')}
          </ThemedText>

          {noVehicleWarning && (
            <ThemedText type="small" style={styles.warning}>
              {t('dvir.noVehicleWarning')}
            </ThemedText>
          )}

          {AREAS.map((a) => {
            const state = areas[a.key];
            return (
              <ThemedView key={a.key} type="backgroundElement" style={styles.areaCard}>
                <Pressable onPress={() => toggleDefect(a.key)} style={styles.areaHeader}>
                  <ThemedText type="default">{t(`dvir.areas.${a.key}`)}</ThemedText>
                  <ThemedView
                    style={[
                      styles.areaPill,
                      { backgroundColor: state.defect ? `${RED}33` : `${GREEN}33` },
                    ]}
                  >
                    <ThemedText type="small" style={{ color: state.defect ? RED : GREEN }}>
                      {state.defect ? t('dvir.defect') : t('dvir.pass')}
                    </ThemedText>
                  </ThemedView>
                </Pressable>

                {state.defect && (
                  <ThemedView type="transparent" style={styles.defectDetails}>
                    <TextInput
                      style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                      placeholder={t('dvir.describeDefect')}
                      placeholderTextColor={theme.textSecondary}
                      value={state.description}
                      onChangeText={(v) => updateDescription(a.key, v)}
                      multiline
                    />
                    <Pressable onPress={() => toggleSeverity(a.key)} style={styles.severityRow}>
                      <ThemedText type="small" themeColor="textSecondary">{t('dvir.severityLabel')}</ThemedText>
                      <ThemedText type="smallBold" style={{ color: state.severity === 'major' ? RED : theme.text }}>
                        {state.severity === 'major' ? t('dvir.severityMajor') : t('dvir.severityMinor')}
                      </ThemedText>
                    </Pressable>

                    {state.photo ? (
                      <View style={styles.photoRow}>
                        <Image source={{ uri: state.photo.uri }} style={[styles.photoThumb, { backgroundColor: theme.backgroundElement }]} resizeMode="cover" />
                        <View style={styles.photoMeta}>
                          <ThemedText type="small" themeColor="textSecondary">
                            {t('dvir.photoAttached')}
                          </ThemedText>
                          <Pressable onPress={() => removePhoto(a.key)}>
                            <ThemedText type="smallBold" style={{ color: RED }}>
                              {t('dvir.removePhoto')}
                            </ThemedText>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.photoButtonRow}>
                        <Pressable style={styles.photoButton} onPress={() => pickPhoto(a.key, 'camera')}>
                          <ThemedText type="smallBold" themeColor="text">{t('dvir.takePhoto')}</ThemedText>
                        </Pressable>
                        <Pressable style={styles.photoButton} onPress={() => pickPhoto(a.key, 'library')}>
                          <ThemedText type="smallBold" themeColor="text">{t('dvir.chooseFromLibrary')}</ThemedText>
                        </Pressable>
                      </View>
                    )}
                  </ThemedView>
                )}
              </ThemedView>
            );
          })}

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: 4 }}>
              {t('dvir.odometer')}
            </ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              placeholder={t('dvir.odometerPlaceholder')}
              placeholderTextColor={theme.textSecondary}
              value={odometer}
              onChangeText={setOdometer}
              keyboardType="number-pad"
            />
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.two }}>
              {t('dvir.signatureLabel')}
            </ThemedText>
            <SignaturePad
              ref={signaturePadRef}
              onChange={setHasSignature}
              clearLabel={t('dvir.clearSignature')}
              emptyLabel={t('dvir.signHere')}
            />
            <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
              {t('dvir.certifyText')}
            </ThemedText>
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
              <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('dvir.submit')}</ThemedText>
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
  doneWarning: { textAlign: 'center', paddingHorizontal: Spacing.four },
  photoButtonRow: { flexDirection: 'row', gap: Spacing.two },
  photoButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: ORANGE,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  photoThumb: { width: 64, height: 64, borderRadius: 8 },
  photoMeta: { gap: 4 },
  areaCard: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  areaHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  areaPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  defectDetails: { gap: Spacing.two },
  severityRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  section: { borderRadius: 12, padding: Spacing.three },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  error: { color: StatusColors.danger, marginBottom: Spacing.two },
  submitButton: { backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  submitButtonDisabled: { opacity: 0.5 },
  doneButton: { marginTop: Spacing.three, backgroundColor: ORANGE, borderRadius: 8, paddingHorizontal: 24, paddingVertical: 12 },
});
