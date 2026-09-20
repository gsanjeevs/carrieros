// src/app/invoice/[id].tsx
// Invoice detail + write access (audit gap) — src/app/(tabs)/invoices.tsx
// was read-only ("No invoice-detail screen exists in mobile yet"). Mirrors
// carrieros-web/app/(app)/invoices/actions.ts's three mutations, gated to
// the same roles as invoices' own RLS (`billing_invoices_all`:
// owner/solo/finance — dispatcher has no invoice access at all, matching
// web).
//
// markInvoicePaid/updateInvoiceDraft have no side effect beyond DB writes,
// so this screen does them directly against Supabase (RLS-protected) —
// same "plain RLS-protected CRUD talks directly to Supabase" posture
// (decisions.md R3b) already used by DVIR/fuel-stops elsewhere in mobile.
// Marking an invoice SENT is different: it really emails the customer via
// server-side SMTP (lib/send-email.ts), which a mobile client has no
// credentials for, so that one action calls the new
// POST /api/invoices/[id]/send route (lib/invoice-actions.ts's
// sendInvoiceAndMarkSent — the exact same function the web server action
// calls) via apiFetch instead of writing to the table directly.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, INVOICE_STATUS_PILL, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { useProfileRole } from '@/hooks/use-profile-role';
import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format-date';
import { formatMoney } from '@/lib/format-money';

const ORANGE = BrandColors.orange;const WRITE_ROLES = ['owner', 'solo', 'finance'];

type InvoiceDetail = {
  id: number;
  invoice_number: string;
  amount: number;
  status: string;
  due_date: string | null;
  notes: string | null;
  sent_at: string | null;
  paid_at: string | null;
  opened_at: string | null;
  load_id: number | null;
};

export default function InvoiceDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, locale } = useLocale();
  const { role } = useProfileRole();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const canWrite = role != null && WRITE_ROLES.includes(role);

  const load = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .from('invoices')
      .select('id, invoice_number, amount, status, due_date, notes, sent_at, paid_at, opened_at, load_id')
      .eq('id', Number(id))
      .maybeSingle();

    const inv = data as InvoiceDetail | null;
    setInvoice(inv);
    if (inv) {
      setAmount(String(inv.amount));
      setDueDate(inv.due_date ?? '');
      setNotes(inv.notes ?? '');
    }
  }, [id]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function saveDraft() {
    if (!invoice) return;
    setBusy(true);
    setError('');
    setSaved(false);

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError(t('invoices.errorInvalidAmount'));
      setBusy(false);
      return;
    }

    const { error: updateErr } = await supabase
      .from('invoices')
      .update({ amount: numericAmount, due_date: dueDate || null, notes: notes || null })
      .eq('id', invoice.id)
      .eq('status', 'draft');

    setBusy(false);
    if (updateErr) {
      setError(t('invoices.errorSaveFailed'));
      return;
    }
    setSaved(true);
    await load();
  }

  async function markSent() {
    if (!invoice) return;
    setBusy(true);
    setError('');

    const res = await apiFetch(`/api/invoices/${invoice.id}/send`, { method: 'POST' });
    setBusy(false);
    if (!res.ok) {
      setError(t('invoices.errorSendFailed'));
      return;
    }
    await load();
  }

  async function markPaid() {
    if (!invoice) return;
    setBusy(true);
    setError('');

    const { error: updateErr } = await supabase
      .from('invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', invoice.id);

    if (!updateErr && invoice.load_id) {
      await supabase.from('loads').update({ status: 'paid' }).eq('id', invoice.load_id);
    }

    setBusy(false);
    if (updateErr) {
      setError(t('invoices.errorMarkPaidFailed'));
      return;
    }
    await load();
  }

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!invoice) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="default" themeColor="textSecondary">{t('invoices.notFound')}</ThemedText>
      </ThemedView>
    );
  }

  const pill = INVOICE_STATUS_PILL[invoice.status] ?? INVOICE_STATUS_PILL.draft;

  return (
    <ThemedView style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
          </Pressable>

          <ThemedView style={styles.headerRow} type="transparent">
            <ThemedText type="title">{invoice.invoice_number}</ThemedText>
            <ThemedView style={[styles.statusPill, { backgroundColor: pill.bg }]}>
              <ThemedText type="small" style={[styles.statusPillText, { color: pill.text }]}>
                {t(`invoices.status.${invoice.status}` as never)}
              </ThemedText>
            </ThemedView>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <InfoRow label={t('invoices.amount')} value={formatMoney(Number(invoice.amount), locale)} />
            <InfoRow label={t('invoices.due')} value={invoice.due_date ?? '—'} />
            <InfoRow label={t('invoices.sentAt')} value={invoice.sent_at ? formatDateTime(invoice.sent_at, locale) : t('invoices.notSentYet')} />
            <InfoRow label={t('invoices.openedAt')} value={invoice.opened_at ? formatDateTime(invoice.opened_at, locale) : t('invoices.notOpenedYet')} />
            <InfoRow label={t('invoices.paidAt')} value={invoice.paid_at ? formatDateTime(invoice.paid_at, locale) : t('invoices.notPaidYet')} />
          </ThemedView>

          {canWrite && invoice.status === 'draft' && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold" style={styles.sectionLabel}>{t('invoices.editDraft').toUpperCase()}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{t('invoices.amount')}</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
              />
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{t('invoices.due')}</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                value={dueDate}
                onChangeText={setDueDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.textSecondary}
              />
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{t('invoices.notes')}</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                value={notes}
                onChangeText={setNotes}
                multiline
              />
              <Pressable onPress={saveDraft} disabled={busy} style={[styles.secondaryButton, busy && styles.buttonDisabled]}>
                <ThemedText type="smallBold" style={{ color: ORANGE }}>{t('invoices.saveDraft')}</ThemedText>
              </Pressable>
            </ThemedView>
          )}

          {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}
          {saved ? <ThemedText type="small" style={styles.saved}>{t('invoices.saved')}</ThemedText> : null}

          {canWrite && invoice.status === 'draft' && (
            <Pressable onPress={markSent} disabled={busy} style={[styles.primaryButton, busy && styles.buttonDisabled]}>
              {busy ? <ActivityIndicator color="#ffffff" /> : (
                <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('invoices.markSent')}</ThemedText>
              )}
            </Pressable>
          )}

          {canWrite && (invoice.status === 'sent' || invoice.status === 'overdue') && (
            <Pressable onPress={markPaid} disabled={busy} style={[styles.primaryButton, busy && styles.buttonDisabled]}>
              {busy ? <ActivityIndicator color="#ffffff" /> : (
                <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('invoices.markPaid')}</ThemedText>
              )}
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView style={styles.infoRow} type="transparent">
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  scrollContent: { paddingBottom: Spacing.six, gap: Spacing.two },
  backLink: { paddingVertical: Spacing.two },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.two },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontWeight: '700' },
  section: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  sectionLabel: { letterSpacing: 0.5, marginBottom: 4 },
  fieldLabel: { marginTop: Spacing.one },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  error: { color: StatusColors.danger },
  saved: { color: '#16a34a' },
  primaryButton: { backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: Spacing.two },
  secondaryButton: { borderWidth: 1, borderColor: ORANGE, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: Spacing.one },
  buttonDisabled: { opacity: 0.5 },
});
