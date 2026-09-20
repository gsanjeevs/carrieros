// src/app/vehicle/[id].tsx
// Vehicle detail + "Log Service" — owner/solo only, matching
// service_logs/maintenance_reminders RLS (owner_solo_*_all: dispatcher and
// finance can read maintenance but not write it). Pushed from
// (tabs)/fleet.tsx's now-pressable cards. Vehicle create/edit stays
// web-only — see fleet.tsx's own header comment — this screen only adds
// service history, it never edits the vehicle row itself.
//
// Mirrors carrieros-web/app/(app)/maintenance/LogServiceButton.tsx's
// service_logs insert + maintenance_reminders reschedule, minus the
// "create a new reminder" sub-form — mobile only lets you log against an
// existing reminder or with none, keeping the picker to one screen's worth
// of UI. Full reminder authoring stays a web-only action for now.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import { useLocale } from '@/hooks/use-locale';
import { useProfileRole } from '@/hooks/use-profile-role';
import { apiClient } from '@/lib/api-client';
import { roleHasCapability } from '@/lib/generated/role-capabilities';
import { keyForSubmission } from '@/lib/idempotency';

const ORANGE = BrandColors.orange;

type VehicleDetail = { id: number; vehicle_number: string | null; nickname: string; status: string };
type ServiceLog = {
  id: number;
  service_type: string;
  service_date: string;
  odometer: number | null;
  cost: number | null;
  shop_name: string | null;
};
type Reminder = { id: number; reminder_type: string; trigger_miles: number | null; trigger_months: number | null };

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


const NO_REMINDER = '';

export default function VehicleDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const { t } = useLocale();
  const { role } = useProfileRole();

  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [logs, setLogs] = useState<ServiceLog[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [reminderId, setReminderId] = useState(NO_REMINDER);
  const [serviceType, setServiceType] = useState('');
  const [serviceDate, setServiceDate] = useState(todayISO());
  const [odometer, setOdometer] = useState('');
  const [cost, setCost] = useState('');
  const [shopName, setShopName] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    if (!id) return;
    const { data } = await apiClient.http.GET('/api/v1/vehicles/{id}', { params: { path: { id: Number(id) } } });
    setVehicle(data ? { id: data.id, vehicle_number: data.vehicle_number, nickname: data.nickname, status: data.status } : null);
    setLogs(data?.service_logs ?? []);
    setReminders(data?.maintenance_reminders ?? []);
  }, [id]);

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  const submissionKey = useRef<{ key: string; body: string } | null>(null);
  const selectedReminder = reminders.find((r) => String(r.id) === reminderId);

  async function submitService() {
    if (!vehicle || !session?.user.id) return;

    const type = selectedReminder?.reminder_type ?? serviceType.trim();
    if (!type) {
      setError(t('vehicleDetail.serviceTypeRequired'));
      return;
    }

    setSubmitting(true);
    setError('');

    const odometerNum = odometer ? Number(odometer) : null;
    const costNum = cost ? Number(cost) : null;

    // Service log + the reminder it satisfies are ONE atomic call. Org, logger and the reminder's
    // next-due date/miles (including month-end handling) are all computed server-side.
    const body = {
      service_type: type,
      service_date: serviceDate,
      odometer: odometerNum,
      cost: costNum,
      shop_name: shopName.trim() || null,
      notes: notes.trim() || null,
      reminder_id: selectedReminder?.id ?? null,
    };
    let failed: boolean;
    try {
      const { response } = await apiClient.http.POST('/api/v1/vehicles/{id}/service-logs', {
        params: { path: { id: vehicle.id }, header: { 'Idempotency-Key': keyForSubmission(submissionKey, body) } },
        body,
      });
      failed = !response.ok;
    } catch {
      failed = true;
    }
    if (failed) {
      setError(t('vehicleDetail.logServiceFailed'));
      setSubmitting(false);
      return;
    }
    submissionKey.current = null;

    setSubmitting(false);
    setFormOpen(false);
    setReminderId(NO_REMINDER);
    setServiceType('');
    setServiceDate(todayISO());
    setOdometer('');
    setCost('');
    setShopName('');
    setNotes('');
    await fetchAll();
  }

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!vehicle) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="default" themeColor="textSecondary">{t('vehicleDetail.notFound')}</ThemedText>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  // Same capability the server checks in carrieros-web's
  // server/application/field-actions-service.ts (`service_log`), read from the
  // generated role_capabilities table — owner/solo today.
  const canLogService = roleHasCapability(role, 'service_log');

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
          </Pressable>

          <ThemedText type="title" style={styles.heading}>{vehicle.nickname}</ThemedText>
          {vehicle.vehicle_number ? (
            <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.two }}>
              {vehicle.vehicle_number}
            </ThemedText>
          ) : null}

          {canLogService && !formOpen && (
            <Pressable onPress={() => setFormOpen(true)} style={styles.logServiceButton}>
              <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('vehicleDetail.logService')}</ThemedText>
            </Pressable>
          )}

          {canLogService && formOpen && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                {t('vehicleDetail.whichReminder')}
              </ThemedText>
              <ThemedView type="transparent" style={styles.assignRow}>
                <Pressable
                  onPress={() => setReminderId(NO_REMINDER)}
                  style={[styles.assignChip, { borderColor: reminderId === NO_REMINDER ? ORANGE : theme.border }]}
                >
                  <ThemedText type="small">{t('vehicleDetail.generalServiceNoReminder')}</ThemedText>
                </Pressable>
                {reminders.map((r) => (
                  <Pressable
                    key={r.id}
                    onPress={() => setReminderId(String(r.id))}
                    style={[styles.assignChip, { borderColor: reminderId === String(r.id) ? ORANGE : theme.border }]}
                  >
                    <ThemedText type="small">{r.reminder_type}</ThemedText>
                  </Pressable>
                ))}
              </ThemedView>

              {reminderId === NO_REMINDER && (
                <ThemedView type="transparent" style={styles.field}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                    {t('vehicleDetail.serviceType')}
                  </ThemedText>
                  <TextInput
                    style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                    value={serviceType}
                    onChangeText={setServiceType}
                    placeholder={t('vehicleDetail.serviceTypePlaceholder')}
                    placeholderTextColor={theme.textSecondary}
                  />
                </ThemedView>
              )}

              <ThemedView type="transparent" style={styles.field}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                  {t('vehicleDetail.serviceDate')}
                </ThemedText>
                <TextInput
                  style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                  value={serviceDate}
                  onChangeText={setServiceDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.textSecondary}
                />
              </ThemedView>

              <ThemedView type="transparent" style={styles.field}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                  {t('vehicleDetail.odometer')}
                </ThemedText>
                <TextInput
                  style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                  value={odometer}
                  onChangeText={setOdometer}
                  keyboardType="numeric"
                  placeholderTextColor={theme.textSecondary}
                />
              </ThemedView>

              <ThemedView type="transparent" style={styles.field}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                  {t('vehicleDetail.cost')}
                </ThemedText>
                <TextInput
                  style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                  value={cost}
                  onChangeText={setCost}
                  keyboardType="numeric"
                  placeholderTextColor={theme.textSecondary}
                />
              </ThemedView>

              <ThemedView type="transparent" style={styles.field}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                  {t('vehicleDetail.shop')}
                </ThemedText>
                <TextInput
                  style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                  value={shopName}
                  onChangeText={setShopName}
                  placeholderTextColor={theme.textSecondary}
                />
              </ThemedView>

              <ThemedView type="transparent" style={styles.field}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                  {t('vehicleDetail.notes')}
                </ThemedText>
                <TextInput
                  style={[styles.input, styles.notesInput, { color: theme.text, borderColor: theme.border }]}
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  placeholderTextColor={theme.textSecondary}
                />
              </ThemedView>

              {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

              <ThemedView type="transparent" style={styles.formButtonRow}>
                <Pressable onPress={() => setFormOpen(false)} disabled={submitting} style={[styles.cancelButton, { borderColor: theme.border }]}>
                  <ThemedText type="smallBold">{t('vehicleDetail.cancel')}</ThemedText>
                </Pressable>
                <Pressable
                  onPress={submitService}
                  disabled={submitting}
                  style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
                >
                  {submitting ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('vehicleDetail.logService')}</ThemedText>
                  )}
                </Pressable>
              </ThemedView>
            </ThemedView>
          )}

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
              {t('vehicleDetail.serviceHistory').toUpperCase()}
            </ThemedText>
            {logs.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">{t('vehicleDetail.noServiceHistory')}</ThemedText>
            ) : (
              logs.map((l) => (
                <ThemedView type="transparent" key={l.id} style={[styles.logRow, { borderTopColor: theme.divider }]}>
                  <ThemedView style={{ backgroundColor: 'transparent' }}>
                    <ThemedText type="small">{l.service_type}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{l.service_date}</ThemedText>
                  </ThemedView>
                  {l.cost ? <ThemedText type="small" themeColor="textSecondary">${l.cost.toFixed(2)}</ThemedText> : null}
                </ThemedView>
              ))
            )}
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.two },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  scrollContent: { paddingBottom: Spacing.six, gap: Spacing.two },
  backLink: { paddingVertical: Spacing.two },
  heading: { fontSize: 22 },
  logServiceButton: {
    backgroundColor: ORANGE,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  section: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two, marginBottom: Spacing.two },
  sectionLabel: { marginBottom: 4, letterSpacing: 0.5 },
  field: { gap: 4 },
  fieldLabel: {},
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  notesInput: { minHeight: 60, textAlignVertical: 'top' },
  assignRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, backgroundColor: 'transparent' },
  assignChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  formButtonRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two, backgroundColor: 'transparent' },
  cancelButton: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: 'center', borderWidth: 1 },
  submitButton: { flex: 1, backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  submitButtonDisabled: { opacity: 0.5 },
  error: { color: StatusColors.danger },
  logRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
