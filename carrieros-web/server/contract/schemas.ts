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
import { DOCUMENT_TYPES, UPLOAD_CONTENT_TYPES, MAX_UPLOAD_BYTES } from '../domain/documents/upload'
import { CDL_CLASSES, ENDORSEMENT_CODES } from '../domain/driver/self-profile'
import { DEFECT_SEVERITIES, DVIR_AREAS, DVIR_TYPES } from '../domain/compliance/dvir'
import { PROBLEM_REASONS } from '../domain/driver-actions/problem-report'
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
  // Comma-separated list of one or more groups (e.g. "completed,cancelled"),
  // so a screen that needs a union of groups (mobile history: completed +
  // cancelled) can still get one correctly-ordered, correctly-limited query
  // instead of merging several client-side with no shared sort key.
  status_group: z
    .string()
    .optional()
    .refine(
      (v) => !v || v.split(',').every((g) => (LOAD_STATUS_GROUP_KEYS as readonly string[]).includes(g)),
      { message: `status_group must be one or more of, comma-separated: ${LOAD_STATUS_GROUP_KEYS.join(', ')}` }
    ),
  limit: z.number().int().min(1).max(100).optional(),
})

export const ListLoadsResponseSchema = z.object({
  loads: z.array(LoadSummarySchema),
  can_see_rate: z.boolean(),
})

export const LoadEventSchema = z.object({
  id: z.number().int(),
  event_type: z.string(),
  created_at: z.string().nullable(),
})

export const LoadDetailSchema = z.object({
  id: z.number().int(),
  load_number: z.string(),
  status: z.string(),
  customer_name_raw: z.string().nullable(),
  pickup_address: z.string().nullable(),
  pickup_city: z.string().nullable(),
  pickup_state: z.string().nullable(),
  pickup_date: z.string().nullable(),
  pickup_time: z.string().nullable(),
  delivery_address: z.string().nullable(),
  delivery_city: z.string().nullable(),
  delivery_state: z.string().nullable(),
  delivery_date: z.string().nullable(),
  delivery_time: z.string().nullable(),
  commodity: z.string().nullable(),
  weight_lbs: z.number().nullable(),
  total_miles: z.number().nullable(),
  driver_id: z.number().int().nullable(),
  vehicle_id: z.number().int().nullable(),
  rate: z.number().nullable().optional().describe('Present only when the caller\'s role may see money.'),
})

export const GetLoadResponseSchema = z.object({
  load: LoadDetailSchema,
  events: z.array(LoadEventSchema),
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

export const LogFuelStopBodySchema = z.object({
  state: z.string().length(2).describe('2-letter state/province code (IFTA aggregates gallons by state).'),
  station: z.string().max(120).nullable().optional(),
  gallons: z.number().positive().max(1000),
  price_per_gallon: z.number().min(0).max(100).nullable().optional(),
  total_cost: z.number().min(0).nullable().optional().describe('Receipt total; otherwise computed as gallons x price.'),
  odometer: z.number().int().min(0).nullable().optional(),
  stop_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe('YYYY-MM-DD; defaults to today.'),
})
export const LogFuelStopResponseSchema = z.object({ id: z.number().int(), total_cost: z.number() })

export const ReportProblemBodySchema = z.object({
  reason: z.enum(PROBLEM_REASONS),
  note: z.string().max(1000).nullable().optional(),
})
export const ReportProblemResponseSchema = z.object({ id: z.number().int() })

export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES)

export const RequestUploadBodySchema = z.object({
  type: DocumentTypeSchema,
  content_type: z.enum(UPLOAD_CONTENT_TYPES),
  size_bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
})
export const RequestUploadResponseSchema = z.object({
  upload_url: z.string().describe('PUT the raw file bytes here with the Content-Type header below. Valid for this path only.'),
  storage_path: z.string().describe('Chosen by the server. Pass it back to finalize the upload.'),
  content_type: z.string(),
})

export const FinalizeDocumentBodySchema = z.object({ type: DocumentTypeSchema, storage_path: z.string().min(1).max(300) })
export const DocumentResponseSchema = z.object({ id: z.number().int(), type: z.string(), storage_path: z.string() })

export const ListDocumentsQuerySchema = z.object({ type: DocumentTypeSchema })
export const ListDocumentsResponseSchema = z.object({
  documents: z.array(
    z.object({
      id: z.number().int(),
      type: z.string(),
      created_at: z.string().nullable(),
      url: z.string().nullable().describe('Short-lived signed download URL.'),
    })
  ),
})

export const InvoiceIdParamsSchema = z.object({ id: z.number().int().positive() })

export const UpdateInvoiceBodySchema = z.object({
  amount: z.number().positive().max(10_000_000),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe('YYYY-MM-DD'),
  notes: z.string().max(1000).nullable().optional(),
})
export const UpdateInvoiceResponseSchema = z.object({ id: z.number().int() })

export const MarkPaidResponseSchema = z.object({
  outcome: z.enum(['APPLIED', 'ALREADY_PAID']),
  invoice_id: z.number().int(),
})

export const MarkMessagesReadBodySchema = z.object({ message_ids: z.array(z.number().int().positive()).min(1).max(200) })
export const MarkMessagesReadResponseSchema = z.object({ updated: z.number().int() })

export const ShareLocationBodySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  recorded_at: z.string().datetime().optional().describe('When the phone took the sample; ignored if in the future.'),
})

export const UpdateDriverProfileBodySchema = z.object({
  cdl_number: z.string().max(40).nullable().optional(),
  cdl_class: z.enum(CDL_CLASSES).nullable().optional(),
  cdl_state: z.string().length(2).nullable().optional(),
  endorsements: z.array(z.enum(ENDORSEMENT_CODES)).optional(),
  emergency_contact_name: z.string().max(100).nullable().optional(),
  emergency_contact_phone: z.string().max(30).nullable().optional(),
  emergency_contact_relation: z.string().max(50).nullable().optional(),
  default_vehicle_id: z.number().int().positive().nullable().optional(),
})

export const LogServiceBodySchema = z.object({
  service_type: z.string().min(1).max(100),
  service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  odometer: z.number().int().min(0).nullable().optional(),
  cost: z.number().min(0).nullable().optional(),
  shop_name: z.string().max(120).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  reminder_id: z.number().int().positive().nullable().optional().describe('The maintenance reminder this service satisfies; its next-due date/miles are recomputed server-side.'),
})
export const LogServiceResponseSchema = z.object({ id: z.number().int() })

export const RecordCrossingBodySchema = z.object({
  state: z.string().length(2),
  crossed_at: z.string().datetime(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
})
export const RecordCrossingResponseSchema = z.object({ id: z.number().int() })

export const ManualCrossingsBodySchema = z.object({
  rows: z.array(z.object({ state: z.string().length(2), miles: z.number().int().positive().max(5000) })).min(1).max(60),
})
export const ManualCrossingsResponseSchema = z.object({ written: z.number().int() })

export const SubmitDvirBodySchema = z.object({
  type: z.enum(DVIR_TYPES),
  odometer: z.number().int().min(0).nullable().optional(),
  defects: z
    .array(z.object({ area: z.enum(DVIR_AREAS), description: z.string().min(1).max(1000), severity: z.enum(DEFECT_SEVERITIES) }))
    .max(DVIR_AREAS.length),
})
export const SubmitDvirResponseSchema = z.object({
  id: z.number().int(),
  defects: z.array(z.object({ id: z.number().int(), area: z.string() })),
})

export const RequestAttachmentBodySchema = z.object({
  kind: z.enum(['signature', 'defect_photo']),
  area: z.enum(DVIR_AREAS).nullable().optional().describe('Required for defect_photo.'),
  content_type: z.enum(['image/png', 'image/jpeg']),
})
export const FinalizeAttachmentBodySchema = z.object({
  kind: z.enum(['signature', 'defect_photo']),
  area: z.enum(DVIR_AREAS).nullable().optional(),
  storage_path: z.string().min(1).max(300),
})

export const EntitlementsResponseSchema = z.object({
  keys: z.array(z.string()).describe('Feature keys the caller\'s organization currently has, per get_my_entitlements().'),
})

export const DriverProfileResponseSchema = z.object({
  id: z.number().int(),
  cdl_number: z.string().nullable(),
  cdl_class: z.enum(CDL_CLASSES).nullable(),
  cdl_state: z.string().nullable(),
  cdl_expiry: z.string().nullable(),
  med_cert_expiry: z.string().nullable(),
  endorsements: z.array(z.string()),
  emergency_contact_name: z.string().nullable(),
  emergency_contact_phone: z.string().nullable(),
  emergency_contact_relation: z.string().nullable(),
  default_vehicle_id: z.number().int().nullable(),
})

export const VehicleSummarySchema = z.object({
  id: z.number().int(),
  vehicle_number: z.string().nullable(),
  nickname: z.string(),
  status: z.string(),
  photo_url: z.string().nullable().describe('Short-lived signed URL, present only when the vehicle has a photo.'),
})
export const ListVehiclesResponseSchema = z.object({ vehicles: z.array(VehicleSummarySchema) })

export const ServiceLogSchema = z.object({
  id: z.number().int(),
  service_type: z.string(),
  service_date: z.string(),
  odometer: z.number().int().nullable(),
  cost: z.number().nullable(),
  shop_name: z.string().nullable(),
})
export const MaintenanceReminderSchema = z.object({
  id: z.number().int(),
  reminder_type: z.string(),
  trigger_miles: z.number().int().nullable(),
  trigger_months: z.number().int().nullable(),
})
export const VehicleDetailResponseSchema = z.object({
  id: z.number().int(),
  vehicle_number: z.string().nullable(),
  nickname: z.string(),
  status: z.string(),
  service_logs: z.array(ServiceLogSchema),
  maintenance_reminders: z.array(MaintenanceReminderSchema),
})

export const InvoiceSummarySchema = z.object({
  id: z.number().int(),
  invoice_number: z.string(),
  amount: z.number(),
  status: z.string(),
  due_date: z.string().nullable(),
  opened_at: z.string().nullable(),
})
export const ListInvoicesResponseSchema = z.object({ invoices: z.array(InvoiceSummarySchema) })

export const InvoiceDetailResponseSchema = z.object({
  id: z.number().int(),
  invoice_number: z.string(),
  amount: z.number(),
  status: z.string(),
  due_date: z.string().nullable(),
  notes: z.string().nullable(),
  sent_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  opened_at: z.string().nullable(),
  load_id: z.number().int().nullable(),
})

export const ListLoadDvirInspectionsQuerySchema = z.object({ type: z.enum(DVIR_TYPES).optional() })
export const DvirInspectionBriefSchema = z.object({
  id: z.number().int(),
  type: z.enum(DVIR_TYPES),
  created_at: z.string().nullable(),
})
export const ListLoadDvirInspectionsResponseSchema = z.object({ inspections: z.array(DvirInspectionBriefSchema) })

export const DvirDefectSchema = z.object({
  id: z.number().int(),
  area: z.string(),
  description: z.string().nullable(),
  severity: z.enum(DEFECT_SEVERITIES).nullable(),
})
export const DvirHistoryItemSchema = z.object({
  id: z.number().int(),
  type: z.enum(DVIR_TYPES),
  condition: z.string(),
  odometer: z.number().int().nullable(),
  submitted_at: z.string(),
  signature_url: z.string().nullable().describe('Short-lived signed URL, present only when signed.'),
  vehicle: z.object({ vehicle_number: z.string().nullable(), nickname: z.string() }).nullable(),
  driver_name: z.string().nullable(),
  defects: z.array(DvirDefectSchema),
})
export const ListDvirInspectionsResponseSchema = z.object({ inspections: z.array(DvirHistoryItemSchema) })

// ── Exceptions ──────────────────────────────────────────────────────────────

export const ExceptionRowSchema = z.object({
  entity_type: z.string(),
  entity_id: z.number().int(),
  exception_type: z.string(),
  tier: z.string(),
  title: z.string(),
  detail: z.string(),
  due_at: z.string().nullable(),
})
export const ListExceptionsResponseSchema = z.object({ exceptions: z.array(ExceptionRowSchema) })

// ── Customers ───────────────────────────────────────────────────────────────

export const CustomerOrgInfoSchema = z.object({ name: z.string(), phone: z.string().nullable(), email: z.string().nullable() })
export const CustomerSummarySchema = z.object({
  org_id: z.number().int(),
  contact_name: z.string().nullable(),
  organization: CustomerOrgInfoSchema.nullable(),
})
export const ListCustomersResponseSchema = z.object({ customers: z.array(CustomerSummarySchema) })

export const CustomerIdParamsSchema = z.object({ id: z.number().int().positive() })

export const CustomerDetailSchema = z.object({
  org_id: z.number().int(),
  customer_number: z.string().nullable(),
  contact_name: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  notes: z.string().nullable(),
  organization: CustomerOrgInfoSchema.extend({ city: z.string().nullable(), state: z.string().nullable() }).nullable(),
})
export const CustomerLoadSchema = z.object({
  id: z.number().int(),
  load_number: z.string(),
  status: z.string().nullable(),
  rate: z.number().nullable(),
  delivery_date: z.string().nullable(),
})
export const GetCustomerResponseSchema = z.object({
  customer: CustomerDetailSchema,
  recent_loads: z.array(CustomerLoadSchema),
  health_score: z.number().nullable(),
})

// ── Billing ─────────────────────────────────────────────────────────────────

export const GetBillingResponseSchema = z.object({
  tier: z.string().nullable(),
  billing_status: z.string().nullable(),
  trial_ends_at: z.string().nullable(),
  stripe_customer_id: z.string().nullable(),
  card_brand: z.string().nullable(),
  card_last4: z.string().nullable(),
  vehicle_count: z.number().int(),
  included_trucks: z.number().int(),
  price_per_additional_truck: z.number(),
})

// ── Maintenance reminders (fleet-wide) ──────────────────────────────────────

export const FleetReminderSchema = z.object({
  id: z.number().int(),
  vehicle_id: z.number().int(),
  reminder_type: z.string(),
  next_due_date: z.string().nullable(),
  next_due_miles: z.number().int().nullable(),
  vehicle: z.object({ vehicle_number: z.string().nullable(), nickname: z.string().nullable() }).nullable(),
})
export const ListMaintenanceRemindersResponseSchema = z.object({ reminders: z.array(FleetReminderSchema) })

// ── Settlements ─────────────────────────────────────────────────────────────

export const SettlementSchema = z.object({
  id: z.number().int(),
  pay_method: z.string(),
  gross_revenue: z.number().nullable(),
  net_pay: z.number().nullable(),
  payment_status: z.string(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  driver: z.object({ driver_number: z.string().nullable(), first_name: z.string().nullable(), last_name: z.string().nullable() }).nullable(),
})
export const ListSettlementsResponseSchema = z.object({ entitled: z.boolean(), settlements: z.array(SettlementSchema) })

// ── IFTA reads ──────────────────────────────────────────────────────────────

export const IftaCrossingSchema = z.object({
  id: z.number().int(),
  state: z.string(),
  odometer_est: z.number().nullable(),
  source: z.string(),
})
export const ListIftaCrossingsResponseSchema = z.object({ crossings: z.array(IftaCrossingSchema) })
export const IftaCompletenessResponseSchema = z.object({ complete: z.boolean() })

export const IftaQuarterlySummaryQuerySchema = z.object({
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/).describe('YYYY-Qn'),
})
export const IftaStateMilesSchema = z.object({ state: z.string(), total_miles: z.number() })
export const IftaQuarterlySummaryResponseSchema = z.object({ entitled: z.boolean(), rows: z.array(IftaStateMilesSchema) })

// ── Fuel stops (read) ───────────────────────────────────────────────────────

export const FuelStopSchema = z.object({
  id: z.number().int(),
  state: z.string(),
  station: z.string().nullable(),
  gallons: z.number(),
  total_cost: z.number(),
})
export const ListFuelStopsResponseSchema = z.object({ fuel_stops: z.array(FuelStopSchema) })

// ── Driver messages (read) ──────────────────────────────────────────────────

export const DriverMessageSchema = z.object({
  id: z.number().int(),
  sender_id: z.string().nullable(),
  body: z.string(),
  original_language: z.string().nullable(),
  sent_at: z.string(),
  read_at: z.string().nullable(),
})
export const ListMessagesResponseSchema = z.object({ messages: z.array(DriverMessageSchema) })

// ── Dashboard ───────────────────────────────────────────────────────────────

export const DashboardLoadCardSchema = z.object({
  id: z.number().int(),
  load_number: z.string(),
  status: z.string(),
  customer_name_raw: z.string().nullable(),
  pickup_city: z.string().nullable(),
  pickup_state: z.string().nullable(),
  delivery_city: z.string().nullable(),
  delivery_state: z.string().nullable(),
})
export const DashboardOpsLoadSchema = DashboardLoadCardSchema.extend({
  driver_id: z.number().int().nullable(),
  vehicle_id: z.number().int().nullable(),
  updated_at: z.string().nullable(),
})
export const DashboardInvoiceSchema = z.object({
  id: z.number().int(),
  invoice_number: z.string(),
  amount: z.number(),
  due_date: z.string().nullable(),
  paid_at: z.string().nullable(),
})
export const GetDashboardResponseSchema = z.object({
  role: z.string(),
  active_loads_count: z.number().int().optional(),
  fleet_counts: z.object({ active: z.number().int(), idle: z.number().int(), in_shop: z.number().int() }).optional(),
  recent_loads: z.array(DashboardLoadCardSchema).optional(),
  solo_active_load: DashboardLoadCardSchema.nullable().optional(),
  ops_loads: z.array(DashboardOpsLoadSchema).optional(),
  available_drivers: z.number().int().optional(),
  available_vehicles: z.number().int().optional(),
  outstanding_total: z.number().optional(),
  outstanding_count: z.number().int().optional(),
  most_overdue_invoices: z.array(DashboardInvoiceSchema).optional(),
  recent_payments: z.array(DashboardInvoiceSchema).optional(),
})

export type ListLoadsQuery = z.infer<typeof ListLoadsQuerySchema>
export type ListLoadsResponse = z.infer<typeof ListLoadsResponseSchema>
