// src/components/pod-section.tsx
// Proof-of-delivery photo capture for a load. Rendered from
// src/app/load/[id].tsx for driver + solo roles.
//
// Data path (ADR 0003): everything goes through the shared API, none of it through
// supabase.from()/storage. Uploading is three steps (lib/pod-upload.ts) so the photo
// bytes never pass through the API (serverless hosts cap request bodies at a few MB):
//   1. POST /loads/{id}/document-uploads  -> server-chosen path + signed upload URL
//   2. PUT the JPEG bytes to that URL (straight to storage)
//   3. POST /loads/{id}/documents         -> server verifies the object exists at the
//                                            issued path and records it
// The server decides who may upload to which load and what path is used; this
// component never builds a storage path.
//
// Offline: known-offline, or a live attempt that can't reach the server at all, saves
// the photo to local storage and queues a pod.upload command (lib/offline-queue.ts)
// instead of losing it -- proof of delivery on rural cellular can't depend on signal at
// the loading dock. The queue replays the exact same three steps once online, requesting
// a fresh signed URL at that time (see lib/pod-upload.ts / offline-queue.ts).
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { useOfflineSync } from '@/hooks/use-offline-sync';
import { base64ToArrayBuffer } from '@/lib/base64';
import { formatDate } from '@/lib/format-date';
import { apiClient } from '@/lib/api-client';
import { newIdempotencyKey } from '@/lib/idempotency';
import { savePhotoLocally } from '@/lib/local-photo-store';
import { enqueuePodUpload } from '@/lib/offline-queue';
import { uploadPodPhoto } from '@/lib/pod-upload';

const ORANGE = BrandColors.orange;

type PodDoc = {
  id: number;
  created_at: string | null;
  signedUrl: string | null;
};

export function PodSection({ loadId }: { loadId: number }) {
  const { t, locale } = useLocale();
  const theme = useTheme();
  const { isOnline, refreshQueueLength } = useOfflineSync();

  const [docs, setDocs] = useState<PodDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [queuedNotice, setQueuedNotice] = useState(false);

  const loadDocs = useCallback(async () => {
    // The API returns each document with a short-lived signed download URL.
    try {
      const { data } = await apiClient.http.GET('/api/v1/loads/{id}/documents', {
        params: { path: { id: loadId }, query: { type: 'pod' } },
      });
      setDocs((data?.documents ?? []).map((d) => ({ id: d.id, created_at: d.created_at, signedUrl: d.url })));
    } catch {
      setDocs([]);
    }
  }, [loadId]);

  useEffect(() => {
    loadDocs().finally(() => setLoading(false));
  }, [loadDocs]);

  async function pick(source: 'camera' | 'library') {
    if (uploading) return; // guards a double-tap before setUploading lands

    setError('');

    // Permissions are no-ops on web (browser file input / getUserMedia
    // prompt handles it), but must be requested before launching on native.
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setError(source === 'camera' ? t('pod.errorCameraDenied') : t('pod.errorLibraryDenied'));
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.7,
      base64: true, // see src/lib/base64.ts for why we don't use Blob
    };

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled) return;

    const asset = result.assets?.[0];
    if (!asset?.base64) {
      setError(t('pod.errorNoImageData'));
      return;
    }

    await upload(asset.base64);
  }

  // Photo bytes go to local storage and a command is queued instead of uploaded, exactly
  // the same "known offline OR the live attempt couldn't reach the server" split as
  // src/app/load/[id].tsx's advanceStatus.
  async function queueForLater(base64: string) {
    const localUri = await savePhotoLocally(base64, 'jpg');
    await enqueuePodUpload({ loadId, idempotencyKey: newIdempotencyKey(), localUri, contentType: 'image/jpeg' }, new Date().toISOString());
    await refreshQueueLength();
    setQueuedNotice(true);
  }

  async function upload(base64: string) {
    setUploading(true);
    setError('');
    setQueuedNotice(false);

    try {
      if (!isOnline) {
        await queueForLater(base64);
        return;
      }

      const bytes = base64ToArrayBuffer(base64);
      const result = await uploadPodPhoto(loadId, 'image/jpeg', bytes);
      if (!result.ok) {
        if (result.step === 'exception') {
          await queueForLater(base64); // couldn't reach the server despite looking online
          return;
        }
        setError(result.step === 'finalize' ? t('pod.errorSaveFailed') : t('pod.errorUploadFailed'));
        return;
      }

      await loadDocs();
    } finally {
      setUploading(false);
    }
  }

  return (
    <ThemedView type="backgroundElement" style={styles.section}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
        {t('pod.sectionTitle').toUpperCase()}
      </ThemedText>

      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.button, uploading && styles.buttonDisabled]}
          disabled={uploading}
          onPress={() => pick('camera')}
        >
          <ThemedText type="smallBold" themeColor="text">{t('pod.takePhoto')}</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.button, uploading && styles.buttonDisabled]}
          disabled={uploading}
          onPress={() => pick('library')}
        >
          <ThemedText type="smallBold" themeColor="text">{t('pod.chooseFromLibrary')}</ThemedText>
        </Pressable>
      </View>

      {uploading && (
        <View style={styles.uploadingRow}>
          <ActivityIndicator color={ORANGE} />
          <ThemedText type="small" themeColor="textSecondary">{t('pod.uploading')}</ThemedText>
        </View>
      )}

      {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}
      {queuedNotice ? <ThemedText type="small" style={styles.queued}>{t('pod.queuedOffline')}</ThemedText> : null}

      {loading ? (
        <ActivityIndicator />
      ) : docs.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">{t('pod.empty')}</ThemedText>
      ) : (
        <View style={styles.thumbRow}>
          {docs.map((d) => (
            <View key={d.id} style={styles.thumbWrap}>
              {d.signedUrl ? (
                <Image source={{ uri: d.signedUrl }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }, styles.thumbMissing]} />
              )}
              <ThemedText type="small" themeColor="textSecondary" style={styles.thumbCaption}>
                {d.created_at ? formatDate(d.created_at, locale) : ''}
              </ThemedText>
            </View>
          ))}
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two, marginBottom: Spacing.two },
  sectionLabel: { marginBottom: 4, letterSpacing: 0.5 },
  buttonRow: { flexDirection: 'row', gap: Spacing.two },
  button: {
    flex: 1,
    borderWidth: 1,
    borderColor: ORANGE,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  error: { color: StatusColors.danger },
  queued: { color: '#d97706' },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  thumbWrap: { width: 88 },
  thumb: { width: 88, height: 88, borderRadius: 8 },
  thumbMissing: { opacity: 0.4 },
  thumbCaption: { marginTop: 2 },
});
