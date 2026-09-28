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
| Claude | Closing an 85-key translation gap across the 20 new locale files (surfaced by merging feature/i18n-timezone after feature/dat-loadboard + the load-orders feature had already added new en.json keys the translations predate) | `carrieros-web/messages/{ru,uk,mn,ar,so,ht,pt,vi,zh,ko,tl,fr,pl,ro,de,hi,gu,am,fa,ne}.json` only, no code changes; worktree `../carrieros-i18n-gap` on `feature/i18n-gap-fill` | 2026-09-27 |

## Recently finished (for context, not a permanent log — prune entries older than a day or two)

| Session | Task | Commits | Finished |
|---|---|---|---|
| Claude | Timezone-aware datetime rendering + expanded languages 4→24 with full translations + `LanguagePicker` component (not yet wired in) — **merged to main** | `2312367`,`cbdf82e`,`5d9c02f`,`1e08b43`,`01d1c37`,`b117943` on branch `feature/i18n-timezone` | 2026-09-27 |
| Claude | Breadcrumb/back-navigation audit + fix (vehicle/driver/customer detail pages + exceptions-inbox CTA plumbing, incl. a follow-up fix for a hardcoded-English `fromLabel`); load/invoice-detail breadcrumb UI itself deferred — **merged to main in this commit** | `89345cc`,`ec09d7b`,`7dd76ba`,`7f81ae5`,`1991bef` on branch `feature/breadcrumb-nav` | 2026-09-27 |
| Claude | DAT load-board integration Phase 1 (posting only, mocked `DatClient`), incl. a real tenancy-gap fix found + fixed via 0053 while writing tests — **merged to main** | `95c0e24`,`f675cf2`,`88211c0`,`59995b1` on branch `feature/dat-loadboard` | 2026-09-27 |
| Codex (GPT-6) | Review/fix and locally commit the in-progress billing/GPS/customer-order work; preserve unrelated local edits | `8f9d429` | 2026-09-27 |
| Claude | UX/navigation review + 3 fixes (customer-role login loop, Settings nav consolidation, theme flash) | `edadaca`, `da0e791`, `374c235` | 2026-09-27 |
| Claude | Found + fixed 4 missing table-grant bugs (0037, 0042) surfaced by running the real demo seed against staging | `2358438` | 2026-09-27 |
| Claude | `/api/version` + staging drift-check tooling | `fdf5e10` | 2026-09-27 |
| Codex (GPT-5) | Restored immutable 0048; added pre-commit migration immutability guard (uncommitted) | local only | 2026-09-27 |
| Codex (GPT-5) | Customer exception email-on-publish/resend; locally verified 0051 legacy invoice count | local only, uncommitted | 2026-09-27 |
| Codex (GPT-5) | Read-only design-system, light/dark theme, and tenant branding audit; Playwright samples at desktop light/dark | local audit only | 2026-09-27 |
| Codex (GPT-5) | Contrast-safe tenant tokens, fixed light/dark status pairs, shared branding preview, canonical Button/ButtonLink/FilterLink styles + scoped lint ratchets; production build verified | local only, uncommitted | 2026-09-27 |
| Codex (GPT-5) | Theme-safe UI rollout with authenticated light/dark browser QA; fixed hydration mismatch, dark muted-copy contrast, unsupported locale choices, and vehicle cab-type translation | `50d8e39` (`Centralize web theme and shared UI styling`), local commit only | 2026-09-27 |

## Flagged by cross-session review (2026-09-27)

**Deferred breadcrumb work on `loads`/`invoices` (from the `feature/breadcrumb-nav` audit, now
merged):** the product-owner-reported case ("exceptions inbox links into a detail page with no way
back") mostly resolves to `/loads/[load_number]` (`pod_missing`) and `/invoices/[invoice_number]`
(`invoice_overdue`) — both off-limits when that branch was built, per the load-orders/invoice-allocation
work that has since landed (`8f9d429`). Now that both pages are editable again, this is unblocked.
`lib/exceptions.ts` already appends `?from=/exceptions&fromLabel=exceptions` to those CTAs (a stable
KEY, not display text — see `lib/resolve-from-label.ts`, added in `1991bef` after a localization bug
was caught in review), so dropping in `components/ui/PageBackLink.tsx` (same pattern as
`vehicles/[vehicle_number]`, `drivers/[driver_number]`, `customers/[customer_number]`) should be close
to copy-paste — `const { from, fromLabel: fromLabelKey } = await searchParams` then
`const fromLabel = await resolveFromLabel(fromLabelKey)`, then
`<PageBackLink from={from} fromLabel={fromLabel} defaultHref="/loads" defaultLabel={t('backToLoads')} />`
(loads already has a `backToLoads` message key; invoices doesn't have a `backToInvoices` key yet,
just the unrelated `backToInvoice` singular one, so that'd need adding). Not done in
`feature/breadcrumb-nav` itself since it would touch the forbidden paths.

Claude reviewed the uncommitted `load_orders`/invoice-allocation work as a first test of periodic
cross-session review. One real bug found, not yet fixed — flagging here rather than editing your
uncommitted file directly:

- **`supabase/migrations/0050_multi_customer_invoice_allocations.sql`,
  `create_load_invoices_command()`**: `v_input_count` is only assigned inside the
  `IF v_order_count > 0` branch (the new multi-customer-orders path). The `ELSE` branch (legacy
  single-customer invoicing — the common case today, since `load_orders` is brand new and most loads
  won't have any yet) never sets it, but it's used unconditionally in the final `InvoiceBatchCreated`
  outbox event: `jsonb_build_object('loadId', p_load_id, 'invoiceCount', v_input_count)`. Every normal
  single-customer invoice creation will log `invoiceCount: null` instead of `1` — silently wrong data
  in an event any webhook consumer or audit trail reads. Fix: set `v_input_count := 1` in the `ELSE`
  branch (or compute it as `jsonb_array_length(p_invoice_rows)` in both branches instead of only one).

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
