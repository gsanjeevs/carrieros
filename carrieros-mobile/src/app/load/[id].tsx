// src/app/load/[id].tsx
// Load detail + status advancement. Lives outside the (tabs) group — a
// standalone pushed screen, not a tab, per the auth-guard/tab-bar
// architecture set up in _layout.tsx.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { FuelStopsSection } from '@/components/fuel-stops-section';
import { IftaSection } from '@/components/ifta-section';
import { PodSection } from '@/components/pod-section';
import { ReportProblemSection } from '@/components/report-problem-section';
import { ShareLocationSection } from '@/components/share-location-section';
import { DriverChatSection } from '@/components/driver-chat-section';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import { useLocale } from '@/hooks/use-locale';
import { useOfflineSync } from '@/hooks/use-offline-sync';
import { enqueueMilestone } from '@/lib/offline-queue';
import { newIdempotencyKey } from '@/lib/idempotency';
import { apiClient } from '@/lib/api-client';
import { roleHasCapability } from '@/lib/generated/role-capabilities';
import { formatDateTime } from '@/lib/format-date';
import { formatNumber } from '@/lib/format-number';
import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';

const ORANGE = BrandColors.orange;

type Role = 'owner' | 'solo' | 'driver' | 'dispatcher' | 'finance';

type LoadDetail = {
  id: number;
  load_number: string;
  status: string;
  customer_name_raw: string | null;
  pickup_address: string | null;
  pickup_city: string | null;
  pickup_state: string | null;
  pickup_date: string | null;
  pickup_time: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_date: string | null;
  delivery_time: string | null;
  commodity: string | null;
  weight_lbs: number | null;
  total_miles: number | null;
  driver_id: number | null;
  vehicle_id: number | null;
};

type DriverOption = { id: number; driver_number: string; first_name: string | null; last_name: string | null };
type VehicleOption = { id: number; vehicle_number: string; nickname: string };

type LoadEvent = {
  id: number;
  event_type: string;
  created_at: string | null;
};

// Status keys map 1:1 to src/messages/*.json loads.status.* — see t() calls
// below rather than a hardcoded label map.
const STATUS_KEYS = [
  'draft',
  'scheduled',
  'dispatched',
  'picked_up',
  'in_transit',
  'delivered',
  'invoiced',
  'paid',
  'cancelled',
  'declined',
] as const;

// Forward progression a driver (or dispatcher/owner) can trigger from this
// screen with one tap. draft→scheduled and invoiced→paid are office-side
// steps, not driver actions — not included here. actionLabelKey maps to
// src/messages/*.json loadDetail.action*.
const NEXT_STATUS: Record<string, { next: string; actionLabelKey: string }> = {
  dispatched: { next: 'picked_up', actionLabelKey: 'loadDetail.actionPickedUp' },
  picked_up: { next: 'in_transit', actionLabelKey: 'loadDetail.actionStartTransit' },
  in_transit: { next: 'delivered', actionLabelKey: 'loadDetail.actionDelivered' },
};

// Matches (tabs)/my-load.tsx's own ACTIVE_LOAD_STATUSES — the window during
// which sharing GPS or logging a POD/DVIR makes sense for a load a driver
// is actually out on.
const ACTIVE_LOAD_STATUSES: readonly string[] = ['dispatched', 'picked_up', 'in_transit'];

const DETAIL_COLS =
  'id, load_number, status, customer_name_raw, pickup_address, pickup_city, pickup_state, ' +
  'pickup_date, pickup_time, delivery_address, delivery_city, delivery_state, delivery_date, ' +
  'delivery_time, commodity, weight_lbs, total_miles, driver_id, vehicle_id';

const LBS_PER_KG = 0.453592;
const MILES_PER_KM = 1.60934;

export default function LoadDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const { t, locale, prefs } = useLocale();
  const { isOnline, refreshQueueLength } = useOfflineSync();

  const [role, setRole] = useState<Role | null>(null);
  const [orgId, setOrgId] = useState<number | null>(null);
  const [load, setLoad] = useState<LoadDetail | null>(null);
  const [events, setEvents] = useState<LoadEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState('');
  const [chatEntitled, setChatEntitled] = useState(false);

  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [assignDriverId, setAssignDriverId] = useState<number | null>(null);
  const [assignVehicleId, setAssignVehicleId] = useState<number | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');

  const fetchAll = useCallback(async () => {
    if (!session?.user.id || !id) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, org_id')
      .eq('id', session.user.id)
      .single();

    const currentRole = (profile?.role ?? 'solo') as Role;
    setRole(currentRole);
    setOrgId(profile?.org_id ?? null);

    const { data: entitled } = await supabase.rpc('has_feature', { feature_key: 'driver_chat' });
    setChatEntitled(entitled === true);

    const { data: loadData, error: loadErr } =
      currentRole === 'driver'
        ? await supabase.from('loads_driver_view').select(DETAIL_COLS).eq('id', Number(id)).single()
        : await supabase.from('loads').select(DETAIL_COLS).eq('id', Number(id)).single();

    if (loadErr) {
      setError(t('loadDetail.loadAccessError'));
    } else {
      const detail = loadData as unknown as LoadDetail;
      setLoad(detail);
      setAssignDriverId(detail.driver_id);
      setAssignVehicleId(detail.vehicle_id);
    }

    const { data: eventData } = await supabase
      .from('load_events')
      .select('id, event_type, created_at')
      .eq('load_id', Number(id))
      .order('created_at', { ascending: true });

    setEvents(eventData ?? []);

    // Assignment pickers are office-side only — skip the extra fetches for
    // anyone without `loads_manage` (owner/solo/dispatcher today, per the
    // generated role_capabilities source of truth), who can never see the
    // section below.
    if (roleHasCapability(currentRole, 'loads_manage')) {
      const [driversRes, vehiclesRes] = await Promise.all([
        apiFetch('/api/drivers'),
        apiFetch('/api/vehicles'),
      ]);
      if (driversRes.ok) setDrivers(await driversRes.json());
      if (vehiclesRes.ok) setVehicles(await vehiclesRes.json());
    }
  }, [session?.user.id, id]);

  async function saveAssignment() {
    if (!load) return;
    setAssigning(true);
    setAssignError('');

    const res = await apiFetch(`/api/loads/${load.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ driver_id: assignDriverId, vehicle_id: assignVehicleId }),
    });

    if (!res.ok) {
      setAssignError(t('loadDetail.assignError'));
      setAssigning(false);
      return;
    }

    setAssigning(false);
    await fetchAll();
  }

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  async function advanceStatus() {
    if (!load || !session?.user.id) return;
    const step = NEXT_STATUS[load.status];
    if (!step) return;

    setAdvancing(true);
    setError('');

    // One user action = one idempotency key, reused by the offline queue's
    // replay, so a retry can never apply the status change twice.
    const idempotencyKey = newIdempotencyKey();
    const occurredAt = new Date().toISOString();

    // Queue the action and show it optimistically. Used when we already know
    // we're offline, and when the request itself fails to reach the server: a
    // driver marking a load delivered with no signal must not lose the action
    // (use-offline-sync.ts replays the queue through the API on reconnect).
    const queueForLater = async () => {
      await enqueueMilestone(
        { loadId: load.id, expectedStatus: load.status, newStatus: step.next, idempotencyKey, occurredAt },
        occurredAt
      );
      await refreshQueueLength();
      setLoad({ ...load, status: step.next });
      setAdvancing(false);
    };

    if (!isOnline) {
      await queueForLater();
      return;
    }

    // Status change + timeline entry + audit + outbox are ONE atomic call on the
    // server (previously two separate writes, so a failure between them left a
    // status change with no timeline entry). The server also enforces who may
    // do this and that the transition is legal.
    let response: Response;
    try {
      ({ response } = await apiClient.http.POST('/api/v1/loads/{id}/milestones', {
        params: { path: { id: load.id }, header: { 'Idempotency-Key': idempotencyKey } },
        body: { expected_status: load.status, new_status: step.next, occurred_at: occurredAt },
      }));
    } catch {
      await queueForLater(); // couldn't reach the server despite looking online
      return;
    }

    if (response.status === 409) {
      // Someone else (dispatcher, another device) moved this load first.
      setError(t('loadDetail.statusConflict'));
      await fetchAll();
      setAdvancing(false);
      return;
    }
    if (!response.ok) {
      setError(t('loadDetail.statusUpdateError'));
      setAdvancing(false);
      return;
    }

    setLoad({ ...load, status: step.next });
    await fetchAll();
    setAdvancing(false);
  }

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!load) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="default" themeColor="textSecondary">
          {error || t('loadDetail.loadNotFound')}
        </ThemedText>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  const step = NEXT_STATUS[load.status];
  const statusLabel = (status: string) =>
    (STATUS_KEYS as readonly string[]).includes(status) ? t(`loads.status.${status}`) : status;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
          </Pressable>

          <ThemedView type="transparent" style={styles.headerRow}>
            <ThemedText type="title" style={styles.loadNumber}>{load.load_number}</ThemedText>
            <ThemedView style={[styles.statusPill, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold">{statusLabel(load.status)}</ThemedText>
            </ThemedView>
          </ThemedView>

          <ThemedText type="default" style={styles.customer}>
            {load.customer_name_raw ?? t('common.unknownCustomer')}
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.section}>
            <SectionLabel text={t('loadDetail.sectionPickup')} />
            <ThemedText type="default">
              {load.pickup_address ?? '—'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {[load.pickup_city, load.pickup_state].filter(Boolean).join(', ') || '—'}
              {load.pickup_date ? `  ·  ${load.pickup_date}` : ''}
              {load.pickup_time ? ` ${load.pickup_time}` : ''}
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <SectionLabel text={t('loadDetail.sectionDelivery')} />
            <ThemedText type="default">
              {load.delivery_address ?? '—'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {[load.delivery_city, load.delivery_state].filter(Boolean).join(', ') || '—'}
              {load.delivery_date ? `  ·  ${load.delivery_date}` : ''}
              {load.delivery_time ? ` ${load.delivery_time}` : ''}
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.section}>
            <SectionLabel text={t('loadDetail.sectionDetails')} />
            <DetailRow label={t('loadDetail.commodity')} value={load.commodity ?? '—'} />
            <DetailRow
              label={t('loadDetail.weight')}
              value={
                load.weight_lbs
                  ? prefs.uomSystem === 'metric'
                    ? `${formatNumber(Math.round(load.weight_lbs * LBS_PER_KG), locale)} ${t('loadDetail.unitKg')}`
                    : `${formatNumber(load.weight_lbs, locale)} ${t('loadDetail.unitLbs')}`
                  : '—'
              }
            />
            <DetailRow
              label={t('loadDetail.miles')}
              value={
                load.total_miles
                  ? prefs.uomSystem === 'metric'
                    ? `${Math.round(load.total_miles * MILES_PER_KM)} ${t('loadDetail.unitKm')}`
                    : `${load.total_miles} ${t('loadDetail.unitMi')}`
                  : '—'
              }
            />
          </ThemedView>

          {roleHasCapability(role, 'loads_manage') && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <SectionLabel text={t('loadDetail.sectionAssignment')} />
              <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: 4 }}>
                {t('loadDetail.assignDriver')}
              </ThemedText>
              <ThemedView type="transparent" style={styles.assignRow}>
                <Pressable
                  onPress={() => setAssignDriverId(null)}
                  style={[
                    styles.assignChip,
                    { borderColor: assignDriverId === null ? ORANGE : theme.border },
                  ]}
                >
                  <ThemedText type="small">{t('loadDetail.unassigned')}</ThemedText>
                </Pressable>
                {drivers.map((d) => {
                  const name = d.first_name || d.last_name
                    ? [d.first_name, d.last_name].filter(Boolean).join(' ')
                    : d.driver_number;
                  return (
                    <Pressable
                      key={d.id}
                      onPress={() => setAssignDriverId(d.id)}
                      style={[
                        styles.assignChip,
                        { borderColor: assignDriverId === d.id ? ORANGE : theme.border },
                      ]}
                    >
                      <ThemedText type="small">{name}</ThemedText>
                    </Pressable>
                  );
                })}
              </ThemedView>

              <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two, marginBottom: 4 }}>
                {t('loadDetail.assignVehicle')}
              </ThemedText>
              <ThemedView type="transparent" style={styles.assignRow}>
                <Pressable
                  onPress={() => setAssignVehicleId(null)}
                  style={[
                    styles.assignChip,
                    { borderColor: assignVehicleId === null ? ORANGE : theme.border },
                  ]}
                >
                  <ThemedText type="small">{t('loadDetail.unassigned')}</ThemedText>
                </Pressable>
                {vehicles.map((v) => (
                  <Pressable
                    key={v.id}
                    onPress={() => setAssignVehicleId(v.id)}
                    style={[
                      styles.assignChip,
                      { borderColor: assignVehicleId === v.id ? ORANGE : theme.border },
                    ]}
                  >
                    <ThemedText type="small">{v.nickname || v.vehicle_number}</ThemedText>
                  </Pressable>
                ))}
              </ThemedView>

              {assignError ? <ThemedText type="small" style={styles.error}>{assignError}</ThemedText> : null}

              <Pressable
                onPress={saveAssignment}
                disabled={assigning || (assignDriverId === load.driver_id && assignVehicleId === load.vehicle_id)}
                style={[
                  styles.assignSaveButton,
                  (assigning || (assignDriverId === load.driver_id && assignVehicleId === load.vehicle_id)) &&
                    styles.actionButtonDisabled,
                ]}
              >
                {assigning ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('loadDetail.saveAssignment')}</ThemedText>
                )}
              </Pressable>
            </ThemedView>
          )}

          {(role === 'driver' || role === 'solo') && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <SectionLabel text={t('loadDetail.sectionCompliance')} />
              <ThemedView type="transparent" style={styles.dvirRow}>
                <Pressable
                  style={styles.dvirButton}
                  onPress={() => router.push({ pathname: '/dvir/[loadId]', params: { loadId: String(load.id), type: 'pre_trip' } })}
                >
                  <ThemedText type="smallBold" themeColor="text">{t('loadDetail.preTripDvir')}</ThemedText>
                </Pressable>
                <Pressable
                  style={styles.dvirButton}
                  onPress={() => router.push({ pathname: '/dvir/[loadId]', params: { loadId: String(load.id), type: 'post_trip' } })}
                >
                  <ThemedText type="smallBold" themeColor="text">{t('loadDetail.postTripDvir')}</ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>
          )}

          {(role === 'driver' || role === 'solo') && ACTIVE_LOAD_STATUSES.includes(load.status) && (
            <ShareLocationSection loadId={load.id} />
          )}

          {(role === 'driver' || role === 'solo') && ACTIVE_LOAD_STATUSES.includes(load.status) && orgId && (
            <ReportProblemSection loadId={load.id} />
          )}

          {(role === 'driver' || role === 'solo') && <PodSection loadId={load.id} />}

          {(role === 'driver' || role === 'solo') && orgId && (
            <FuelStopsSection loadId={load.id} />
          )}

          {(role === 'driver' || role === 'solo') && orgId && (
            <IftaSection
              loadId={load.id}
              vehicleId={load.vehicle_id}
              carrierOrgId={orgId}
              loadStatus={load.status}
              totalMiles={load.total_miles}
            />
          )}

          {chatEntitled && (role === 'driver' || role === 'solo' || role === 'dispatcher') && (
            <DriverChatSection loadId={load.id} />
          )}

          {events.length > 0 && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <SectionLabel text={t('loadDetail.sectionTimeline')} />
              {events.map((e) => (
                <ThemedView type="transparent" key={e.id} style={styles.eventRow}>
                  <ThemedText type="small">{statusLabel(e.event_type.replace('status_', ''))}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {e.created_at ? formatDateTime(e.created_at, locale) : ''}
                  </ThemedText>
                </ThemedView>
              ))}
            </ThemedView>
          )}

          {error ? (
            <ThemedText type="small" style={styles.error}>{error}</ThemedText>
          ) : null}

          {step && (
            <Pressable
              onPress={advanceStatus}
              disabled={advancing}
              style={[styles.actionButton, advancing && styles.actionButtonDisabled]}
            >
              {advancing ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <ThemedText type="smallBold" style={{ color: '#ffffff' }}>
                  {t(step.actionLabelKey)}
                </ThemedText>
              )}
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
      {text.toUpperCase()}
    </ThemedText>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView type="transparent" style={styles.detailRow}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.two },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  scrollContent: { paddingBottom: Spacing.six, gap: Spacing.two },
  backLink: { paddingVertical: Spacing.two },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  loadNumber: { fontSize: 24 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  customer: { marginBottom: Spacing.two },
  section: { borderRadius: 12, padding: Spacing.three, gap: 4, marginBottom: Spacing.two },
  sectionLabel: { marginBottom: 4, letterSpacing: 0.5 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  eventRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  dvirRow: { flexDirection: 'row', gap: Spacing.two, backgroundColor: 'transparent' },
  dvirButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: ORANGE,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  assignRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, backgroundColor: 'transparent' },
  assignChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  assignSaveButton: {
    marginTop: Spacing.three,
    backgroundColor: ORANGE,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  error: { color: StatusColors.danger, marginBottom: Spacing.two },
  actionButton: {
    marginTop: Spacing.two,
    backgroundColor: ORANGE,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionButtonDisabled: { opacity: 0.5 },
});
