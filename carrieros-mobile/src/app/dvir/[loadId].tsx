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
//
// Offline: known-offline, or a live submit that can't reach the server at all, writes
// the signature/defect photos to local storage and queues a dvir.submit command
// (lib/offline-queue.ts) instead of losing the inspection -- an FMCSA-mandated safety
// record filed at the end of a route with no signal must not disappear. The queue
// replays the atomic inspection+defects call, then the attachments, once online.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SignaturePad, type SignaturePadHandle } from '@/components/signature-pad';
import { SwipeableRow } from '@/components/swipeable-row';
import { PhotoSourceSheet } from '@/components/photo-source-sheet';
import { BrandColors, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import { useLocale } from '@/hooks/use-locale';
import { useOfflineSync } from '@/hooks/use-offline-sync';
import { usePhotoPicker } from '@/hooks/use-photo-picker';
import { base64ToArrayBuffer } from '@/lib/base64';
import { apiClient } from '@/lib/api-client';
import { keyForSubmission } from '@/lib/idempotency';
import { uploadDvirAttachment } from '@/lib/dvir-attachments';
import { savePhotoLocally } from '@/lib/local-photo-store';
import { enqueueDvirSubmit, type DvirAttachmentPayload } from '@/lib/offline-queue';
import { resolveSubmitter } from '@/lib/submitter';
import { haptics } from '@/lib/haptics';

const ORANGE = BrandColors.orange;
const RED = StatusColors.danger;
const GREEN = '#16a34a';

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
  const navigation = useNavigation();
  const { loadId, type } = useLocalSearchParams<{ loadId: string; type: 'pre_trip' | 'post_trip' }>();
  const { session } = useSession();
  const { t } = useLocale();
  const { isOnline, refreshQueueLength } = useOfflineSync();
  const photoPicker = usePhotoPicker({
    cameraDeniedMessage: t('dvir.errorCameraDenied'),
    libraryDeniedMessage: t('dvir.errorLibraryDenied'),
    noImageDataMessage: t('dvir.errorNoImageData'),
    takePhotoLabel: t('dvir.takePhoto'),
    chooseFromLibraryLabel: t('dvir.chooseFromLibrary'),
    cancelLabel: t('common.cancel'),
    sheetTitle: t('dvir.addPhotoSheetTitle'),
  });
  // Which area's picker sheet is currently open -- only relevant on Android,
  // where the sheet is a rendered <Modal> rather than an imperative iOS call
  // and so needs to know which area's onPicked callback to invoke.
  const androidSheetAreaKey = useRef<AreaKey | null>(null);

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
  const [queued, setQueued] = useState(false);
  const submissionKey = useRef<{ key: string; body: string } | null>(null);
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
      const { data } = await apiClient.http.GET('/api/v1/loads/{id}', { params: { path: { id: Number(loadId) } } });
      if (!data?.load.vehicle_id && !submitter?.defaultVehicleId) setNoVehicleWarning(true);
    }
    checkVehicle();
  }, [session?.user.id, loadId]);

  // Success haptic fires once, exactly when the confirmation screen mounts
  // (spec §1.5) -- not re-fired if a warning banner is also showing, since a
  // success+warning double-haptic in the same half-second reads as
  // contradictory rather than informative.
  useEffect(() => {
    if (done && !queued) haptics.success();
  }, [done, queued]);

  // Success haptic on signature completion (spec §1.4) -- fires the first
  // time hasSignature flips true, not on every stroke.
  const signatureCompleteFired = useRef(false);
  useEffect(() => {
    if (hasSignature && !signatureCompleteFired.current) {
      signatureCompleteFired.current = true;
      haptics.success();
    }
    if (!hasSignature) signatureCompleteFired.current = false;
  }, [hasSignature]);

  // Back-gesture / swipe-back guard (spec §1.2) -- the one screen in this
  // spec that intercepts it: a driver mid-checklist with a defect flagged
  // but no description yet typed loses real compliance work if the OS
  // gesture silently discards it (submit() itself already blocks on a
  // missing description, so this is the same rule applied to navigating
  // away instead of submitting). Alert.alert renders as the native
  // UIAlertController on iOS and a Material dialog on Android automatically
  // -- no extra platform branching needed here.
  const hasUnsavedDefect = AREAS.some((a) => areas[a.key].defect && !areas[a.key].description.trim());
  usePreventRemove(hasUnsavedDefect && !done, ({ data }: { data: { action: Parameters<typeof navigation.dispatch>[0] } }) => {
    Alert.alert(t('dvir.discardTitle'), t('dvir.discardMessage'), [
      { text: t('dvir.discardCancel'), style: 'cancel' },
      { text: t('dvir.discardConfirm'), style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  function toggleDefect(key: AreaKey) {
    setAreas((prev) => {
      const next = !prev[key].defect;
      // Warning haptic when a defect is newly flagged (a meaningful,
      // discrete state change worth the stronger tier); a plain Light tap
      // acknowledgment when un-flagging back to OK.
      if (next) haptics.warning();
      else haptics.light();
      return { ...prev, [key]: { ...prev[key], defect: next } };
    });
  }

  // Swipe-right-to-OK accelerator (spec §1.2) -- a secondary path alongside
  // the always-visible OK/Defect buttons, not a replacement for them.
  function markOkViaSwipe(key: AreaKey) {
    setAreas((prev) => (prev[key].defect ? { ...prev, [key]: { ...prev[key], defect: false } } : prev));
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

  // Camera/library choice now goes through the shared native chooser (spec
  // §1.3): ActionSheetIOS on iOS, the Material-styled <PhotoSourceSheet>
  // Modal on Android -- both wired through use-photo-picker.ts instead of
  // this screen hand-rolling permission requests + ImagePicker calls itself.
  function openPhotoPicker(key: AreaKey) {
    setError('');
    androidSheetAreaKey.current = key;
    photoPicker.open((photo) => {
      setAreas((prev) => ({ ...prev, [key]: { ...prev[key], photo } }));
    });
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

    const submissionBody = {
      type: type as 'pre_trip' | 'post_trip',
      odometer: odometer ? Number(odometer) : null,
      defects: defectAreas.map((a) => ({ area: a.key, description: areas[a.key].description.trim(), severity: areas[a.key].severity })),
    };
    const idempotencyKey = keyForSubmission(submissionKey, submissionBody);

    // Captured now regardless of connectivity: SignaturePad's view must still be
    // mounted, so this can't be deferred to replay time the way the upload itself can.
    const signatureBase64 = await signaturePadRef.current?.capture();

    // Offline (or a live attempt that can't reach the server at all): the inspection
    // and its attachments are queued whole, exactly the same "known offline OR the
    // request itself failed to reach the server" split as src/app/load/[id].tsx's
    // advanceStatus. Photo bytes move to local storage (AsyncStorage isn't for blobs);
    // the actual upload happens at replay time via lib/offline-queue.ts.
    const queueForLater = async () => {
      const attachments: DvirAttachmentPayload[] = [];
      if (signatureBase64) {
        const localUri = await savePhotoLocally(signatureBase64, 'png');
        attachments.push({ kind: 'signature', localUri, contentType: 'image/png' });
      }
      for (const a of defectAreas) {
        const photo = areas[a.key].photo;
        if (!photo) continue;
        const localUri = await savePhotoLocally(photo.base64, 'jpg');
        attachments.push({ kind: 'defect_photo', area: a.key, localUri, contentType: 'image/jpeg' });
      }

      await enqueueDvirSubmit(
        { loadId: Number(loadId), idempotencyKey, ...submissionBody, attachments },
        new Date().toISOString()
      );
      await refreshQueueLength();
      submissionKey.current = null;
      setQueued(true);
      setSubmitting(false);
      setDone(true);
    };

    if (!isOnline) {
      await queueForLater();
      return;
    }

    // The inspection AND its defects are ONE atomic call. The server files it as the caller, picks the
    // vehicle (the load's, else the driver's default), and DERIVES the condition from the defects, so an
    // inspection can never claim 'satisfactory' while listing defects. (Previously: inspection insert,
    // then a separate defects insert, so a failure between them left a 'defects_noted' report with no
    // defects: a safety record that lies.)
    let response: Response;
    let data: { id: number; defects: { id: number; area: string }[] } | undefined;
    try {
      ({ data, response } = await apiClient.http.POST('/api/v1/loads/{id}/dvir-inspections', {
        params: { path: { id: Number(loadId) }, header: { 'Idempotency-Key': idempotencyKey } },
        body: submissionBody,
      }));
    } catch {
      await queueForLater(); // couldn't reach the server despite looking online
      return;
    }

    if (!response.ok) {
      setError(t('dvir.errorSubmitFailed'));
      setSubmitting(false);
      return;
    }
    const filed = data ?? null;
    if (!filed) {
      setError(t('dvir.errorSubmitFailed'));
      setSubmitting(false);
      return;
    }
    submissionKey.current = null;

    // Attachments are best-effort: the report is already saved, so a failed signature/photo is a
    // warning on the confirmation screen, never a lost inspection.
    let signatureFailed = false;
    if (signatureBase64) {
      signatureFailed = !(await uploadDvirAttachment(filed.id, { kind: 'signature' }, 'image/png', base64ToArrayBuffer(signatureBase64)));
    }

    let failedPhotos = 0;
    for (const a of defectAreas) {
      const photo = areas[a.key].photo;
      if (!photo) continue;
      const ok = await uploadDvirAttachment(filed.id, { kind: 'defect_photo', area: a.key }, 'image/jpeg', base64ToArrayBuffer(photo.base64));
      if (!ok) failedPhotos += 1;
    }
    setPhotoWarningCount(failedPhotos);

    setSignatureWarning(signatureFailed);
    setSubmitting(false);
    setDone(true);
  }

  if (done) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="title" style={{ color: GREEN, fontSize: 22 }}>
          {queued ? t('dvir.queuedOffline') : t('dvir.submitted')}
        </ThemedText>
        {!queued && photoWarningCount > 0 && (
          <ThemedView style={styles.warningBanner}>
            <ThemedText type="small" style={styles.warningBannerText}>
              {t('dvir.photoUploadFailedWarning', { count: photoWarningCount })}
            </ThemedText>
          </ThemedView>
        )}
        {!queued && signatureWarning && (
          <ThemedView style={styles.warningBanner}>
            <ThemedText type="small" style={styles.warningBannerText}>
              {t('dvir.signatureUploadFailedWarning')}
            </ThemedText>
          </ThemedView>
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
                {/* Swipe-right-to-OK (spec §1.2) -- a secondary accelerator for a
                    driver standing still with two free hands. The tap toggle
                    below remains the primary path for gloved/one-handed use. */}
                <SwipeableRow
                  side="left"
                  label={t('dvir.pass')}
                  color={StatusColors.success}
                  hapticTier="light"
                  onAction={() => markOkViaSwipe(a.key)}
                >
                  <Pressable
                    onPress={() => toggleDefect(a.key)}
                    style={({ pressed }) => [styles.areaHeader, pressed && styles.areaHeaderPressed]}
                  >
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
                </SwipeableRow>

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
                        <Pressable
                          style={({ pressed }) => [styles.photoButton, pressed && styles.photoButtonPressed]}
                          android_ripple={{ color: `${ORANGE}22` }}
                          onPress={() => openPhotoPicker(a.key)}
                        >
                          <ThemedText type="smallBold" themeColor="text">{t('dvir.addPhoto')}</ThemedText>
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

          {(error || photoPicker.error) ? <ThemedText type="small" style={styles.error}>{error || photoPicker.error}</ThemedText> : null}

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

      {/* Android bottom-sheet half of the camera/library chooser -- iOS uses
          ActionSheetIOS imperatively (see openPhotoPicker/use-photo-picker.ts)
          and never opens this. */}
      <PhotoSourceSheet
        visible={photoPicker.androidSheetOpen}
        title={t('dvir.addPhotoSheetTitle')}
        takePhotoLabel={t('dvir.takePhoto')}
        chooseFromLibraryLabel={t('dvir.chooseFromLibrary')}
        cancelLabel={t('common.cancel')}
        onClose={photoPicker.closeAndroidSheet}
        onTakePhoto={() => {
          const key = androidSheetAreaKey.current;
          if (!key) return;
          photoPicker.pickFromAndroidSheet('camera', (photo) => setAreas((prev) => ({ ...prev, [key]: { ...prev[key], photo } })));
        }}
        onChooseFromLibrary={() => {
          const key = androidSheetAreaKey.current;
          if (!key) return;
          photoPicker.pickFromAndroidSheet('library', (photo) => setAreas((prev) => ({ ...prev, [key]: { ...prev[key], photo } })));
        }}
      />
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
  // Distinct visual weight for non-fatal upload warnings on the confirmation
  // screen (spec §1.5) -- an amber banner, separate from the green success
  // state, so it reads as an action item rather than buried prose.
  warningBanner: {
    backgroundColor: '#fff8e1',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.two,
    marginHorizontal: Spacing.four,
  },
  warningBannerText: { color: '#92400e', textAlign: 'center' },
  photoButtonRow: { flexDirection: 'row', gap: Spacing.two },
  photoButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: ORANGE,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  // Pressed-state dim (spec §5.3) -- matches the opacity-dim convention used
  // elsewhere in this app (e.g. components/app-tabs.web.tsx's `pressed` style).
  photoButtonPressed: { opacity: 0.85 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  photoThumb: { width: 64, height: 64, borderRadius: 8 },
  photoMeta: { gap: 4 },
  areaCard: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  areaHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  areaHeaderPressed: { opacity: 0.85 },
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
