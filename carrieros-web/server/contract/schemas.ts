// server/contract/schemas.ts
// The API contract: request/response shapes for /api/v1, defined once in zod.
// Everything downstream is derived from this file and nothing else:
//   * route handlers validate input and (in tests) output against these schemas;
//   * `npm run gen:api` turns them into OpenAPI and then into a typed client
//     written identically into carrieros-web and carrieros-mobile.
// Hand-written request/response types in either app are duplication this file
// exists to remove. Change a shape here, regenerate, and CI fails if a client
// was left behind.
import { z } from 'zod'
import { CHANGE_ENTITIES } from '../domain/events/entities'
import { LOAD_STATUS_GROUP_KEYS } from '../domain/load/status-groups'
import { DATE_FORMATS, LANGUAGES, THEMES, TIME_FORMATS, UOM_SYSTEMS } from '../domain/profile/preferences'

export const ChangeEntitySchema = z.enum(CHANGE_ENTITIES)
export const LoadStatusGroupSchema = z.enum(LOAD_STATUS_GROUP_KEYS as [string, ...string[]])

// Stable, language-neutral error body. Clients map error_code to localized copy.
export const ErrorResponseSchema = z.object({
  error_code: z.string(),
  error: z.string().describe('Developer-facing fallback text; never render to end users.'),
  meta: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional()
    .describe('Machine-readable context, e.g. { current_status } on a 409 VERSION_CONFLICT.'),
})

export const LoadSummarySchema = z.object({
  id: z.number().int(),
  load_number: z.string(),
  status: z.string(),
  customer_name_raw: z.string().nullable(),
  pickup_city: z.string().nullable(),
  pickup_state: z.string().nullable(),
  delivery_city: z.string().nullable(),
  delivery_state: z.string().nullable(),
  pickup_date: z.string().nullable(),
  delivery_date: z.string().nullable(),
  commodity: z.string().nullable(),
  driver_id: z.number().int().nullable(),
  rate: z
    .number()
    .nullable()
    .optional()
    .describe('Present only when the caller\'s role may see money. Absent, not null, otherwise.'),
})

export const ListLoadsQuerySchema = z.object({
  status_group: LoadStatusGroupSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

export const ListLoadsResponseSchema = z.object({
  loads: z.array(LoadSummarySchema),
  can_see_rate: z.boolean(),
})

export const StreamEventsQuerySchema = z.object({
  entities: z
    .string()
    .optional()
    .describe('Comma-separated subset of: ' + CHANGE_ENTITIES.join(', ') + '. Default: all.'),
  since: z.number().int().min(0).optional().describe('Resume after this signal id (also accepted as Last-Event-ID).'),
})

export const MeResponseSchema = z.object({
  user_id: z.string(),
  org_id: z.number().int(),
  role: z.string(),
  capabilities: z.array(z.string()).describe('UI/navigation capabilities for the role (not a security boundary; RLS and the API still enforce access).'),
})

export const LoadIdParamsSchema = z.object({ id: z.number().int().positive() })

export const IdempotencyKeyHeaderSchema = z.object({
  'Idempotency-Key': z
    .string()
    .min(8)
    .max(128)
    .describe('Client-generated key, unique per user action. Replaying it returns the original outcome instead of applying twice (safe offline retry).'),
})

export const SubmitMilestoneBodySchema = z.object({
  expected_status: z
    .string()
    .nullable()
    .optional()
    .describe('The status the client believes the load is in. If it is not the current status the call fails with 409 VERSION_CONFLICT. Omit to advance from whatever the server holds.'),
  new_status: z.string().describe('Target execution status: scheduled, dispatched, picked_up, in_transit or delivered.'),
  reason: z.string().max(500).nullable().optional().describe('Free-text note stored on the timeline entry.'),
  occurred_at: z.string().datetime().optional().describe('When it actually happened (offline replays); defaults to now.'),
})

export const MilestoneResponseSchema = z.object({
  outcome: z.enum(['APPLIED', 'REPLAYED']),
  load_id: z.number().int(),
  status: z.string(),
  load_number: z.string().nullable(),
})

export const UpdatePreferencesBodySchema = z
  .object({
    preferred_language: z.enum(LANGUAGES).optional(),
    uom_system: z.enum(UOM_SYSTEMS).nullable().optional().describe('null = inherit the organization\'s setting.'),
    date_format: z.enum(DATE_FORMATS).optional(),
    time_format: z.enum(TIME_FORMATS).optional(),
    theme_preference: z.enum(THEMES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one preference to update' })

export const SetPushTokenBodySchema = z.object({ token: z.string().min(1).max(512) })

export const OkResponseSchema = z.object({ ok: z.literal(true) })

export type ListLoadsQuery = z.infer<typeof ListLoadsQuerySchema>
export type ListLoadsResponse = z.infer<typeof ListLoadsResponseSchema>
