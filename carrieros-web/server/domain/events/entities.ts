// server/domain/events/entities.ts
// The kinds of thing a client can subscribe to change signals for. Mirrors the
// `entity` values written by the change_events triggers (migration 0012); the
// API contract and both clients derive their enum from here.
export const CHANGE_ENTITIES = ['loads', 'exceptions', 'invoices', 'messages', 'documents'] as const
export type ChangeEntity = (typeof CHANGE_ENTITIES)[number]

export function isChangeEntity(value: string): value is ChangeEntity {
  return (CHANGE_ENTITIES as readonly string[]).includes(value)
}
