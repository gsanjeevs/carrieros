// src/lib/submitter.ts
// Resolves "who is acting" for driver-facing writes (DVIR inspections, POD
// uploads, ...).
//
// The branch matters because `solo` (an owner who also drives) has NO row in
// the `drivers` table at all — that table only holds invited employee-drivers
// — so their carrier org has to come from `profiles.org_id`, and driver_id
// stays null. RLS still permits their writes via the owner/solo FOR ALL
// policies (keyed on role, not driver_id), so this is an RLS-sanctioned path
// and not a workaround.
import { supabase } from '@/lib/supabase';

export type Submitter = {
  carrierOrgId: number;
  driverId: number | null;
  defaultVehicleId: number | null;
  role: string;
};

export async function resolveSubmitter(userId: string): Promise<Submitter | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, org_id')
    .eq('id', userId)
    .single();

  if (profile?.role === 'driver') {
    const { data: driver } = await supabase
      .from('drivers')
      .select('id, carrier_org_id, default_vehicle_id')
      .eq('profile_id', userId)
      .single();
    if (!driver) return null;
    return {
      carrierOrgId: driver.carrier_org_id,
      driverId: driver.id,
      defaultVehicleId: driver.default_vehicle_id,
      role: 'driver',
    };
  }

  // solo / owner / dispatcher / finance — org comes straight off the profile.
  if (!profile?.org_id) return null;
  return {
    carrierOrgId: profile.org_id,
    driverId: null,
    defaultVehicleId: null,
    role: profile.role ?? 'solo',
  };
}
