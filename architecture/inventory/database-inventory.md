# CarrierOS — Database Layer Inventory

Read-only audit, 2026-07-26. Sources: `supabase/schema/schema.sql` (2492 lines) and
live introspection of the running `supabase_db_carrieros` container. Live DB is
treated as authoritative for what is deployed; drift is called out in §7.

Machine-readable companion: `architecture/inventory/database-inventory.json`.

**Headline counts**

| | |
|---|---|
| Tables (`public`, relkind=`r`) | 40 |
| Views | 1 (`loads_driver_view`) |
| Tables with RLS **enabled** | 40 / 40 (100%) |
| Tables with RLS enabled but **zero policies** | 0 |
| Tables with `FORCE ROW LEVEL SECURITY` | 0 |
| RLS policies — `public` | 95 |
| RLS policies — `storage.objects` | 5 |
| Functions (`public`) | 18 |
| `SECURITY DEFINER` functions | 16 / 18 |
| Triggers | 2 |
| Triggers containing business logic | 0 |
| Postgres enum types | 0 (every vocabulary is `TEXT` + `CHECK`) |

---

## 1. Tables WITHOUT a direct tenant-ownership column

26 of 40 tables carry a direct tenant key (`carrier_org_id` on 17, `org_id` on 9).
The remaining 14 are listed below, classified by *why*. **None of them is an
unguarded isolation hole** — but the four "indirect" ones depend entirely on a
subquery in their policy text, so any future policy edit there is a tenant-leak
risk with no column-level backstop.

### 1a. Indirect ownership — tenant enforced only by a policy subquery (4)

| Table | Path to tenant | Policies enforcing it |
|---|---|---|
| `dvir_defects` | `inspection_id` → `dvir_inspections.carrier_org_id` | 4 policies, all join through `dvir_inspections` |
| `driver_message_translations` | `message_id` → `driver_messages.carrier_org_id` | 2 (SELECT, INSERT); no UPDATE/DELETE policy → immutable |
| `load_events` | `load_id` → `loads.carrier_org_id` | 2 (SELECT, INSERT); no UPDATE/DELETE policy → append-only |
| `settlement_deductions` | `settlement_id` → `driver_settlements.carrier_org_id` | 2, both join through `driver_settlements` |

Verified: every one of these policies re-derives the tenant from the parent via
`my_org_id()` or `profiles.org_id`. No `USING (true)` among them.

### 1b. Self-tenant (1)

- `organizations` — `id` *is* the tenant key. Guarded by 4 policies
  (`org_member_select`, `carrier_reads_own_customer_orgs`,
  `auth_user_create_carrier_org`, `owner_solo_org_update`).

### 1c. Global reference / platform config — not tenant-scoped by design (9)

`features`, `tiers`, `languages`, `roles`, `ifta_tax_rates`, `vehicle_types`,
`vehicle_classifications`, `vehicle_type_classifications`, `platform_flags`

All read via `USING (true)` to `authenticated` (`languages` and `tiers` also to
`anon`), except `platform_flags`, which is `sx_*`-role-gated. Intentional: these
are the shared taxonomy every tenant renders from.

### 1d. Platform-scoped tables that DO carry `org_id` but are guarded by role, not org

Worth knowing because their policies deliberately ignore the tenant column —
they are the SuperAdmin cross-tenant surfaces:

- `admin_events` — SELECT to `sx_owner`/`sx_finance`/`sx_support`. **No INSERT
  policy**: only `service_role` can write audit rows.
- `admin_notes` — ALL to `sx_owner`/`sx_finance`/`sx_support`.
- `billing_events` — SELECT to `sx_owner`/`sx_finance`. No write policy.
- `org_flag_overrides` — SELECT to `sx_*`, write to `sx_owner`.

---

## 2. Tables WITHOUT RLS enabled

**None.** All 40 base tables have `relrowsecurity = true` and at least one policy.

The single view, `loads_driver_view`, cannot have RLS of its own — but it is
created with **`security_invoker = on`**, so it evaluates `loads`' policies as the
calling user. This is the fix for the 2026-07-20 hole described in
`supabase/schema/README.md` (a view that let any driver read/write every carrier's
loads). Confirmed still in place live.

⚠️ One residual note: `authenticated` holds `INSERT`/`UPDATE`/`DELETE` grants on
`loads_driver_view` as well as `SELECT`. Writes through the view are still filtered
by `loads`' policies thanks to `security_invoker`, so this is not exploitable, but
the write grants serve no purpose and could be revoked.

---

## 3. SECURITY DEFINER functions — 16 of 18

`SECURITY DEFINER` runs with the definer's privileges, bypassing RLS on every
table it touches. Each one below must therefore re-derive the tenant itself.
All 16 set `search_path = public` (search-path hijack is closed).

### RLS helpers (called from policy text — definer is required here)

| Function | Returns | Tenant self-check | Notes |
|---|---|---|---|
| `my_org_id()` | `bigint` | n/a — is the source | `SELECT org_id FROM profiles WHERE id = auth.uid() AND is_active = true`. Returns NULL for deactivated users, which fails every policy closed. STABLE. **`proacl` is NULL → PUBLIC EXECUTE.** |
| `my_role()` | `text` | n/a | Same shape, returns `profiles.role`. STABLE. **PUBLIC EXECUTE.** |
| `driver_self_update_allowed(bigint, date, date, boolean, text)` | `boolean` | yes | Guards driver self-UPDATE: true only if org, CDL expiry, med-cert expiry, `is_active` and `driver_number` are all unchanged. STABLE. `authenticated` only. |

### Tenant-scoped business functions (all self-check against `my_org_id()`)

| Function | Tenant self-check | What it does |
|---|---|---|
| `get_exceptions()` | `carrier_org_id = my_org_id()` throughout | Live exceptions inbox: overdue invoices, expiring org/driver/vehicle docs, stale loads. |
| `get_customer_health_score(bigint)` | `AND carrier_org_id = my_org_id()` | 0–100 score from on-time-paid invoice ratio + exception count. |
| `get_ifta_quarterly_summary(bigint, text)` | `AND p_carrier_org_id = my_org_id()` | Per-state mileage for a quarter. |
| `get_ifta_tax_summary(bigint, text)` | `IF p_carrier_org_id != my_org_id() THEN RETURN;` | Per-state IFTA miles + net tax due. |
| `mark_overdue_invoices()` | `AND carrier_org_id = my_org_id()` | Flips `sent` → `overdue` for past-due invoices. Returns row count. |
| `check_ifta_completeness(bigint)` | **none** | Returns true if recorded crossings cover ≥60% of `loads.total_miles`. ⚠️ Takes an arbitrary `p_load_id` with no org check — leaks a boolean about any load in any tenant. Low severity (one bit, and only about mileage completeness) but it is a real cross-tenant read. |
| `has_feature(text)` | via `my_org_id()` | See §5. |
| `get_my_entitlements()` | via `my_org_id()` | Batched `has_feature()`. STABLE. |

### Write-path functions with explicit role guards

| Function | Guard | What it does |
|---|---|---|
| `create_customer_org(...)` | `my_org_id() IS NULL → RAISE 'NO_ORGANIZATION'`; role must be `owner`/`solo`/`dispatcher` else `RAISE 'FORBIDDEN'` | Creates a `type='customer'` org + `customer_details` row for the caller's carrier. ⚠️ **`proacl` is NULL → PUBLIC EXECUTE (anon can call it)**; the internal `NO_ORGANIZATION` raise is the only thing stopping an anonymous caller. |
| `bulk_import_customers(jsonb)` | Same two guards, plus array-type and 1–50 length validation | Bulk create/update of up to 50 customer orgs. ⚠️ Also **PUBLIC EXECUTE**, same reliance on the internal raise. |
| `send_expiry_reminders()` | none in-body | Batch job inserting `exception_events` rows of `event_type='reminder_sent'` for expiring CDLs, med certs, vehicle and org docs across **all** carriers. Correctly restricted at the grant layer: `EXECUTE` to `service_role` only. |

### Public (anon-executable) functions

| Function | Exposure |
|---|---|
| `get_public_tracking(text)` | `EXECUTE` granted to **`anon`**. Looks a load up by `tracking_token` and returns status, city/state pairs, last GPS fix, and the carrier's name/phone/email. Token is the entire authorization — treat `loads.tracking_token` as a bearer secret. |
| `get_public_tracking_events(text)` | `EXECUTE` granted to **`anon`**. Returns the `load_events` timeline for the same token. |

### The 2 SECURITY INVOKER functions

- `next_entity_val(bigint, text)` — per-org counter (upsert into `org_sequences`)
  used to mint load/invoice/customer numbers. `proacl` NULL → PUBLIC EXECUTE, and
  it takes an arbitrary `carrier_org_bigint`. As INVOKER it is saved by
  `org_sequences`' `ALL` policy `(org_id = my_org_id())`, so a cross-org call
  fails — but the tenant argument is caller-supplied and unchecked in the body.
- `update_updated_at()` — trigger function, `NEW.updated_at = now()`.

---

## 4. Triggers — 2, both bookkeeping

| Table | Trigger | Timing | Function | Business logic? |
|---|---|---|---|---|
| `loads` | `loads_updated_at` | BEFORE UPDATE, FOR EACH ROW | `update_updated_at()` | No — stamps `updated_at` |
| `org_documents` | `org_docs_updated_at` | BEFORE UPDATE, FOR EACH ROW | `update_updated_at()` | No — stamps `updated_at` |

**There is no business logic in any trigger.** Notably absent, all of which are
therefore the application's responsibility with no database backstop:

- No trigger writes `load_events` on a `loads.status` change — the status timeline
  is populated by app code only.
- No trigger writes `exception_events`; that is the batch function
  `send_expiry_reminders()`.
- No trigger enforces the `loads.status` lifecycle ordering — the CHECK constraint
  validates membership in the value set, not transitions. Any status can jump to
  any other.
- No `updated_at` trigger on the other 38 tables, several of which have an
  `updated_at`-style column.
- No trigger auto-provisions `profiles` from `auth.users`.

---

## 5. `has_feature()` — full semantics

```sql
CREATE OR REPLACE FUNCTION public.has_feature(feature_key text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (SELECT rank FROM tiers WHERE code = (
            SELECT tier FROM carrier_details WHERE org_id = my_org_id()
          ))
         >=
         (SELECT rank FROM tiers WHERE code = (
            SELECT min_tier FROM features WHERE key = feature_key
          ));
$function$
```

**Signature.** `public.has_feature(feature_key text) → boolean`. `SECURITY
DEFINER`, `search_path = public`, `EXECUTE` granted to `authenticated` only.
It is **VOLATILE** — it is not marked `STABLE`, unlike its sibling
`get_my_entitlements()`, so the planner cannot cache it within a statement.

**What it consults.** Exactly four things: `profiles` (indirectly, via
`my_org_id()`), `carrier_details.tier`, `tiers.rank`, and `features.min_tier`.
Tier ranks are `starter=1, growth=2, pro=3, enterprise=4`. The answer is a pure
rank comparison and nothing else.

**Trial, grace and suspension are NOT handled — at all.**
`carrier_details` carries `billing_status` (`trialing|active|past_due|canceled`,
default `trialing`), `trial_ends_at` (default `now() + 90 days`) and
`grace_period_until`. `has_feature()` reads **none** of them. Consequences:

- An org whose 90-day trial expired keeps every feature of whatever `tier` says.
- `billing_status = 'past_due'` or `'canceled'` revokes nothing.
- `grace_period_until` is written by the `/admin` SuperAdmin UI (it emits an
  `admin_events` row of type `admin.grace_period`) but has no reader in the
  entitlement path.
- The only way to actually revoke entitlements is to mutate
  `carrier_details.tier`. There is no independent kill switch.

**Feature flags are NOT handled.** `platform_flags` / `org_flag_overrides` are a
separate system, are both empty, and are not consulted here — so a per-org
override cannot currently affect any gate.

**Edge cases.**

| Situation | Returns | Effect |
|---|---|---|
| No active `profiles` row → `my_org_id()` IS NULL | **NULL** (not `false`) | Fails closed everywhere: `hasFeature()` coerces with `data === true`; an RLS `USING` clause treats NULL as deny. |
| Caller's org has no `carrier_details` row — i.e. any `type='customer'` org, and the `type='platform'` ShipmentX org | **NULL** | ShipmentX staff (`sx_owner`/`sx_finance`/`sx_support`) are entitled to *nothing* by `has_feature()`. `/admin` must not gate on it. |
| `feature_key` not present in `features` (typo) | **NULL** | Silent fail-closed. No referential validation of the argument. |
| `carrier_details.tier` IS NULL | **NULL** | Column is nullable with `DEFAULT 'starter'`; only reachable by an explicit NULL write. |
| Normal case | `true` / `false` | Rank comparison. |

**Callers — SQL: zero.** No RLS policy and no other database function calls
`has_feature()`. Despite the "RLS-usable gate" framing in `schema.sql` comments
and in `lib/entitlements.ts`, **every tier gate in the product is enforced in
application code only**. A client holding a valid JWT can read tier-gated rows
directly through PostgREST; only the tenant boundary is enforced in the database.

**Callers — TypeScript: 21 call sites** through the thin wrappers
`carrieros-web/lib/entitlements.ts` and `carrieros-mobile/src/lib/entitlements.ts`.

Web (16): `customers/[customer_number]/page.tsx` (`customer_health_score`,
`exception_history`), `loads/[load_number]/page.tsx` (`driver_chat`,
`ifta_mileage_log`), `settlements/page.tsx` (`driver_settlements`,
`settlement_ach`), `dispatch/page.tsx` (`desktop_command_center`),
`exceptions/page.tsx` (`full_exceptions_inbox`), `finance/page.tsx`
(`ifta_tax_hub`), `api/loads/[id]/route.ts` (`ifta_mileage_log`),
`api/settlements/run/route.ts` (`driver_settlements`),
`api/settlements/[id]/send-ach/route.ts` (`settlement_ach`),
`api/driver-messages/route.ts` and `.../[id]/translate/route.ts` (`driver_chat`),
`api/team/invite/route.ts` and `api/team/[id]/route.ts`
(`dispatcher_finance_roles`).

Mobile (5): `app/load/[id].tsx:137` (a **raw** `supabase.rpc('has_feature')` that
bypasses the wrapper — its result is destructured as `data: entitled` and used
truthily, so NULL still fails closed, but it is the one call site not going
through the shared helper), `app/customers/[id].tsx:74`,
`app/settlements/index.tsx:51`, `components/ifta-section.tsx:70`,
`components/ifta-summary.tsx:45`.

**4 of the 14 rows in `features` have no call site in either app** —
`load_expenses`, `quickbooks_export`, `fuel_analytics`,
`driver_performance_analytics`. They appear in tier/entitlement listings but are
not enforced anywhere.

---

## 6. Entitlement data model

Two systems, only one of which is live.

**System A — tier ladder (live and enforced in app code).**

- `tiers(code PK, label, rank, monthly_price, included_trucks,
  price_per_additional_truck)`. 4 rows: starter/1/$49/1 truck,
  growth/2/$99/3, pro/3/$199/6, enterprise/4/$349/12. `anon` has SELECT
  (pricing page).
- `features(key PK, label, min_tier FK→tiers.code, display_order)`. 14 rows —
  10 at `growth`, 4 at `pro`. **No feature requires `starter` or `enterprise`:
  Enterprise currently unlocks nothing beyond Pro.** Its single policy is
  `features_select FOR SELECT TO authenticated USING (true)` — the full feature
  catalogue is readable by every authenticated user of every tenant, by design.
- `carrier_details(org_id PK)` holds `tier` (default `starter`) plus the billing
  state `has_feature()` ignores: `billing_status`, `trial_ends_at`,
  `grace_period_until`, `stripe_customer_id`, `card_brand`, `card_last4`.
- `has_feature(key)` — single-key gate (§5). `get_my_entitlements()` — same rule
  applied to every `features` row; `STABLE`, `authenticated`, returns an empty
  set (not an error) when there is no org or no `carrier_details` row.

⚠️ `getEntitlements()` is exported by both apps and has **zero call sites**. The
batched primitive the design intends for data-driven menus is unused; every
surface does individual `has_feature()` round trips instead (e.g.
`settlements/page.tsx` makes two).

**System B — feature flags (schema only, dead).**

- `platform_flags(flag_key PK, description, default_enabled, created_at)` — **0 rows.**
- `org_flag_overrides(org_id, flag_key) PK, enabled, set_by, set_at` — **0 rows.**
- Both are `sx_*`-role-gated for read, `sx_owner` for write. Neither has a reader
  in SQL or TypeScript. Even if populated, `has_feature()` would ignore them.

`billing_events(org_id, event_type, status, …)` exists for billing history; both
`event_type` and `status` are free text with no CHECK, and the table is empty.

---

## 7. Grants and default privileges

**Schema `USAGE` on `public`** is granted to `anon`, `authenticated`,
`service_role` and `PUBLIC` — standard Supabase.

**Current table grants.**

- `authenticated` — full `SELECT, INSERT, UPDATE, DELETE` (+ `REFERENCES,
  TRIGGER, TRUNCATE`) on **all 40 tables and the view**, from `schema.sql`
  SECTION 8c's blanket `GRANT ... ON ALL TABLES`. RLS is what actually restricts
  reach; the grants are deliberately wide.
- `service_role` — same, plus it bypasses RLS.
- `anon` — `SELECT` on exactly **two** tables: `languages` and `tiers`. Everything
  else is read-denied at the grant layer as well as by RLS.

**⚠️ `anon` holds `TRUNCATE` (plus `REFERENCES`, `TRIGGER`) on every one of the 40
public tables.** This comes from Supabase's `ALTER DEFAULT PRIVILEGES` and was
never revoked. `TRUNCATE` **bypasses RLS entirely**. It is not reachable through
PostgREST (there is no TRUNCATE verb) so it is not exploitable as deployed, but
it is a latent privilege on an internet-facing role and should be revoked.

**Are public-schema objects auto-exposed? No — and this is a trap.**
Default privileges for objects owned by `postgres` in `public` grant
`anon`/`authenticated`/`service_role` only `Dxtm` (TRUNCATE, REFERENCES, TRIGGER,
MAINTAIN) — **not SELECT/INSERT/UPDATE/DELETE**. A newly created table is
therefore *not* readable by `authenticated` until SECTION 8c's blanket GRANT is
re-run; queries return zero rows with **no error**, indistinguishable from an
empty table. This exact failure already shipped once (2026-07-21, the
`vehicle_types`/`tiers`/`features` batch) and is documented in
`supabase/schema/README.md`.

**Function `EXECUTE`.** Six functions have a NULL `proacl`, which means the
Postgres default of **`PUBLIC EXECUTE`** — including `anon`:
`my_org_id`, `my_role`, `next_entity_val`, `update_updated_at`,
**`create_customer_org`**, **`bulk_import_customers`**. The last two are
`SECURITY DEFINER` write paths; they are protected only by their in-body
`NO_ORGANIZATION` / `FORBIDDEN` raises, not by a grant. Explicitly granted:
`anon` → `get_public_tracking`, `get_public_tracking_events`; `service_role` only
→ `send_expiry_reminders`; `authenticated` → the remaining nine.

---

## 8. Status / vocabulary columns

**There are zero Postgres enum types.** Every vocabulary is `TEXT` + `CHECK`, so
Supabase's generated types are plain `string` with no compile-time exhaustiveness
— the manual grep step in `supabase/schema/README.md` (step 3) is the only guard.

### Core domain lifecycles

| Table.column | Default | Allowed values |
|---|---|---|
| **`loads.status`** | `draft` | `draft`, `scheduled`, `dispatched`, `picked_up`, `in_transit`, `delivered`, `invoiced`, `paid`, `cancelled`, `declined` (10) |
| **`invoices.status`** | `draft` | `draft`, `sent`, `paid`, `overdue` (4) |
| **`vehicles.status`** | `active` | `active`, `idle`, `in_shop` (3) — separate from `vehicles.is_active` |
| **`drivers.invite_status`** | `pending` | `pending`, `accepted`, `revoked` |
| **`drivers.is_active`** | `true` | boolean — the deactivate-not-delete flag |
| **customers / relationships** | — | **No status column exists.** `customer_details` is `(org_id, carrier_org_id, customer_number, contact_name, tags[], notes)`; `organizations` has no `is_active`; `customer_contacts` has no `is_active`. There is currently **no way to deactivate a customer or a customer contact** — the only vocabulary on the customer side is `organizations.type` ∈ `carrier`, `customer`, `platform`. |

Note `loads.status` uses British `cancelled` while nothing else in the schema
uses either spelling — worth pinning before more branch sites accumulate.

### Billing / entitlement

- `carrier_details.billing_status` (default `trialing`): `trialing`, `active`, `past_due`, `canceled` — **US spelling here, vs `cancelled` on loads.**
- `carrier_details.tier` (default `starter`): `starter`, `growth`, `pro`, `enterprise`
- `carrier_details.default_payment_method` (default `other`) / `invoices.payment_method`: `stripe`, `factoring`, `other`
- `carrier_details.default_net_terms_days` (default 30): `7`, `15`, `30`, `45`, `60`
- `driver_settlements.payment_status` (default `pending`): `pending`, `sent`, `cleared`
- `driver_settlements.pay_method` / `drivers.settlement_type`: `percent_of_rate`, `per_mile`, `flat_per_load`

### Identity, roles and preferences

- `profiles.role`: `owner`, `solo`, `driver`, `dispatcher`, `finance`, `customer_admin`, `customer_viewer`, `sx_owner`, `sx_finance`, `sx_support` (10)
- `profiles.is_active` (default `true`) — deactivation makes `my_org_id()` and `my_role()` return NULL, which fails **every** RLS policy closed. This is the real off-switch for a user.
- `roles.scope`: `carrier`, `customer`, `platform`
- `organizations.type`: `carrier`, `customer`, `platform`; `.country`: `US`, `CA`, `MX`; `.currency`: `USD`, `CAD`, `MXN`
- `profiles.preferred_language` / `carrier_details.default_language`: `en`, `es`, `pa`, `ur`
- `profiles.uom_system` / `carrier_details.uom_system`: `imperial`, `metric`
- `profiles.date_format`: `MM/DD/YYYY`, `DD/MM/YYYY`, `YYYY-MM-DD`; `.time_format`: `12h`, `24h`; `.theme_preference`: `light`, `dark`, `system`
- `drivers.cdl_class`: `A`, `B`, `C`

### Operations, compliance, documents

- `loads.intake_method`: `email`, `pdf`, `paste`, `manual`
- `dvir_inspections.type`: `pre_trip`, `post_trip`; `.condition`: `satisfactory`, `defects_noted`
- `dvir_defects.severity`: `minor`, `major`
- `exception_events.entity_type`: `driver`, `vehicle`, `customer`, `invoice`, `load`; `.severity`: `info`, `warning`, `urgent`
- `ifta_state_crossings.source`: `gps`, `manual`
- `documents.type`: `pod`, `rate_con`, `bol`, `other`
- `driver_documents.doc_type`: `cdl_scan`, `medical_cert`, `other`
- `vehicle_documents.doc_type`: `registration`, `insurance_cert`, `dot_authority`, `annual_inspection`, `other` (constraint still named `truck_documents_doc_type_check` — pre-rename leftover)
- `org_documents.doc_type`: `coi`, `general_liability`, `workers_comp`, `mc_authority`, `dot_certificate`, `ucr`, `w9`, `business_license`
- `vehicles.cab_type`: `sleeper`, `day_cab`, `other`

### ⚠️ Vocabulary columns with NO CHECK constraint (free text)

These have a de-facto vocabulary enforced only by app code:

| Column | Values observed live |
|---|---|
| `load_events.event_type` | `status_scheduled`, `status_dispatched`, `status_in_transit`, `status_delivered`, `status_invoiced` |
| `admin_events.event_type` | `admin.change_tier`, `admin.grace_period`, `admin.impersonate`, `admin.note_add` |
| `service_logs.service_type` | `Oil Change` (free-form title case — no normalisation) |
| `maintenance_reminders.reminder_type` | `Oil Change` |
| `exception_events.event_type` | (table empty; `send_expiry_reminders()` writes `reminder_sent`) |
| `load_expenses.expense_type` | (empty) |
| `settlement_deductions.deduction_type` | (empty) |
| `billing_events.event_type`, `billing_events.status` | (empty) |

`load_events.event_type` is the notable one: it mirrors `loads.status` with a
`status_` prefix but has no constraint tying the two together, and no trigger
writes it — the timeline can silently diverge from the load's actual status.

---

## 9. Drift: `schema.sql` vs live DB

Method: object-name diff between `supabase/schema/schema.sql` and live
introspection. A full replay against a scratch database was **not** performed
(this was a read-only audit; the replay recipe in `supabase/schema/README.md`
creates and drops a database).

| Object class | Verdict |
|---|---|
| Tables | **Match** — 40 in both, plus the 1 view |
| Functions | **Match** — 18 in both |
| Triggers | **Match** — 2 in both |
| `storage.objects` policies | **Match** — 5 in both |
| `public` policies | **1 policy of drift** (see below) |

**The one divergence:**

- `profiles.users_read_own_profile` — `FOR SELECT TO authenticated USING
  (auth.uid() = id)`. **Present in the live DB, absent from `schema.sql`.**
  It is a strict subset of the existing `same_org_profiles_select`
  (`org_id = my_org_id() OR org_id IN (...)`), which already covers the caller's
  own row, so a fresh replay dropping it would not change effective access.
  It looks like a leftover from an early bootstrap policy written before
  `my_org_id()` existed. Still: it is an undocumented divergence, and the next
  `supabase db reset` + replay will silently remove it.

**Stale documentation found alongside the drift:**

- `supabase/schema/README.md` line 82 states "As of 2026-07-21 (post-Phase
  7B-7F) a clean replay yields 0 errors, 35 tables, 80 policies." Live is now
  **40 tables and 100 policies** (95 public + 5 storage). Those counts should be
  refreshed.
- `docs/carrieros-db/schema.sql` (the Zoho copy) was not compared — `docs/` is a
  gitignored symlink outside this audit's reach. `supabase/schema/schema.sql`
  remains authoritative per its own README.

---

## Summary of issues worth acting on

1. **`has_feature()` ignores billing state entirely** — expired trials, `past_due`
   and `canceled` orgs keep every feature. `grace_period_until` is written by
   `/admin` and never read. Only mutating `carrier_details.tier` revokes anything.
2. **Zero SQL callers of `has_feature()`** — every tier gate is app-code only, so
   a direct PostgREST client reaches tier-gated rows.
3. **`anon` has `TRUNCATE` on all 40 public tables** — bypasses RLS; not currently
   reachable via PostgREST, but should be revoked.
4. **`create_customer_org` and `bulk_import_customers` are `SECURITY DEFINER` with
   `PUBLIC EXECUTE`** — guarded only by an in-body raise, not by a grant.
5. **`check_ifta_completeness(p_load_id)` has no tenant check** — returns a boolean
   about any load in any tenant.
6. **No way to deactivate a customer or a customer contact** — no `is_active` on
   `organizations`, `customer_details` or `customer_contacts`, contradicting the
   deactivate-never-delete rule that `drivers`, `vehicles` and `profiles` follow.
7. **`profiles.users_read_own_profile` exists live but not in `schema.sql`** — will
   vanish on the next replay.
8. **`cancelled` (loads) vs `canceled` (billing_status)** spelling split.
9. **`platform_flags` / `org_flag_overrides` are dead** — empty, no readers, and
   ignored by the entitlement path they appear to belong to.
10. **`getEntitlements()` has zero call sites** despite being the intended batched
    primitive; 4 of 14 `features` rows are never enforced.
