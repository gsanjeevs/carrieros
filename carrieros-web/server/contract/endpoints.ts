// server/contract/endpoints.ts
// Registry of /api/v1 operations. Add an operation here (with its schemas in
// schemas.ts), run `npm run gen:api`, and both apps get a typed method for it.
import type { ZodType } from 'zod'
import {
  ErrorResponseSchema,
  ListLoadsQuerySchema,
  ListLoadsResponseSchema,
  IdempotencyKeyHeaderSchema,
  LoadIdParamsSchema,
  MilestoneResponseSchema,
  OkResponseSchema,
  SetPushTokenBodySchema,
  UpdatePreferencesBodySchema,
  SubmitMilestoneBodySchema,
  MeResponseSchema,
  StreamEventsQuerySchema,
} from './schemas'

export interface Endpoint {
  operationId: string
  method: 'get' | 'post' | 'patch' | 'put' | 'delete'
  path: string
  summary: string
  tag: string
  params?: ZodType
  query?: ZodType
  headers?: ZodType
  body?: ZodType
  response: ZodType
  /** Extra status codes, all shaped as ErrorResponse. */
  errorStatuses: readonly number[]
  /** text/event-stream: documented here, consumed via the client's subscribe(), not openapi-fetch. */
  stream?: boolean
}

export const endpoints: readonly Endpoint[] = [
  {
    operationId: 'getMe',
    method: 'get',
    path: '/api/v1/me',
    summary: 'The caller\'s identity, organization, role and capabilities',
    tag: 'identity',
    response: MeResponseSchema,
    errorStatuses: [401, 403],
  },
  {
    operationId: 'listLoads',
    method: 'get',
    path: '/api/v1/loads',
    summary: 'List loads visible to the caller',
    tag: 'loads',
    query: ListLoadsQuerySchema,
    response: ListLoadsResponseSchema,
    errorStatuses: [400, 401, 403, 500],
  },
  {
    operationId: 'updateMyPreferences',
    method: 'patch',
    path: '/api/v1/me/preferences',
    summary: 'Update the caller\'s own display preferences (language, units, date/time format, theme)',
    tag: 'identity',
    body: UpdatePreferencesBodySchema,
    response: OkResponseSchema,
    errorStatuses: [400, 401, 403, 500],
  },
  {
    operationId: 'setMyPushToken',
    method: 'put',
    path: '/api/v1/me/push-token',
    summary: 'Register the caller\'s device push token',
    tag: 'identity',
    body: SetPushTokenBodySchema,
    response: OkResponseSchema,
    errorStatuses: [400, 401, 403, 500],
  },
  {
    operationId: 'submitLoadMilestone',
    method: 'post',
    path: '/api/v1/loads/{id}/milestones',
    summary: 'Advance a load to its next execution status (atomic: status + timeline + audit + outbox)',
    tag: 'loads',
    params: LoadIdParamsSchema,
    headers: IdempotencyKeyHeaderSchema,
    body: SubmitMilestoneBodySchema,
    response: MilestoneResponseSchema,
    errorStatuses: [400, 401, 403, 404, 409, 500],
  },
  {
    operationId: 'streamEvents',
    method: 'get',
    path: '/api/v1/events',
    summary: 'Server-sent change signals for the caller\'s organization',
    tag: 'events',
    query: StreamEventsQuerySchema,
    response: ErrorResponseSchema, // placeholder body type; real media type is text/event-stream
    errorStatuses: [401, 403],
    stream: true,
  },
]
