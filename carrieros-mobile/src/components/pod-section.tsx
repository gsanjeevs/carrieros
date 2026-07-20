// src/components/pod-section.tsx
// Proof-of-delivery photo capture for a load. Rendered from
// src/app/load/[id].tsx for driver + solo roles.
//
// Storage contract (must be matched exactly or the upload 403s):
//   bucket `documents` (PRIVATE) — path `{carrier_org_id}/loads/{load_id}/{file}`
// RLS on storage.objects keys INSERT/SELECT off the FIRST path segment
// equalling the caller's org id. Only owner/solo may DELETE, which is why the
// orphan-cleanup path below can fail for a driver and falls back to surfacing
// the orphaned path in the error message.
//
// The bucket is private, so listing thumbnails uses createSignedUrl() —
// getPublicUrl() returns a URL that always 400s here.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useLocale } from '@/hooks/use-locale';
import { base64ToArrayBuffer } from '@/lib/base64';
import { supabase } from '@/lib/supabase';
import { resolveSubmitter } from '@/lib/submitter';

const ORANGE = '#f97316';
const BUCKET = 'documents';
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1h — plenty for a screen session

type PodDoc = {
  id: number;
  storage_path: string;
  created_at: string | null;
  signedUrl: string | null;
};

export function PodSection({ loadId }: { loadId: number }) {
  const { t } = useLocale();

  const [docs, setDocs] = useState<PodDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const loadDocs = useCallback(async () => {
    const { data, error: fetchErr } = await supabase
      .from('documents')
      .select('id, storage_path, created_at')
      .eq('load_id', loadId)
      .eq('type', 'pod')
      .order('created_at', { ascending: false });

    if (fetchErr || !data) {
      setDocs([]);
      return;
    }

    // One signed URL per object. createSignedUrls() (plural) exists but
    // returns per-path errors inline; the loop keeps the mapping obvious and
    // a POD list is small by nature.
    const withUrls = await Promise.all(
      data.map(async (d) => {
        const { data: signed } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(d.storage_path, SIGNED_URL_TTL_SECONDS);
        return { ...d, signedUrl: signed?.signedUrl ?? null };
      })
    );
    setDocs(withUrls);
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
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        setError(t('pod.errorNotSignedIn'));
        return;
      }

      const submitter = await resolveSubmitter(userId);
      if (!submitter) {
        setError(t('pod.errorResolveAccount'));
        return;
      }

      const storagePath = `${submitter.carrierOrgId}/loads/${loadId}/pod-${Date.now()}.jpg`;
      const body = base64ToArrayBuffer(base64);

      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, body, { contentType: 'image/jpeg', upsert: false });

      if (uploadErr) {
        setError(t('pod.errorUploadFailed'));
        return;
      }

      const { error: insertErr } = await supabase.from('documents').insert({
        load_id: loadId,
        carrier_org_id: submitter.carrierOrgId,
        type: 'pod',
        storage_path: storagePath,
        uploaded_by: userId,
      });

      if (insertErr) {
        // Don't leave a silent orphan in the bucket. Drivers can't DELETE
        // from storage (owner/solo only), so if the cleanup itself fails we
        // name the orphaned path in the error instead of swallowing it.
        const { error: removeErr } = await supabase.storage.from(BUCKET).remove([storagePath]);
        setError(
          removeErr
            ? t('pod.errorSaveFailedOrphan', { path: storagePath })
            : t('pod.errorSaveFailed')
        );
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
                <View style={[styles.thumb, styles.thumbMissing]} />
              )}
              <ThemedText type="small" themeColor="textSecondary" style={styles.thumbCaption}>
                {d.created_at ? new Date(d.created_at).toLocaleDateString() : ''}
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
  error: { color: '#dc2626' },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  thumbWrap: { width: 88 },
  thumb: { width: 88, height: 88, borderRadius: 8, backgroundColor: '#00000022' },
  thumbMissing: { opacity: 0.4 },
  thumbCaption: { marginTop: 2 },
});
