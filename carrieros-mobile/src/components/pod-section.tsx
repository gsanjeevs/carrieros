// src/components/pod-section.tsx
// Proof-of-delivery photo capture for a load. Rendered from
// src/app/load/[id].tsx for driver + solo roles.
//
// Data path (ADR 0003): everything goes through the shared API, none of it through
// supabase.from()/storage. Uploading is three steps so the photo bytes never pass
// through the API (serverless hosts cap request bodies at a few MB):
//   1. POST /loads/{id}/document-uploads  -> server-chosen path + signed upload URL
//   2. PUT the JPEG bytes to that URL (straight to storage)
//   3. POST /loads/{id}/documents         -> server verifies the object exists at the
//                                            issued path and records it
// The server decides who may upload to which load and what path is used; this
// component never builds a storage path.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { base64ToArrayBuffer } from '@/lib/base64';
import { formatDate } from '@/lib/format-date';
import { apiClient } from '@/lib/api-client';
import { keyForSubmission } from '@/lib/idempotency';
import { logError } from '@/lib/observability';

const ORANGE = BrandColors.orange;

type PodDoc = {
  id: number;
  created_at: string | null;
  signedUrl: string | null;
};

export function PodSection({ loadId }: { loadId: number }) {
  const { t, locale } = useLocale();
  const theme = useTheme();

  const [docs, setDocs] = useState<PodDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const submissionKey = useRef<{ key: string; body: string } | null>(null);

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

  async function upload(base64: string) {
    setUploading(true);
    setError('');

    try {
      const bytes = base64ToArrayBuffer(base64);

      // 1. Ask for an upload slot. The server authorizes this actor for THIS load and chooses the path.
      const slot = await apiClient.http.POST('/api/v1/loads/{id}/document-uploads', {
        params: { path: { id: loadId } },
        body: { type: 'pod', content_type: 'image/jpeg', size_bytes: bytes.byteLength },
      });
      if (!slot.data) {
        logError({ where: 'pod-upload', step: 'request-slot', status: slot.response.status, bytes: bytes.byteLength }, slot.error);
        setError(t('pod.errorUploadFailed'));
        return;
      }

      // 2. Bytes go straight to storage. An ArrayBuffer (not a Blob) is required on RN, see lib/base64.ts.
      const put = await fetch(slot.data.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': slot.data.content_type },
        body: bytes,
      });
      if (!put.ok) {
        logError({ where: 'pod-upload', step: 'put-bytes', status: put.status, bytes: bytes.byteLength }, await put.text().catch(() => ''));
        setError(t('pod.errorUploadFailed'));
        return;
      }

      // 3. Record it. The server verifies the object is really there; a retry with the same key applies once.
      const body = { type: 'pod' as const, storage_path: slot.data.storage_path };
      const { response } = await apiClient.http.POST('/api/v1/loads/{id}/documents', {
        params: { path: { id: loadId }, header: { 'Idempotency-Key': keyForSubmission(submissionKey, body) } },
        body,
      });
      if (!response.ok) {
        logError({ where: 'pod-upload', step: 'finalize', status: response.status }, await response.text().catch(() => ''));
        setError(t('pod.errorSaveFailed'));
        return;
      }

      submissionKey.current = null;
      await loadDocs();
    } catch (e) {
      logError({ where: 'pod-upload', step: 'exception' }, e); // no signal, etc.
      setError(t('pod.errorUploadFailed'));
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
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  thumbWrap: { width: 88 },
  thumb: { width: 88, height: 88, borderRadius: 8 },
  thumbMissing: { opacity: 0.4 },
  thumbCaption: { marginTop: 2 },
});
