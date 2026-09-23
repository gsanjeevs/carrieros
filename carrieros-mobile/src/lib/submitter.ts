// src/lib/submitter.ts
// Resolves "who is acting" for driver-facing writes (DVIR inspections, POD
// uploads, ...).
//
// The branch matters because `solo` (an owner who also drives) has NO row in
// the `drivers` table at all — that table only holds invited employee-drivers
// — so their carrier org has to come from /api/v1/me's org_id, and driver_id
// stays null. RLS still permits their writes via the owner/solo FOR ALL
// policies (keyed on role, not driver_id), so this is an RLS-sanctioned path
// and not a workaround.
import { apiClient } from '@/lib/api-client';

export type Submitter = {
  carrierOrgId: number;
  driverId: number | null;
  defaultVehicleId: number | null;
  role: string;
};

export async function resolveSubmitter(_userId: string): Promise<Submitter | null> {
  const { data: me } = await apiClient.http.GET('/api/v1/me');
  if (!me) return null;

  if (me.role === 'driver') {
    const { data: driver } = await apiClient.http.GET('/api/v1/me/driver-profile');
    if (!driver) return null;
    return {
      carrierOrgId: me.org_id,
      driverId: driver.id,
      defaultVehicleId: driver.default_vehicle_id,
      role: 'driver',
    };
  }

  // solo / owner / dispatcher / finance — org comes straight off /me.
  return {
    carrierOrgId: me.org_id,
    driverId: null,
    defaultVehicleId: null,
    role: me.role ?? 'solo',
  };
}
