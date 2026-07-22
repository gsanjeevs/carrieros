// components/icons/maintenance/index.tsx
// Barrel + lookup for maintenance service-type icons.
//
// maintenance_reminders.reminder_type and service_logs.service_type are
// plain TEXT columns with no CHECK constraint (see schema.sql) — carriers
// type these in free-form via LogServiceButton's "create new reminder"
// input (e.g. "Oil Change", "DOT Inspection"). So there is no fixed enum to
// key off of; getMaintenanceIcon() below keyword-matches the free text
// against the 5 common service types this app's UI copy already suggests
// (see LogServiceButton's reminderTypeExample/serviceTypePlaceholder
// strings) and falls back to a generic wrench for anything else.
import type { ComponentType } from 'react'
import OilChange from './OilChange'
import TireRotation from './TireRotation'
import DotInspection from './DotInspection'
import BrakeService from './BrakeService'
import FuelFilter from './FuelFilter'
import GenericService from './GenericService'

export type MaintenanceIconProps = { className?: string }

export const MAINTENANCE_ICONS: Record<string, ComponentType<MaintenanceIconProps>> = {
  oil_change: OilChange,
  tire_rotation: TireRotation,
  dot_inspection: DotInspection,
  brake_service: BrakeService,
  fuel_filter: FuelFilter,
  other: GenericService,
}

export {
  OilChange,
  TireRotation,
  DotInspection,
  BrakeService,
  FuelFilter,
  GenericService,
}

// Keyword rules, checked in order, against the free-text reminder_type /
// service_type value. Order matters: "fuel filter" must beat a bare "fuel"
// match, and "tire" beats nothing else here so order isn't load-bearing for
// it, but kept deliberate for readability.
const KEYWORD_RULES: Array<{ key: string; test: RegExp }> = [
  { key: 'oil_change', test: /oil/i },
  { key: 'tire_rotation', test: /tire/i },
  { key: 'dot_inspection', test: /dot|inspect/i },
  { key: 'brake_service', test: /brake/i },
  { key: 'fuel_filter', test: /fuel|filter/i },
]

/** Resolve a free-text reminder_type/service_type to its icon component. */
export function getMaintenanceIcon(type: string | null | undefined): ComponentType<MaintenanceIconProps> {
  if (type) {
    const rule = KEYWORD_RULES.find(r => r.test.test(type))
    if (rule) return MAINTENANCE_ICONS[rule.key]
  }
  return MAINTENANCE_ICONS.other
}
