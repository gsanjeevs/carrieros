// server/contract/endpoints.ts
// Registry of /api/v1 operations. Add an operation here (with its schemas in
// schemas.ts), run `npm run gen:api`, and both apps get a typed method for it.
import type { ZodType } from 'zod'
import {
  ErrorResponseSchema,
  ListLoadsQuerySchema,
  ListLoadsResponseSchema,
  DocumentResponseSchema,
  FinalizeDocumentBodySchema,
  IdempotencyKeyHeaderSchema,
  ListDocumentsQuerySchema,
  ListDocumentsResponseSchema,
  RequestUploadBodySchema,
  RequestUploadResponseSchema,
  LoadIdParamsSchema,
  LogFuelStopBodySchema,
  LogFuelStopResponseSchema,
  MilestoneResponseSchema,
  ReportProblemBodySchema,
  ReportProblemResponseSchema,
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
    operationId: 'logFuelStop',
    method: 'post',
    path: '/api/v1/loads/{id}/fuel-stops',
    summary: 'Log a fuel purchase against a load (retry-safe)',
    tag: 'loads',
    params: LoadIdParamsSchema,
    headers: IdempotencyKeyHeaderSchema,
    body: LogFuelStopBodySchema,
    response: LogFuelStopResponseSchema,
    errorStatuses: [400, 401, 403, 404, 409, 422, 500],
  },
  {
    operationId: 'reportLoadProblem',
    method: 'post',
    path: '/api/v1/loads/{id}/problem-reports',
    summary: 'Report a problem/delay on a load; lands in the Exceptions inbox (retry-safe)',
    tag: 'loads',
    params: LoadIdParamsSchema,
    headers: IdempotencyKeyHeaderSchema,
    body: ReportProblemBodySchema,
    response: ReportProblemResponseSchema,
    errorStatuses: [400, 401, 403, 404, 409, 422, 500],
  },
  {
    operationId: 'requestDocumentUpload',
    method: 'post',
    path: '/api/v1/loads/{id}/document-uploads',
    summary: 'Step 1 of an upload: get a server-chosen path and a signed URL to PUT the bytes to',
    tag: 'documents',
    params: LoadIdParamsSchema,
    body: RequestUploadBodySchema,
    response: RequestUploadResponseSchema,
    errorStatuses: [400, 401, 403, 404, 500],
  },
  {
    operationId: 'finalizeDocument',
    method: 'post',
    path: '/api/v1/loads/{id}/documents',
    summary: 'Step 3 of an upload: verify the object exists at the issued path and record it against the load (retry-safe)',
    tag: 'documents',
    params: LoadIdParamsSchema,
    headers: IdempotencyKeyHeaderSchema,
    body: FinalizeDocumentBodySchema,
    response: DocumentResponseSchema,
    errorStatuses: [400, 401, 403, 404, 409, 422, 500],
  },
  {
    operationId: 'listLoadDocuments',
    method: 'get',
    path: '/api/v1/loads/{id}/documents',
    summary: 'List a load\'s documents of one type, each with a short-lived signed download URL',
    tag: 'documents',
    params: LoadIdParamsSchema,
    query: ListDocumentsQuerySchema,
    response: ListDocumentsResponseSchema,
    errorStatuses: [400, 401, 403, 404, 500],
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
