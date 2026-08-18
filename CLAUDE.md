# CarrierOS monorepo — working notes

Product docs (PRD, tech-spec, BRD, decisions.md) live in `docs/` (a symlink
to an external Zoho WorkDrive folder, gitignored — not visible outside this
machine). `docs/resume.md` there is a running knowledge log across sessions;
check it for anything not covered here.

## Layout
- `carrieros-web/` — Next.js 16 (App Router). Read `carrieros-web/AGENTS.md`
  first — this Next.js version has breaking API changes from training data.
- `carrieros-mobile/` — Expo/React Native (SDK 57). Read
  `carrieros-mobile/AGENTS.md` first, same reason.
- `supabase/` — local Supabase project (Postgres + Auth), shared by both
  apps. Schema changes go through **`supabase/migrations/*.sql`**, the
  authority for schema evolution since 2026-07-26 (read
  `architecture/database-migrations.md` before touching schema — it replaced
  the old ad hoc `docker exec psql` + hand-copy-into-schema.sql workflow,
  which had real, already-occurred drift/upgrade-path failure modes).
  `node scripts/db/migrate.mjs` applies pending migrations (`--status` /
  `--dry-run` to inspect first); migrations are numbered, checksummed, and
  immutable once applied — fix mistakes forward with a new migration, never
  edit a merged one. `supabase/schema/schema.sql` is now a **reviewed
  current-state snapshot**, verified against the migrations by
  `node scripts/db/verify-migrations.mjs` (9 checks in throwaway DBs) — it is
  no longer the thing you hand-edit to change the database, but it must still
  be kept in sync by hand alongside any new migration (the verifier catches
  drift, it doesn't generate the snapshot). Read `supabase/schema/README.md`
  for schema.sql's own ordering rules (policies next to the table they guard,
  anything calling `my_org_id()`/`my_role()` after those functions are
  defined). `docs/carrieros-db/schema.sql` is a copy kept so the product docs
  stay self-contained; if they disagree, the repo wins.
- `.claude/launch.json` — dev server configs for the Browser-pane preview
  tool (`carrieros-web`, `carrieros-mobile (web preview)`, `supabase`).

## Persistent demo accounts
Not deleted between sessions — reused for manual/browser testing.
- `demo@carrieros.dev` / `Demo123!` — owner, "Sierra Freight Co" (org 12),
  trucks T-1/T-2, driver D-1 Mike Rodriguez, loads L-1/L-2/L-3.
- `mike.driver@carrieros.dev` / `Demo123!` — driver on the same org.
- `info@shipmentx.com` / `Demo123!` — sx_owner (ShipmentX platform staff),
  for testing the `/admin` SuperAdmin UI. Org is ShipmentX's own
  `type='platform'` row, separate from any carrier tenant.

After browser-testing changes their language/units/date/time prefs, run
`./scripts/reset-demo.sh` to put them back to defaults rather than resetting
by hand.

## After any schema change
Write a new numbered file in `supabase/migrations/` (never edit a merged
one — see `architecture/database-migrations.md`), apply it locally with
`node scripts/db/migrate.mjs`, and hand-update `supabase/schema/schema.sql`
to match — `node scripts/db/verify-migrations.mjs` checks the two agree but
does not generate the snapshot for you. Then run `./scripts/regen-types.sh`
to regenerate both apps' generated types, then `npx tsc --noEmit` in each
app. Don't run `supabase gen types ... > file` directly — the CLI sometimes
writes a log line to stdout before the real output, and `2>&1 | tail`
redirects that into the file too, silently corrupting it (tsc then fails
with a cryptic parse error on line 1). The script redirects stderr to
`/dev/null` to avoid this.

## Browser-pane automation reliability
The Browser pane's `computer` click tool is unreliable in this environment:
`read_page` sometimes reports `Viewport: 0x0` transiently, and click
coordinates don't always map to the right DOM element (worse on
React-Native-Web, which renders deeply nested non-semantic `<div>`s).

- If `read_page`/clicks stop responding: close the tab and open a fresh one
  (`tabs_close` + `tabs_create` + `navigate`) rather than reusing stale state.
- If a click silently doesn't register, dispatch a real event sequence via
  `javascript_tool` instead of the `computer` tool:

  ```js
  function clickByText(text) {
    const all = [...document.querySelectorAll('div')];
    const target = all.find(el => el.children.length === 0 && el.textContent.trim() === text);
    const row = target.parentElement; // the Pressable/clickable ancestor — verify via .closest or a short walk-up if this guess is off
    const r = row.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      row.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    }
  }
  clickByText('Metric — kilometers, kilograms');
  ```

  For a plain HTML `<form>`, `document.querySelector('form').requestSubmit()`
  is simpler and more reliable than clicking the submit button.

## Gated checks (enforcement, not just documentation)
There is no CI in this repo — git hooks are the actual enforcement mechanism
for `docs/architecture-principles.md` (Rules A-G, decoupling) and
`docs/design/carrieros-design-system.md` (component-library adoption). A doc
alone did not stop a real regression once already (SuperAdmin UI's first
draft bypassed `components/ui/*` — see `docs/design/carrieros-design-system.md`
§11, 2026-07-23), so new mechanical guards were added rather than relying on
the doc being re-read every time.

**One-time setup per clone** (hooks live in the versioned `scripts/git-hooks/`,
not `.git/hooks/`, so they survive a fresh clone but still need this pointed
at once):
```bash
git config core.hooksPath scripts/git-hooks
```

- **`scripts/git-hooks/pre-commit`** — on any staged `carrieros-web/**/*.{ts,tsx}`:
  `eslint` (includes the UI-component-pattern guard below), `tsc --noEmit`,
  and `carrieros-web/scripts/check-architecture.mjs` (static grep — no DB —
  enforcing Rule B/D "business/query logic must not import React/Next.js/
  components" and Rule G "call sites must go through `lib/storage`/
  `lib/auth-admin`, not the raw Supabase SDK"). Mobile TS files get
  `tsc --noEmit` only. Fast (no DB), so it runs on every commit.
- **`scripts/git-hooks/pre-push`** — runs each app's full test suite
  (DB-backed, slower) if that app changed since `main`. Gated at push, not
  commit, since that's when code actually leaves the machine.
- **`carrieros-web/eslint.config.mjs`'s `no-restricted-syntax` UI guard** —
  flags hand-rolled card/badge Tailwind (`bg-white/5`, `shadow-card-dark`,
  `border-white/8`, etc.) instead of `components/ui/*`. Ratcheted: `warn`
  repo-wide (surfaces the pre-existing debt in `app/(app)/**` without
  breaking the build) and `error` for surfaces already fully migrated,
  listed in that file's `ERROR_SURFACES` array. When you finish migrating
  another surface onto `components/ui/*`, add its glob to `ERROR_SURFACES` so
  the regression is locked out for good instead of sitting at `warn` forever.
- **`check-architecture.mjs`'s Rule B checks** (hot-table query
  encapsulation — `profiles`/`loads`/`drivers` should go through
  `lib/queries/*.ts`, not ad hoc `.from()` calls) run at `warn`, not `error`
  — the debt is too large (dozens of call sites) to gate as zero-violation
  yet. Same ratchet posture as the UI guard: build a table's `lib/queries/`
  module, migrate its call sites, then tighten that table's check to `error`.

**Standing audit cadence** (this repo has no CI and no wall-clock cron for
this — it's a session-driven workflow, so the habit has to be explicit):
- Run `npm run verify:compliance` (bundles `eslint` full-repo + `tsc --noEmit`
  + `check:architecture`) before marking any new UI/data module "done," and
  before any status update to `docs/production-gates.md`/`docs/resume.md` —
  don't rely solely on the commit hook catching it reactively after staging.
- Each time a surface finishes migrating onto `components/ui/*`, add its glob
  to `ERROR_SURFACES` (above) — that's what actually ratchets the standard
  forward, not just running the check.
- Track the `no-restricted-syntax` warn-count as a trend line in
  `docs/design/carrieros-design-system.md` §11's changelog after each wave —
  makes stalled progress or backsliding visible instead of silent.

## Speeding up multi-surface work
When a task spans independent surfaces (e.g. i18n on web + i18n on mobile,
or a fix needed in both apps), dispatch one background `Agent` per surface
in parallel rather than doing them serially — they don't share files and
don't block each other. Scale verification depth to risk: full
browser-driven verification (login, click through, check the DB) for
schema/auth/logic changes; a typecheck + one-locale spot-check is enough for
repetitive mechanical work (e.g. the 4th/5th translated screen).
