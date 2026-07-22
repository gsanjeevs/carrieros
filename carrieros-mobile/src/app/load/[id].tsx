// src/app/load/[id].tsx
// Load detail + status advancement. Lives outside the (tabs) group — a
// standalone pushed screen, not a tab, per the auth-guard/tab-bar
// architecture set up in _layout.tsx.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { PodSection } from '@/components/pod-section';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';

const ORANGE = '#f97316';

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
};

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

const DETAIL_COLS =
  'id, load_number, status, customer_name_raw, pickup_address, pickup_city, pickup_state, ' +
  'pickup_date, pickup_time, delivery_address, delivery_city, delivery_state, delivery_date, ' +
  'delivery_time, commodity, weight_lbs, total_miles';

export default function LoadDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const { t } = useLocale();

  const [role, setRole] = useState<Role | null>(null);
  const [load, setLoad] = useState<LoadDetail | null>(null);
  const [events, setEvents] = useState<LoadEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    if (!session?.user.id || !id) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();

    const currentRole = (profile?.role ?? 'solo') as Role;
    setRole(currentRole);

    const { data: loadData, error: loadErr } =
      currentRole === 'driver'
        ? await supabase.from('loads_driver_view').select(DETAIL_COLS).eq('id', Number(id)).single()
        : await supabase.from('loads').select(DETAIL_COLS).eq('id', Number(id)).single();

    if (loadErr) {
      setError(t('loadDetail.loadAccessError'));
    } else {
      setLoad(loadData as unknown as LoadDetail);
    }

    const { data: eventData } = await supabase
      .from('load_events')
      .select('id, event_type, created_at')
      .eq('load_id', Number(id))
      .order('created_at', { ascending: true });

    setEvents(eventData ?? []);
  }, [session?.user.id, id]);

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  async function advanceStatus() {
    if (!load || !session?.user.id) return;
    const step = NEXT_STATUS[load.status];
    if (!step) return;

    setAdvancing(true);
    setError('');

    // Update the base `loads` table directly (not the view) — the RLS
    // policy that permits this is defined on `loads`. No .select() chained,
    // so no risk of the response including the rate column even for
    // owner/solo/dispatcher callers.
    const { error: updateErr } = await supabase
      .from('loads')
      .update({ status: step.next })
      .eq('id', load.id);

    if (updateErr) {
      setError(t('loadDetail.statusUpdateError'));
      setAdvancing(false);
      return;
    }

    await supabase.from('load_events').insert({
      load_id: load.id,
      event_type: `status_${step.next}`,
      created_by: session.user.id,
    });

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

          <ThemedView style={styles.headerRow}>
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
            <DetailRow label={t('loadDetail.weight')} value={load.weight_lbs ? `${load.weight_lbs.toLocaleString()} lbs` : '—'} />
            <DetailRow label={t('loadDetail.miles')} value={load.total_miles ? `${load.total_miles} mi` : '—'} />
          </ThemedView>

          {(role === 'driver' || role === 'solo') && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <SectionLabel text={t('loadDetail.sectionCompliance')} />
              <ThemedView style={styles.dvirRow}>
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

          {(role === 'driver' || role === 'solo') && <PodSection loadId={load.id} />}

          {events.length > 0 && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <SectionLabel text={t('loadDetail.sectionTimeline')} />
              {events.map((e) => (
                <ThemedView key={e.id} style={styles.eventRow}>
                  <ThemedText type="small">{statusLabel(e.event_type.replace('status_', ''))}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {e.created_at ? new Date(e.created_at).toLocaleString() : ''}
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
    <ThemedView style={styles.detailRow}>
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
  error: { color: '#dc2626', marginBottom: Spacing.two },
  actionButton: {
    marginTop: Spacing.two,
    backgroundColor: ORANGE,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionButtonDisabled: { opacity: 0.5 },
});
