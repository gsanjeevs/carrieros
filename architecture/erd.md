# CarrierOS entity-relationship diagrams

> **Generated** by `node scripts/db/gen-erd.mjs` from the live schema. Do not edit by hand:
> change the database via a migration, then re-run the generator. CI runs it with `--check`.

49 tables, 89 foreign keys, split into 6 domain diagrams (one diagram of every table is unreadable).
A box drawn without columns belongs to another domain; find it in its own section.
`||` = the FK is required (NOT NULL); `|o` = the FK is optional (nullable). `PK`/`FK` mark keys.

Conventions worth knowing: every tenant-owned row carries `carrier_org_id` or `org_id` and is isolated by
row-level security; vocabularies are `TEXT` + `CHECK`, not Postgres enums (so generated types are plain
`string`); the loads_driver_view view (loads without `rate`) is not a table and is not drawn.

## Tenancy, identity & entitlements

Organizations (carrier / customer / platform), their users, roles and the tier/feature model that gates what each org may use.

Tables: `organizations`, `carrier_details`, `customer_details`, `customer_contacts`, `profiles`, `roles`, `languages`, `role_capabilities`, `tiers`, `features`, `org_sequences`, `org_flag_overrides`, `org_feature_overrides`, `platform_flags`

```mermaid
erDiagram
  organizations {
    bigint id PK
    text address
    text city
    text country
    timestamptz created_at
    text currency
    text ein
    text email
    text logo_path
    text name
    text phone
    text state
    text type
    text zip
  }
  carrier_details {
    bigint org_id PK
    text billing_status
    text brand_accent_color
    text brand_primary_color
    text card_brand
    text card_last4
    text default_language
    integer default_net_terms_days
    text default_payment_method
    text dot_number
    text factoring_company
    timestamptz grace_period_until
    text load_email
    text mc_number
    text stripe_customer_id
    text tier
    text timezone
    timestamptz trial_ends_at
    text uom_system
  }
  customer_details {
    bigint org_id PK
    bigint carrier_org_id FK
    text contact_name
    text customer_number
    text notes
    ARRAY tags
  }
  customer_contacts {
    bigint id PK
    bigint carrier_org_id FK
    timestamptz created_at
    text email
    boolean is_primary
    text name
    bigint org_id FK
    text phone
    uuid portal_profile_id FK
    text title
  }
  profiles {
    uuid id PK
    text avatar_path
    timestamptz created_at
    text date_format
    text first_name
    boolean is_active
    text last_name
    bigint org_id FK
    text phone
    text preferred_language
    text push_token
    text role
    text theme_preference
    text time_format
    text timezone
    text uom_system
  }
  roles {
    bigint id PK
    text abbreviation
    text code
    text color_token
    integer display_order
    text label
    text scope
  }
  languages {
    text code PK
    integer display_order
    text flag_emoji
    text label
    text native_name
  }
  role_capabilities {
    text capability PK
    text role PK
  }
  tiers {
    text code PK
    integer included_trucks
    text label
    numeric monthly_price
    numeric price_per_additional_truck
    integer rank
  }
  features {
    text key PK
    integer display_order
    text label
    text min_tier FK
    boolean retained_when_delinquent
  }
  org_sequences {
    text entity PK
    bigint org_id PK
    bigint last_val
  }
  org_flag_overrides {
    text flag_key PK
    bigint org_id PK
    boolean enabled
    timestamptz set_at
    uuid set_by FK
  }
  org_feature_overrides {
    text feature_key PK
    bigint org_id PK
    text effect
    timestamptz expires_at
    text reason
    timestamptz set_at
    uuid set_by FK
  }
  platform_flags {
    text flag_key PK
    timestamptz created_at
    boolean default_enabled
    text description
  }
  organizations ||--o{ carrier_details : "org_id"
  organizations ||--o{ customer_contacts : "carrier_org_id"
  organizations ||--o{ customer_contacts : "org_id"
  profiles |o--o{ customer_contacts : "portal_profile_id"
  organizations ||--o{ customer_details : "carrier_org_id"
  organizations ||--o{ customer_details : "org_id"
  tiers ||--o{ features : "min_tier"
  features ||--o{ org_feature_overrides : "feature_key"
  organizations ||--o{ org_feature_overrides : "org_id"
  profiles |o--o{ org_feature_overrides : "set_by"
  platform_flags ||--o{ org_flag_overrides : "flag_key"
  organizations ||--o{ org_flag_overrides : "org_id"
  profiles |o--o{ org_flag_overrides : "set_by"
  organizations ||--o{ org_sequences : "org_id"
  auth_users ||--o{ profiles : "id"
  organizations ||--o{ profiles : "org_id"
  roles ||--o{ role_capabilities : "role"
```

## Fleet

Vehicles, drivers, their documents, and maintenance.

Tables: `vehicles`, `vehicle_types`, `vehicle_classifications`, `vehicle_type_classifications`, `vehicle_documents`, `drivers`, `driver_documents`, `org_documents`, `maintenance_reminders`, `service_logs`

```mermaid
erDiagram
  vehicles {
    bigint id PK
    text cab_type
    bigint carrier_org_id FK
    text color
    timestamptz created_at
    text dimensions
    boolean is_active
    text license_plate
    text license_state
    text make
    text model
    text nickname
    text photo_path
    text status
    text vehicle_number
    bigint vehicle_type_id FK
    text vin
    integer year
  }
  vehicle_types {
    bigint id PK
    text code
    integer display_order
    text generic_photo_path
    text icon
    text label
    text specialized_capacity_note
    numeric typical_cargo_volume_cuft
    numeric typical_length_ft
    numeric typical_payload_capacity_lbs
  }
  vehicle_classifications {
    bigint id PK
    text code
    integer display_order
    text label
    text license_category_note
    numeric max_weight_kg
    numeric min_weight_kg
    text region
    boolean requires_special_license
    text scheme_name
  }
  vehicle_type_classifications {
    bigint classification_id PK
    bigint vehicle_type_id PK
  }
  vehicle_documents {
    bigint id PK
    bigint carrier_org_id FK
    timestamptz created_at
    text doc_type
    date expiry_date
    text label
    text storage_path
    uuid uploaded_by FK
    bigint vehicle_id FK
  }
  drivers {
    bigint id PK
    bigint carrier_org_id FK
    text cdl_class
    date cdl_expiry
    text cdl_number
    text cdl_state
    timestamptz created_at
    bigint default_vehicle_id FK
    text driver_number
    text emergency_contact_name
    text emergency_contact_phone
    text emergency_contact_relation
    ARRAY endorsements
    text invite_status
    boolean is_active
    date med_cert_expiry
    uuid profile_id FK
    numeric settlement_rate
    text settlement_type
  }
  driver_documents {
    bigint id PK
    bigint carrier_org_id FK
    timestamptz created_at
    text doc_type
    bigint driver_id FK
    date expiry_date
    text label
    text storage_path
    uuid uploaded_by FK
  }
  org_documents {
    bigint id PK
    timestamptz created_at
    text doc_type
    date expiry_date
    text label
    bigint org_id FK
    text storage_path
    timestamptz updated_at
    uuid uploaded_by FK
  }
  maintenance_reminders {
    bigint id PK
    bigint carrier_org_id FK
    timestamptz created_at
    boolean is_active
    integer last_odometer
    date last_service_date
    date next_due_date
    integer next_due_miles
    text reminder_type
    integer trigger_miles
    integer trigger_months
    bigint vehicle_id FK
  }
  service_logs {
    bigint id PK
    bigint carrier_org_id FK
    numeric cost
    timestamptz created_at
    uuid logged_by FK
    text notes
    integer odometer
    text receipt_path
    date service_date
    text service_type
    text shop_name
    bigint vehicle_id FK
  }
  organizations |o--o{ driver_documents : "carrier_org_id"
  drivers |o--o{ driver_documents : "driver_id"
  profiles |o--o{ driver_documents : "uploaded_by"
  organizations ||--o{ drivers : "carrier_org_id"
  vehicles |o--o{ drivers : "default_vehicle_id"
  profiles ||--o{ drivers : "profile_id"
  organizations |o--o{ maintenance_reminders : "carrier_org_id"
  vehicles |o--o{ maintenance_reminders : "vehicle_id"
  organizations |o--o{ org_documents : "org_id"
  profiles |o--o{ org_documents : "uploaded_by"
  organizations |o--o{ service_logs : "carrier_org_id"
  profiles |o--o{ service_logs : "logged_by"
  vehicles |o--o{ service_logs : "vehicle_id"
  organizations |o--o{ vehicle_documents : "carrier_org_id"
  profiles |o--o{ vehicle_documents : "uploaded_by"
  vehicles |o--o{ vehicle_documents : "vehicle_id"
  vehicle_classifications ||--o{ vehicle_type_classifications : "classification_id"
  vehicle_types ||--o{ vehicle_type_classifications : "vehicle_type_id"
  organizations ||--o{ vehicles : "carrier_org_id"
  vehicle_types ||--o{ vehicles : "vehicle_type_id"
```

## Loads & dispatch

The core shipment record, its timeline, expenses, documents (POD etc.), exceptions and driver chat.

Tables: `loads`, `load_events`, `load_expenses`, `documents`, `exception_events`, `driver_messages`, `driver_message_translations`

```mermaid
erDiagram
  loads {
    bigint id PK
    bigint carrier_org_id FK
    text commodity
    timestamptz created_at
    text customer_name_raw
    bigint customer_org_id FK
    text delivery_address
    text delivery_city
    date delivery_date
    numeric delivery_lat
    numeric delivery_lng
    text delivery_state
    time delivery_time
    text delivery_zip
    bigint driver_id FK
    jsonb extraction_data
    text intake_method
    timestamptz last_location_at
    numeric last_location_lat
    numeric last_location_lng
    text load_number
    text pickup_address
    text pickup_city
    date pickup_date
    numeric pickup_lat
    numeric pickup_lng
    text pickup_state
    time pickup_time
    text pickup_zip
    numeric rate
    text raw_intake_text
    text status
    numeric total_miles
    text tracking_token
    timestamptz updated_at
    bigint vehicle_id FK
    integer weight_lbs
  }
  load_events {
    bigint id PK
    timestamptz created_at
    uuid created_by FK
    text event_type
    bigint load_id FK
    numeric location_lat
    numeric location_lng
    text note
  }
  load_expenses {
    bigint id PK
    numeric amount
    bigint carrier_org_id FK
    timestamptz created_at
    text expense_type
    bigint load_id FK
    uuid logged_by FK
    text note
  }
  documents {
    bigint id PK
    bigint carrier_org_id FK
    timestamptz created_at
    bigint load_id FK
    text storage_path
    text type
    uuid uploaded_by FK
  }
  exception_events {
    bigint id PK
    bigint carrier_org_id FK
    timestamptz created_at
    text detail
    bigint entity_id
    text entity_type
    text event_type
    timestamptz occurred_at
    text severity
    text title
  }
  driver_messages {
    bigint id PK
    text body
    bigint carrier_org_id FK
    bigint load_id FK
    text original_language
    timestamptz read_at
    uuid sender_id FK
    timestamptz sent_at
  }
  driver_message_translations {
    bigint id PK
    bigint message_id FK
    text target_language
    timestamptz translated_at
    text translated_body
  }
  organizations |o--o{ documents : "carrier_org_id"
  loads |o--o{ documents : "load_id"
  profiles |o--o{ documents : "uploaded_by"
  driver_messages ||--o{ driver_message_translations : "message_id"
  organizations ||--o{ driver_messages : "carrier_org_id"
  loads ||--o{ driver_messages : "load_id"
  profiles |o--o{ driver_messages : "sender_id"
  organizations ||--o{ exception_events : "carrier_org_id"
  profiles |o--o{ load_events : "created_by"
  loads ||--o{ load_events : "load_id"
  organizations ||--o{ load_expenses : "carrier_org_id"
  loads ||--o{ load_expenses : "load_id"
  profiles |o--o{ load_expenses : "logged_by"
  organizations ||--o{ loads : "carrier_org_id"
  organizations |o--o{ loads : "customer_org_id"
  drivers |o--o{ loads : "driver_id"
  vehicles |o--o{ loads : "vehicle_id"
```

## Billing & settlements

Customer invoices, driver settlements and their deductions, and subscription billing events.

Tables: `invoices`, `driver_settlements`, `settlement_deductions`, `billing_events`

```mermaid
erDiagram
  invoices {
    bigint id PK
    numeric amount
    bigint carrier_org_id FK
    timestamptz created_at
    bigint customer_org_id FK
    date due_date
    timestamptz factored_at
    text factoring_company
    text factoring_reference
    text invoice_number
    bigint load_id FK
    text notes
    timestamptz opened_at
    timestamptz paid_at
    text payment_method
    timestamptz sent_at
    text status
  }
  driver_settlements {
    bigint id PK
    numeric advance_amount
    bigint carrier_org_id FK
    timestamptz created_at
    uuid created_by FK
    bigint driver_id FK
    numeric gross_revenue
    bigint load_id FK
    integer loads_count
    numeric net_pay
    text pay_method
    text payment_status
    text pdf_statement_path
    date period_end
    date period_start
    numeric rate_value
  }
  settlement_deductions {
    bigint id PK
    numeric amount
    text deduction_type
    text note
    bigint settlement_id FK
  }
  billing_events {
    bigint id PK
    numeric amount
    text card_last4
    timestamptz created_at
    text event_type
    bigint org_id FK
    timestamptz resolved_at
    text status
    text stripe_event_id
  }
  organizations ||--o{ billing_events : "org_id"
  organizations ||--o{ driver_settlements : "carrier_org_id"
  profiles |o--o{ driver_settlements : "created_by"
  drivers |o--o{ driver_settlements : "driver_id"
  loads |o--o{ driver_settlements : "load_id"
  organizations ||--o{ invoices : "carrier_org_id"
  organizations |o--o{ invoices : "customer_org_id"
  loads |o--o{ invoices : "load_id"
  driver_settlements ||--o{ settlement_deductions : "settlement_id"
```

## Compliance & IFTA

Fuel purchases and state crossings for IFTA reporting, and driver vehicle inspection reports (DVIR).

Tables: `fuel_stops`, `ifta_state_crossings`, `ifta_tax_rates`, `dvir_inspections`, `dvir_defects`

```mermaid
erDiagram
  fuel_stops {
    bigint id PK
    bigint carrier_org_id FK
    timestamptz created_at
    bigint driver_id FK
    numeric gallons
    bigint load_id FK
    uuid logged_by FK
    integer odometer
    numeric price_per_gallon
    text receipt_path
    text state
    text station
    date stop_date
    numeric total_cost
    bigint vehicle_id FK
  }
  ifta_state_crossings {
    bigint id PK
    bigint carrier_org_id FK
    timestamptz created_at
    timestamptz crossed_at
    bigint driver_id FK
    numeric lat
    numeric lng
    bigint load_id FK
    integer odometer_est
    text source
    text state
    bigint vehicle_id FK
  }
  ifta_tax_rates {
    bigint id PK
    text quarter
    numeric rate_per_gallon
    text state
  }
  dvir_inspections {
    bigint id PK
    bigint carrier_org_id FK
    text condition
    timestamptz created_at
    bigint driver_id FK
    bigint load_id FK
    integer odometer
    text signature_url
    timestamptz submitted_at
    text type
    bigint vehicle_id FK
  }
  dvir_defects {
    bigint id PK
    text area
    timestamptz created_at
    text description
    bigint inspection_id FK
    text photo_path
    text severity
  }
  dvir_inspections |o--o{ dvir_defects : "inspection_id"
  organizations |o--o{ dvir_inspections : "carrier_org_id"
  drivers |o--o{ dvir_inspections : "driver_id"
  loads |o--o{ dvir_inspections : "load_id"
  vehicles |o--o{ dvir_inspections : "vehicle_id"
  organizations ||--o{ fuel_stops : "carrier_org_id"
  drivers |o--o{ fuel_stops : "driver_id"
  loads |o--o{ fuel_stops : "load_id"
  profiles |o--o{ fuel_stops : "logged_by"
  vehicles |o--o{ fuel_stops : "vehicle_id"
  organizations ||--o{ ifta_state_crossings : "carrier_org_id"
  drivers |o--o{ ifta_state_crossings : "driver_id"
  loads |o--o{ ifta_state_crossings : "load_id"
  vehicles |o--o{ ifta_state_crossings : "vehicle_id"
```

## Platform & infrastructure

SuperAdmin activity, the tenant audit trail, transactional outbox, live-update change feed, idempotency keys, the public developer API's OAuth clients/rate limits, and migration bookkeeping.

Tables: `admin_events`, `admin_notes`, `audit_events`, `outbox_events`, `change_events`, `idempotency_keys`, `oauth_clients`, `oauth_client_rate_limits`, `schema_migrations`

```mermaid
erDiagram
  admin_events {
    bigint id PK
    uuid admin_id FK
    timestamptz created_at
    text event_type
    jsonb metadata
    bigint org_id FK
  }
  admin_notes {
    bigint id PK
    uuid admin_id FK
    text body
    timestamptz created_at
    bigint org_id FK
  }
  audit_events {
    bigint id PK
    text action
    uuid actor_user_id FK
    text aggregate_id
    text aggregate_type
    text correlation_id
    integer expected_version
    jsonb metadata
    text new_state
    timestamptz occurred_at
    bigint org_id FK
    text prior_state
    text reason
  }
  outbox_events {
    bigint id PK
    text aggregate_id
    text aggregate_type
    integer attempts
    text correlation_id
    text event_type
    text idempotency_key
    text last_error
    integer max_attempts
    timestamptz next_attempt_at
    timestamptz occurred_at
    bigint org_id FK
    jsonb payload
    timestamptz processed_at
    uuid replayed_by FK
    bigint replayed_from_id FK
    text status
  }
  change_events {
    bigint id PK
    timestamptz created_at
    text entity
    bigint entity_id
    text op
    bigint org_id
  }
  idempotency_keys {
    bigint id PK
    text correlation_id
    timestamptz created_at
    text endpoint
    timestamptz expires_at
    text idempotency_key
    bigint org_id FK
    text request_hash
    jsonb response_body
    integer status_code
    uuid user_id FK
  }
  oauth_clients {
    bigint id PK
    text client_id
    text client_secret_hash
    timestamptz created_at
    timestamptz last_used_at
    text name
    bigint org_id FK
    timestamptz revoked_at
  }
  oauth_client_rate_limits {
    text client_id PK
    timestamptz window_start PK
    integer request_count
  }
  schema_migrations {
    text version PK
    timestamptz applied_at
    text checksum
    integer duration_ms
    text name
  }
  profiles |o--o{ admin_events : "admin_id"
  organizations |o--o{ admin_events : "org_id"
  profiles |o--o{ admin_notes : "admin_id"
  organizations ||--o{ admin_notes : "org_id"
  auth_users |o--o{ audit_events : "actor_user_id"
  organizations ||--o{ audit_events : "org_id"
  organizations ||--o{ idempotency_keys : "org_id"
  auth_users ||--o{ idempotency_keys : "user_id"
  organizations ||--o{ oauth_clients : "org_id"
  organizations ||--o{ outbox_events : "org_id"
  auth_users |o--o{ outbox_events : "replayed_by"
  outbox_events |o--o{ outbox_events : "replayed_from_id"
```
