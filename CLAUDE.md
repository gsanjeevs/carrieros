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
  apps. No `supabase/migrations/` — schema changes are applied ad hoc via
  `docker exec supabase_db_carrieros psql ...` and then written into
  **`supabase/schema/schema.sql`**, which is the version-controlled source of
  truth. Read `supabase/schema/README.md` before editing it: policies go
  next to the table they guard (a duplicate `CREATE POLICY` name fails on a
  fresh run), and anything calling `my_org_id()`/`my_role()` must appear
  after those functions are defined — an ordering bug there already shipped
  once. Verify by replaying the file against a scratch DB (recipe in the
  README) before committing. `docs/carrieros-db/schema.sql` is a copy kept so
  the product docs stay self-contained; if they disagree, the repo wins.
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
Run `./scripts/regen-types.sh` to regenerate both apps' generated types, then
`npx tsc --noEmit` in each app. Don't run `supabase gen types ... > file`
directly — the CLI sometimes writes a log line to stdout before the real
output, and `2>&1 | tail` redirects that into the file too, silently
corrupting it (tsc then fails with a cryptic parse error on line 1). The
script redirects stderr to `/dev/null` to avoid this.

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
  listed in that file's `ERROR_SURFACES` array (currently `app/(admin)/**`
  only). When you finish migrating another surface onto `components/ui/*`,
  add its glob to `ERROR_SURFACES` so the regression is locked out for good
  instead of sitting at `warn` forever.

**When building a new module**: run `npm run check:architecture` and
`npx eslint` yourself before considering the work done, don't rely solely on
the commit hook to catch it after the fact — the hook is the backstop, not
the primary check.

## Speeding up multi-surface work
When a task spans independent surfaces (e.g. i18n on web + i18n on mobile,
or a fix needed in both apps), dispatch one background `Agent` per surface
in parallel rather than doing them serially — they don't share files and
don't block each other. Scale verification depth to risk: full
browser-driven verification (login, click through, check the DB) for
schema/auth/logic changes; a typecheck + one-locale spot-check is enough for
repetitive mechanical work (e.g. the 4th/5th translated screen).
