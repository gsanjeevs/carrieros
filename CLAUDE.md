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
  `docker exec supabase_db_carrieros psql ...` and then hand-copied into
  `docs/carrieros-db/schema.sql` to keep it as the source-of-truth doc.
- `.claude/launch.json` — dev server configs for the Browser-pane preview
  tool (`carrieros-web`, `carrieros-mobile (web preview)`, `supabase`).

## Persistent demo accounts
Not deleted between sessions — reused for manual/browser testing.
- `demo@carrieros.dev` / `Demo123!` — owner, "Sierra Freight Co" (org 12),
  trucks T-1/T-2, driver D-1 Mike Rodriguez, loads L-1/L-2/L-3.
- `mike.driver@carrieros.dev` / `Demo123!` — driver on the same org.

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

## Speeding up multi-surface work
When a task spans independent surfaces (e.g. i18n on web + i18n on mobile,
or a fix needed in both apps), dispatch one background `Agent` per surface
in parallel rather than doing them serially — they don't share files and
don't block each other. Scale verification depth to risk: full
browser-driven verification (login, click through, check the DB) for
schema/auth/logic changes; a typecheck + one-locale spot-check is enough for
repetitive mechanical work (e.g. the 4th/5th translated screen).
