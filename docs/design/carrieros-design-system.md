# CarrierOS Design System — Product Layer
_Last updated: 2026-07-22 · Extends `ux-foundations.md` (Core)_

**This file is CarrierOS's product-layer design doc.** It supplies CarrierOS's concrete brand
theme (real hex values for every Core color role) and every CarrierOS-specific domain pattern —
the load status pipeline, exception tiers, IFTA table, fuel stop list, driver chat, DVIR checklist,
maintenance service/reminder cards, the Fleet Truck Card, the Pro-tier light topbar, and the mobile
(Expo/React Native) equivalents of all of the above.

It deliberately does **not** re-explain anything `ux-foundations.md` ("Core") already owns: token
architecture and taxonomy (§1–2), the component API catalog (§3), accessibility minimums (§4), or
the multi-platform delivery rule (§5). Where CarrierOS uses a Core component, this doc names it and
gives CarrierOS's concrete implementation (Tailwind classes on web, StyleSheet objects on mobile) —
it does not re-list that component's variants/states, since Core already defines those.

**Read `ux-foundations.md` first.** Everything below assumes its taxonomy and governance rules.

---

## 0. Scope & Governance

Per Core §0's extension rule, this doc may:
- Add CarrierOS-specific components/patterns (vehicle/load domain content below).
- Supply concrete values for tokens Core defines only as roles (the brand hex table in §1 below).

This doc must **not**:
- Redefine a Core component's required props or state matrix.
- Introduce a second token-naming convention (`{category}-{role}[-{variant}][-{state}]`, per Core
  §0, is the only naming shape used here too).
- Hardcode a raw hex/spacing value in a recipe where a Core token role exists for it. Where
  CarrierOS's current code doesn't yet honor that (see §2's implementation-status note), the gap is
  named explicitly rather than worked around silently.

Where CarrierOS genuinely needs something Core's catalog doesn't cover, it's called out as a
**Proposed Core Addition** callout box at the point of use, not quietly implemented as a local
one-off. See §10 for the running list.

---

## 1. CarrierOS Brand Theme

This section supplies the actual hex values for every color role Core (§2.1) defines abstractly.
**These values are CarrierOS's brand theme, not a universal spec** — a second product built on Core
would supply its own palette here, using the same role names.

> **Implementation status (2026-09-27):** Layer 3 semantic tokens are live in
> `carrieros-web/app/globals.css`, and many web surfaces now use them. `components/ui/` is the
> shared component/style source for controls and common patterns. Adoption is still incremental;
> avoid fixed light/dark palette utilities on migrated surfaces and check `eslint.config.mjs` for
> current lint ratchets. Auth/onboarding and public tracking intentionally retain a branded dark
> presentation while consuming the semantic tokens.

### 1.1 Layer 1 — Palette tokens (`@theme` block, `carrieros-web/app/globals.css`)

Raw named colors live in the `@theme` block in `carrieros-web/app/globals.css`. That file is the
source of truth; values are intentionally not duplicated in this document because the older table
drifted from the live palette. Semantic `status-*` foreground/surface pairs are theme-aware and
independent of carrier brand overrides; primary/accent brand foregrounds are contrast-resolved.

### 1.2 Layer 3 — Semantic tokens (CarrierOS's `:root` / `.dark` blocks)

Semantic roles map to theme-specific values in the live `:root`, `.dark`, and `.auth-shell` blocks.
Tailwind utility names are registered in the same file, including:

```css
@theme {
  --color-surface-page:   var(--color-surface-page);
  --color-surface-card:   var(--color-surface-card);
  --color-text-pri:       var(--color-text-primary);
  --color-status-danger:  var(--status-danger-text);
}
```

### 1.3 Semantic vs palette — which class to use

| Core role | CarrierOS class to use | Never use |
|---|---|---|
| `color-surface-page` | `bg-surface-page` | `bg-navy`, `bg-[#0f1923]`, `bg-white` |
| `color-surface-card` | `bg-surface-card` | `bg-white/5`, `bg-white` |
| `color-surface-input` | `bg-surface-input` | `bg-white/5`, `bg-white` |
| `color-border` | `border-border-ui` | `border-white/8`, `border-gray-200` |
| `color-divider` | `border-divider-ui` | `border-white/7`, `border-gray-100` |
| `color-text-primary` | `text-text-pri` | `text-white`, `text-navy` |
| `color-text-secondary` | `text-text-sec` | `text-gray-400`, `text-[#8898aa]` |
| `color-text-muted` | `text-text-mut` | `text-gray-500`, `text-[#4b5a6e]` |
| `color-brand-primary` | `text-brand-orange`, `bg-brand-orange` | `text-[#f97316]` |
| `color-status-danger` | `text-danger`, `bg-danger` | `text-red-500`, `text-[#dc2626]` |
| `color-status-success` | `text-success`, `bg-success` | `text-green-600`, `text-[#16a34a]` |

Semantic tokens are already registered. Legacy fixed-palette utilities remain migration debt on
some surfaces; use semantic classes for all new and migrated UI. Scoped ESLint guards enforce this
on the surfaces already converted.

### 1.4 Theme switching mechanism (CarrierOS's concrete wiring)

`profiles.theme_preference` stores `'light' | 'dark' | 'system'`. The root layout reads this and
sets the class on `<html>` (the single root attribute toggle Core §1's theming mechanism requires):

```tsx
// app/layout.tsx
<html lang={locale} dir={dir} className={theme === 'dark' ? 'dark' : ''}>
```

For `'system'`, add a small inline `<script>` before hydration that reads `prefers-color-scheme` and
sets the class — prevents flash of wrong theme on load.

### 1.5 Sidebar exception

The **sidebar chrome always stays dark navy** regardless of theme (Decision V3) — this is a
deliberate CarrierOS product decision, not a Core rule, and it bypasses the semantic layer on
purpose:

```tsx
// Sidebar — intentionally always dark, represented by stable navigation tokens
<aside className="bg-navigation-surface border-r border-navigation-border text-navigation-primary">

// Main content — uses semantic tokens, switches with theme
<main className="bg-surface-page text-text-pri">
```

### 1.6 Mobile theme stance (resolved explicitly)

Mobile is **not** intentionally light-only forever, and this is not the same dark theme as web:

- **Web** supports light / dark / system, user-toggled via `profiles.theme_preference` (§1.4).
- **Mobile** (`carrieros-mobile/src/constants/theme.ts`) already supports light + dark, OS-driven
  (via `Platform`/system color scheme) — `Colors.light` and `Colors.dark` both exist today.
- **The two dark treatments are intentionally different, not a bug or an oversight.** Web's dark
  theme is the dark-navy page treatment described in §1.2. Mobile's `Colors.dark` is, per the
  theme file's own comment, "a branded-navy variant of the same light-mobile-card idea" — mobile
  screens keep white/light cards as the base visual language in both OS themes; dark mode changes
  the surrounding chrome/background, not a port of web's dark-card treatment.

### 1.7 Dark vs light surface reference

| Surface | Web dark (default) | Web light | Mobile light (`Colors.light`) | Mobile dark (`Colors.dark`, OS-driven) |
|---|---|---|---|---|
| Page bg | `bg-navy` `#0f1923` | `#f4f6f9` | `#ffffff` | `#0f1923` (navy) |
| Card bg | `bg-white/5` | `#ffffff` | `#ffffff` | `navyLight` `#1e3a5f` |
| Primary text | `text-white` | `#0f1923` | `#0f1923` | `#ffffff` |
| Secondary text | `text-slate-400` `#8898aa` | `#8898aa` | `#8898aa` | `#9fb3c8` |

Web defaults to dark but switches via the semantic layer (§1.2/§1.4). Sidebar is always dark
regardless (§1.5). Never use raw `bg-white`, `bg-navy`, or `bg-gray-*` for a web main-content area —
use the semantic classes in §1.3.

---

## 2. Canonical Token Source (Core §8 requirement)

**Current honest state (2026-09-27): semantic tokens and partial lint enforcement; no generation tooling.**

- **Web:** `carrieros-web/app/globals.css` is the source of truth for palette, light/dark semantic
  surfaces, auth-shell tokens, stable navigation/image tokens, brand foregrounds, and accessible
  load-status pairs. Shared recipes/components live under `carrieros-web/components/ui/`; migrated
  page surfaces use those components and semantic utilities. This is a staged migration, not yet
  proof every page is fully tokenized. Scoped ESLint ratchets and `npm run check:tokens` catch
  regressions/drift on selected areas.
- **Mobile:** `carrieros-mobile/src/constants/theme.ts` remains a hand-maintained mirror for shared
  palette values and mobile-specific surfaces.
- **There is no token generation tooling** (Style Dictionary or equivalent). The two app themes
  remain separately maintained; `scripts/check-tokens.mjs` checks selected values but does not
  generate either file.

**Canonical file: `carrieros-web/app/globals.css`.** Web ships first, and `theme.ts`'s own comments
already defer to it. `theme.ts` is the generated/derived file, maintained by hand until real tooling
exists.

**Proposed real fix (per Core §8):** adopt a token-generation tool (e.g. Style Dictionary) with one
canonical `design/tokens.json` (or `.ts`) that generates both `globals.css`'s `@theme`/semantic
blocks and `theme.ts`. Not built yet — flagged as future Code-side work, not invented here.

**Manual-sync checklist — until generation tooling exists, run this whenever `globals.css` changes:**

- [ ] New/changed palette hex in `globals.css`'s `@theme` block → update the matching constant in
      `BrandColors` or `StatusColors` in `theme.ts`.
- [ ] New/changed semantic (Layer 3) value in `globals.css`'s `:root`/`.dark` blocks → update the
      matching key in `Colors.light`/`Colors.dark` in `theme.ts` — but check §1.6 first: mobile's
      dark values are a deliberate branded-navy variant, not a 1:1 copy of web's dark semantic
      values, so this is "keep the same *meaning*," not "copy the same hex."
    - Convert to the closest already-named `StatusColors`/`Colors` value, don't invent a new
      one-off hex in `theme.ts`.
- [ ] New status/pill mapping (e.g. a new load status) → add to the matching `*_PILL` map in
      `theme.ts` (`LOAD_STATUS_PILL`, `VEHICLE_STATUS_PILL`, `INVOICE_STATUS_PILL`,
      `EXCEPTION_TIER_PILL`) using existing `StatusColors` entries, and update the equivalent
      web badge/status map (e.g. `app/(app)/loads/page.tsx`'s `STATUS_COLOR`) in the same change.
- [ ] Run `./scripts/regen-types.sh` is unrelated (DB types) — this checklist is colors/spacing only,
      no equivalent regeneration script exists yet for tokens.
- [ ] Update this doc (§1) if a brand-theme value itself changes, since §1 is CarrierOS's copy of
      the concrete values for a human reader — the code files remain the actual source of truth.

---

## 3. Known Gaps for Code to Fix

Flagging for a future Code session — **not fixed here**, this is a docs migration:

- **Done (2026-07-22):** `components/ui/` now exists in `carrieros-web` — a real, importable
  component library implementing this catalog: `Button.tsx`, `StatusBadge.tsx`, `Card.tsx`
  (+ `CardHeader`/`CardBody`), `Input.tsx`, `KpiTile.tsx`, `Avatar.tsx`, `Table.tsx`
  (+ `TableHeaderCell`/`TableRow`/`TableCell`), `ProgressBar.tsx`, `Tabs.tsx`,
  `SegmentedControl.tsx`, `Modal.tsx`, `Tooltip.tsx`, `Toast.tsx`, `EmptyState.tsx`, `Skeleton.tsx`,
  plus an `index.ts` barrel and a local `cn.ts` helper. Existing pages have not been migrated to
  import from it yet (deliberate, incremental adoption — see §11's Changelog entry).
- **Done (2026-07-22):** the Layer 3 semantic token block (§1.2) has been added to `globals.css`,
  immediately after the existing `@theme` block — `bg-surface-page`/`bg-surface-card`/
  `bg-surface-subtle`/`bg-surface-input`, `border-border-ui`, `border-divider-ui`, and
  `text-text-pri`/`text-text-sec`/`text-text-mut` are now real Tailwind utilities, not aspirational
  ones. §1's "not yet implemented" callout is now stale as a result — the classes in §1.3's table
  are live.
- Several code comments still point at an even older doc this file (and `design-system.md` before
  it) already superseded: `carrieros-mobile/src/constants/theme.ts` ("see docs/design/design-tokens.md"),
  `carrieros-web/app/globals.css` ("docs/design/design-tokens.md … is the source of truth"),
  `Sidebar.tsx`, and `carrieros-mobile/src/app/(tabs)/loads.tsx` all reference
  `docs/design/design-tokens.md` by name in comments. That file is stale — this doc
  (`carrieros-design-system.md`) plus `ux-foundations.md` are the current source of truth. Update
  those comments to point here instead.
- No token-generation tooling exists yet (§2) — `globals.css` and `theme.ts` are manually
  cross-referenced only.
- **`lib/domain/load-status.ts`'s `loadStatusColor()` uses raw Tailwind palette-color utilities**
  (`bg-blue-500/20 text-blue-400`, `bg-amber-500/20 text-amber-400`, `bg-purple-500/20
  text-purple-400`, `bg-slate-500/20 text-slate-400`, etc.) instead of this project's actual design
  tokens (`bg-info`/`text-info`, `bg-warning`/`text-warning`, `bg-purple`/`text-purple`,
  `bg-danger`/`text-danger`) now that `components/ui/StatusBadge.tsx` exists and those tokens are
  real. This is a genuine inconsistency between `docs/architecture-principles.md`'s Rule A module
  (drafted the same day as this pass, governing `loads.status`'s color mapping) and this design
  system — flagged for reconciliation, not fixed in this pass, since `load-status.ts` is another
  session's active architectural work and this pass was scoped to be additive-only
  (`components/ui/` + the Layer 3 token block above). A future pass should either swap
  `loadStatusColor()`'s raw hex/palette classes for the semantic status tokens, or (preferably,
  since a `StatusBadge` component now exists) drive call sites off
  `<StatusBadge variant={...}>` via a status→variant mapping, so `loads.status` styling flows
  through the real component instead of a hand-copied class string either way.

---

## 4. Icon Library

Core §2.9 fixes the size scale (16/18/20/24–32px) and leaves the library choice to the product.
**CarrierOS's choice: Material Symbols Outlined, everywhere, no exceptions** — never emoji, never
Heroicons. (Several code recipes below still show emoji placeholders like 📷/✅/⛽ from early mockup
capture; treat those as placeholders to replace with the matching Material Symbol, not as a second
allowed icon source.)

---

## 5. Component Implementations (CarrierOS's concrete recipes for Core's catalog)

Every component below is one of Core §3's named components. This section supplies CarrierOS's
Tailwind implementation (web) of each variant/state Core already defines — it does not re-list the
variant/state matrix itself. Where CarrierOS's current code doesn't yet have a recipe for a
Core-defined variant, that gap is noted rather than invented.

### 5.1 Button

_Real component: `components/ui/Button.tsx`. The recipe below is that component's internal implementation, not something to copy-paste per page anymore._

Core: `Button` — variants `primary, secondary (outline), ghost, danger, success`; sizes `sm, md`;
states `default, hover, focus, active, disabled, loading` (see ux-foundations.md §3). CarrierOS's
implementation:

```tsx
// Primary (orange CTA)
<button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand-orange text-white text-xs font-semibold hover:bg-brand-orange/90 transition-colors">
  <span className="material-symbols-outlined text-[15px]">add</span>
  Action
</button>

// Ghost (translucent border over dark backdrop)
<button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/7 border border-white/8 text-slate-400 text-xs font-semibold hover:bg-white/12 hover:text-white transition-colors">
  Filter
</button>

// Danger
<button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-danger/20 border border-danger/20 text-danger text-xs font-semibold">
  Suspend
</button>

// Success
<button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-success/20 border border-success/20 text-success text-xs font-semibold">
  Retry
</button>

// Small size: add btn-sm → px-2 py-1 text-[11px]
```

**Documentation gap, not a Core gap:** CarrierOS's code doesn't yet have a distinct recipe for
Core's `secondary (outline)` variant (solid border, opaque background) separate from `ghost`
(translucent border over a colored/dark backdrop) — only the `ghost` recipe above exists in current
mockup/code capture. Needs a real `secondary (outline)` recipe next time that variant is built,
rather than reusing the `ghost` classes for both.

### 5.2 StatusBadge

_Real component: `components/ui/StatusBadge.tsx`. The recipe below is that component's internal implementation, not something to copy-paste per page anymore._

Core: `StatusBadge` — variants `success, warning, danger, info, neutral, brand, teal`; sizes
`sm, md`; states `default only` (see ux-foundations.md §3). **Rule: always `rounded-full`, never
`rounded` or `rounded-md`.**

```tsx
// success — active, delivered, healthy, paid
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#e8f9f1] text-[#1a9e5c]">
  Active
</span>

// warning — pending, expiring, due soon
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#fff7e0] text-[#b37d00]">
  Pending
</span>

// danger — failed, overdue, critical
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#fdecea] text-[#c0392b]">
  Failed
</span>

// info — informational, new
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#e8f0fe] text-[#1a5eb8]">
  Info
</span>

// brand — urgent-but-not-broken; dispatched (load assigned, driver notified, not yet moving)
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#fff0e6] text-[#c05a00]">
  Dispatched
</span>

// teal — in transit / en route (driver physically moving), and CA Pilot / special program
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-teal/15 text-teal">
  In Transit
</span>
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-teal/15 text-teal">
  CA Pilot
</span>

// neutral — unassigned, inactive
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-white/8 text-slate-400">
  Unassigned
</span>

// purple — invoiced (accepted as Core's 8th StatusBadge variant, ux-foundations.md §3, 2026-07-22)
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#f3eeff] text-[#6c3abf]">
  Invoiced
</span>

// Tier badges (Starter/Growth/Pro) use the same component, sm size, uppercase tracking
<span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-[0.04em] bg-white/7 text-slate-400 uppercase">STARTER</span>
<span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-[0.04em] bg-brand-orange/15 text-brand-orange uppercase">GROWTH</span>
<span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-[0.04em] bg-info/20 text-info uppercase">PRO</span>
```

**Note:** `dispatched` uses the `brand` variant (orange), resolved distinctly from `in_transit`,
which uses `teal` — see §6.1 Load Status Pipeline for the full resolved semantics.

**Accessibility — never color alone (Core §4):** every badge above already pairs its color with a
text label ("Active", "Pending", "Dispatched", etc.), which satisfies Core's non-color-alone rule.
When a badge is ever rendered icon-only (e.g. a compact table cell), it must keep an `aria-label`
carrying the same text, not rely on the pastel color alone.

---

### 5.3 Card / KpiTile

_Real components: `components/ui/Card.tsx` (+ `CardHeader`/`CardBody`) and `components/ui/KpiTile.tsx`. The recipes below are those components' internal implementation, not something to copy-paste per page anymore._

Core: `Card` — variants `standard, interactive, selectable`; states `default, hover (interactive),
focus (interactive), selected (selectable)`. `KpiTile` — states `default, loading (skeleton)` (see
ux-foundations.md §3).

```tsx
// Standard card
<div className="bg-surface-card border border-border-ui rounded-xl overflow-hidden mb-4">
  {/* Card header */}
  <div className="px-5 py-3.5 border-b border-divider-ui flex items-center justify-between">
    <div>
      <div className="text-sm font-bold text-text-pri">Card Title</div>
      <div className="text-xs text-text-sec mt-0.5">Subtitle</div>
    </div>
    <span className="text-xs font-semibold text-brand-orange cursor-pointer">View All</span>
  </div>
  {/* Card body */}
  <div className="px-5 py-4">{/* content */}</div>
</div>

// Interactive card / clickable row (pipeline lists, customer rows)
<div className="flex items-center gap-3 px-4 py-3 border-b border-divider-ui hover:bg-surface-subtle transition-colors cursor-pointer last:border-b-0">

// KpiTile — grid is always 4 columns on desktop
<div className="grid grid-cols-4 gap-3.5 mb-6">
  <div className="bg-surface-card border border-border-ui rounded-xl px-5 py-4">
    <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-slate-400 mb-2">Label</div>
    <div className="text-[26px] font-extrabold tracking-tight text-text-pri [font-variant-numeric:tabular-nums] leading-none">
      $1,847
    </div>
    <div className="text-xs text-slate-400 mt-1.5 flex items-center gap-1">
      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-success/20 text-success-dark">↑ 12%</span>
      vs last month
    </div>
  </div>
</div>
```

### 5.4 Page Layout & Sidebar

_No new `components/ui/` component for this section — it documents `Sidebar.tsx` (existing) and page-shell layout conventions, not a Core-catalog component this pass built._

Sidebar is CarrierOS's own persistent nav shell — not a Core component, but built from Core
primitives (nav items are effectively `Button`-adjacent list rows). **Sidebar width is always
`w-64` (256px) — never `w-60` or `w-72`.** It always stays dark navy regardless of theme (§1.5).

```tsx
// Outer shell
<nav className="w-64 min-h-screen bg-navy border-r border-white/8 flex flex-col fixed top-0 left-0 bottom-0 z-50">

// Logo area
<div className="px-5 pt-6 pb-5 border-b border-white/8">
  <span className="text-xl font-extrabold text-brand-orange tracking-tight">Carrier</span>
  <span className="text-xl font-extrabold text-white tracking-tight">OS</span>
</div>

// User area
<div className="px-5 py-4 border-b border-white/8 flex items-center gap-2.5">
  <div className="w-8 h-8 rounded-full bg-navy-light text-[#93c5fd] text-xs font-bold flex items-center justify-center flex-shrink-0">
    SG
  </div>
  <div>
    <div className="text-sm font-semibold text-white">Name</div>
    <div className="text-xs text-slate-400 mt-0.5">Role</div>
  </div>
</div>

// Nav section label
<div className="px-3 pt-3 pb-1 text-[10px] font-bold tracking-[0.1em] text-navy-muted uppercase">
  MAIN
</div>

// Nav item — inactive
<div className="flex items-center gap-2.5 px-3 py-2 mx-2 rounded-md text-sm font-medium text-slate-400 hover:bg-white/6 hover:text-white transition-colors cursor-pointer">
  <span className="material-symbols-outlined text-[18px]">dashboard</span>
  Dashboard
</div>

// Nav item — active
<div className="flex items-center gap-2.5 px-3 py-2 mx-2 rounded-md text-sm font-medium bg-brand-orange/10 text-brand-orange">
  <span className="material-symbols-outlined text-[18px]">local_shipping</span>
  Loads
</div>

// Nav badge (alert count)
<span className="ml-auto bg-danger text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
  5
</span>

// Footer
<div className="px-5 py-3.5 border-t border-white/8 text-[11px] text-slate-500 mt-auto">
  System <span className="text-teal font-semibold">● Healthy</span>
</div>
```

```tsx
// Main content wrapper (with sidebar)
<main className="ml-64 flex-1 min-h-screen flex flex-col bg-surface-page">

// Page header (sticky)
<div className="px-7 py-5 border-b border-divider-ui flex items-center gap-4 bg-surface-page/80 backdrop-blur sticky top-0 z-40">
  <div>
    <h1 className="text-lg font-bold text-text-pri">Page Title</h1>
    <p className="text-xs text-text-sec mt-0.5">Subtitle / count</p>
  </div>
  <div className="ml-auto flex items-center gap-2">{/* header actions */}</div>
</div>

// Page body
<div className="flex-1 px-7 py-6">{/* content */}</div>
```

### 5.5 Table

_Real component: `components/ui/Table.tsx` (exports `Table`, `TableHeaderCell`, `TableRow`, `TableCell`). The recipe below is that component's internal implementation, not something to copy-paste per page anymore._

Core: `Table` — states `default row, hover row, sorted-column header` (see ux-foundations.md §3).

```tsx
<div className="overflow-x-auto">
  <table className="w-full border-collapse">
    <thead>
      <tr>
        <th className="text-[10px] font-bold uppercase tracking-[0.08em] text-text-sec pb-2.5 text-left px-3 border-b border-divider-ui">
          Column
        </th>
        {/* numeric column: add text-right */}
      </tr>
    </thead>
    <tbody>
      <tr className="hover:bg-white/[0.025] transition-colors">
        <td className="py-2.5 px-3 text-[13px] text-text-pri border-b border-divider-ui last:border-b-0">
          Value
        </td>
        {/* numeric: add text-right [font-variant-numeric:tabular-nums] */}
        {/* ID / code: add font-mono text-[12px] text-slate-400 */}
      </tr>
    </tbody>
  </table>
</div>
```

**Known gap vs. Core §3's expanded `Table` matrix:** Core now also defines pagination (page-based
default), bulk-select (leading checkbox + contextual action bar), sticky header, and responsive
card-collapse as standard `Table` states. CarrierOS's current loads/invoices/drivers/customers list
pages implement none of these yet (plain scroll, no bulk actions, no mobile card-collapse) — flagged
here as a real product gap to close, not a Core-catalog gap. Next list-page rebuild should adopt all
four rather than reinventing ad hoc pagination/selection per page.

### 5.6 Input / Filter & Search Bar

_Real component: `components/ui/Input.tsx`. The recipe below is that component's internal implementation for the `Input` part specifically (text/select/textarea); the surrounding filter-bar composition is still page-layout, not componentized this pass._

Core: `Input` (text/select/textarea) — sizes `sm, md`; states `default, focus, error, disabled,
readonly` (see ux-foundations.md §3). CarrierOS's search/filter-bar composition:

```tsx
<div className="flex items-center gap-2.5 mb-4 flex-wrap">
  {/* Search input */}
  <div className="flex items-center gap-2 bg-surface-input border border-border-ui rounded-lg px-3 py-1.5 flex-1 min-w-[200px] max-w-xs">
    <span className="material-symbols-outlined text-[16px] text-slate-500">search</span>
    <input
      className="bg-transparent border-none outline-none text-[13px] text-text-pri placeholder:text-text-mut w-full"
      placeholder="Search..."
    />
  </div>
  {/* Filter chip — inactive */}
  <button className="px-3 py-1 rounded-full text-xs font-medium border border-white/8 text-slate-400 hover:border-white/20 hover:text-white transition-colors">
    All
  </button>
  {/* Filter chip — active */}
  <button className="px-3 py-1 rounded-full text-xs font-medium border border-brand-orange bg-brand-orange/10 text-brand-orange">
    Active (12)
  </button>
</div>
```

### 5.7 Avatar

_Real component: `components/ui/Avatar.tsx`. The recipe below is that component's internal implementation, not something to copy-paste per page anymore._

Core: `Avatar` — variants `circle (user), rounded-square (org)`; sizes `sm, md, lg`; color assigned
consistently per entity, not per-render random (see ux-foundations.md §3). CarrierOS's px mapping:
`sm` = 28px (`w-7 h-7`, table-compact), `md` = 32px (`w-8 h-8`, standard), `lg` = 40px (`w-10 h-10`,
detail page).

```tsx
// User avatar (circle, initials)
<div className="w-8 h-8 rounded-full bg-navy-light text-[#93c5fd] text-xs font-bold flex items-center justify-center flex-shrink-0">
  GG
</div>

// Org avatar (rounded-square, initials)
<div className="w-8 h-8 rounded-lg bg-navy-light text-[#93c5fd] text-xs font-bold flex items-center justify-center flex-shrink-0">
  GB
</div>

// Additional color variants for visual distinction (assign consistently per org/user, not random):
// bg-[#1a3a2f] text-green-400   bg-[#2a1f3a] text-purple-400
// bg-[#1a2f3a] text-blue-400    bg-[#3a1f1f] text-red-400
```

### 5.8 ProgressBar / HealthBar

_Real component: `components/ui/ProgressBar.tsx`. The recipe below is that component's internal implementation, not something to copy-paste per page anymore._

Core: `ProgressBar` / `HealthBar` — fill color by threshold, variants `success, warning, danger`
(see ux-foundations.md §3).

```tsx
// Health score bar (customer health board)
<div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
  <div className="h-full rounded-full bg-success" style={{ width: `${score}%` }} /> {/* or bg-warning / bg-danger */}
</div>

// Feature adoption progress bar
<div className="h-1 rounded-full bg-white/8 mt-1.5">
  <div className="h-full rounded-full bg-brand-orange" style={{ width: `${pct}%` }} />
</div>
```

**Future chart work:** if a multi-series chart or sparkline is ever added (e.g. revenue-by-lane,
a fleet-utilization heatmap), it must use Core §2.10's categorical/sequential palette conventions,
not an ad hoc color choice per chart. Nothing in CarrierOS today needs this yet — noted so the first
chart built doesn't reinvent it.

### 5.9 Tabs / SegmentedControl

_Real components: `components/ui/Tabs.tsx` and `components/ui/SegmentedControl.tsx`. The recipes below are those components' internal implementation, not something to copy-paste per page anymore._

Core: `Tabs` (page-level underline) and `SegmentedControl` (see ux-foundations.md §3). CarrierOS has
two distinct desktop patterns using these:

```tsx
// SegmentedControl — grouped pill filter (mockup-22 Fleet Inventory; light-theme desktop only)
<div className="flex gap-0.5 bg-white border border-[#e5e8ef] rounded-lg p-0.5 w-fit mb-5">
  <button className="px-3.5 py-1.5 rounded-md text-[12px] font-medium text-[#8898aa] cursor-pointer">
    All <span className="text-[10px] ml-1 opacity-65">24</span>
  </button>
  <button className="px-3.5 py-1.5 rounded-md text-[12px] font-semibold bg-navy text-white cursor-pointer">
    Active <span className="text-[10px] ml-1 opacity-65">18</span>
  </button>
  <button className="px-3.5 py-1.5 rounded-md text-[12px] font-medium text-[#8898aa] cursor-pointer">
    In Shop
  </button>
</div>

// Tabs — within-page underline strip (mockup-15 Home Screens, mockup-19 Chat)
<div className="flex border-b border-black/8 bg-white flex-shrink-0">
  <button className="flex-1 py-2.5 px-2 text-[12px] font-semibold text-[#8898aa] border-b-2 border-transparent">
    Loads
  </button>
  <button className="flex-1 py-2.5 px-2 text-[12px] font-semibold text-navy border-b-2 border-brand-orange">
    Chat
  </button>
  <button className="flex-1 py-2.5 px-2 text-[12px] font-semibold text-[#8898aa] border-b-2 border-transparent">
    IFTA
  </button>
</div>
```

### 5.10 EmptyState / Skeleton / Toast

_Real components: `components/ui/EmptyState.tsx`, `components/ui/Skeleton.tsx`, `components/ui/Toast.tsx`, and (page-level underline/hover detail) `components/ui/Tooltip.tsx`. As of 2026-07-22 these are real, working components — the note below about "no mockup yet" describes the absence of a CarrierOS-specific visual recipe, not the absence of the component itself._

Core defines `EmptyState`, `Skeleton`, and `Toast` (see ux-foundations.md §3). Per Core's own
Changelog, none of these appear in any of the 23 mockups yet — Core is ahead of current CarrierOS
usage. No CarrierOS-specific recipe exists for these yet; when one of these is first built, add its
recipe here rather than inventing a page-local pattern.

---

## 6. Domain Patterns (web) — genuinely CarrierOS-specific

Everything in this section is unique to CarrierOS's load/fleet/billing domain — Core has no
equivalent, and a second product built on Core would not inherit any of it.

### 6.1 Load Status Pipeline

5-step horizontal status bar: Booked → Dispatched → Picked Up → In Transit → Delivered.

```tsx
<div className="flex items-center gap-0">
  {steps.map((step, i) => (
    <Fragment key={step}>
      <div className={cn(
        "flex flex-col items-center",
        isComplete ? "text-success-dark" : isCurrent ? "text-brand-orange" : "text-slate-500"
      )}>
        <div className={cn(
          "w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold",
          isComplete ? "bg-success border-success text-white" :
          isCurrent  ? "bg-brand-orange/20 border-brand-orange text-brand-orange" :
                       "bg-white/5 border-white/15 text-slate-500"
        )}>
          {isComplete ? "✓" : i + 1}
        </div>
        <div className="text-[10px] mt-1 whitespace-nowrap">{step}</div>
      </div>
      {i < steps.length - 1 && (
        <div className={cn("flex-1 h-px mx-1 mb-5", isComplete ? "bg-success" : "bg-white/10")} />
      )}
    </Fragment>
  ))}
</div>
```

**Resolved semantics (previously a conflict, now fixed):** `dispatched` (load assigned, driver
notified, not yet moving) is **orange** (`StatusBadge` variant `brand`). `in_transit`/`picked_up`
(driver physically moving) is **teal** (`StatusBadge` variant `teal`). These are deliberately
different colors for different pipeline stages, not interchangeable.

### 6.2 Semantic Color Rules (what each color MEANS in CarrierOS)

Pick a badge/status color based on meaning, never preference:

| Color | Meaning | Used for |
|---|---|---|
| Red / danger | Broken, failed, expired, critical | Failed payment, expired card, churn risk, overdue invoice |
| Orange / brand | Urgent but not broken; dispatched (assigned, not yet moving) | Trial expiring <7d, low adoption, CTA buttons, dispatched load |
| Amber / warning | Warning, approaching threshold | Expiring soon, due this week, underutilised |
| Green / success | Healthy, complete, paid, active | Delivered load, paid invoice, healthy org, compliant driver |
| Blue / info | Informational, new, upcoming | New signup, FYI items, informational badges |
| Gray / neutral | Inactive, unassigned, unknown | Idle vehicle, no data, disabled state |
| Teal | Special program, in-transit / en route | CA Pilot, driver physically moving (`in_transit`/`picked_up`). `dispatched` = orange, `in_transit` = teal — see §6.1. |

### 6.3 Exception / Alert Cards (Triage pattern)

Severity border-left color by group: Critical → `border-l-danger`; High → `border-l-brand-orange`;
Medium → `border-l-warning`; Low → `border-l-info`.

```tsx
<div className="bg-white/5 border border-white/8 border-l-4 border-l-danger rounded-xl px-4 py-3.5 mb-2 flex items-start gap-3.5 hover:bg-white/7 transition-colors">
  {/* Icon block */}
  <div className="w-9 h-9 rounded-lg bg-danger/20 flex items-center justify-center flex-shrink-0 mt-0.5">
    <span className="material-symbols-outlined text-[16px] text-danger">credit_card_off</span>
  </div>
  {/* Body */}
  <div className="flex-1 min-w-0">
    <div className="text-[13px] font-bold text-white flex items-center gap-2">
      Org Name
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-orange/15 text-brand-orange uppercase">GROWTH</span>
    </div>
    <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">Signal description</div>
    <div className="text-[11px] text-slate-500 mt-1.5">Meta info · last login etc.</div>
  </div>
  {/* Actions */}
  <div className="flex gap-1.5 flex-shrink-0 mt-0.5">
    <button className="...ghost btn...">Email</button>
    <button className="...danger btn...">Suspend</button>
  </div>
</div>
```

Section-group header (used above a group of exception cards):

```tsx
<div className="text-[10px] font-bold tracking-[0.1em] uppercase text-slate-500 mb-2.5 flex items-center gap-2">
  <div className="w-2 h-2 rounded-full bg-danger flex-shrink-0" />
  Critical — Act Today (3)
</div>
```

### 6.4 Activity / Audit Feed

```tsx
<div className="flex items-start gap-3 px-4 py-3 border-b border-white/7 hover:bg-white/[0.02] last:border-b-0">
  <div className="w-7 h-7 rounded-lg bg-brand-orange/12 flex items-center justify-center flex-shrink-0">
    <span className="material-symbols-outlined text-[14px] text-brand-orange">local_shipping</span>
  </div>
  <div className="flex-1 min-w-0">
    <div className="text-[13px] text-text-pri leading-snug">
      <strong className="font-semibold">Org Name</strong> · event description
    </div>
    <div className="text-[11px] text-text-mut mt-0.5 flex gap-3">
      <span>Event type</span>
      <span className="font-mono text-[10px]">POST /api/...</span>
    </div>
  </div>
  <div className="text-[11px] text-slate-500 flex-shrink-0 mt-0.5">2 min ago</div>
</div>
```

### 6.5 Info Row (key–value pairs in detail pages)

```tsx
<div className="flex justify-between items-center py-2 border-b border-divider-ui text-[13px] last:border-b-0">
  <span className="text-text-sec">Label</span>
  <span className="text-text-pri font-medium text-right">Value</span>
</div>
```

### 6.6 Adoption / Checklist Items

```tsx
// Completed item
<div className="flex items-center gap-2.5 py-2.5 border-b border-white/7 last:border-b-0">
  <div className="w-5 h-5 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0">
    <span className="material-symbols-outlined text-[12px] text-success-dark">check</span>
  </div>
  <span className="text-[13px] text-slate-400 line-through flex-1">Completed step</span>
  <span className="text-[11px] text-slate-500">Jul 1</span>
</div>

// Incomplete / stuck item (highlight amber if it's the blocker)
<div className="flex items-center gap-2.5 py-2.5 border-b border-white/7">
  <div className="w-5 h-5 rounded-full bg-white/7 flex items-center justify-center flex-shrink-0">
    <span className="material-symbols-outlined text-[12px] text-slate-500">close</span>
  </div>
  <span className="text-[13px] text-warning font-semibold flex-1">Blocked step ← Stuck here</span>
  <span className="text-[11px] text-slate-500">—</span>
</div>
```

### 6.7 Timeline Items

```tsx
<div className="flex gap-3 py-2.5 border-b border-white/7 last:border-b-0">
  <div className="w-7 h-7 rounded-full bg-brand-orange/15 flex items-center justify-center flex-shrink-0 mt-0.5">
    <span className="material-symbols-outlined text-[13px] text-brand-orange">local_shipping</span>
  </div>
  <div className="flex-1">
    <div className="text-[13px] text-text-pri">Event title</div>
    <div className="text-[11px] text-text-mut mt-0.5">Date · Time</div>
  </div>
</div>
```

### 6.8 Delta Chips (KPI change indicators)

```tsx
<span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-success/20 text-success-dark inline-flex items-center gap-0.5">↑ 12%</span>
<span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-danger/20 text-danger inline-flex items-center gap-0.5">↓ 3</span>
<span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-warning/20 text-warning inline-flex items-center gap-0.5">~ same</span>
```

### 6.9 Dividers, Section Groups, Note Boxes, Callout Box

```tsx
// Visual divider between sections
<div className="h-px bg-white/7 my-4" />

// Note / internal comment box
<div className="bg-surface-subtle border border-border-ui rounded-lg px-3 py-2.5 text-xs text-slate-400 leading-relaxed mb-2">
  Note content here
  <div className="text-[10px] text-slate-500 mt-1.5">Author · Date</div>
</div>

// Callout box — orange-tinted, an important tip/prompt (distinct from the Note box above).
// Seen in mockups 01–08 in mobile contexts.
<div className="bg-brand-orange/10 border border-brand-orange/25 rounded-lg px-3 py-2 text-xs text-brand-orange/90 leading-relaxed">
  ★ Tip text or prompt goes here
</div>
```

**Callout canonical spec from CSS:** `background: rgba(244,121,32,.1); border: 1px solid
rgba(244,121,32,.25); border-radius: 8px; padding: 8px 11px; font-size: 11px`.

### 6.10 Plan / Pricing Card

Used in the signup & trial flow (mockup-09) to let users pick a tier. Built on Core's `Card`
`selectable` variant.

```tsx
// Default state
<div className="bg-white rounded-2xl p-5 mb-3 border-2 border-[#e8ecf0] cursor-pointer transition-all">
  <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full tracking-[0.05em]">
    POPULAR
    {/* bg-orange/15 text-orange for Growth; bg-[#e8f0fe] text-[#1a5eb8] for Pro */}
  </span>
  <div className="text-[18px] font-extrabold text-navy mt-1">Growth</div>
  <div className="text-[28px] font-black text-brand-orange mt-1.5 mb-0.5 tracking-[-0.03em]">
    $99 <span className="text-[14px] font-medium text-[#8898aa]">/mo</span>
  </div>
  <div className="text-[13px] text-[#8898aa] mb-3.5 pb-3.5 border-b border-[#e8ecf0]">Up to 10 trucks</div>
  <ul className="flex flex-col gap-1.5 list-none">
    <li className="text-[13px] text-navy flex items-start gap-2 leading-[1.4]">
      <span className="text-brand-orange font-extrabold flex-shrink-0">✓</span>
      Real-time GPS tracking
    </li>
  </ul>
  <div className="text-center mt-3.5 text-[13px] font-bold text-[#8898aa]">Tap to select</div>
</div>

// Selected state (Core Card "selected" state)
<div className="... border-orange shadow-[0_0_0_3px_rgba(249,115,22,0.12)]">
  <div className="text-center mt-3.5 text-[13px] font-bold text-brand-orange">✓ Selected</div>
</div>
```

### 6.11 Fleet Truck Card (Desktop)

The primary truck listing component in the Fleet Inventory screen (mockup-22). Horizontal card with
photo column, info column, and driver column.

```tsx
<div className="bg-white border border-[#e5e8ef] rounded-[14px] flex overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.05)] hover:shadow-[0_6px_24px_rgba(0,0,0,0.1)] transition-shadow mb-3.5">

  {/* Left accent strip — color indicates status: success=active/available, warning=in-shop, danger=out-of-service */}
  <div className="w-1 flex-shrink-0 bg-success" />

  {/* Truck photo column */}
  <div className="w-[200px] flex-shrink-0 overflow-hidden relative">
    <img src="..." className="w-full h-full object-cover block" alt="Truck" />
    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 py-2">
      <div className="text-[11px] font-bold text-white tracking-[0.05em]">T-1</div>
      <div className="text-[10px] text-white/75">Semi-Truck</div>
    </div>
  </div>

  {/* Truck info column */}
  <div className="flex-1 px-5 py-4.5 flex flex-col gap-2 min-w-0">
    <div className="flex items-center gap-2.5 flex-wrap">
      <span className="text-[16px] font-extrabold text-navy">Big Blue</span>
      <span className="text-[11px] font-semibold text-[#8898aa] bg-[#f4f6f9] border border-[#e5e8ef] rounded px-1.5 py-0.5">T-1</span>
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#e8f9f1] text-[#1a9e5c]">
        <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
        Active
      </span>
    </div>
    <div className="text-[12px] text-[#8898aa]">2021 Kenworth T680</div>
    <div className="flex gap-4.5 flex-wrap">
      <span className="flex items-center gap-1 text-[11px] text-[#8898aa]">
        <span className="material-symbols-outlined text-[14px]">speed</span>
        142,500 mi
      </span>
      <span className="flex items-center gap-1 text-[11px] text-warning">
        <span className="material-symbols-outlined text-[14px]">build</span>
        Service due
      </span>
    </div>
  </div>

  {/* Driver column */}
  <div className="border-l border-[#f1f3f8] px-5 py-4.5 flex flex-col justify-between min-w-[200px] flex-shrink-0">
    <div className="flex items-center gap-2.5">
      <div className="w-10 h-10 rounded-full object-cover border-2 border-[#e5e8ef] bg-teal text-white text-[14px] font-bold flex items-center justify-center flex-shrink-0">
        MR
      </div>
      <div>
        <div className="text-[13px] font-bold text-navy">Mike Rodriguez</div>
        <div className="text-[11px] text-[#8898aa]">In Transit</div>
      </div>
    </div>
    <div className="bg-[#e8f0fe] text-[#1a5eb8] rounded-[7px] px-2.5 py-1 text-[11px] font-semibold flex items-center gap-1 mt-2.5">
      <span className="material-symbols-outlined text-[13px]">local_shipping</span>
      Load L-042 active
    </div>
    <div className="flex gap-1.5 mt-2.5">
      <button className="bg-[#f4f6f9] border border-[#e5e8ef] text-navy rounded-md text-[11px] font-semibold px-2.5 py-1.5 cursor-pointer">Details</button>
      <button className="bg-[#f4f6f9] border border-[#e5e8ef] text-navy rounded-md text-[11px] font-semibold px-2.5 py-1.5 cursor-pointer">Assign</button>
    </div>
  </div>
</div>
```

### 6.12 Pro / Light-Theme Desktop Topbar

The Finance & IFTA command center (mockup-17) uses a white topbar, not the dark navy used
elsewhere. **This applies only to the Pro tier's desktop screens.**

```tsx
<div className="h-14 bg-white border-b border-[#e5e8ef] flex items-center px-6 gap-3 sticky top-0 z-20 flex-shrink-0">
  <div>
    <div className="text-[15px] font-bold text-navy">Finance Dashboard</div>
    <div className="text-[12px] text-[#8898aa]">Q2 2026</div>
  </div>
  <select className="border border-[#e5e8ef] rounded-lg px-3 py-1.5 text-[13px] text-navy bg-white cursor-pointer ml-auto">
    <option>Q2 2026</option>
  </select>
  <button className="bg-navy text-white border-none rounded-lg px-3.5 py-2 text-[13px] font-semibold cursor-pointer flex items-center gap-1.5">
    Export
  </button>
</div>
```

**Rule:** the dark topbar (`bg-navy sticky z-40`) is used for Starter/Growth desktop. The light
topbar (`bg-white border-b border-[#e5e8ef]`) is Pro-tier only. Do not mix.

### 6.13 Internationalization — CarrierOS's RTL Locale

Core §5 defines the platform-agnostic RTL mechanics (logical properties, directional icon mirroring,
locale-owned number/date formatting). CarrierOS's concrete detail: **Urdu is CarrierOS's one RTL
locale** today (alongside English/Spanish/Punjabi, all LTR). `dir={dir}` on the root element (§1.4's
snippet) already switches per-locale. Any new component built going forward should use logical
Tailwind utilities (`ms-*`/`me-*` over `ml-*`/`mr-*`, `text-start`/`text-end` over `text-left`/
`text-right`) so it mirrors automatically under Urdu rather than needing a manual RTL variant —
existing components predate this convention and have not been audited against it; treat that as a
known gap, not a completed guarantee.

### 6.14 Destructive Actions Applied

Core §7 defines the two-tier reversible/irreversible pattern. CarrierOS's concrete application:
**reversible-by-default** actions (deactivate a driver/vehicle, archive a load) follow this system's
existing "deactivate never delete" convention (`profiles.is_active`, `decisions.md`) and should use
a `Toast` + "Undo" affordance, not a confirmation modal. **Irreversible/high-consequence** actions —
"Suspend" in the exception-card triage pattern (§6.3) being the clearest current example, since it
cuts off a paying customer's access — require Core §7's confirmation `Modal` before executing, not
the single-click button shown in §6.3's recipe today. That recipe predates this rule; treat the
missing confirm-modal step as a real gap to close next time the Suspend action is wired up, not an
intentional one-click design.

---

## 7. Mobile Patterns (`carrieros-mobile`, Expo/React Native)

**Styling mechanism: plain React Native `StyleSheet.create`, not NativeWind.**
`carrieros-mobile/package.json` has no NativeWind/Tailwind dependency; 23 files under
`carrieros-mobile/src` use `StyleSheet.create`, and only one (`components/animated-icon.web.tsx`, a
web-only fallback) uses `className`. `carrieros-mobile/src/global.css` is a leftover Expo-template
artifact providing CSS custom properties for web font-family fallback only — it is not a NativeWind
entry point and does not drive component styling.

Every recipe below is written as real `StyleSheet.create`-consumable object syntax (or is explicitly
labeled otherwise), referencing the actual token names from
`carrieros-mobile/src/constants/theme.ts` (`BrandColors`, `StatusColors`, `Colors.light`/`Colors.dark`,
`Spacing`) rather than inventing new hex literals inline. Where a mockup pattern has no mobile screen
built yet, it's labeled **"web-only pattern, no mobile implementation yet"** instead of a fabricated
conversion.

### 7.1 Mobile App Shell

```ts
import { StyleSheet } from 'react-native';
import { BrandColors, Colors } from '@/constants/theme';

const styles = StyleSheet.create({
  // Top nav bar — always navy, regardless of screen theme (mirrors web sidebar exception, §1.5)
  navBar: {
    backgroundColor: BrandColors.navy,
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  navBackLabel: { color: BrandColors.orange, fontSize: 13, fontWeight: '600' },
  navTitle: { flex: 1, color: '#ffffff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  navActionLabel: { color: BrandColors.orange, fontSize: 13, fontWeight: '600' },

  // Content area — resolves to Colors.light.background / Colors.dark.background per OS theme
  content: { flex: 1, backgroundColor: Colors.light.background },
});
```

**Phone-frame dimensions are mockup-reference only** (not real RN layout — a design-tool artifact
for presenting mockups inside a phone bezel): `width: 320, borderRadius: 44, padding: 12` outer
chrome; inner content area `borderRadius: 34, overflow: 'hidden'`. Nav bar title: `fontSize: 16,
fontWeight: '700'`.

### 7.2 Mobile Bottom Tab Bar

The persistent bottom navigation in the driver and owner mobile apps (mockups 12, 14, 15, 19, 20).

```ts
const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.08)',
    flexDirection: 'row',
    paddingTop: 6,
    paddingBottom: 10,
    flexShrink: 0,
    // 4 equal columns for driver app (Home, Loads, Chat, Profile); 5 for IFTA/compliance
    // views (add Logs tab) — never more than 5. Use flex:1 per tab item, not a fixed width.
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 2 },
  tabIcon: { fontSize: 20, color: '#8898aa' },       // inactive
  tabIconActive: { fontSize: 20, color: BrandColors.orange },
  tabLabel: { fontSize: 9, fontWeight: '600', color: '#8898aa', textTransform: 'uppercase', letterSpacing: 0.5 },
  tabLabelActive: { fontSize: 9, fontWeight: '600', color: BrandColors.orange, textTransform: 'uppercase', letterSpacing: 0.5 },
  tabBadge: {
    position: 'absolute', top: 0, right: 14,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: BrandColors.orange,
    borderWidth: 2, borderColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center',
  },
  tabBadgeText: { fontSize: 8, fontWeight: '800', color: '#ffffff' },
});
```

No underline/indicator pill for the active tab — color change only (`#8898aa` inactive,
`BrandColors.orange` active).

### 7.3 Mobile Form Inputs (Light Theme)

Used inside white cards (onboarding, team invite, fuel stop forms).

```ts
const styles = StyleSheet.create({
  fieldContainer: { marginBottom: 14 },
  label: {
    fontSize: 11, fontWeight: '600', color: '#8898aa',
    marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    width: '100%',
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1.5, borderColor: '#e8ecf0',
    borderRadius: 10,
    fontSize: 15, color: BrandColors.navy,
    backgroundColor: '#ffffff',
  },
  inputFocused: { borderColor: BrandColors.orange },
  hint: { fontSize: 11, color: '#8898aa', marginTop: 6, lineHeight: 16 },
  row: { flexDirection: 'row', gap: 10 },
  rowField: { flex: 1 },
});
```

Focus state is applied conditionally via `[styles.input, isFocused && styles.inputFocused]` — no
"if dark theme" branching per Core §1's non-negotiable; this is a component-local focus state, not
a theme resolution.

### 7.4 Mobile Full-Width CTA Button

The primary action button on mobile screens — full width, taller than desktop's compact button.

```ts
const styles = StyleSheet.create({
  ctaPrimary: {
    width: '100%', backgroundColor: BrandColors.orange,
    borderRadius: 12, paddingVertical: 15, alignItems: 'center',
  },
  ctaPrimaryText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },

  ctaSecondary: {
    width: '100%', backgroundColor: 'transparent',
    borderRadius: 12, borderWidth: 2, borderColor: BrandColors.navy,
    paddingVertical: 15, alignItems: 'center',
  },
  ctaSecondaryText: { color: BrandColors.navy, fontSize: 15, fontWeight: '700' },

  ctaNavy: { width: '100%', backgroundColor: BrandColors.navy, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  ctaNavyText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },

  ctaSuccess: { width: '100%', backgroundColor: StatusColors.success, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  ctaSuccessText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },

  // Small inline variant (within cards, not full-width)
  ctaInline: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: BrandColors.orange, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start',
  },
  ctaInlineText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
});
```

`StatusColors` import needed alongside `BrandColors`. Note the 12px radius here is a distinct,
intentional mobile-button-specific value, not literally Core's `radius-lg`/`radius-xl` re-borrowed
from cards — see §9 for how CarrierOS's radius usage maps to Core's radius scale.

### 7.5 Mobile Card (Light Theme)

```ts
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1, borderColor: '#e8ecf0',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 1 },
    elevation: 2, // Android shadow approximation
  },
  cardLabel: {
    fontSize: 11, fontWeight: '700', color: '#aaaaaa',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10,
  },
  // Selectable option card (role cards, plan cards) — Core Card "selectable"/"selected"
  selectableCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 16, borderWidth: 2, borderColor: 'transparent' },
  selectableCardSelected: { borderColor: BrandColors.orange, backgroundColor: '#fff9f5' },
});
```

Standard mobile cards: 14px radius. Primary/hero cards: 16px radius.

---

### 7.6 DVIR Checklist Item

Pre-trip / post-trip inspection list items (mockup-10).

```ts
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#f0f2f5',
  },
  itemIcon: { fontSize: 22, width: 32, textAlign: 'center' }, // replace emoji placeholder with Material Symbol per §4
  itemName: { flex: 1, fontSize: 14, fontWeight: '600', color: BrandColors.navy, marginHorizontal: 12 },
  toggleGroup: { flexDirection: 'row', gap: 6 },
  okButtonInactive: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#e8f5e9' },
  okButtonInactiveText: { fontSize: 12, fontWeight: '700', color: '#2e7d32' },
  okButtonActive: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: StatusColors.success },
  okButtonActiveText: { fontSize: 12, fontWeight: '700', color: '#ffffff' },
  failButtonInactive: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#e0e0e0', backgroundColor: '#fafafa' },
  failButtonInactiveText: { fontSize: 12, fontWeight: '700', color: '#8898aa' },
  failButtonActive: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: StatusColors.danger },
  failButtonActiveText: { fontSize: 12, fontWeight: '700', color: '#ffffff' },

  // Progress header (above the list)
  progressHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: BrandColors.navy },
  progressCount: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  progressTrack: { flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 3, marginHorizontal: 12 },
  progressFill: { height: '100%', backgroundColor: StatusColors.success, borderRadius: 3 }, // width set dynamically via style prop

  // Signature pad
  signaturePad: {
    borderWidth: 2, borderStyle: 'dashed', borderColor: '#e0e0e0',
    borderRadius: 12, height: 120,
    alignItems: 'center', justifyContent: 'center',
  },
  signaturePadSigned: { borderStyle: 'solid', borderColor: StatusColors.success },
  signaturePadHint: { fontSize: 14, color: '#8898aa', textAlign: 'center' },
});
```

### 7.7 Maintenance Service Item & Reminder Card

Used in the truck maintenance flow (mockup-11).

```ts
const styles = StyleSheet.create({
  serviceItem: {
    backgroundColor: '#ffffff', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#e8ecf0',
    shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  serviceTitle: { fontSize: 15, fontWeight: '700', color: BrandColors.navy, marginBottom: 4 },
  serviceMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  serviceMetaText: { fontSize: 12, color: '#8898aa' },

  reminderCard: { backgroundColor: '#ffffff', borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#e8ecf0', overflow: 'hidden' },
  reminderHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f2f5',
  },
  reminderTitle: { fontSize: 14, fontWeight: '700', color: BrandColors.navy },
  reminderBody: { paddingHorizontal: 16, paddingVertical: 12 },
  reminderTrack: { height: 6, backgroundColor: '#e8ecf0', borderRadius: 3, marginTop: 8, marginBottom: 6, overflow: 'hidden' },
  reminderFill: { height: '100%', borderRadius: 3 }, // backgroundColor: StatusColors.success/warning/danger by threshold, width set dynamically
  reminderMetaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  reminderMetaText: { fontSize: 11, color: '#8898aa' },
});
```

Reminder status badge (`Due Soon` etc.) reuses the Core `StatusBadge` recipe values from §5.2
(warning pastel pair `bg #fff7e0` / `text #b37d00`), just as an RN `<View>`/`<Text>` pair with
`borderRadius: 9999`.

### 7.8 Chat Bubbles & Chat Input Bar

Driver-to-dispatcher in-app messaging (mockup-19). Light theme throughout.

```ts
const styles = StyleSheet.create({
  chatArea: { flex: 1, backgroundColor: '#f4f6f9', paddingHorizontal: 12, paddingVertical: 12, gap: 10 },
  dateDivider: { textAlign: 'center', fontSize: 10, fontWeight: '600', color: '#8898aa', textTransform: 'uppercase', letterSpacing: 0.5, paddingVertical: 4 },

  // Received message (them) — left-aligned
  bubbleReceivedWrap: { maxWidth: '80%', alignSelf: 'flex-start' },
  bubbleSenderLabel: { fontSize: 10, fontWeight: '600', color: '#8898aa', marginBottom: 2, paddingHorizontal: 4 },
  bubbleReceived: {
    backgroundColor: '#ffffff', color: BrandColors.navy,
    borderTopLeftRadius: 4, borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
    paddingHorizontal: 12, paddingVertical: 10,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  bubbleText: { fontSize: 13, lineHeight: 19 },
  bubbleTimestamp: { fontSize: 10, color: '#8898aa', marginTop: 2, paddingHorizontal: 4 },

  // Sent message (me) — right-aligned, always teal
  bubbleSentWrap: { maxWidth: '80%', alignSelf: 'flex-end' },
  bubbleSent: {
    backgroundColor: StatusColors.teal, // always teal, never orange
    borderTopLeftRadius: 16, borderTopRightRadius: 4, borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  bubbleSentText: { fontSize: 13, lineHeight: 19, color: '#ffffff' },

  // System message
  systemMessage: {
    alignSelf: 'center', textAlign: 'center', fontSize: 11, color: '#8898aa',
    backgroundColor: 'rgba(0,0,0,0.04)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6,
  },

  // Chat input bar
  inputBar: {
    backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)',
    paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0,
  },
  chatInput: {
    flex: 1, backgroundColor: '#f4f6f9', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 13, color: BrandColors.navy,
  },
  sendButton: { width: 36, height: 36, backgroundColor: StatusColors.teal, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sendButtonIcon: { color: '#ffffff', fontSize: 16 },
});
```

Bubble corner radii: received = `4/16/16/16` (top-left small); sent = `16/4/16/16` (top-right
small). Sent bubble background is always teal (`StatusColors.teal`, `#1abc9c`), never orange.

### 7.9 Fuel Stop List Item

Used in the fuel stop logging form (mockup-18). A grouped list of stops inside a rounded white
container.

```ts
const styles = StyleSheet.create({
  totalCard: {
    marginHorizontal: 12, marginBottom: 8, backgroundColor: BrandColors.navy,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  totalLabel: { fontSize: 12, color: '#8898aa' },
  totalValue: { fontSize: 18, fontWeight: '800', color: '#ffffff', textAlign: 'right' },
  totalSubValue: { fontSize: 11, color: '#8898aa', marginTop: 2, textAlign: 'right' },

  stopListGroup: { marginHorizontal: 12 },
  stopItemFirst: { backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#f4f6f9', paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  stopItemMiddle: { backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#f4f6f9', paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  stopItemLast: { backgroundColor: '#ffffff', paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  stopIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(249,115,22,0.1)', alignItems: 'center', justifyContent: 'center' },
  stopInfo: { flex: 1 },
  stopCity: { fontSize: 13, fontWeight: '700', color: BrandColors.navy },
  stopMeta: { fontSize: 11, color: '#8898aa', marginTop: 2 },
  stopCost: { fontSize: 14, fontWeight: '700', color: BrandColors.navy, textAlign: 'right' },
  stopCostPerGal: { fontSize: 10, color: '#8898aa', marginTop: 2, textAlign: 'right' },

  iftaCallout: {
    marginHorizontal: 12, marginTop: 10, backgroundColor: 'rgba(217,119,6,0.08)',
    borderWidth: 1, borderColor: 'rgba(217,119,6,0.2)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', gap: 8, alignItems: 'flex-start',
  },
  iftaCalloutText: { fontSize: 11, color: '#8a6200', lineHeight: 16 },
});
```

### 7.10 IFTA State Table Row (Mileage Log)

Used in the IFTA mileage log screen (mockup-20). A state-by-state breakdown grouped in a white
card — implement as a `FlatList`/`View` row list (no native `<table>` in RN), fixed-width columns
via `flexDirection: 'row'` + explicit `width`s standing in for the web grid-template columns.

```ts
const styles = StyleSheet.create({
  tableHeader: {
    flexDirection: 'row', backgroundColor: '#f4f6f9',
    paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  headerCellState: { width: 50, fontSize: 9, fontWeight: '700', color: '#8898aa', textTransform: 'uppercase', letterSpacing: 0.5 },
  headerCellProgress: { flex: 1, fontSize: 9, fontWeight: '700', color: '#8898aa', textTransform: 'uppercase', letterSpacing: 0.5 },
  headerCellNumeric: { width: 60, fontSize: 9, fontWeight: '700', color: '#8898aa', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'right' },

  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f4f6f9' },
  stateCode: { width: 50 },
  stateCodeText: { fontSize: 14, fontWeight: '800', color: BrandColors.navy },
  stateNameText: { fontSize: 11, color: '#8898aa', marginTop: 2 },
  miniBarWrap: { flex: 1, paddingHorizontal: 8 },
  miniBarTrack: { height: 5, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 3, overflow: 'hidden' },
  miniBarFill: { height: '100%', backgroundColor: BrandColors.orange, borderRadius: 3 }, // width set dynamically
  milesText: { width: 60, fontSize: 12, fontWeight: '700', color: BrandColors.navy, textAlign: 'right' }, // tabular-nums equivalent: use a monospace/tabular numeric font feature if available on the platform
  pctText: { width: 60, fontSize: 10, color: '#8898aa', textAlign: 'right' },

  // Quarter summary strip (above the table, navy bg, 3 equal columns)
  summaryStrip: { flexDirection: 'row', backgroundColor: BrandColors.navy, paddingHorizontal: 16, paddingVertical: 14 },
  summaryCol: { flex: 1, alignItems: 'center' },
  summaryColBordered: { flex: 1, alignItems: 'center', borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.1)' },
  summaryValue: { fontSize: 18, fontWeight: '800', color: '#ffffff' },
  summaryLabel: { fontSize: 9, color: '#8898aa', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 },
});
```

### 7.11 Mobile Notification / Alert Banner

Colored notification banners on DVIR summary and maintenance-alert screens (mockups 10, 11).
Light-theme only.

```ts
const styles = StyleSheet.create({
  bannerSuccess: { backgroundColor: '#e8f5e9', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 12 },
  bannerSuccessText: { color: '#2e7d32', fontSize: 14, fontWeight: '600' },

  bannerWarning: { backgroundColor: '#fff8e1', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 12 },
  bannerWarningText: { color: '#92400e', fontSize: 13, fontWeight: '600' },

  bannerError: { backgroundColor: '#ffebee', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 12 },
  bannerErrorText: { color: '#c62828', fontSize: 14, fontWeight: '600' },

  // Inline alert with icon + CTA (maintenance/DVIR reminder within driver home)
  inlineAlert: {
    backgroundColor: '#fef3cd', borderWidth: 1.5, borderColor: '#fde68a', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  inlineAlertIcon: { fontSize: 20 },
  inlineAlertText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#92400e' },
  inlineAlertButton: { backgroundColor: StatusColors.warning, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  inlineAlertButtonText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
});
```

### 7.12 POD / Photo Upload Zone

Proof-of-delivery photo capture (mockup-03); also used for fuel-stop receipt capture.

```ts
const styles = StyleSheet.create({
  uploadEmpty: {
    borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12, padding: 28, alignItems: 'center', gap: 10,
  },
  uploadEmptyIcon: { fontSize: 32 },
  uploadEmptyText: { fontSize: 13, color: '#8898aa', fontWeight: '600' },
  uploadEmptyHint: { fontSize: 11, color: '#64748b' },

  uploadHasPhoto: {
    borderWidth: 2, borderColor: 'rgba(22,163,74,0.4)', backgroundColor: 'rgba(22,163,74,0.06)',
    borderRadius: 12, overflow: 'hidden',
  },
  uploadThumbnailPlaceholder: { width: '100%', height: 120, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, // background: linear gradient equivalent via expo-linear-gradient if needed

  uploadComplete: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(22,163,74,0.1)', borderWidth: 1.5, borderColor: 'rgba(22,163,74,0.3)',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
  },
  uploadCompleteTitle: { fontSize: 13, fontWeight: '700', color: StatusColors.success },
  uploadCompleteSubtitle: { fontSize: 11, color: '#8898aa', marginTop: 2 },
});
```

### 7.13 Success / Confirmation Screen

Full-screen success state after a key flow (dispatching a load, completing DVIR, submitting
invoice). Seen in mockups 01, 03, 09. Two variants — this is one of the places mobile genuinely
uses both its light and dark treatment (§1.6): the "dark" variant below is mobile's OS-driven
`Colors.dark` (branded-navy), not a port of web's dark theme.

```ts
// Dark variant (Colors.dark context — e.g. success toast inside an in-progress dark screen)
const darkStyles = StyleSheet.create({
  successBanner: {
    backgroundColor: 'rgba(22,163,74,0.1)', borderWidth: 1.5, borderColor: 'rgba(22,163,74,0.35)',
    borderRadius: 8, paddingHorizontal: 16, paddingVertical: 14, alignItems: 'center',
  },
  successIcon: { fontSize: 28 },
  successTitle: { fontSize: 16, fontWeight: '800', color: '#ffffff', marginTop: 8 },
  successSubtitle: { fontSize: 12, color: '#8898aa', marginTop: 2 },
});

// Light variant (Colors.light context — signup/onboarding completion)
const lightStyles = StyleSheet.create({
  successCard: {
    backgroundColor: '#ffffff', borderRadius: 20, marginHorizontal: 20, marginTop: 24,
    paddingHorizontal: 28, paddingVertical: 28, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: 4 },
  },
  successEmoji: { fontSize: 52 }, // replace with an illustration asset, not a literal emoji, per §4
  successTitle: { fontSize: 20, fontWeight: '900', color: BrandColors.navy, marginTop: 12, marginBottom: 6 },
  successSubtitle: { fontSize: 13, color: '#8898aa', lineHeight: 21, textAlign: 'center' },
  detailBlock: { backgroundColor: '#f4f6f9', borderRadius: 12, padding: 14, marginTop: 16, width: '100%' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  detailLabel: { fontSize: 12, color: '#8898aa', fontWeight: '600' },
  detailValue: { fontSize: 12, fontWeight: '700', color: BrandColors.navy },
});
```

### 7.14 Web-only patterns — no mobile implementation yet

The following patterns exist only on desktop web today; there is no mobile screen equivalent to
convert, so no mobile syntax is given for them (fabricating one would misrepresent what's actually
built): **SegmentedControl / Filter Tab Group** (§5.9 — Pro Finance, Fleet Inventory desktop only),
**Fleet Truck Card** (§6.11 — desktop Fleet Inventory), **Pro / Light-Theme Desktop Topbar** (§6.12
— Pro-tier desktop only).

---

## 8. Spacing & Radius — CarrierOS's Applied Usage

Core §2.3 and §2.4 define the spacing and radius *scales*; this section only maps CarrierOS's
actual component usage onto those scales — it doesn't restate the scales themselves.

| Element | Value | Web (Tailwind) | Core spacing alias |
|---|---|---|---|
| Page horizontal padding | 28px | `px-7` | between `space-xl` (24px) and `space-2xl` (32px) — an unlisted half-step, same family as Core §2.3's flagged `6/10/14px` gaps |
| Page vertical padding | 24px | `py-6` | `space-xl` |
| Card inner padding | 16px 20px | `px-5 py-4` | `space-md` / between `space-lg`–`space-xl` |
| Card header padding | 14px 18px | `px-5 py-3.5` | half-step `14px` (Core §2.3 note) |
| Gap between KPI cards | 14px | `gap-3.5` | half-step `14px` |
| Gap between section cards | 16px | `gap-4` / `mb-4` | `space-md` |
| Sidebar nav item padding | 8px 12px | `px-3 py-2` | `space-xs` / `space-sm` |
| Table cell padding | 11px 12px | `py-2.5 px-3` | ~`space-sm` |
| Button padding (standard) | 6px 12px | `px-3 py-1.5` | half-step `6px` / `space-sm` |
| Button padding (small) | 4px 9px | `px-2 py-1` | ~`space-2xs`/`space-xs` |

**Radius usage → Core's radius scale (§2.4):**

| CarrierOS usage | Value | Core alias |
|---|---|---|
| Status chips/badges (always) | 9999px | `radius-full` |
| Sidebar nav items, small desktop buttons | 6px | `radius-sm` |
| Desktop compact buttons/inputs | 8px | `radius-md` |
| Mobile form inputs (all mobile screens) | 10px | `radius-input` |
| Dense dashboard cards (KPI tiles, section panels) | 12px | `radius-lg` |
| Default content card (majority case, incl. mobile standard card) | 14px | `radius-card` |
| Mobile full-width CTA buttons, hero/primary cards | 12–16px | `radius-xl`-ish — mobile buttons intentionally reuse the "prominent card" radius family, not the compact-button radius, because they're full-width touch targets, not desktop compact controls |

Icon sizing (16/18/20/24–32px) is Core §2.9 exactly — no CarrierOS override; Material Symbols
Outlined is CarrierOS's chosen library (§4).

---

## 9. Process Checklist (before marking any UI screen complete)

Most per-element rules below are Core non-negotiables (§1, §4) — restated here only as a
CarrierOS-specific pre-ship checklist, not as a second specification of them:

- [ ] No raw hex/rgb in JSX/TSX outside this doc's own recipes — if a token doesn't exist, add it to
      `globals.css` (or propose a Core role) before using it (Core §1 non-negotiable #1).
- [ ] Badges/chips are `rounded-full` only (§5.2).
- [ ] KPI values are `text-[26px] font-extrabold tracking-tight [font-variant-numeric:tabular-nums]`
      (§5.3; tabular-nums is Core §1 non-negotiable #4).
- [ ] Sidebar is `w-64` (256px), `bg-navy`, always dark regardless of theme (§1.5, §5.4).
- [ ] Icons are Material Symbols Outlined only (§4) — never emoji, never a second icon library.
- [ ] Card backgrounds use the correct current-state class: `bg-white/5` interim or
      `bg-surface-card` once Layer 3 tokens land (§1.2–§1.3) — not `bg-white`/`bg-gray-*`.
  - [ ] Mobile screens use real `StyleSheet.create` objects, not Tailwind `className` strings (§7).
- [ ] Visual diff done: mockup open side-by-side with the running app.
- [ ] New pattern introduced? Add a row to this doc's Changelog (§11) and a recipe in the matching
      section above.

---

## 10. Governance Boundary — Proposed Core Additions

Per §0 and Core's own extension rule, anything CarrierOS needs that Core's catalog doesn't support
is listed here explicitly rather than worked around locally:

1. **`StatusBadge` `purple` variant** — ~~Proposed~~ **Accepted 2026-07-22.** CarrierOS's `invoiced`
   load status uses a purple pastel pill (`--color-purple`/`--color-purple-light`), an 8th color
   role beyond Core's original 7 (`success, warning, danger, info, neutral, brand, teal`). Core's
   catalog (`ux-foundations.md` §3) now lists `purple` as an accepted 8th `StatusBadge` variant.
   Recipe in §5.2 above.

No other Core-catalog gaps were found during this migration. The three half-step spacing values
(6px/10px/14px) that CarrierOS's mockups use pervasively are already flagged by Core itself
(`ux-foundations.md` §2.3's own note) as a pending token-governance decision — not re-flagged here
as a new gap, since Core already owns tracking it.

**Also accepted in the same pass (2026-07-22):** a design-architecture review added several new
Core sections not previously covered — data-visualization palette (Core §2.10), ARIA/screen-reader
and non-color-alone accessibility rules (Core §4), internationalization & RTL mechanics (Core §5),
a layout grid system (Core §6), a destructive-action/confirmation pattern (Core §7), an expanded
`Table` state matrix (Core §3), a component deprecation policy (Core §0), and a Storybook/
visual-regression tooling recommendation (Core §9). These are Core additions, not CarrierOS
proposals — see §6.13, §6.14, and §5.5's updated note below for how CarrierOS's own patterns relate
to each.

---

## 11. Changelog

| Date | Change |
|---|---|
| 2026-07-22 | **Restructuring**: migrated all content from `design-system.md` (1576 lines, pre-Core/product-split) into this file, `carrieros-design-system.md`. `design-system.md` is now a stub pointing here and to `ux-foundations.md`. What moved to Core (`ux-foundations.md`): the four-layer token architecture explanation, the full token taxonomy (spacing/radius/shadow/motion/breakpoint/z-index scales), the component API catalog (variant/state matrices for Button/StatusBadge/Card/Input/KpiTile/Avatar/Table/Toast/Tabs/SegmentedControl/Modal/Tooltip/ProgressBar/EmptyState/Skeleton), and accessibility minimums — all previously re-explained or re-specified in `design-system.md` without attribution to any shared foundation, since no such foundation existed yet. What stayed here, unchanged in detail: every CarrierOS domain pattern (load status pipeline, exception tiers, IFTA table, fuel stop list, driver chat, DVIR checklist, Fleet Truck Card, Pro-tier light topbar, plan/pricing card, semantic color meanings, sidebar-always-dark exception) and CarrierOS's concrete brand hex values for every Core color role. What changed: (1) mobile sections rewritten from literal (non-functional) Tailwind `className` JSX into real `StyleSheet.create`-consumable object syntax, since `carrieros-mobile` uses plain RN StyleSheet, not NativeWind; (2) the mobile light/dark theme stance, previously left implicit (and contradicted by an old table label implying mobile was light-only forever), resolved explicitly — mobile supports light+dark (OS-driven), intentionally different from web's dark theme, not a bug; (3) a canonical-token-source section added, naming `globals.css` as canonical over `theme.ts` and documenting the manual-sync process, since no generation tooling exists; (4) a "Known Gaps for Code to Fix" section added, surfacing stale `docs/design/design-tokens.md` references in code comments without silently fixing them; (5) one proposed Core addition surfaced (`StatusBadge` `purple` variant) rather than worked around locally; (6) the old "Conflicts & Resolutions" audit table removed — every conflict it tracked was already absorbed into `ux-foundations.md`'s own token scale and Changelog during Stage 1 validation, so re-listing them here would be a second, now-redundant copy. |
| 2026-07-22 | **Real `components/ui/` library built** (in `carrieros-web`): `Button.tsx`, `StatusBadge.tsx`, `Card.tsx` (+ `CardHeader`/`CardBody`), `Input.tsx`, `KpiTile.tsx`, `Avatar.tsx`, `Table.tsx` (+ `TableHeaderCell`/`TableRow`/`TableCell`), `ProgressBar.tsx`, `Tabs.tsx`, `SegmentedControl.tsx`, `Modal.tsx` (focus trap + return-focus-on-close + a `confirm-destructive` variant requiring a typed confirmation phrase, per Core §7), `Tooltip.tsx`, `Toast.tsx` (`role="status"`/`"alert"` per severity, per Core §4), `EmptyState.tsx`, `Skeleton.tsx`, plus an `index.ts` barrel — implementing Core §3's full component catalog against this doc's §5 recipes. The Layer 3 semantic token block (§1.2) was added to `globals.css` in the same pass, making `bg-surface-card`/`text-text-pri`/etc. real Tailwind utilities (§3's "Known Gaps" updated accordingly). Originated a real `secondary` (outline) `Button` recipe — §5.1 previously had none, only `ghost`. Flagged (not fixed) a token-naming inconsistency in `lib/domain/load-status.ts`'s `loadStatusColor()`, which uses raw Tailwind palette-color classes instead of this project's semantic status tokens — see §3. Existing pages were deliberately **not** migrated to the new components in this pass (incremental adoption, same posture as `docs/architecture-principles.md` Rule B). |
| 2026-07-22 | **Core sync**: `ux-foundations.md` bumped to v1.1 after a design-architecture gap review (data-viz palette §2.10, ARIA/non-color-alone accessibility rules §4, i18n/RTL mechanics §5, layout grid §6, destructive-action pattern §7, expanded `Table` matrix §3, deprecation policy §0, Storybook/visual-regression recommendation §9). This doc synced: accepted the proposed `purple` `StatusBadge` variant (§5.2, §10) now that Core lists it; added §6.13 (CarrierOS's RTL locale is Urdu) and §6.14 (the Suspend action needs Core §7's confirm-modal, not a single click) as CarrierOS's concrete application of the new Core patterns; flagged the `Table` section (§5.5) and `HealthBar` section (§5.8) with known gaps against Core's new matrix/data-viz sections rather than silently adopting them. |
| 2026-07-23 | **Component-library adoption gap found and partially closed.** The new `app/(admin)/admin/**` SuperAdmin UI (Phase 8) shipped its first draft using the exact ad-hoc pattern this doc's §9 checklist exists to prevent — `bg-white/5 border border-white/8 rounded-xl shadow-card-dark` hand-rolled on every page instead of `Card`/`KpiTile`/`StatusBadge`/`Table`/`Button` from `components/ui/`. Retrofitted all 7 admin pages + the org-detail drilldown to use the real component library and the canonical Triage severity mapping (§6.2/§6.3: critical→danger/`border-l-danger`, high→brand/`border-l-brand-orange`, medium→warning/`border-l-warning`, low→info/`border-l-info`) instead of raw hex borders. **Also found while fixing this**: `components/ui/*`'s semantic tokens (`bg-surface-card`, `text-text-pri`, etc.) were dead code — §1.4's documented theme-switching mechanism (`profiles.theme_preference` → `<html className={theme === 'dark' ? 'dark' : ''}>`) was never actually built (no such column/settings UI exists anywhere), so nothing ever applied `.dark` and the semantic layer's dark-mode override never activated. Fixed by hardcoding `dark` on `<html>` in `app/layout.tsx` (a real toggle is future work, not built here) — zero effect on the rest of the app, which hardcodes dark literal colors directly rather than using semantic tokens at all. **Scope note, not silently fixed**: `components/ui/*` adoption elsewhere in `carrieros-web` remains at effectively zero (only `StatusBadge` was migrated, in the two `Wave 1`/`Wave 2` passes noted above, restricted to badges — `Card`/`KpiTile`/`Table`/`Button` were never adopted anywhere else). A full-app migration is a large separate effort, not attempted in this pass. **New guard added**: `eslint.config.mjs`'s `adminCardPatternGuard` — a `no-restricted-syntax` rule scoped to `app/(admin)/**/*.tsx` that errors on the same literal patterns (`shadow-card-dark`, `bg-white/(5|7)`, `border-white/(5|8|10)`) in any `className`, so this doc's own guidance can't silently regress again on this surface (having the doc alone did not prevent the regression it just describes). Not applied repo-wide — see the scope note above. **Also found and fixed while verifying this end-to-end**: `proxy.ts`'s `ROLE_ROUTES` never guarded `/dashboard` itself, so an `sx_owner` login (which always redirects to `/dashboard` and relies on middleware to bounce onward) fell through with no matching prefix and landed on `dashboard/page.tsx`'s "no dashboard view built for this role" placeholder instead of `/admin` — no data exposure (that placeholder is role-agnostic), but a broken landing page. Added `/dashboard` to `ROLE_ROUTES` restricted to the five tenant roles. |

| 2026-07-23 | **Guard generalized into a ratchet, plus a real enforcement gate wired in.** The prior entry's `adminCardPatternGuard` (error-only, `app/(admin)/**` only) is now `uiComponentPatternGuardWarn`/`uiComponentPatternGuardError` in `eslint.config.mjs`: `warn` fires repo-wide (surfacing the pre-existing ad hoc-Tailwind debt across `app/(app)/**` without breaking the build), `error` fires for surfaces listed in `ERROR_SURFACES` (currently just `app/(admin)/**`) — add a surface's glob there once it's actually migrated, to lock the regression out for good instead of leaving it at `warn` forever. This lint guard, plus a new `carrieros-web/scripts/check-architecture.mjs` enforcing `docs/architecture-principles.md`'s Rule B/D/G decoupling boundaries, are now wired into a versioned pre-commit hook (`scripts/git-hooks/`, see `CLAUDE.md`'s "Gated checks" section) — this repo has no CI, so the git hook is the actual enforcement surface, not just another doc. |

| 2026-07-23 | **Wave 3 — the `app/(app)/**` retrofit, closing out the near-zero-adoption gap the two entries above left open.** All 6 highest-traffic tenant-app directories (`dashboard`, `invoices`, `drivers`, `loads`, `customers`, `vehicles` — 35 files) migrated onto `Card`/`CardHeader`/`CardBody`/`KpiTile`/`Table`/`ProgressBar`/`Modal`/`Input`/`Button`/`EmptyState`/`Avatar`, replacing the 392 hand-rolled-Tailwind hits found in the pre-migration scope pass. `StatusBadge` usage from the earlier Wave 1/2 passes was left untouched throughout. Bespoke pickers (vehicle-type icon grid, cab-type/color swatches in `AddVehicleButton.tsx`) kept their custom markup — only the banned literal classes were swapped to semantic tokens, per the same exception already established for the CDL-badge markup in `drivers/**`. **Verified end-to-end**: `tsc --noEmit` clean, full Vitest suite (42 tests) green, full-repo `eslint` dropped from the 392-hit/206-warning pre-wave baseline to 76 warnings (mostly `react-hooks/set-state-in-effect` pre-existing debt unrelated to this pass) with zero new errors, and a live browser walkthrough (dashboard, loads list + detail, drivers list + detail, customers list, vehicles list + detail incl. the Maintenance tab's `ProgressBar`) confirmed correct rendering plus a real write (creating and deleting a test customer through the retrofitted `AddCustomerButton` Modal) still works. All 6 globs added to `eslint.config.mjs`'s `ERROR_SURFACES`, so this can't silently regress. **Deferred, not attempted this pass** (lower traffic, smaller footprint): `maintenance`, `team`, `billing`, `settlements`, `dispatch`, `exceptions`, `settings` — a smaller Wave 4 candidate for later. |

| 2026-07-23 | **Wave 4 — the remaining 7 `app/(app)/**` directories, closing the adoption gap completely.** After Wave 3, the 7 smaller/lower-traffic directories (`maintenance`, `team`, `billing`, `settlements`, `dispatch`, `exceptions`, `settings` — 16 files) were initially framed as "deferred, a candidate for later." The user corrected this directly: "why is anything deferred? its all AI and i have time to fix all in my local machine. do not make any defer choices by yourself" — there was no real technical reason to leave them unmigrated, only an unrequested judgment call about priority. All 7 were retrofitted in the same session onto `Card`/`CardHeader`/`CardBody`/`Table`/`StatusBadge`/`EmptyState`/`Modal`/`Input`/`Button`/`SegmentedControl`/`ProgressBar`, same posture as Wave 3 (bespoke pickers keep custom markup, banned literals swapped to semantic tokens; the exceptions inbox's "all clear" icon was deliberately kept success-green rather than using `EmptyState`'s default muted icon, to preserve the §6.2 semantic color mapping). **Verified end-to-end**: `tsc --noEmit` clean, full Vitest suite (42 tests) green, full-repo `eslint` dropped from Wave 3's 76-warning baseline to 37 warnings with zero new errors, zero violations across all 7 newly-migrated globs, and a live browser walkthrough (maintenance, team, billing, settlements' tier-gated empty state, dispatch's tier-gated empty state, exceptions' all-clear state, settings) confirmed correct rendering plus a real write (saving profile settings) still works. All 7 globs added to `ERROR_SURFACES` — all 13 `app/(app)/**` directories are now in `ERROR_SURFACES`; the `components/ui/*` adoption sweep across the whole tenant app is complete (aside from the query-encapsulation and DTO-boundary work tracked separately under Rule B/C in `architecture-principles.md`). |

| 2026-07-24 | **Raw-hex color sweep — a real blind spot the `no-restricted-syntax` guard never covered.** A four-part audit (design/architecture/features/deployability) found 50 files using raw hex colors (`bg-[#f97316]`, `color: '#16a34a'`, etc.) instead of `@theme` tokens — including files already in `ERROR_SURFACES`, since the guard only ever matched specific banned literal Tailwind fragments (`bg-white/5` etc.), never hex. Fixed: added `--color-brand-orange-hover`/`--color-teal-hover` (previously-untokenized hover states, ~26 files), plus four genuinely new semantic tokens after user confirmation — `brand-blue`/`brand-blue-dark` (dashboard KPI icons + vehicle banner gradient, distinct from the darker `info` blue), `slate`/`slate-light`/`slate-dark` (dashboard icon neutrals, distinct from `navy-muted`'s blue cast), `score-warning`/`score-critical` (customer health-score gauge's own 3-tier palette), and a `vehicle-inshop-dark` gradient endpoint. New `lib/design-tokens.ts` holds the same hex values as plain exported constants for the handful of call sites that need a literal string at runtime (the dashboard cards' `` `${color}20` `` hex-alpha-suffix trick, which can't take a Tailwind class or a `var(--color-*)` reference) — documented as a deliberate, narrow exception, not a second source of truth. Left alone, on purpose: `AddVehicleButton.tsx`'s `hex: '#f8fafc'`/`'#0f172a'` vehicle-paint-color picker data (real domain data, not UI styling); `components/ui/Avatar.tsx`'s extra variant colors and two `hover:text-[#fb923c]` instances (a shade with no matching token, not part of the confirmed decisions this pass). **The guard itself was extended**, not just the violations fixed: a new hex-literal selector (className arbitrary-value hex + `color`/`backgroundColor`/`borderColor` style-prop hex) was added to the same ratchet, and the rule's `files` glob was widened from `app/**/*.tsx`-only to include `components/**/*.tsx` — component files had been entirely unguarded by this rule at any severity until now. **Verified**: `tsc --noEmit` clean, full-repo `eslint` shows 0 hex-rule violations on any `ERROR_SURFACES` file, only 2 residual warnings repo-wide (both the deferred `#fb923c` case), live browser check (dashboard, loads list, login) confirmed correct rendering post-substitution. |

| 2026-07-24 | **Rule B query-encapsulation debt — `profiles` closed out, `loads`/`drivers` substantially reduced.** `check-architecture.mjs`'s `query-encapsulation-{profiles,loads,drivers}` warn-count (86 combined at scoping time) is a Rule B tracking metric, not a UI-token one, but follows the same ratchet posture as `ERROR_SURFACES` above. `profiles`: all ~39 remaining ad hoc `.from('profiles')` call sites migrated onto `lib/queries/profiles.ts` (widened with `getOrgOwnerOrSolo`, and `insertProfile`/`updateProfilePreferences`/`upsertProfile` wired into every remaining invite/onboarding/settings call site) — **0 violations**, so the script's per-table severity was restructured from one shared `warn` loop into a `QUERY_ENCAPSULATION_SEVERITY` config object and `profiles` tightened to `error`, gating it for good. `loads`/`drivers`: `lib/queries/loads.ts`/`drivers.ts` gained several new/widened shared functions (`getLoadForOrg`, `listLoadIdsAndStatusForOrg`, `getActiveLoadForDriver`, widened `getDriverIdForProfile`/`listActiveDriversForOrg`/`listDriverIdsForOrgs`) and 33→13 / 16→4 call sites migrated; both stay `warn` — the remainder are one-off shapes (finance lane-analytics, CSV export projection, settlement date-range calcs, admin date-filtered counts) matching each file's own "don't over-abstract a single caller" header comment, not remaining debt to chase. **Verified**: `tsc --noEmit` clean, full-repo `eslint` shows no new errors/warnings on any touched file (pre-existing unrelated errors in `app/(admin)/**` pages and `Modal.tsx`/`LanguageSwitcher.tsx` untouched by this pass), `check-architecture.mjs` exits 0. |

_When a new mockup or screen introduces a new CarrierOS-specific component pattern, add a recipe in
the matching section above and a row here. If it needs a new Core-level token/component, add a
Proposed Core Addition callout (§10) instead of a local workaround._
