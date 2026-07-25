// src/components/share-location-section.tsx
// PRD P0 (Starter tier): "Share Location" — a driver on an active load can
// share live GPS to `loads.last_location_lat/lng/last_location_at`, which
// is exactly what the web app's public tracking page
// (carrieros-web/app/track/[token]/page.tsx) already reads. Foreground-only
// (watchPositionAsync, not a background task) — sharing stops the moment
// the app is backgrounded, which is a deliberate, simpler v1 than asking
// for background location permission (a heavier App Store review path)
// for a feature that mainly needs to work while the driver has the app
// open during a stop.
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch } from 'react-native';
import * as Location from 'expo-location';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing } from '@/constants/theme';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';

const ORANGE = BrandColors.orange;
// Balanced accuracy + a distance filter (not a time interval) — a parked/
// idling driver shouldn't generate a write every few seconds for no
// positional change.
const DISTANCE_FILTER_METERS = 50;

export function ShareLocationSection({ loadId }: { loadId: number }) {
  const { t } = useLocale();
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    return () => {
      subscriptionRef.current?.remove();
    };
  }, []);

  async function start() {
    setError('');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setError(t('loadDetail.locationPermissionDenied'));
      return;
    }

    subscriptionRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: DISTANCE_FILTER_METERS },
      async (position) => {
        await supabase
          .from('loads')
          .update({
            last_location_lat: position.coords.latitude,
            last_location_lng: position.coords.longitude,
            last_location_at: new Date(position.timestamp).toISOString(),
          })
          .eq('id', loadId);
      }
    );
    setSharing(true);
  }

  function stop() {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    setSharing(false);
  }

  function toggle(next: boolean) {
    if (next) start();
    else stop();
  }

  return (
    <ThemedView type="backgroundElement" style={styles.section}>
      <ThemedView style={styles.row}>
        <ThemedView style={styles.textCol}>
          <ThemedText type="smallBold">{t('loadDetail.shareLocation')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {sharing ? t('loadDetail.shareLocationOn') : t('loadDetail.shareLocationOff')}
          </ThemedText>
        </ThemedView>
        <Switch value={sharing} onValueChange={toggle} trackColor={{ true: ORANGE }} />
      </ThemedView>
      {error ? (
        <Pressable onPress={() => setError('')}>
          <ThemedText type="small" style={styles.error}>{error}</ThemedText>
        </Pressable>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: { borderRadius: 12, padding: Spacing.three, gap: 4, marginBottom: Spacing.two },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  textCol: { flex: 1, gap: 2, backgroundColor: 'transparent' },
  error: { color: '#dc2626', marginTop: 4 },
});
