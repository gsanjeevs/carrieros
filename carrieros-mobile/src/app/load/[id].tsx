// src/app/load/[id].tsx
// Load detail + status advancement. Lives outside the (tabs) group — a
// standalone pushed screen, not a tab, per the auth-guard/tab-bar
// architecture set up in _layout.tsx.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
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

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  dispatched: 'Dispatched',
  picked_up: 'Picked Up',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  invoiced: 'Invoiced',
  paid: 'Paid',
};

// Forward progression a driver (or dispatcher/owner) can trigger from this
// screen with one tap. draft→scheduled and invoiced→paid are office-side
// steps, not driver actions — not included here.
const NEXT_STATUS: Record<string, { next: string; actionLabel: string }> = {
  dispatched: { next: 'picked_up', actionLabel: 'Mark Picked Up' },
  picked_up: { next: 'in_transit', actionLabel: 'Start Transit' },
  in_transit: { next: 'delivered', actionLabel: 'Mark Delivered' },
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
      setError('Could not load this load — it may not be assigned to you.');
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
      setError('Could not update status — you may not have permission.');
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
          {error || 'Load not found.'}
        </ThemedText>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <ThemedText type="link" themeColor="textSecondary">← Back</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  const step = NEXT_STATUS[load.status];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <ThemedText type="link" themeColor="textSecondary">← Back</ThemedText>
          </Pressable>

          <ThemedView style={styles.headerRow}>
            <ThemedText type="title" style={styles.loadNumber}>{load.load_number}</ThemedText>
            <ThemedView style={[styles.statusPill, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold">{STATUS_LABEL[load.status] ?? load.status}</ThemedText>
            </ThemedView>
          </ThemedView>

          <ThemedText type="default" style={styles.customer}>
            {load.customer_name_raw ?? 'Unknown customer'}
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.section}>
            <SectionLabel text="Pickup" />
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
            <SectionLabel text="Delivery" />
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
            <SectionLabel text="Load Details" />
            <DetailRow label="Commodity" value={load.commodity ?? '—'} />
            <DetailRow label="Weight" value={load.weight_lbs ? `${load.weight_lbs.toLocaleString()} lbs` : '—'} />
            <DetailRow label="Miles" value={load.total_miles ? `${load.total_miles} mi` : '—'} />
          </ThemedView>

          {role === 'driver' && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <SectionLabel text="Compliance" />
              <ThemedView style={styles.dvirRow}>
                <Pressable
                  style={styles.dvirButton}
                  onPress={() => router.push({ pathname: '/dvir/[loadId]', params: { loadId: String(load.id), type: 'pre_trip' } })}
                >
                  <ThemedText type="smallBold" themeColor="text">Pre-Trip DVIR</ThemedText>
                </Pressable>
                <Pressable
                  style={styles.dvirButton}
                  onPress={() => router.push({ pathname: '/dvir/[loadId]', params: { loadId: String(load.id), type: 'post_trip' } })}
                >
                  <ThemedText type="smallBold" themeColor="text">Post-Trip DVIR</ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>
          )}

          {events.length > 0 && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <SectionLabel text="Timeline" />
              {events.map((e) => (
                <ThemedView key={e.id} style={styles.eventRow}>
                  <ThemedText type="small">{e.event_type.replace('status_', '').replace(/_/g, ' ')}</ThemedText>
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
                  {step.actionLabel}
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
