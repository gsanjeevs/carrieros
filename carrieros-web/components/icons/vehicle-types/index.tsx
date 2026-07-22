// components/icons/vehicle-types/index.tsx
// Lookup from vehicle_types.code -> icon component. Keys must match the
// `code` column exactly (see supabase/schema/schema.sql).
import type { ComponentType } from 'react'
import Semi from './Semi'
import BoxTruck from './BoxTruck'
import Flatbed from './Flatbed'
import Reefer from './Reefer'
import StepDeck from './StepDeck'
import Tanker from './Tanker'
import Dump from './Dump'

export const VEHICLE_TYPE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  semi: Semi,
  box_truck: BoxTruck,
  flatbed: Flatbed,
  reefer: Reefer,
  step_deck: StepDeck,
  tanker: Tanker,
  dump: Dump,
}

export { Semi, BoxTruck, Flatbed, Reefer, StepDeck, Tanker, Dump }
