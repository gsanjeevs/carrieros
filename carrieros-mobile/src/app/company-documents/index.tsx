// src/app/company-documents/index.tsx
// Company-level compliance documents (COI, general liability, workers comp, MC
// authority, DOT certificate, UCR, W-9, business license) — the mobile
// equivalent of carrieros-web/components/CompanyDocuments.tsx +
// carrieros-web/app/(app)/documents/page.tsx.
//
// Gated the same way as web: org_documents_view to see the list at all
// (owner/solo/finance), org_documents_manage to upload (owner/solo only;
// finance is read-only). Dispatcher/driver have neither capability and never
// get a link to this screen (src/components/settings-content.tsx), but this
// screen still gates directly in case of a deep link.
//
// Upload is the three-step signed-URL contract (ADR 0003), same shape as
// lib/pod-upload.ts / lib/dvir-attachments.ts:
//   1. POST /api/v1/org-documents/uploads  -> server-chosen path + signed PUT url
//   2. PUT the raw bytes to that url
//   3. POST /api/v1/org-documents          -> server verifies the object and records it
// Delete calls DELETE /api/v1/org-documents/{id} via lib/api.ts's apiFetch (the same
// bearer-token raw-fetch helper src/app/team/index.tsx uses), rather than
// apiClient.http, because the generated client (lib/generated/api-types.ts) has no
// delete operation for this path yet — the web app instead deletes via a direct
// Supabase RLS-backed call (components/CompanyDocuments.tsx), which mobile
// deliberately never does (ADR 0003). This id-based DELETE route does not exist in the
// backend yet; adding it is a required follow-up before this button will work.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { useProfileRole } from '@/hooks/use-profile-role';
import { apiClient } from '@/lib/api-client';
import { apiFetch } from '@/lib/api';
import { base64ToArrayBuffer } from '@/lib/base64';
import { formatDate } from '@/lib/format-date';
import { roleHasCapability } from '@/lib/generated/role-capabilities';

const ORANGE = BrandColors.orange;
const EXPIRY_WARNING_DAYS = 30;

// Order matches web's dropdown order.
const DOC_TYPES = [
  'coi',
  'general_liability',
  'workers_comp',
  'mc_authority',
  'dot_certificate',
  'ucr',
  'w9',
  'business_license',
] as const;
type DocType = (typeof DOC_TYPES)[number];

// Content types the upload-slot endpoint accepts.
const CONTENT_TYPE_BY_MIME: Record<string, 'image/jpeg' | 'image/png' | 'image/heic' | 'image/webp' | 'application/pdf'> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/heic': 'image/heic',
  'image/webp': 'image/webp',
  'application/pdf': 'application/pdf',
};

type OrgDocument = {
  id: number;
  doc_type: string;
  expiry_date: string | null;
  created_at: string | null;
  url: string | null;
};

type ExpiryStatus = 'expired' | 'expiringSoon' | null;

// Mirrors carrieros-web/components/CompanyDocuments.tsx's expiryStatus().
function expiryStatus(expiryDate: string | null): ExpiryStatus {
  if (!expiryDate) return null;
  const due = new Date(expiryDate);
  if (Number.isNaN(due.getTime())) return null;
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntil = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (daysUntil < 0) return 'expired';
  if (daysUntil <= EXPIRY_WARNING_DAYS) return 'expiringSoon';
  return null;
}

export default function CompanyDocumentsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, locale } = useLocale();
  const { role, loading: roleLoading } = useProfileRole();

  const canView = roleHasCapability(role, 'org_documents_view');
  const canManage = roleHasCapability(role, 'org_documents_manage');

  const [documents, setDocuments] = useState<OrgDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<DocType>('coi');
  const [expiryInput, setExpiryInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data } = await apiClient.http.GET('/api/v1/org-documents');
    setDocuments((data?.documents as OrgDocument[] | undefined) ?? []);
  }, []);

  useEffect(() => {
    if (roleLoading || !canView) return;
    load().finally(() => setLoading(false));
  }, [roleLoading, canView, load]);

  function validExpiryDate(): string | null | undefined {
    // Returns undefined for an invalid entry (caller should abort), null for
    // "no expiry set" (optional field), or the YYYY-MM-DD string.
    const trimmed = expiryInput.trim();
    if (!trimmed) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || Number.isNaN(new Date(trimmed).getTime())) return undefined;
    return trimmed;
  }

  async function pickAndUpload() {
    if (uploading) return;
    setError('');

    const expiryDate = validExpiryDate();
    if (expiryDate === undefined) {
      setError(t('companyDocuments.errorInvalidExpiry'));
      return;
    }

    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;

    const asset = result.assets?.[0];
    if (!asset) return;

    const contentType = asset.mimeType ? CONTENT_TYPE_BY_MIME[asset.mimeType] : undefined;
    if (!contentType) {
      setError(t('companyDocuments.errorUnsupportedType'));
      return;
    }

    const MAX_BYTES = 10 * 1024 * 1024;
    const sizeBytes = asset.size ?? new File(asset.uri).size ?? 0;
    if (sizeBytes > MAX_BYTES) {
      setError(t('companyDocuments.errorTooLarge'));
      return;
    }

    setUploading(true);
    try {
      // 1. Ask for an upload slot.
      const slot = await apiClient.http.POST('/api/v1/org-documents/uploads', {
        body: { doc_type: selectedType, content_type: contentType, size_bytes: sizeBytes, expiry_date: expiryDate },
      });
      if (!slot.data) {
        setError(t('companyDocuments.errorUploadFailed'));
        return;
      }

      // 2. Bytes go straight to storage.
      const base64 = await new File(asset.uri).base64();
      const bytes = base64ToArrayBuffer(base64);
      const put = await fetch(slot.data.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': slot.data.content_type },
        body: bytes,
      });
      if (!put.ok) {
        setError(t('companyDocuments.errorUploadFailed'));
        return;
      }

      // 3. Record it.
      const { response } = await apiClient.http.POST('/api/v1/org-documents', {
        body: { doc_type: selectedType, storage_path: slot.data.storage_path, expiry_date: expiryDate },
      });
      if (!response.ok) {
        setError(t('companyDocuments.errorSaveFailed'));
        return;
      }

      setExpiryInput('');
      await load();
    } catch {
      setError(t('companyDocuments.errorUploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  function confirmDelete(doc: OrgDocument) {
    if (deletingId !== null) return;
    Alert.alert(
      t('companyDocuments.deleteConfirmTitle'),
      t('companyDocuments.deleteConfirmMessage', { type: t(`companyDocuments.type.${doc.doc_type}`, { defaultValue: doc.doc_type }) }),
      [
        { text: t('companyDocuments.deleteCancel'), style: 'cancel' },
        { text: t('companyDocuments.delete'), style: 'destructive', onPress: () => handleDelete(doc.id) },
      ]
    );
  }

  async function handleDelete(id: number) {
    setError('');
    setDeletingId(id);
    try {
      const response = await apiFetch(`/api/v1/org-documents/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        setError(t('companyDocuments.errorDeleteFailed'));
        return;
      }
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch {
      setError(t('companyDocuments.errorDeleteFailed'));
    } finally {
      setDeletingId(null);
    }
  }

  if (roleLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
        </Pressable>
        <ThemedText type="title" style={styles.heading}>{t('companyDocuments.title')}</ThemedText>

        {!canView ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>{t('companyDocuments.noAccess')}</ThemedText>
        ) : (
          <ScrollView contentContainerStyle={styles.listContent}>
            {canManage && (
              <ThemedView style={[styles.uploadCard, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="smallBold" style={styles.sectionLabel}>{t('companyDocuments.uploadTitle')}</ThemedText>

                <View style={styles.typeRow}>
                  {DOC_TYPES.map((docType) => {
                    const selected = docType === selectedType;
                    return (
                      <Pressable
                        key={docType}
                        onPress={() => setSelectedType(docType)}
                        style={[
                          styles.typeChip,
                          { borderColor: selected ? ORANGE : theme.backgroundSelected },
                        ]}
                      >
                        <ThemedText
                          type="small"
                          style={selected ? { color: ORANGE, fontWeight: 700 } : undefined}
                        >
                          {t(`companyDocuments.type.${docType}`)}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>

                <ThemedText type="small" themeColor="textSecondary">{t('companyDocuments.expiryLabel')}</ThemedText>
                <TextInput
                  value={expiryInput}
                  onChangeText={setExpiryInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { borderColor: theme.backgroundSelected, color: theme.text }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Pressable
                  onPress={pickAndUpload}
                  disabled={uploading}
                  style={[styles.uploadButton, uploading && styles.uploadButtonDisabled]}
                >
                  {uploading ? (
                    <ActivityIndicator color={ORANGE} />
                  ) : (
                    <ThemedText type="smallBold" themeColor="text">{t('companyDocuments.chooseFile')}</ThemedText>
                  )}
                </Pressable>

                {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}
              </ThemedView>
            )}

            {loading ? (
              <ActivityIndicator />
            ) : documents.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                {t('companyDocuments.empty')}
              </ThemedText>
            ) : (
              documents.map((doc) => {
                const status = expiryStatus(doc.expiry_date);
                return (
                  <ThemedView key={doc.id} style={[styles.card, { backgroundColor: theme.card }, styles.cardShadow]}>
                    <ThemedView type="transparent" style={styles.rowBetween}>
                      <ThemedText type="smallBold">{t(`companyDocuments.type.${doc.doc_type}`, { defaultValue: doc.doc_type })}</ThemedText>
                      {status && (
                        <ThemedView
                          style={[
                            styles.badge,
                            { backgroundColor: status === 'expired' ? StatusColors.dangerLight : StatusColors.warningLight },
                          ]}
                        >
                          <ThemedText
                            type="small"
                            style={{ color: status === 'expired' ? StatusColors.dangerDark : StatusColors.warningDark }}
                          >
                            {t(status === 'expired' ? 'companyDocuments.expired' : 'companyDocuments.expiringSoon')}
                          </ThemedText>
                        </ThemedView>
                      )}
                    </ThemedView>
                    {doc.expiry_date && (
                      <ThemedText type="small" themeColor="textSecondary">
                        {t('companyDocuments.expiresOn', { date: formatDate(doc.expiry_date, locale) })}
                      </ThemedText>
                    )}
                    {doc.created_at && (
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatDate(doc.created_at, locale)}
                      </ThemedText>
                    )}
                    <ThemedView type="transparent" style={styles.rowBetween}>
                      {doc.url && (
                        <Pressable onPress={() => Linking.openURL(doc.url as string)}>
                          <ThemedText type="link" themeColor="textSecondary">{t('companyDocuments.view')}</ThemedText>
                        </Pressable>
                      )}
                      {canManage && (
                        <Pressable onPress={() => confirmDelete(doc)} disabled={deletingId === doc.id}>
                          {deletingId === doc.id ? (
                            <ActivityIndicator size="small" color={StatusColors.dangerDark} />
                          ) : (
                            <ThemedText type="link" style={{ color: StatusColors.dangerDark }}>
                              {t('companyDocuments.delete')}
                            </ThemedText>
                          )}
                        </Pressable>
                      )}
                    </ThemedView>
                  </ThemedView>
                );
              })
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  backLink: { paddingVertical: Spacing.two },
  heading: { fontSize: 24, marginBottom: Spacing.three },
  listContent: { gap: Spacing.two, paddingBottom: Spacing.four },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  sectionLabel: { marginBottom: 4 },
  uploadCard: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two, marginBottom: Spacing.two },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  typeChip: { borderWidth: 1, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  input: { borderWidth: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 },
  uploadButton: {
    borderWidth: 1,
    borderColor: ORANGE,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  uploadButtonDisabled: { opacity: 0.5 },
  error: { color: StatusColors.dangerDark },
  card: { borderRadius: 16, padding: Spacing.three, gap: 4 },
  cardShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' },
  badge: { borderRadius: 12, paddingVertical: 2, paddingHorizontal: 8 },
});
