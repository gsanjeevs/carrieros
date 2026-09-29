# 06 — The mobile app (`carrieros-mobile`)

## 1. Purpose

`carrieros-mobile` is the Expo/React Native app used by three kinds of
people, often in the same fleet: **drivers** running loads from a phone
mounted on a dash, **dispatchers** running the ops board, and **SMB
owner-operators/finance staff** ("owner", "solo", "finance" roles) who use
it as a lightweight companion to the web app. It is not a scaled-down web
app — the driver-facing screens in particular assume the user is standing
in a warehouse or truck stop, not at a desk.

That audience shapes the design in two concrete ways worth internalizing
before reading any screen code:

- **Non-technical users under time pressure.** Screens favor large tap
  targets, minimal typing, and camera/photo capture over forms (DVIR
  inspections, proof-of-delivery). Error messages are translated, not
  developer-facing.
- **Unreliable rural cellular connectivity is a normal operating
  condition, not an edge case.** A driver in a warehouse with no signal
  still has to be able to mark a load delivered, file a DVIR, or attach a
  POD photo. The app has to hold that in a store safely to be able to file it later.

Multi-language support (English, Spanish, Punjabi, Urdu) reflects the
actual driver workforce this app targets; Urdu is a right-to-left script,
which the app handles as a first-class case (§3).

## 2. File structure

```
carrieros-mobile/src/
├── app/                        # Expo Router — file-based routing
│   ├── (tabs)/                 # Fixed superset of tab screens; actual
│   │   │                       #   visible tabs per role come from
│   │   │                       #   constants/tab-sets.ts, not this folder
│   │   ├── _layout.tsx         #   renders <AppTabs /> (native tab bar)
│   │   ├── home.tsx            #   role-branching dashboard (owner/solo/
│   │   │                       #   dispatcher/finance) — see §3
│   │   ├── my-load.tsx         #   driver's home-equivalent screen
│   │   ├── dvir-start.tsx      #   driver: start a pre/post-trip inspection
│   │   ├── loads.tsx, fleet.tsx, alerts.tsx, customers.tsx,
│   │   │   invoices.tsx, reports.tsx, history.tsx, profile.tsx, more.tsx
│   │   └── index.tsx           #   legacy; content moved to loads.tsx
│   ├── load/[id].tsx           # Load detail + status advance (pushed, not a tab)
│   ├── load/new.tsx, load/new-from-photo.tsx
│   ├── dvir/[loadId].tsx       # DVIR inspection form
│   ├── dvir-history/index.tsx
│   ├── customers/, invoice/[id].tsx, vehicle/[id].tsx
│   ├── billing/, settlements/, ifta-report/, maintenance/, team/,
│   │   company-documents/, driver-profile/, messages/
│   ├── onboarding/index.tsx    # post-signup org setup wizard
│   ├── welcome.tsx, login.tsx, signup.tsx   # public/unauthenticated routes
│   └── _layout.tsx             # root layout: auth gate, locale/theme
│                                #   providers, offline banner, push token reg
├── components/                 # Shared UI: themed-text/view, app-tabs
│                                #   (native + .web variants), offline-banner,
│                                #   signature-pad, photo-source-sheet,
│                                #   swipeable-row, per-feature sections
│                                #   (pod-section, fuel-stops-section, etc.)
├── hooks/                      # use-session, use-locale, use-profile-role,
│                                #   use-offline-sync, use-onboarding-status,
│                                #   use-theme, use-photo-picker,
│                                #   use-register-push-token
├── lib/                        # api-client.ts, api.ts, offline-queue.ts,
│                                #   session-recovery.ts, i18n.ts,
│                                #   local-photo-store.ts, pod-upload.ts,
│                                #   dvir-attachments.ts, idempotency.ts,
│                                #   supabase.ts, observability.ts,
│                                #   format-*.ts, entitlements.ts
│   └── generated/               #   api-client.ts, api-types.ts,
│                                #   role-capabilities.ts, live-refresh.ts
│                                #   (generated from carrieros-web — see §3)
├── constants/                  # tab-sets.ts (per-role tab config), theme.ts
├── types/                      # database.ts, assets.d.ts
└── messages/                   # en.json, es.json, pa.json, ur.json (i18n-js)
```

Tests live in `carrieros-mobile/tests/` (Jest, `jest-expo` preset), parallel
to `src/lib/` rather than co-located — see §5.

## 3. Key files

### 3.1 Role-based routing: `(tabs)/home.tsx` and `constants/tab-sets.ts`

The "5 distinct role-based home screens" note refers to the fact that the
app's 5 roles (`owner`, `solo`, `driver`, `dispatcher`, `finance` —
`src/hooks/use-profile-role.ts:13`) each land somewhere different. Four of
them share one route, `(tabs)/home.tsx`, which branches internally on role;
`driver` gets an entirely separate screen, `(tabs)/my-load.tsx`, reachable
via its own tab. From the header comment:

```1:10:carrieros-mobile/src/app/(tabs)/home.tsx
// src/app/(tabs)/home.tsx
// "Home" tab for Owner/Solo/Dispatcher/Finance — 4 different content sets
// behind one route, branching on profiles.role (see
// src/hooks/use-profile-role.ts). This is NOT the old (tabs)/index.tsx
// (that content moved to loads.tsx unchanged) — this is a real dashboard
// per role, per the mobile-parity design pass. All content comes from one
// GET /api/v1/dashboard call (server/application/dashboard-query-service.ts
// assembles the same per-role reads this screen used to make as 3-5
// separate round trips) instead of querying loads/vehicles/drivers/invoices
// directly.
```

The role branch itself (`carrieros-mobile/src/app/(tabs)/home.tsx:200-307`)
renders a different card/section set per role from one `data` payload —
e.g. `role === 'solo' && soloActiveLoad` shows "my load today",
`role === 'dispatcher'` shows an ops board with a stale-load flag
(4h+ since `updated_at`, `home.tsx:26-31`), `role === 'finance'` shows
outstanding invoices.

Which tabs are visible per role is a **separate** concern from which
content renders, controlled by `constants/tab-sets.ts`:

```56:79:carrieros-mobile/src/constants/tab-sets.ts
export const TAB_SETS: Record<Role, TabSetEntry[]> = {
  // HOME is NOT gated on the `dashboard` capability even though every role
  // (including driver) has `dashboard` — driver's home-equivalent screen is
  // MY_LOAD, not HOME, so a capability-driven check would incorrectly add a
  // Home tab for drivers. Left as an explicit per-role literal.
  owner: [HOME, ...dispatchTabs('owner'), ...fleetTabs('owner'), MORE],
  solo: [HOME, ...dispatchTabs('solo'), ...fleetTabs('solo'), MORE],
  dispatcher: [HOME, ...dispatchTabs('dispatcher'), ...fleetTabs('dispatcher'), CUSTOMERS],
  finance: [HOME, INVOICES, CUSTOMERS, REPORTS, MORE],
  driver: [MY_LOAD, DVIR, HISTORY, PROFILE],
};
```

Some tabs derive from the generated `role_capabilities` table
(`roleHasCapability`, imported from `lib/generated/role-capabilities.ts`);
others (CUSTOMERS, MORE, INVOICES, etc.) are deliberately hardcoded because
their visibility doesn't map 1:1 onto a single capability — read the
comments at `tab-sets.ts:20-76` before "cleaning up" this file.

### 3.2 API client layer: `lib/api-client.ts`

All app data goes through one generated, typed client — not direct
Supabase table reads:

```1:20:carrieros-mobile/src/lib/api-client.ts
// src/lib/api-client.ts
// Mobile's typed client for carrieros-web's /api/v1 (generated runtime, see
// carrieros-web/scripts/gen-api-client.ts). All app data goes through this, not
// through supabase.from()/rpc()/storage: the API is the single data path shared
// with the web app (ADR 0003). supabase.auth stays here in supabase.ts only for
// sign-in and session refresh.
import { fetch as streamFetch } from 'expo/fetch';

import { createApiClient } from '@/lib/generated/api-client';
import { handleUnauthorized } from '@/lib/session-recovery';
import { supabase } from '@/lib/supabase';

export const apiClient = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL!,
  // React Native's global fetch cannot stream; expo/fetch can (used for the
  // live-update SSE stream).
  streamFetch: streamFetch as unknown as typeof fetch,
  getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token,
  onUnauthorized: () => void handleUnauthorized(),
});
```

Auth token handling: `supabase.auth` (see `lib/supabase.ts`) owns
sign-in/session refresh only. Every API call attaches the current Supabase
access token as a bearer token (`getAccessToken`); a 401 triggers
`handleUnauthorized()` (`lib/session-recovery.ts`), which tries one silent
refresh and, if the session is truly gone (revoked elsewhere, admin
action), signs out **locally only** so the auth gate in `app/_layout.tsx`
routes the user back to `/login` — without touching their other devices'
sessions.

There is a second, older calling convention still present,
`lib/api.ts` (`apiFetch`), used for a handful of Next.js API routes that
predate the generated client. Its header comment explains the seam: it's
for "endpoints that are real business logic... not a plain table read/write
RLS already covers." New code should go through `apiClient`, not `apiFetch`.

### 3.3 Offline queue: `lib/offline-queue.ts`

This is the actual current state of offline handling — read the whole
module header before assuming more exists than does:

```1:31:carrieros-mobile/src/lib/offline-queue.ts
// src/lib/offline-queue.ts
// Offline mode for the actions a driver must be able to take without signal (a
// load marked delivered in a warehouse with no bars must not be lost). Actions
// are queued in AsyncStorage as typed COMMANDS and replayed through the shared
// API once connectivity returns -- the same endpoint online use goes through, so
// an offline action gets the same rules (who may do it, legal transition,
// atomic write) as an online one.
//
// Three command kinds today: load status advances, DVIR (pre/post-trip
// inspection, FMCSA 49 CFR 396.11), and proof-of-delivery photo uploads -- the
// three actions a driver on rural cellular cannot be allowed to lose.
//
// Each command carries the idempotency key minted when the driver tapped, so a
// flush that is interrupted and retried can never apply an action twice.
```

Mechanics:
- Commands are typed JSON (`QueuedCommand`, `lib/offline-queue.ts:82-85`)
  stored under an `AsyncStorage` key (`carrieros:offline-queue:v2`); a v1→v2
  migration path exists for anyone with a queue from before commands were
  typed (`migrateLegacy`, `offline-queue.ts:98-120`).
- Photo bytes (DVIR/POD) are **never** put in AsyncStorage — they're written
  to local file storage at queue time (`lib/local-photo-store.ts`) and the
  command only carries the file URI; the actual signed-URL upload happens at
  replay time, since signed URLs are short-lived.
- `flushQueue()` (`offline-queue.ts:282-299`) replays commands **in order**
  and stops at the first one that needs a retry, so a later command for the
  same load can't be misapplied out of sequence or rejected as a false
  conflict.
- Server response mapping (`offline-queue.ts:23-31`): `200` → synced and
  removed; `400/403/404/409` → server explicitly refused it (e.g. someone
  else already moved the load) → removed and counted `rejected`, retrying
  would never help; network error/`5xx`/`401` → left queued for the next
  flush.

`hooks/use-offline-sync.ts` watches connectivity via `expo-network`
(chosen specifically because it works in Expo Go, unlike
`@react-native-community/netinfo`) and calls `flushQueue()` the moment the
app comes back online. `components/offline-banner.tsx`, mounted once in
`app/_layout.tsx`, surfaces `isOnline`/`queueLength` from that same hook as
a persistent top-of-screen strip — "Offline", "Offline — N changes
queued", or "Syncing N changes".

### 3.4 i18n / RTL: `lib/i18n.ts` and `hooks/use-locale.tsx`

Confirmed: 4 locales, and Urdu is RTL, handled as a real case, not just a
translated string table:

```14:21:carrieros-mobile/src/lib/i18n.ts
export const SUPPORTED_LOCALES = ['en', 'es', 'pa', 'ur'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const RTL_LOCALES: readonly Locale[] = ['ur'];

export function isRTLLocale(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}
```

`hooks/use-locale.tsx` resolves the locale from `profiles.preferred_language`
(shared column with the web app) and, on change, calls `I18nManager.allowRTL`
/`forceRTL` — which, per the comment at `use-locale.tsx:73-90`, only takes
visual effect after a full app restart on native (a documented React Native
limitation); a web-preview-only `document.dir` flip is added for local
verification without a restart. Punjabi and Urdu also load dedicated fonts
(Noto Sans Gurmukhi / Noto Nastaliq Urdu) on demand via mount-only loader
components (`GurmukhiFontLoader`, `NastaliqFontLoader`,
`use-locale.tsx:104-119`), since English/Spanish use the system font.

There's a subtle React Compiler gotcha documented at
`use-locale.tsx:206-222` about why `t()` must be wrapped in a
`useCallback` keyed on `locale` — worth reading if a screen's text appears
"stuck" on the locale active at first mount.

### 3.5 Driver load-status update: `app/load/[id].tsx`

This is the file to open for the end-to-end trace in §4 — it's where the
API call, the idempotency key, and the offline-queue fallback all meet in
one function, `advanceStatus()` (`load/[id].tsx:204-267`).

## 4. Tracing a user action end-to-end: driver marks a load delivered

**Screen:** `carrieros-mobile/src/app/load/[id].tsx`, a pushed (non-tab)
screen reached from a `LoadCard` press on `home.tsx` or `my-load.tsx`.
The driver taps a status-advance button, which calls `advanceStatus()`.

**1. Mint an idempotency key up front** (`load/[id].tsx:212-215`):

```ts
const idempotencyKey = newIdempotencyKey();
const occurredAt = new Date().toISOString();
```

One driver tap = one key. This same key is reused if the action ends up in
the offline queue, so a flush retry can never double-apply the status
change (`lib/idempotency.ts`).

**2. Known-offline path** (`load/[id].tsx:231-234`): if
`useOfflineSync().isOnline` is already `false`, the screen skips the
network call entirely, calls `enqueueMilestone()`
(`lib/offline-queue.ts:148-152`) to persist a `load.milestone` command to
AsyncStorage, and optimistically updates the local `load.status` so the
driver sees the change reflected immediately.

**3. Online path — the real API call** (`load/[id].tsx:240-249`):

```ts
({ response } = await apiClient.http.POST('/api/v1/loads/{id}/milestones', {
  params: { path: { id: load.id }, header: { 'Idempotency-Key': idempotencyKey } },
  body: { expected_status: load.status, new_status: step.next, occurred_at: occurredAt },
}));
```

This hits `carrieros-web`'s `POST /api/v1/loads/[id]/milestones` route
(`carrieros-web/app/api/v1/loads/[id]/milestones/route.ts`) — the same
endpoint an online web-app user's action would hit. Per the comment at
`load/[id].tsx:236-239`, the status change, timeline entry, audit record,
and outbox write happen as one atomic server-side call; the server (not
the mobile client) enforces who is allowed to make this transition and
whether it's legal from the load's current state.

**4. Failure handling, three distinct cases:**
- **Network exception** (couldn't reach the server despite the device
  reporting itself online — DNS blip, aborted request):
  `load/[id].tsx:246-249` catches it and falls through to the same
  `queueForLater()` path as the known-offline case.
- **`409 Conflict`** (`load/[id].tsx:251-257`): someone else — a
  dispatcher, another device — already moved this load. The client shows
  `loadDetail.statusConflict` and re-fetches the load rather than queuing;
  retrying a stale transition would never succeed.
- **Other non-OK response** (`load/[id].tsx:258-262`): generic
  `loadDetail.statusUpdateError`, no queuing — this is a definitive server
  refusal (e.g. validation failure), not a connectivity problem.

**5. Reconnect / replay:** once `expo-network`'s `useNetworkState` reports
connectivity again, `hooks/use-offline-sync.ts` calls
`flushQueue()` (`lib/offline-queue.ts:282-299`), which POSTs the same
`/api/v1/loads/{id}/milestones` endpoint with the same idempotency key. A
`200` removes the command and increments a `synced` counter surfaced by
`offline-banner.tsx`; a `400/403/404/409` removes it as `rejected` (the
server's answer didn't change just because time passed); anything else
(network error again, `5xx`, `401`) leaves it queued for the next flush.

For the API-route side of this same call (how carrieros-web resolves auth,
tenant scoping, and dispatches to the domain layer), see
[03-api-and-public-api.md](./03-api-and-public-api.md).

## 5. Conventions and gotchas

- **Offline resilience is real but narrow — be honest about its scope in
  QA.** Only three action kinds are queue-protected today: load status
  advances, DVIR submissions, and POD photo uploads
  (`lib/offline-queue.ts:9-11`). Everything else in the app (dashboard
  reads, invoices, customer edits, messaging, etc.) has no offline queue —
  a failed request there just surfaces an error, full stop. If you're
  testing "does the app work offline," scope the question to those three
  flows; don't assume parity elsewhere.
- **The queue is best-effort for attachments, strict for the record they
  attach to.** A DVIR inspection or POD upload's *defining* call (filing
  the inspection / finalizing the document) is what determines
  synced/rejected; a failed photo upload within an otherwise-synced command
  is logged and left as an orphaned local file rather than retried or
  silently deleted (`offline-queue.ts:187-223`) — there's no automatic
  cleanup or re-upload sweep for those yet (noted directly in the source
  comment as a known gap).
- **`eas.json` staging/production env values are still placeholders.**
  Confirmed current as of this walkthrough:
  ```json
  "staging": {
    "env": {
      "EXPO_PUBLIC_SUPABASE_URL": "REPLACE_WITH_STAGING_SUPABASE_URL",
      "EXPO_PUBLIC_API_URL": "REPLACE_WITH_STAGING_WEB_URL"
    }
  }
  ```
  (same pattern for `production`, `carrieros-mobile/eas.json:12-27`.) A
  staging or production EAS build today would ship pointed at nothing —
  don't run one without filling these in first.
- **Local dev points at localhost, not staging.** `.env` (gitignored,
  present in this checkout) has
  `EXPO_PUBLIC_API_URL=http://localhost:3001` and a local Supabase URL
  (`127.0.0.1:54321`) — the mobile app is not currently wired to talk to
  any deployed environment. `.env.example` documents that `EXPO_PUBLIC_*`
  values are compiled into the app bundle and visible to anyone with the
  app — only the anon key and public URLs belong there, never a
  service-role key.
- **Data access is API-only, by rule, not just convention (ADR 0003).**
  `lib/api-client.ts`'s header comment is explicit: all app data goes
  through the generated client, not `supabase.from()/rpc()/storage`.
  `supabase.auth` is the one sanctioned exception, used only for sign-in
  and session refresh. See `architecture/inventory/mobile-supabase-usage.md`
  for the tracked inventory of any remaining direct-access call sites.
- **Two API-calling conventions coexist**: the generated `apiClient`
  (`lib/api-client.ts`, preferred) and an older manual `apiFetch`
  (`lib/api.ts`) for a handful of pre-existing Next.js route calls. Don't
  add new calls through `apiFetch`.
- **Tests live under `tests/`, not co-located with source.** Jest with the
  `jest-expo` preset; `npm test` / `npm run test:watch`
  (`carrieros-mobile/package.json`). Current coverage
  (`carrieros-mobile/tests/`) is concentrated on `lib/` logic —
  `offline-queue.test.ts`, `idempotency.test.ts`, `session-recovery.test.ts`,
  `i18n.test.ts`, `dvir-attachments.test.ts`, `password-policy.test.ts`,
  `profile-api.test.ts`, `secure-session-storage.test.ts`,
  `observability.test.ts`, `theme-status-pills.test.ts`,
  `use-photo-picker.test.ts` — i.e., the offline queue and auth-recovery
  logic in §3.3/§4 already have direct test coverage; screen-level
  (`app/`) behavior currently does not.
- **`AGENTS.md`/`CLAUDE.md` in this repo are a one-line pointer**, not
  general conventions: they exist only to flag that Expo's docs have
  changed recently and to tell an AI assistant to check versioned docs
  (`https://docs.expo.dev/versions/v57.0.0/`) before writing Expo-specific
  code — worth knowing if you see AI-authored mobile changes referencing
  an unfamiliar Expo API.
- **RTL is real, but native RTL layout only applies after an app
  restart** (`hooks/use-locale.tsx:73-90`) — if you're QA-testing Urdu and
  the layout doesn't flip immediately after switching locale in-app, that's
  expected; restart the app (or reload in the web preview, which flips
  immediately via a `document.dir` override for local testing only).

## 6. See also

- [03-api-and-public-api.md](./03-api-and-public-api.md) — the
  `carrieros-web` side of every call this app makes: how `/api/v1` routes
  resolve auth and tenant scoping and dispatch into the domain layer.
- [ADR 0003 — API-only data access](../adr/0003-api-only-data-access.md) —
  the rule behind `lib/api-client.ts` §3.2.
- `architecture/inventory/mobile-supabase-usage.md` — tracked inventory of
  any remaining direct Supabase access from mobile.
- [04-auth-and-authorization.md](./04-auth-and-authorization.md) — how the
  bearer token this app attaches to every API call is validated server-side.
