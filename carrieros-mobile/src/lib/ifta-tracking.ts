// src/lib/ifta-tracking.ts
// GPS auto-capture for IFTA state-mileage logging (mockup-20). Runs as an
// Expo TaskManager background location task, firing periodically (~15 min,
// matching the mockup's own dev notes) even when the app is backgrounded --
// that background delivery is the actual point of this feature (accurate
// IFTA mileage needs a driver who isn't staring at the app), which is why
// it needs the heavier "Always Allow" permission path.
// ShareLocationSection (share-location-section.tsx) already covers a
// lighter, foreground-only live-location feature for dispatch visibility --
// this is deliberately a separate mechanism because it has a different
// permission tier and a different purpose (IFTA compliance, not live
// tracking UX).
//
// Known limitation this session could not verify: TaskManager background
// delivery requires a real custom dev client / production build and a
// physical device with "Always Allow" granted -- it does not fire in Expo
// Go, and there is no way to drive that from this environment. The code
// below matches the documented expo-location/expo-task-manager v57 API
// exactly (confirmed against node_modules/expo-location's own .d.ts files
// before writing this); startIftaTracking()'s foreground-permission and
// insert path IS exercisable and was verified live (see load/[id].tsx's
// odometer-fallback screen for the non-GPS path). True background delivery
// needs an on-device test outside this session's reach.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { apiClient } from '@/lib/api-client';

export const IFTA_TASK_NAME = 'ifta-location-tracking';
const CONTEXT_KEY = 'ifta_tracking_context';
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

type TrackingContext = {
  loadId: number;
  vehicleId: number | null;
  driverId: number;
  carrierOrgId: number;
  lastState: string | null;
};

// expo-location's reverseGeocodeAsync returns the full US state name (via
// the device's native geocoder) in `region` -- ifta_state_crossings.state
// and the rest of the IFTA UI use 2-letter codes, so this is the mapping
// that keeps GPS-sourced rows in the same shape as manually-entered ones.
const US_STATE_NAME_TO_CODE: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS',
  Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA',
  Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT',
  Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
  Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
  Wisconsin: 'WI', Wyoming: 'WY',
};

async function recordCrossingIfStateChanged(lat: number, lng: number, timestampMs: number) {
  const raw = await AsyncStorage.getItem(CONTEXT_KEY);
  if (!raw) return;
  const ctx: TrackingContext = JSON.parse(raw);

  const [address] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
  const stateCode = address?.region ? (US_STATE_NAME_TO_CODE[address.region] ?? address.region) : null;
  if (!stateCode || stateCode === ctx.lastState) return;

  // Through the shared API: it derives org/driver/vehicle, checks the ifta_mileage_log entitlement
  // and that this driver owns the load. The idempotency key is DETERMINISTIC (load + state + fix
  // time), so a retry after a dropped connection can never record the same crossing twice.
  // This runs as a headless background task: any failure just means the next fix retries the comparison.
  try {
    const { response } = await apiClient.http.POST('/api/v1/loads/{id}/ifta-crossings', {
      params: { path: { id: ctx.loadId }, header: { 'Idempotency-Key': `ifta-${ctx.loadId}-${stateCode}-${timestampMs}` } },
      body: { state: stateCode, crossed_at: new Date(timestampMs).toISOString(), latitude: lat, longitude: lng },
    });
    if (!response.ok) return;
  } catch {
    return;
  }

  await AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify({ ...ctx, lastState: stateCode }));
}

TaskManager.defineTask(IFTA_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  const latest = locations?.[locations.length - 1];
  if (!latest) return;
  await recordCrossingIfStateChanged(latest.coords.latitude, latest.coords.longitude, latest.timestamp);
});

export type StartResult =
  | { started: true }
  | { started: false; reason: 'foreground_denied' | 'background_denied' };

export async function startIftaTracking(
  ctx: Omit<TrackingContext, 'lastState'>
): Promise<StartResult> {
  await AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify({ ...ctx, lastState: null }));

  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') return { started: false, reason: 'foreground_denied' };

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  if (bgStatus !== 'granted') return { started: false, reason: 'background_denied' };

  if (await TaskManager.isTaskRegisteredAsync(IFTA_TASK_NAME)) {
    await Location.stopLocationUpdatesAsync(IFTA_TASK_NAME);
  }

  await Location.startLocationUpdatesAsync(IFTA_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: FIFTEEN_MINUTES_MS,
    distanceInterval: 0,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'CarrierOS is tracking your route',
      notificationBody: 'Logging state mileage for IFTA while this load is in transit.',
    },
  });

  return { started: true };
}

export async function stopIftaTracking() {
  if (await TaskManager.isTaskRegisteredAsync(IFTA_TASK_NAME)) {
    await Location.stopLocationUpdatesAsync(IFTA_TASK_NAME);
  }
  await AsyncStorage.removeItem(CONTEXT_KEY);
}

export async function isIftaTrackingActive(): Promise<boolean> {
  return TaskManager.isTaskRegisteredAsync(IFTA_TASK_NAME);
}
