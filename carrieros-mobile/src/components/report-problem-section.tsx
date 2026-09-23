// src/components/report-problem-section.tsx
// Driver "Problem / Delay" reporting (mockup-03 Screen 3's 4th status
// option — previously the only gap in the whole safety/ops audit flagged as
// "most relevant"). A driver could advance load status but had no way to
// tell dispatch something is wrong short of a phone call. Writes directly
// to exception_events (R3b category 2 — plain RLS-protected insert, no
// server secret needed, so no Next.js route) via the
// driver_exception_events_insert policy, which locks a driver to only their
// own assigned load and this exact event_type — see supabase/schema/schema.sql.
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { useSession } from '@/hooks/use-session';
import { apiClient } from '@/lib/api-client';
import { keyForSubmission } from '@/lib/idempotency';

const RED = StatusColors.danger;

// Reason codes are stable identifiers, never translated text, stored in
// exception_events.title as `reason:<code>` — the exceptions inbox (a
// separate, not-yet-built display task) reads the code, not the English
// label, so it can render in the reader's own locale.
const REASON_CODES = ['breakdown', 'traffic', 'weather', 'accident', 'customer_issue', 'other'] as const;
type ReasonCode = (typeof REASON_CODES)[number];

export function ReportProblemSection({ loadId }: { loadId: number }) {
  const theme = useTheme();
  const { t } = useLocale();
  const { session } = useSession();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReasonCode | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const submissionKey = useRef<{ key: string; body: string } | null>(null);

  async function submit() {
    if (!reason || !session?.user.id) return;
    setSubmitting(true);
    setError('');

    // Org, reporter and severity are decided server-side; the reason is a code the
    // Exceptions inbox renders in the reader's own language.
    const body = { reason, note: note.trim() || null };
    let ok = false;
    try {
      const { response } = await apiClient.http.POST('/api/v1/loads/{id}/problem-reports', {
        params: { path: { id: loadId }, header: { 'Idempotency-Key': keyForSubmission(submissionKey, body) } },
        body,
      });
      ok = response.ok;
    } catch {
      ok = false;
    }
    const insertErr = ok ? null : true;

    if (insertErr) {
      setError(t('loadDetail.reportProblemError'));
      setSubmitting(false);
      return;
    }

    submissionKey.current = null;
    setSubmitting(false);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <ThemedView type="backgroundElement" style={styles.section}>
        <ThemedText type="smallBold" style={{ color: '#16a34a' }}>
          {t('loadDetail.reportProblemSent')}
        </ThemedText>
      </ThemedView>
    );
  }

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={[styles.openButton, { borderColor: RED }]}>
        <ThemedText type="smallBold" style={{ color: RED }}>
          {t('loadDetail.reportProblem')}
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <ThemedView type="backgroundElement" style={styles.section}>
      <ThemedText type="smallBold">{t('loadDetail.reportProblemTitle')}</ThemedText>

      <ThemedView type="transparent" style={styles.reasonGrid}>
        {REASON_CODES.map((code) => (
          <Pressable
            key={code}
            onPress={() => setReason(code)}
            style={[
              styles.reasonChip,
              { borderColor: reason === code ? RED : theme.border },
            ]}
          >
            <ThemedText type="small">{t(`loadDetail.problemReason.${code}`)}</ThemedText>
          </Pressable>
        ))}
      </ThemedView>

      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={t('loadDetail.reportProblemNotePlaceholder')}
        placeholderTextColor={theme.textSecondary}
        multiline
        style={[styles.noteInput, { color: theme.text, borderColor: theme.border }]}
      />

      {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

      <ThemedView type="transparent" style={styles.buttonRow}>
        <Pressable onPress={() => setOpen(false)} style={styles.cancelButton}>
          <ThemedText type="small" themeColor="textSecondary">{t('common.cancel')}</ThemedText>
        </Pressable>
        <Pressable
          onPress={submit}
          disabled={!reason || submitting}
          style={[styles.submitButton, { backgroundColor: RED }, (!reason || submitting) && styles.disabled]}
        >
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('loadDetail.reportProblemSubmit')}</ThemedText>
          )}
        </Pressable>
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two, marginBottom: Spacing.two },
  openButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  reasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, backgroundColor: 'transparent' },
  reasonChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  noteInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: Spacing.two,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  buttonRow: { flexDirection: 'row', gap: Spacing.two, backgroundColor: 'transparent' },
  cancelButton: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  submitButton: { flex: 2, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  error: { color: RED },
});
