// server/domain/load/status-groups.ts
// The list-screen grouping of load statuses. Single source: the web page, the
// API and (through the API) mobile all derive their filters from here, instead
// of each keeping its own hand-copied array.

export type LoadStatusGroup = 'needs_dispatch' | 'in_progress' | 'completed' | 'cancelled' | 'declined'

export const LOAD_STATUS_GROUPS: Readonly<Record<LoadStatusGroup, readonly string[]>> = {
  needs_dispatch: ['draft', 'scheduled'],
  in_progress: ['dispatched', 'picked_up', 'in_transit'],
  completed: ['delivered', 'invoiced', 'paid'],
  cancelled: ['cancelled'],
  declined: ['declined'],
}

export const LOAD_STATUS_GROUP_KEYS = Object.keys(LOAD_STATUS_GROUPS) as LoadStatusGroup[]

export function isLoadStatusGroup(value: string | null | undefined): value is LoadStatusGroup {
  return !!value && value in LOAD_STATUS_GROUPS
}
