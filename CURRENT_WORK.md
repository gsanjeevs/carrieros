# Current work (multi-session coordination)

This repo is actively worked on by more than one LLM coding session at the same time (as of
2026-09-27: a Claude session and a GPT-Luna session, both with full write access, both reading this
exact file — not per-tool copies). This file is the shared "who's doing what right now" board. It
costs one read + one small edit per task; the alternative (discovering a collision via `git status`,
a broken build, or two sessions independently fixing the same bug) has already cost real time today —
see the log below for what that actually looked like before this file existed.

## How to use this file

**Before starting a new task:**
1. Read the table below. If another entry touches the same files/area you're about to start on,
   coordinate before proceeding (wait, pick a different task, or explicitly split the work) rather
   than assuming it'll sort itself out at merge time.
2. Add a row for yourself: which session, what you're doing, which files/areas you expect to touch,
   and when you started. Keep it to one line — this is a status board, not a changelog.

**While working:** if the scope changes meaningfully (you touch a file you didn't expect to), update
your row rather than leaving it stale — a wrong entry is worse than no entry.

**When done:** remove your row (or move it to "recently finished" for a day if it's useful context for
the other session), and mention the commit(s) so the other session can `git log` them if curious.

## Active

| Session | Task | Files/areas | Started |
|---|---|---|---|
| — | No active task recorded | — | — |

## Recently finished (for context, not a permanent log — prune entries older than a day or two)

| Session | Task | Commits | Finished |
|---|---|---|---|
| Codex (GPT-6) | SX admin support operations: audited read-only support view, ticket inbox, per-user investigation, normalized carrier analytics, and guided onboarding | `cbbc040`,`615ae16`,`19f8ad4`,`7704495` on `feature/sx-admin-support`; not pushed | 2026-09-27 |
| Claude | Fixed the test-suite orphaned-org leak (46 → 0, validated against real accumulated data): 3 tables missing their own direct carrier_org_id-to-organizations cleanup, `vehicles` never explicitly deleted (relied on cascade, which fired an activity-log trigger AFTER the org row was already gone), 6 more profile-referencing tables missing from the sweep — **pushed** | one commit on `main` | 2026-09-27 |
| Claude | Load-detail-page reorganization — applied the existing `VehicleTabs`/`DriverTabs`/`CustomerTabs` pattern via new `LoadTabs.tsx` (Overview/Documents/Compliance & Fuel/Messages/Activity tabs; header, rate card, action grid, status timeline, and assignment/invoice/loadboard sidebar stay outside the tabs unchanged); added `loads.tab_*` keys to all 24 locales — **merged to main** | `1c570b5`,`f8424ff` on branch `feature/load-detail-redesign` | 2026-09-27 |
| Claude | Wired the 24-language `LanguagePicker` into `LanguageSwitcher` (Sidebar + login) and the Settings page; also found and fixed a real latent bug — `i18n/locales.ts`'s `SUPPORTED_LOCALES` was still stuck at 4 codes despite the DB/message-catalog expansion to 24, silently capping the UI — **merged to main** | `26bf422`,`0926785`,`6253e9f` on branch `feature/wire-language-picker` | 2026-09-27 |
| Claude | Wired `PageBackLink` into `loads/[load_number]` and `invoices/[invoice_number]` (the actual product-owner-reported "exceptions -> detail page, no way back" case) — closes the deferred item from `feature/breadcrumb-nav`; added new `backToInvoices` key translated across all 24 locales | `6ecb0b8`, `17403cb` on branch `feature/detail-page-breadcrumb` (not yet merged) | 2026-09-27 |
## Flagged by cross-session review (2026-09-27)

**Deferred breadcrumb work on `loads`/`invoices` — RESOLVED:** the product-owner-reported case
("exceptions inbox links into a detail page with no way back") is now fixed on
`feature/detail-page-breadcrumb` (`6ecb0b8`, `17403cb`, not yet merged) — `PageBackLink` is wired into
both `/loads/[load_number]` (`pod_missing`) and `/invoices/[invoice_number]` (`invoice_overdue`), same
pattern as `vehicles/[vehicle_number]`/`drivers/[driver_number]`/`customers/[customer_number]`, and the
new `backToInvoices` message key was added and translated across all 24 locales (kept
`tests/locale-messages.test.ts` green). See "Recently finished" above.

**`v_input_count` NULL-in-legacy-branch bug — RESOLVED.** Flagged here after a cross-session review of
`supabase/migrations/0050_multi_customer_invoice_allocations.sql`'s `create_load_invoices_command()`
(the `ELSE`/legacy-single-customer branch never set `v_input_count`, so `InvoiceBatchCreated` logged
`invoiceCount: null` instead of `1`). Confirmed fixed by `supabase/migrations/0051_fix_legacy_invoice_batch_count.sql`
(`v_input_count := jsonb_array_length(p_invoice_rows)` in the `ELSE` branch) — already on `main`,
`verify-migrations.mjs` 11/11 clean. No further action needed.

## Why this exists — real collisions from before this file (2026-09-27)

Worth keeping as a reminder of what "no coordination" actually costs, not just an abstract risk:

- **A literal git ref race**: two sessions committing within seconds of each other hit
  `cannot lock ref 'HEAD'` — recoverable (just retry), but a close call.
- **`supabase/schema/schema.sql` hunk conflicts**: this file is hand-maintained and both sessions
  append to it in the same region for unrelated migrations — repeatedly had to `git add -p` to stage
  only one session's hunk without touching the other's in-progress addition.
- **Migration numbering races**: sequential, must-be-unique migration files (`0043`, `0044`, ...) —
  two sessions picking "the next number" from memory rather than re-checking right before writing is
  a collision waiting to happen. **Always re-run `ls supabase/migrations | sort -V | tail -3` (or
  `git fetch && git log origin/main -- supabase/migrations`) immediately before creating a new
  migration file** — never reuse a number you determined earlier in your own session.
- **Duplicate work**: both sessions independently found and fixed the exact same
  `dedupeByVehicle`/RSC-boundary bug in `components/DispatchMap.tsx` around the same time — neither
  could see the other was already on it. This is the specific failure mode this file exists to prevent.

## Worktrees for real parallel feature work

For anything beyond a quick fix, prefer a separate git worktree per session/task over both sessions
editing the same checkout of `main` directly:

```bash
git worktree add ../carrieros-<short-task-name> -b <task-branch> main
```

Each worktree has its own working directory and branch off the same repo/history — no shared
uncommitted state, no ref races, no accidental hunk-picking in shared files. Merge (or open a PR) when
the task is done. `git worktree list` to see what's active; `git worktree remove <path>` to clean up
after merging.

Shared "hub" files that are worth extra caution even across worktrees (they can still conflict at
merge time even though they won't race during editing): `supabase/schema/schema.sql`,
`supabase/migrations/*` (numbering), `lib/generated/role-capabilities.ts` and its mobile counterpart
(regenerated, not hand-edited — regenerate after merging, don't hand-merge the generated file itself),
`messages/{en,es,pa,ur}.json`.
