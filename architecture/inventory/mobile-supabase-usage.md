# carrieros-mobile — direct Supabase access inventory

Generated 2026-07-26. Scope: `carrieros-mobile/src` (all 76 `.ts`/`.tsx` files;
`node_modules` excluded). Machine-readable companion:
`mobile-supabase-usage.json`.

Read-only audit — no source file was modified.

## Totals

| Kind | Count |
| --- | --- |
| `table` (`.from('<table>')`) | 88 |
| — of which **reads** (`.select`) | 62 |
| — of which **writes** (`insert`/`update`/`delete`) | **26** |
| `rpc` (`.rpc('<fn>')`) | 8 (6 distinct functions) |
| `storage` (`supabase.storage`) | 7 |
| `auth` (`supabase.auth.*`) | 10 |
| `realtime` (`.channel` / `postgres_changes` / `.subscribe`) | 4 (1 subscription) |
| `api` (`apiFetch` call sites) | 14 |
| **Total occurrences** | **131** |

Write verb split: 9 `insert`, 16 `update`, 1 `delete`, 0 `upsert`.

### Distinct tables/views touched (21)

`carrier_details`, `customer_details`, `documents`, `driver_messages`,
`driver_settlements`, `drivers`, `dvir_defects`, `dvir_inspections`,
`exception_events`, `fuel_stops`, `ifta_state_crossings`, `invoices`,
`load_events`, `loads`, `loads_driver_view`, `maintenance_reminders`,
`profiles`, `service_logs`, `tiers`, `vehicles`, plus one **dynamic**
runtime table name (offline replay queue).

### Distinct RPCs (6)

| RPC | Call sites |
| --- | --- |
| `get_exceptions` | `src/app/(tabs)/alerts.tsx:37`, `src/lib/exceptions.ts:39` |
| `has_feature` | `src/app/load/[id].tsx:137`, `src/lib/entitlements.ts:14` |
| `get_my_entitlements` | `src/lib/entitlements.ts:19` |
| `get_customer_health_score` | `src/app/customers/[id].tsx:81` |
| `check_ifta_completeness` | `src/components/ifta-section.tsx:107` |
| `get_ifta_quarterly_summary` | `src/components/ifta-summary.tsx:62` |

---

## 1. Direct table WRITES — highest-priority REST API migration targets

All 26. These bypass any HTTP API entirely and rely on RLS alone for
authorization; every one is a candidate for a server-side endpoint where
business rules (status transitions, tier gating, audit trail, validation)
belong.

| # | File:line | Table | Op | Surface | What it does |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/app/driver-profile/index.tsx:124` | `drivers` | update | screen `/driver-profile` | Driver edits own profile fields |
| 2 | `src/app/dvir/[loadId].tsx:211` | `dvir_inspections` | insert | screen `/dvir/[loadId]` | Creates DVIR inspection record |
| 3 | `src/app/dvir/[loadId].tsx:246` | `dvir_inspections` | update | screen `/dvir/[loadId]` | Attaches uploaded `signature_url` |
| 4 | `src/app/dvir/[loadId].tsx:292` | `dvir_defects` | insert | screen `/dvir/[loadId]` | Bulk-inserts defect rows |
| 5 | `src/app/invoice/[id].tsx:101` | `invoices` | update | screen `/invoice/[id]` | Edits amount / due date / notes |
| 6 | `src/app/invoice/[id].tsx:135` | `invoices` | update | screen `/invoice/[id]` | Marks invoice `paid` + `paid_at` |
| 7 | `src/app/invoice/[id].tsx:140` | `loads` | update | screen `/invoice/[id]` | Cascades load status to `paid` |
| 8 | `src/app/load/[id].tsx:228` | `loads` | update | screen `/load/[id]` | **Load status advancement** (state machine lives client-side) |
| 9 | `src/app/load/[id].tsx:238` | `load_events` | insert | screen `/load/[id]` | Writes the audit event for #8 |
| 10 | `src/app/vehicle/[id].tsx:131` | `service_logs` | insert | screen `/vehicle/[id]` | Logs maintenance service |
| 11 | `src/app/vehicle/[id].tsx:156` | `maintenance_reminders` | update | screen `/vehicle/[id]` | Completes/updates a reminder |
| 12 | `src/components/driver-chat-section.tsx:56` | `driver_messages` | update | component `driver-chat-section` | Bulk mark-as-read (`read_at`) |
| 13 | `src/components/fuel-stops-section.tsx:103` | `fuel_stops` | insert | component `fuel-stops-section` | Driver logs a fuel purchase (IFTA input) |
| 14 | `src/components/ifta-section.tsx:148` | `ifta_state_crossings` | **delete** | component `ifta-section` | Deletes GPS-sourced crossings before re-insert |
| 15 | `src/components/ifta-section.tsx:149` | `ifta_state_crossings` | insert | component `ifta-section` | Re-inserts crossing rows (non-atomic with #14) |
| 16 | `src/components/pod-section.tsx:149` | `documents` | insert | component `pod-section` | POD document row after storage upload |
| 17 | `src/components/report-problem-section.tsx:47` | `exception_events` | insert | component `report-problem-section` | Driver reports an exception |
| 18 | `src/components/share-location-section.tsx:51` | `loads` | update | component `share-location-section` | Writes live location onto the load |
| 19 | `src/hooks/use-locale.tsx:177` | `profiles` | update | hook `use-locale` | `preferred_language` |
| 20 | `src/hooks/use-locale.tsx:187` | `profiles` | update | hook `use-locale` | `uom_system` |
| 21 | `src/hooks/use-locale.tsx:197` | `profiles` | update | hook `use-locale` | `date_format` |
| 22 | `src/hooks/use-locale.tsx:207` | `profiles` | update | hook `use-locale` | `time_format` |
| 23 | `src/hooks/use-register-push-token.ts:42` | `profiles` | update | hook `use-register-push-token` | `push_token` |
| 24 | `src/hooks/use-theme.tsx:114` | `profiles` | update | hook `use-theme` | `theme_preference` |
| 25 | `src/lib/ifta-tracking.ts:69` | `ifta_state_crossings` | insert | lib `ifta-tracking` | Background GPS state-crossing insert |
| 26 | `src/lib/offline-queue.ts:70` | **dynamic** | update | lib `offline-queue` | Generic replay of any queued update |

### Notes on the riskiest writes

- **#8/#9 (`loads` status + `load_events`)** — the status state machine
  (`NEXT_STATUS`) is client-side, and the two writes are separate,
  non-transactional statements: a failure between them leaves a status
  change with no audit event. A `PATCH /api/loads/:id` route already exists
  and is used elsewhere in the same file (line 179) — this path deliberately
  does not use it.
- **#26 (`offline-queue.ts:70`)** — `supabase.from(entry.table as any).update(...)`
  with a runtime table name and an arbitrary patch object read out of
  AsyncStorage. Today the only enqueue call site is
  `src/app/load/[id].tsx:213` with `table: 'loads'`, but the mechanism will
  replay *any* table/patch it finds in the queue. Migrating writes behind a
  REST API requires redesigning this queue to enqueue API calls, not table
  patches.
- **#14/#15 (`ifta_state_crossings` delete-then-insert)** — a non-atomic
  replace. An interruption between the two leaves the driver's GPS crossings
  deleted and not restored; IFTA is a tax-filing input.
- **#6/#7 (`invoices` → `loads` cascade)** — a two-table business
  transaction done as two client statements. The same screen already routes
  "send invoice" through `POST /api/invoices/:id/send`, so the seam exists.
- **#19–#24 (`profiles` preference updates)** — low business risk; pure user
  preferences. Lowest migration priority.

---

## 2. Operations that ALREADY go through `apiFetch` (14 call sites)

`src/lib/api.ts`'s `apiFetch` attaches the Supabase session as an
`Authorization: Bearer` header and calls carrieros-web's Next.js API routes
at `EXPO_PUBLIC_API_URL`. These are the existing HTTP seam.

| File:line | Method | Path |
| --- | --- | --- |
| `src/app/invoice/[id].tsx:120` | POST | `/api/invoices/${invoice.id}/send` |
| `src/app/load/[id].tsx:166` | GET | `/api/drivers` |
| `src/app/load/[id].tsx:167` | GET | `/api/vehicles` |
| `src/app/load/[id].tsx:179` | PATCH | `/api/loads/${load.id}` |
| `src/app/load/new-from-photo.tsx:134` | POST | `/api/extract-load-image` |
| `src/app/load/new-from-photo.tsx:159` | POST | `/api/loads` |
| `src/app/load/new.tsx:68` | POST | `/api/loads` |
| `src/app/onboarding/index.tsx:198` | POST | `/api/onboarding` |
| `src/app/onboarding/index.tsx:240` | POST | `/api/vehicles` |
| `src/app/onboarding/index.tsx:271` | POST | `/api/customers` |
| `src/app/onboarding/index.tsx:299` | POST | `/api/billing/add-payment-method` |
| `src/app/team/index.tsx:40` | GET | `/api/team` |
| `src/components/driver-chat-section.tsx:88` | POST | `/api/driver-messages` |
| `src/components/driver-chat-section.tsx:108` | POST | `/api/driver-messages/${messageId}/translate` |

Distinct API routes already consumed: `/api/loads` (POST), `/api/loads/:id`
(PATCH), `/api/drivers`, `/api/vehicles` (GET+POST), `/api/customers`,
`/api/team`, `/api/onboarding`, `/api/billing/add-payment-method`,
`/api/invoices/:id/send`, `/api/driver-messages`,
`/api/driver-messages/:id/translate`, `/api/extract-load-image`.

**Precedent worth noting:** load creation, load PATCH, driver-message send,
and invoice send are already API-mediated — so several of the direct writes
above have an existing route that could absorb them with little new
server-side work. `src/app/load/[id].tsx` is the clearest case: it uses
`PATCH /api/loads/:id` at line 179 and a raw table update at line 228.

---

## 3. Realtime usage

Exactly **one** subscription in the whole app, in
`src/components/driver-chat-section.tsx`:

| Line | Element |
| --- | --- |
| 67 | `.channel(\`driver-messages-load-${loadId}\`)` |
| 69 | `.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'driver_messages', filter: \`load_id=eq.${loadId}\` }, …)` |
| 76 | `.subscribe()` |
| 79 | `supabase.removeChannel(channel)` (cleanup) |

**Business meaning: none — pure UX refresh.** The handler only appends the
new row to local component state (with an id-dedupe guard). It performs no
write, no validation, no side effect. The code comment confirms it replaced
a 5-second poll. Every *authoritative* chat action is already API-mediated:
sending goes through `POST /api/driver-messages` (line 88) and translation
through `POST /api/driver-messages/:id/translate` (line 108); only the
mark-as-read update (write #12) still hits the table directly.

Implication for an API migration: this channel can be kept as-is
(server-push transport) or replaced with SSE/WebSocket from the REST API
without changing any business logic. It is not a blocker.

---

## 4. Storage usage (7, all bucket `documents`)

| File:line | Op | Purpose |
| --- | --- | --- |
| `src/app/(tabs)/fleet.tsx:57` | `createSignedUrl` | Vehicle photo thumbnails |
| `src/app/dvir-history/index.tsx:86` | `createSignedUrl` | DVIR signature images |
| `src/app/dvir/[loadId].tsx:239` | `upload` | DVIR signature upload |
| `src/app/dvir/[loadId].tsx:270` | `upload` | DVIR defect photo upload |
| `src/components/pod-section.tsx:67` | `createSignedUrl` | POD preview |
| `src/components/pod-section.tsx:140` | `upload` | POD upload |
| `src/components/pod-section.tsx:163` | `remove` | POD delete (**destructive**, client-driven) |

The three uploads and the `remove` are effectively unmediated writes to
object storage; `pod-section.tsx:163` deletes an object outright from the
client. `pod-section.tsx:124` also reads the raw session token, suggesting
this path is already partly aware of an HTTP seam.

## 5. Auth usage (10)

| File:line | Call |
| --- | --- |
| `src/app/login.tsx:33` | `signInWithPassword` |
| `src/app/signup.tsx:48` | `signUp` |
| `src/app/(tabs)/loads.tsx:169` | `signOut` |
| `src/app/onboarding/index.tsx:342` | `signOut` |
| `src/components/settings-content.tsx:257` | `signOut` |
| `src/components/onboarding-status-error.tsx:37` | `signOut` |
| `src/components/pod-section.tsx:124` | `getSession` |
| `src/hooks/use-session.ts:11` | `getSession` |
| `src/hooks/use-session.ts:16` | `onAuthStateChange` |
| `src/lib/api.ts:13` | `getSession` (supplies the Bearer token to `apiFetch`) |

Auth stays on the Supabase client by design — `apiFetch` depends on it for
the bearer token, so this layer is not a migration target.

---

## Suggested migration priority

1. **Load lifecycle** — writes #8, #9, #18 plus the offline queue (#26).
   Business-critical state machine + audit trail, and `PATCH /api/loads/:id`
   already exists.
2. **Financial** — writes #5, #6, #7 (`invoices`, `loads` cascade).
3. **IFTA / compliance** — #13, #14, #15, #25 (non-atomic delete+insert,
   tax-filing data).
4. **DVIR** — #2, #3, #4 plus the two storage uploads.
5. **Misc entity writes** — #1, #10, #11, #16, #17, #12.
6. **User preferences** — #19–#24. Lowest risk, migrate last.
