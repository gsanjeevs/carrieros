# carrieros-web — direct Supabase access inventory

Generated 2026-07-26 by a static scan of `app/`, `components/`, `lib/`, `tests/`
(`.ts`/`.tsx`, `node_modules` excluded). Machine-readable companion:
`web-supabase-usage.json`.

Counts were reconciled against raw ripgrep: 312 unique lines contain `.from(`;
14 are correctly excluded (4 `Array.from`/`Buffer.from`, 2 doc comments, 8
storage-chain continuation lines recorded at their `.storage` line instead),
leaving 298 lines → 296 table occurrences + 10 storage occurrences (8 of which
sit on a `.storage` line with no `.from(`). `.auth` = 51 raw − 3 comments = 48.
`.rpc(` = 20 raw − 2 comments = 18.

## Totals

**376 occurrences total.**

| Kind | Count |
|---|---|
| table (`.from('x')`) | 296 |
| auth (`supabase.auth.*`) | 48 |
| rpc (`.rpc('x')`) | 18 |
| storage (`supabase.storage.*`) | 10 |
| realtime | 4 |

| Operation | Count |
|---|---|
| read (`.select`) | 165 |
| write (`insert`/`update`/`upsert`/`delete`) | 131 |
| auth | 48 |
| rpc | 18 |
| storage | 10 |
| realtime | 4 |

| Layer | Count |
|---|---|
| test | 105 |
| route-handler | 79 |
| server-component | 97 |
| lib | 51 |
| client-component | 33 |
| server-action (`'use server'`) | 11 |

**33 distinct tables**, **13 distinct RPCs**, **3 storage buckets**
(`documents`, `avatars`, plus the provider's parameterised bucket).

RPCs: `bulk_import_customers`, `check_ifta_completeness`, `create_customer_org`,
`get_customer_health_score`, `get_exceptions`, `get_ifta_tax_summary`,
`get_my_entitlements`, `get_public_tracking`, `get_public_tracking_events`,
`has_feature`, `mark_overdue_invoices`, `next_entity_val`,
`send_expiry_reminders`.

Auth surface: `auth.getUser` (30) dominates; privileged
`auth.admin.*` = 11 calls (`deleteUser` 4, `createUser` 3, `listUsers`,
`getUserById`, `inviteUserByEmail`, `generateLink`).

## Highest-risk: tables written from client components

27 table occurrences live in client components, **19 of them writes** — i.e.
the browser issues the mutation directly and RLS is the only thing standing
between a user and the row. Ranked:

| Table | writes | reads | Files |
|---|---|---|---|
| `maintenance_reminders` | 2 | 0 | `app/(app)/maintenance/LogServiceButton.tsx` (insert, update) |
| `org_documents` | 2 | 0 | `components/CompanyDocuments.tsx` (insert, delete) |
| `driver_documents` | 2 | 0 | `components/DriverDocuments.tsx` (insert, delete) |
| `vehicle_documents` | 2 | 0 | `components/VehicleDocuments.tsx` (insert, delete) |
| `documents` | 2 | 0 | `components/LoadDocuments.tsx` (insert, delete) |
| `driver_messages` | 2 | 3 | `components/DriverMessageThread.tsx` (read-receipt updates) |
| `service_logs` | 1 | 0 | `app/(app)/maintenance/LogServiceButton.tsx` (insert) |
| `vehicles` | 1 | 0 | `app/(app)/vehicles/[vehicle_number]/VehiclePhotoUpload.tsx` (update `photo_path`) |
| `organizations` | 1 | 0 | `app/onboarding/steps/AddLogoStep.tsx` (update `logo_path`) |
| `drivers` | 1 | 2 | `components/DriverPayConfig.tsx` (update pay config) |
| `fuel_stops` | 1 | 0 | `components/FuelStopsSection.tsx` (insert) |
| `ifta_state_crossings` | 1 | 0 | `components/IftaCrossingsSection.tsx` (insert) |
| `profiles` | 1 | 0 | `components/LanguageSwitcher.tsx` (update `preferred_language`) |

The four `*Documents.tsx` components are the same copy-pasted
upload-then-insert / delete-then-remove pattern repeated per entity — a
storage write and a table write that are not transactional, so a failure
between them orphans a row or a blob.

`components/DriverPayConfig.tsx` is the one that touches money-shaped data
(driver pay config) straight from the browser.

## Service-role (`createAdminClient`) call sites

40 total references; **20 are real call sites**, the rest are imports, type
annotations (`ReturnType<typeof createAdminClient>`), a re-export, and
comments. Defined in `lib/supabase/server.ts` using
`SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS).

| Site | Layer | Justified? |
|---|---|---|
| `app/(app)/team/page.tsx:45` | server-component | **Borderline.** Only use is `listUsers({perPage:1000})` to attach emails/`lastSignInAt` to the roster. Role gate (`owner`/`solo`) happens above it, so it is guarded — but it pulls the *entire* auth user list (all tenants) and filters in memory. Should be a scoped lookup. |
| `app/api/team/route.ts:27` | route-handler | Same pattern as above, same caveat: full `listUsers` then in-memory join. Guarded by owner/solo check. |
| `app/api/team/invite/route.ts:77` | route-handler | Justified — inviting a user requires `auth.admin`. |
| `app/api/team/[id]/route.ts:42` | route-handler | Justified — role change / member removal touches `auth.users`. |
| `app/api/drivers/invite/route.ts:38` | route-handler | Justified — driver invite creates an auth user. |
| `app/api/customers/[org_id]/contacts/[contact_id]/invite/route.ts:51` | route-handler | Justified — portal-contact invite creates an auth user. |
| `app/api/customers/[org_id]/contacts/[contact_id]/revoke/route.ts:40` | route-handler | Justified — revoking portal access deletes/disables an auth user. |
| `app/api/onboarding/route.ts:121` | route-handler | Justified — onboarding writes org + profile before the user has an org-scoped RLS identity. |
| `app/api/cron/send-reminders/route.ts:45` | route-handler | Justified — cron runs with no user session; must cross tenants. Depends entirely on the route's own cron-secret check. |
| `app/api/intake/email/route.ts:69` | route-handler | Justified in kind (inbound webhook, no session) but **highest blast radius**: the org is resolved from the email `to:` address, then the service-role client writes a load into that org. Auth is the sender's ability to hit the endpoint. |
| `app/api/invoices/[id]/track/route.ts:33` | route-handler | Justified — tracking-pixel GET is unauthenticated by design; the write is narrowly scoped (`opened_at` only, `.is('opened_at', null)` so it is one-shot). |
| `lib/admin-auth.ts:51` | lib | Justified — returns the admin client only after verifying the caller's `profiles.role` is an `sx_*` SuperAdmin role. This is the single chokepoint for every `/api/admin/*` route. |
| `lib/api-auth.ts:95` | lib | `export { createAdminClient }` — a pure re-export. Widens the import surface for no benefit; worth removing so the only path is `lib/supabase/server`. |
| `tests/setup.ts`, `tests/helpers.ts`, `tests/global-teardown.ts` | test | Justified — fixtures and teardown must bypass RLS. |

Remaining entries are the definition, type annotations
(`app/api/onboarding/route.ts:24`, `app/api/team/[id]/route.ts:56`,
`lib/admin-auth.ts:26`) and comments.

## Realtime usage

All 4 occurrences are in **one file**, `components/DriverMessageThread.tsx`
(client-component):

| Line | Call | Business meaning? |
|---|---|---|
| 100 | `.channel(\`driver-messages-load-${loadId}\`)` | Per-load channel. Naming implies tenant scoping is by `load_id` only — Realtime authorization must be enforced by RLS on `driver_messages`, not by the channel name. |
| 102–103 | `.on('postgres_changes', { event:'INSERT', table:'driver_messages', filter:\`load_id=eq.${loadId}\` })` | **Business-meaningful.** This is the live delivery path for driver↔dispatcher chat, not a cosmetic refresh: a missed event means an undelivered message. The handler re-fetches the row by id (payload lacks the `profiles` join). |
| 114 | `.subscribe()` | Subscription activation. |
| 117 | `supabase.removeChannel(channel)` | Correct cleanup in the effect teardown. |

No Realtime anywhere else — loads, dispatch, and exceptions are all
request/response. So Realtime is a single-feature dependency today, but that
feature (chat) carries real business meaning, and the subscription is INSERT-only:
edits and deletes to `driver_messages` do not propagate.

## Top 5 risk findings

1. **19 client-side writes across 13 tables** — RLS is the sole authorization
   boundary for document CRUD, maintenance logs, IFTA crossings, fuel stops and
   driver pay config. No server-side validation layer sits in front of them.
2. **`app/(app)/team/page.tsx:45` and `app/api/team/route.ts:27` call
   `listUsers({ perPage: 1000 })` with the service-role key** and filter
   client-side — a cross-tenant read of the entire auth user table on a
   per-tenant page.
3. **`app/api/intake/email/route.ts:69`** resolves the target org from an
   inbound email address and then writes with the service-role client.
4. **Non-transactional storage + table writes** in the four `*Documents.tsx`
   components (upload then insert; delete row then remove blob) — a partial
   failure orphans a row or a blob, and the ordering differs between them.
5. **All Realtime lives in one component and only listens to INSERT** —
   `driver_messages` updates/deletes never reach an open thread, and the read-receipt
   `update` at line 92 is fired without awaiting or checking its error.
