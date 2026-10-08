# UX Foundations — Company Design System Core

_Status: v1.1 — drafted 2026-07-22, extended 2026-07-22 (data-visualization palette conventions,
ARIA/screen-reader and non-color-alone accessibility rules, internationalization & RTL mechanics, a
layout grid system, a destructive-action/confirmation pattern, an expanded `Table` state matrix, a
component deprecation policy, a Storybook/visual-regression tooling recommendation, and an accepted
8th `StatusBadge` variant proposed by CarrierOS). This is the CORE layer: product-agnostic, reusable
by every product this company builds. It contains no CarrierOS-specific content — no vehicle icons,
no load-status semantics, no domain components. CarrierOS's own patterns live in
`carrieros-design-system.md`, which extends this document._

---

## 0. Purpose & Governance

**What this is.** The single source of truth for design mechanics shared across every product: token
taxonomy, theming architecture, the component API catalog, accessibility minimums, and the
multi-platform delivery mechanism. A new product does not re-derive these — it supplies its own brand
theme (color values, font family, logo) and writes its own product-specific document for
domain-specific components, both referencing this file.

**Ownership.** This file is owned by whoever holds the "design system" role company-wide (not by any
one product team). Changes here affect every product using this foundation.

**Versioning.** This file is versioned independently of any product doc. A **breaking change** (renaming
a token, changing a component's required props, removing a variant) requires a major version bump and
an explicit migration note in the Changelog, since downstream products depend on the exact names
defined here. A **non-breaking addition** (a new component, a new optional variant, a new token) is a
minor bump.

**Token naming convention.** Every token name follows `{category}-{role}[-{variant}][-{state}]`, all
kebab-case, no abbreviations that aren't already standard (`btn` and `sec` are not standard; `button`
and `secondary` are). Examples: `color-surface-card`, `color-text-secondary`, `space-lg`,
`radius-md`, `shadow-level-2`, `motion-duration-fast`. Do not invent a new naming shape for a new
category — extend the existing pattern.

**Extension rule for product-specific docs.** A product doc may:
- Add new components/patterns unique to its domain (e.g. CarrierOS's vehicle-type icon set, load
  pipeline, CDL card).
- Supply concrete values for the tokens this document defines only as roles (its brand color palette,
  font family, logo).

A product doc may **not**:
- Redefine a Core component's required props or state matrix.
- Introduce a second naming convention for tokens.
- Hardcode a raw color/spacing/shadow value in a component recipe where a Core token exists for that
  role — if the product needs a value Core doesn't have a role for, propose adding the role to Core
  first, don't invent a local one-off.

**Deprecation policy.** The versioning rule above says what counts as a breaking change; this is the
*process* for retiring something rather than just bumping a number. A deprecated token, component, or
variant is marked `@deprecated` at its source (the token definition, or the component's prop/variant
declaration) with the exact replacement named inline — never a bare "don't use this" with no
alternative. It remains fully functional for at least one full minor-version cycle: never removed in
the same release as the deprecation notice, so downstream products have a real window to migrate.
Every deprecated item is listed in the running "Deprecated — scheduled for removal" table in the
Changelog (§10) until it's actually deleted at a major version bump — at which point its row moves
from that table into the breaking-change Changelog entry that removes it.

---

## 1. Token Architecture (the mechanics — non-negotiable for every product)

### Four layers

1. **Brand/theme values** (product-supplied) — the actual hex codes, font family, and logo for one
   product's brand. Not defined in this document.
2. **Palette tokens** (generated from Layer 1) — raw named colors with no meaning attached (e.g. a
   product's `orange-500`). Never referenced directly by components.
3. **Semantic tokens** (generated from Layer 2, switch value per theme) — meaning-carrying names like
   `color-surface-page`, `color-text-primary`, `color-status-danger`. **Components only ever reference
   Layer 3 (semantic tokens) or Layer 4 (component tokens) — never Layer 1 or 2 directly, and never a
   raw hex value.**
4. **Component tokens** (optional, generated from Layer 3) — component-scoped aliases for cases where
   a component needs a distinct value from the general semantic role (e.g. `button-primary-bg` might
   alias `color-brand-primary` today but could diverge later without touching every button call site).

### Theming mechanism

Light/dark/system (and any future theme) is implemented **entirely at Layer 3** — the semantic token
*values* change per theme; the *names* components reference never change. Theme switching is a single
attribute/class toggle at the root (e.g. `<html data-theme="dark">` on web; the RN equivalent resolves
the same semantic token set from a theme context). No component should ever contain conditional
"if dark theme, use X" logic — that logic belongs entirely in how Layer 3 tokens resolve.

### Single source of truth — required, not optional

Every token in Layers 2–4 must originate from **one canonical file** (JSON or TS), not be
hand-duplicated across platforms. A generation step produces:
- Web: CSS custom properties + Tailwind `@theme` registration.
- Mobile (React Native): a theme object/context (`theme.ts` or equivalent) — RN cannot consume CSS
  custom properties or Tailwind classes directly, so this is a real second output, not a copy-paste of
  the web file.
- Any future platform (a second web app, a native app, an admin tool) generates from the same source.

If tooling for this (e.g. Style Dictionary) isn't set up yet for a given product, the product's own
doc must state which file is canonical and which are generated/derived, and a process for keeping them
in sync until real generation tooling exists. **Two hand-maintained files that "happen to agree" is
the failure mode this rule exists to prevent** — it was already found once in this company's first
product.

### Non-negotiables (apply to every product's implementation)

1. No raw hex/rgb value in component/page code. If a token doesn't exist for the needed role, add the
   role to Layer 3 first.
2. No conditional theme logic inside components — theme resolution lives in the token layer only.
3. Every interactive element has a defined focus-visible state (see §4 Accessibility).
4. Every numeric/monetary display value uses tabular figures (`font-variant-numeric: tabular-nums` on
   web; the RN equivalent numeric font feature).
5. Every recurring UI element is a named, reusable component (§3) — never a copy-pasted class-string
   recipe duplicated across pages/screens.

---

## 2. Token Taxonomy

Concrete values below are given where they're genuinely platform/brand-independent (spacing, type
ramp *ratios*, motion, breakpoints, z-index, radius scale, icon sizes). Color is defined only as
**roles** — each product supplies its own brand values for these roles.

### 2.1 Color roles (values supplied per-product)

| Role | Purpose |
|---|---|
| `color-brand-primary` | The product's primary brand/CTA color |
| `color-brand-secondary` | Optional secondary brand accent |
| `color-surface-page` | Page/app background |
| `color-surface-card` | Card/panel background |
| `color-surface-subtle` | Recessed/nested surface (e.g. inside a card) |
| `color-surface-input` | Form field background |
| `color-surface-overlay` | Modal backdrop |
| `color-border` | Default border |
| `color-divider` | Internal separator (lighter than border) |
| `color-text-primary` | Primary text |
| `color-text-secondary` | Secondary/label text |
| `color-text-muted` | De-emphasized/meta text |
| `color-text-disabled` | Disabled-state text |
| `color-text-on-brand` | Text on top of a brand-colored surface (usually white or near-white) |
| `color-status-success` | Success/healthy/complete |
| `color-status-warning` | Warning/due-soon/approaching threshold |
| `color-status-danger` | Error/broken/overdue/critical |
| `color-status-info` | Informational/neutral-positive/upcoming |
| `color-status-neutral` | Inactive/unassigned/unknown |

Every status role additionally needs `-light`/`-dark` or `-bg`/`-fg` pairs for badge treatments (a
pastel background + a readable foreground), generated from the same role, not separately invented per
component. **Semantic meaning is Core; the exact hex is product-supplied** — but the *meaning* of each
role (what "danger" means, when to use "warning" vs "info") is fixed here and should not be
reinterpreted per product.

### 2.2 Typography scale

A role-based ramp — every product supplies its own `font-family-base` (and optional
`font-family-mono` for codes/IDs), but the size/weight/line-height ratios below are the shared scale:

| Role | Size | Weight | Line-height | Use |
|---|---|---|---|---|
| `display` | 32px | 800 (extrabold) | 1.2 | Hero numbers, marketing headlines |
| `heading-1` | 26px | 800 | 1.25 | KPI values, page-level emphasis |
| `heading-2` | 20px | 700 | 1.3 | Section titles |
| `heading-3` | 16px | 700 | 1.4 | Card titles, sub-sections |
| `body-lg` | 15px | 400 | 1.5 | Primary reading text, form inputs |
| `body` | 13px | 400 | 1.5 | Default UI text |
| `body-sm` | 12px | 400 | 1.45 | Secondary/meta text |
| `caption` | 11px | 500 | 1.4 | Timestamps, fine print |
| `overline` | 10px | 700 | 1.3 | Uppercase eyebrow/section labels, `tracking: 0.08em` |

### 2.3 Spacing scale

Base unit 4px. Use the semantic aliases in component specs, not raw step numbers, so a future
re-tuning of the scale doesn't require touching every component:

| Alias | Value |
|---|---|
| `space-3xs` | 2px |
| `space-2xs` | 4px |
| `space-xs` | 8px |
| `space-sm` | 12px |
| `space-md` | 16px |
| `space-lg` | 20px |
| `space-xl` | 24px |
| `space-2xl` | 32px |
| `space-3xl` | 48px |
| `space-4xl` | 64px |

**Note (validated against mockups 2026-07-22):** the 23 mockups also make heavy, deliberate use of
three intermediate "half-step" values not in the table above — `6px`, `10px`, and `14px` — for
finer-grained padding/gap tuning (button padding, table-cell padding, card-header padding, KPI-grid
gaps). Frequency is comparable to or higher than several already-listed steps (e.g. `gap:10px` appears
more often than `gap:16px` or `gap:20px` across the mockups). These are real and recurring, not
one-off outliers, but naming three new rungs is a token-governance decision outside this validation
pass's scope — flagging here so a future revision can decide whether to add named aliases or keep
them as documented component-level exceptions (as `design-system.md` already does).

### 2.4 Radius scale

| Alias | Value | Use |
|---|---|---|
| `radius-xs` | 4px | Small chips, table-cell inner elements |
| `radius-sm` | 6px | Nav items, small buttons |
| `radius-md` | 8px | Compact controls — dense buttons, callouts, desktop search/filter inputs |
| `radius-input` | 10px | Native form inputs (all mobile screens) and compact stat/mini-KPI tiles |
| `radius-lg` | 12px | Dense dashboard cards — KPI tiles, section panels, list-row cards (desktop) |
| `radius-card` | 14px | Default content card — the majority-case card radius across the mockups |
| `radius-xl` | 16px | Prominent/hero cards |
| `radius-full` | 9999px | Pills, badges, avatars — always, no exceptions |

### 2.5 Shadow / elevation scale

Named by elevation *level*, not by use-case — a product's theme supplies the concrete
`rgba(...)`/blur/spread per level, per light/dark:

| Level | Use |
|---|---|
| `elevation-0` | Flat, no shadow |
| `elevation-1` | Resting card |
| `elevation-2` | Hover / dropdown |
| `elevation-3` | Modal / dialog |
| `elevation-4` | Toast / maximum-prominence overlay |

Plus optional **glow** variants (`glow-success`, `glow-warning`, `glow-danger`) for status-indicator
emphasis (e.g. an expiring-document ring), generated from the matching status color.

### 2.6 Motion tokens

| Token | Value |
|---|---|
| `motion-duration-instant` | 100ms |
| `motion-duration-fast` | 150ms |
| `motion-duration-base` | 200ms |
| `motion-duration-slow` | 300ms |
| `motion-easing-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| `motion-easing-decelerate` | `cubic-bezier(0, 0, 0.2, 1)` (entrances) |
| `motion-easing-accelerate` | `cubic-bezier(0.4, 0, 1, 1)` (exits) |

**Rule:** hover/focus color and background transitions use `motion-duration-base` +
`motion-easing-standard`. Modal/toast entrances use `motion-duration-slow` + `motion-easing-decelerate`;
exits use `motion-duration-fast` + `motion-easing-accelerate`. Respect
`prefers-reduced-motion` — disable non-essential transitions/animations when set.

### 2.7 Breakpoints

| Name | Min-width |
|---|---|
| `sm` | 640px |
| `md` | 768px |
| `lg` | 1024px |
| `xl` | 1280px |
| `2xl` | 1536px |

### 2.8 Z-index scale

| Layer | Value |
|---|---|
| `z-base` | 0 |
| `z-dropdown` | 1000 |
| `z-sticky` | 1100 |
| `z-overlay` | 1200 |
| `z-modal` | 1300 |
| `z-toast` | 1400 |
| `z-tooltip` | 1500 |

### 2.9 Icon sizing

| Context | Size |
|---|---|
| Inline (within text/rows) | 16px |
| Nav item | 18px |
| Alert / status | 20px |
| Hero / empty-state | 24–32px |

Icon library choice (e.g. Material Symbols Outlined) is a product-layer decision — Core only fixes
the size scale and the rule that one icon library is used consistently, with clearly scoped exceptions
(a product may document a custom illustrated icon set for specific domain categories, same pattern
CarrierOS already uses for vehicle types/maintenance).

### 2.10 Data Visualization Palette

Future chart/sparkline work (e.g. multiple carriers or lanes plotted on one chart) needs a stable,
documented color-assignment convention now, before any chart ships — not invented ad hoc per chart.
This section governs **category-to-color** and **magnitude-to-color** mapping only. The
threshold-driven success/warning/danger fill already used by `ProgressBar`/`HealthBar` (§3) for a
single metric like a health-score ring is unchanged and is not a data-viz palette concern.

**Categorical palette** — for distinguishing N unrelated series on one chart (e.g. Carrier A vs.
Carrier B vs. Carrier C, or multiple lanes). Reuse existing roles already defined in §2.1, in this
fixed order — do not invent new hex values Core doesn't already have a role for:

| Order | Role reused |
|---|---|
| 1 | `color-brand-primary` |
| 2 | `color-status-info` |
| 3 | `color-status-success` |
| 4 | `color-brand-secondary` |
| 5 | `color-status-warning` |
| 6 | `color-status-neutral` (neutral gray) |
| 7 | the teal-equivalent role (backs `StatusBadge`'s `teal` variant, §3) |
| 8 | the purple-equivalent role (backs `StatusBadge`'s `purple` variant, §3) |

**Rule:** category-to-color mapping is fixed and documented, so the same entity gets the same color
across every chart in the product — slot 3 is always `color-status-success`, whether it's "Carrier B"
on one chart or "Lane 4" on another. Never assign arbitrary or random colors per data series, and
never reorder the table above per chart to make a specific value visually stand out — decide once
which entity occupies which slot, and keep it consistent everywhere that entity appears in a chart.

**Sequential palette** — for a single metric's magnitude (e.g. a heatmap or density chart). A single
hue, typically `color-brand-primary` or `color-status-info`, ramped by lightness only, 3–5 steps,
light-to-dark mapping to low-to-high magnitude. Do not mix hues within one sequential ramp — mixing
hues turns it into a categorical palette and breaks the light-to-dark reading order a sequential
palette depends on.

---

## 3. Component API Catalog

Every entry below is a **named component with a defined variant/state matrix** — not a class-string
recipe to copy-paste. Implementations (web JSX/Tailwind, RN StyleSheet/NativeWind) reference semantic
tokens only (§2.1–2.9), never raw values. Each product's implementation lives in its own codebase
(e.g. `components/ui/` in a web app), generated/maintained against this spec.

| Component | Variants | Sizes | States |
|---|---|---|---|
| `Button` | primary, secondary (outline), ghost, danger, success | sm, md | default, hover, focus, active, disabled, loading |
| `StatusBadge` | success, warning, danger, info, neutral, brand, teal (special/in-progress program state), purple (special/secondary program state — e.g. CarrierOS's `invoiced` load status) | sm, md | default only (badges don't have interactive states unless dismissible) |
| `Card` | standard, interactive (clickable row), selectable (single-choice option card) | — | default, hover (interactive only), focus (interactive only), selected (selectable only) |
| `Input` (text/select/textarea) | — | sm, md | default, focus, error, disabled, readonly |
| `KpiTile` | — | — | default, loading (skeleton) |
| `Avatar` | circle (user), rounded-square (org) | sm, md, lg | default; color assigned consistently per entity, not per-render random |
| `Table` | — | — | default row, hover row, sorted-column header, bulk-select (leading checkbox column active), sticky header |
| `Toast` | success, warning, danger, info | — | entering, visible, exiting |
| `Tabs` (page-level underline) | — | — | default, active, focus |
| `SegmentedControl` | — | — | default, active |
| `Modal` / `Dialog` | sm, md, lg (width) | — | entering, visible, exiting |
| `Tooltip` | — | — | entering, visible, exiting |
| `ProgressBar` / `HealthBar` | success, warning, danger (fill color by threshold) | — | default |
| `EmptyState` | — | — | default (icon/illustration + message + optional CTA) |
| `Skeleton` (loading placeholder) | text, block, avatar | — | pulsing animation using `motion-duration-slow` |

**`Table` specifics** (a real, common SaaS data-table need this product hits immediately — loads,
invoices, drivers, customers lists):
- **Pagination:** page-based (previous/next or numbered pages, plus a page-size control) is the
  default for data tables. Infinite scroll is a legitimate per-product exception, not the default —
  a product doc that uses it must say so explicitly rather than silently diverging.
- **Bulk-select:** a leading checkbox column, plus a contextual bulk-action bar that appears once ≥1
  row is selected (replacing or overlaying the table's default toolbar for the duration of the
  selection).
- **Sticky header:** the header row stays visible on vertical scroll *within the table's own scroll
  container* — not a page-level sticky, which behaves differently and can conflict with page-level
  navigation chrome.
- **Responsive collapse:** below a defined breakpoint (§2.7 — typically `md`), a data table becomes a
  stacked card list, one card per row, label:value pairs — not a horizontally-scrolled, shrunken
  version of the same table.

**Every component must be reachable from one canonical import location per app** (e.g.
`components/ui/*` in web, an equivalent shared folder in mobile) — not redefined inline per page. A
page/screen that needs a badge imports `StatusBadge`; it does not construct its own
`<span className="...">`.

---

## 4. Accessibility Requirements (non-negotiable, every product)

- **Contrast:** WCAG AA minimum — 4.5:1 for normal text, 3:1 for large text (≥18px, or ≥14px bold) and
  for UI component boundaries/icons. Verify against both light and dark theme values, not just one.
- **Focus visibility:** every interactive element has a visible focus state (a ring or outline using a
  dedicated `color-focus-ring` semantic token) — never `outline: none` without a replacement.
- **Touch targets:** minimum 44×44px (iOS HIG) / 44×44dp equivalent on Android, for any tappable
  element on mobile — non-negotiable for a driver-facing or field-use product.
- **Reduced motion:** respect `prefers-reduced-motion` — non-essential transitions/animations are
  disabled or shortened to `motion-duration-instant` when set.
- **Keyboard navigation:** every interactive element on web is reachable and operable via keyboard
  alone, in a logical tab order.
- **Screen reader / ARIA baseline:** every icon-only interactive element (a button with only an icon,
  no visible text) has an `aria-label` or equivalent; every `Toast` (§3) announces via an ARIA live
  region, per severity — `role="status"` for success/info, `role="alert"` for danger/warning; every
  `Modal`/`Dialog` (§3) traps focus while open and returns focus to the triggering element on close; a
  decorative icon that duplicates adjacent visible text is `aria-hidden="true"`, not narrated a second
  time by the screen reader.
- **Never color alone:** any UI element whose sole differentiator is color — status badges, health
  bars, chart series (§2.10), alert severity — must also carry a non-color signal: a text label, an
  icon, or a pattern. Relying on hue alone fails WCAG 1.4.1 and fails color-blind users outright, not
  just low-vision users. Color is the *fast visual scan* signal; text/icon is the *accessible*
  signal — pairing them is a product doc's component-recipe job (not Core's, since Core doesn't
  specify per-product copy), but every product must do it. This is a genuine current gap: the whole
  `StatusBadge`/severity-tier system as shipped today is color-led.

---

## 5. Internationalization & RTL

This system already ships RTL in production (a right-to-left language, per CarrierOS's product doc)
— Core states the platform-agnostic mechanics once here, since every future product will also need
i18n, not just the one that shipped it first.

- **Text growth, not truncation.** Never bake a fixed-width container into a component on the
  assumption of LTR-length text. Some languages run 30–40% longer than English for the same meaning —
  components (buttons, labels, table cells, nav items) must accommodate text growth (wrap, resize, or
  scroll) rather than truncate by default.
- **Logical properties, not physical ones.** RTL mirroring is automatic for anything built with CSS
  logical properties (`margin-inline-start`/`-end`, `padding-inline-start`/`-end`,
  `inset-inline-start`/`-end`) instead of physical ones (`margin-left`, `padding-right`,
  `left`/`right`) — or the RN equivalent (`start`/`end` instead of `left`/`right`, built
  `I18nManager`-aware). Build components with logical/directional-agnostic properties from the start;
  retrofitting RTL onto a physical-property component after the fact is the expensive path, and the
  one Core wants every product to skip.
- **Icon mirroring is selective, not automatic.** Icons that convey directionality (back/forward
  chevrons, arrows, "next/previous") must mirror in RTL. Icons that don't encode direction (a truck, a
  checkmark, a status dot) must not mirror — mirroring a symmetric or non-directional icon is either a
  no-op or actively wrong.
- **Numerals, dates, and currency follow the locale, not the layout direction.** These are a
  locale/data-layer concern (`Intl.NumberFormat`/`Intl.DateTimeFormat` or the platform equivalent), not
  a token/theming concern — an RTL layout does not imply RTL-formatted numerals (many RTL locales still
  read digits left-to-right within an RTL sentence). Don't conflate direction-of-layout with
  locale-of-formatting; they're solved independently, by different layers.

---

## 6. Layout Grid System

Core defines breakpoints (§2.7) but, until now, not a shared column/container system — every product
was left to invent this per page.

- **Columns:** a 12-column responsive grid, with a `space-xl` (24px) gutter (§2.3) by default between
  columns.
- **Container max-width:** a `content-max-width` token role, so a product doesn't invent this per page
  — a comfortable reading/dashboard max-width (roughly 1440–1600px) on very large viewports, full-bleed
  below that width.
- **Dense layouts may go full-bleed.** KPI grids, data tables (§3 `Table`), and other dense dashboard
  layouts may reasonably ignore `content-max-width` and run full-bleed within the app shell — that's a
  legitimate product-layer layout choice, not a Core violation. What Core actually owns, and what
  products shouldn't reinvent, is the **column count and gutter** (12 columns, `space-xl` gutter) — the
  shared mechanic, not the per-page decision of when to cap width.

---

## 7. Destructive Action & Confirmation Pattern

A standard two-tier pattern for any action that removes, disables, or otherwise changes access. This
is an addition to `Modal`'s (§3) usage guidance, not a new component.

**Tier 1 — low-risk, reversible actions** (archive, deactivate-not-delete — most of this system's
actions, per its own "deactivate never delete" convention): proceed immediately, with no confirmation
modal. Pair the action with an undo affordance — a `Toast` (§3) carrying a time-limited "Undo" action
— rather than blocking the user with a dialog before something reversible happens.

**Tier 2 — high-risk, irreversible actions** (permanent delete, suspending a paying customer, revoking
access): require an explicit confirmation `Modal`/`Dialog` (§3) that restates specifically what will
happen, not a generic "Are you sure?". For the highest-risk cases within this tier, require typing a
confirmation phrase (e.g. the entity's own name) before the confirm action enables.

**Rule for choosing a tier:** default to Tier 1 (reversible) unless the action is genuinely
unrecoverable or has legal/financial consequences — those are the only two reasons to escalate to Tier
2's added friction. Don't attach a confirmation modal to a reversible action "just to be safe" — that
just trains users to click through it without reading, which defeats the point for the actions that
actually need it.

---

## 8. Multi-Platform Delivery

- One canonical token source (JSON/TS) per company (or per product, if products intentionally diverge
  on brand) generates every platform's consumable token format. State explicitly, in the product doc,
  what that canonical file is and what's generated from it.
- Component specs in §3 are platform-agnostic by design (named component + variant/state matrix); each
  platform's actual implementation (Tailwind classes on web, StyleSheet/NativeWind on mobile) is
  product-layer work, but must reference the same semantic token names so a value change in the
  canonical source propagates without touching component code.
- A product doc must name its actual token source file and both generated targets explicitly (e.g.
  "canonical: `design/tokens.json` → generates `globals.css`'s `@theme` block and
  `src/constants/theme.ts`") — even if the generation step is still manual/documented-process rather
  than tooled, so it's unambiguous which file is source and which are derived.

---

## 9. Tooling Recommendation

Neither of the below is built yet — this is a recommendation for the next investment, not a claim
that it exists.

- **A living component reference** (Storybook for web, or an equivalent RN preview harness for
  mobile) so every named component in §3's catalog has one real, runnable example per variant/state.
  This — not another paragraph of documentation — is the mechanism that actually prevents the
  copy-paste duplication this whole restructuring exists to fix: a developer reaching for a
  `StatusBadge` finds the real component rendered in Storybook and imports it, instead of writing a
  new `<span>`.
- **Visual-regression testing** (Chromatic, Percy, or equivalent), once a component reference exists,
  to catch unintended token-value drift — a token change that silently shifts a button's color by a
  few percent of lightness should fail a visual diff, not ship unnoticed.

This is a **recommendation, not a mandate** — a maturity investment, not a blocking requirement for
shipping product work.

---

## 10. Changelog

| Date | Change |
|---|---|
| 2026-07-22 | v1.0 skeleton drafted — token taxonomy, component API catalog, accessibility requirements, multi-platform delivery rule, governance/naming convention. No product-specific content. Pending: product-layer docs (starting with CarrierOS) fill in concrete brand values and validate the component catalog against real screens. |
| 2026-07-22 | Radius scale: added `radius-card` (14px) as the true majority-case card radius — 8 of 23 mockups (01–08) define it literally as their root `--radius` token, and the base `.card` class in mockups 10, 11, 14, 15 also uses 14px, outnumbering the 12px usage now reclassified under `radius-lg` (dense dashboard cards: mockup-17 `.section-card`, mockup-21 `.kpi-card`, mockup-22 `.d-card`/`.assign-card`). |
| 2026-07-22 | Radius scale: added `radius-input` (10px) — every native `<input>`/form-field class found (`.input` in mockup-10/11, `.form-input` in mockup-12, `.form-field` in mockup-22) uses 10px, none use the previously-assumed 8px; `radius-md` (8px) description narrowed to the compact-control/dense-desktop-input use it's actually evidenced for. |
| 2026-07-22 | Component catalog: split `Button`'s combined "secondary/ghost" variant into two distinct variants, `secondary (outline)` and `ghost` — mockups (09, 10, 11, and others) implement `.btn-outline` (solid border, opaque background) and `.btn-ghost` (translucent border over colored/dark backdrops) as visually and semantically separate styles, not size/state variants of one style. |
| 2026-07-22 | Component catalog: added `teal` as a 7th `StatusBadge` variant — mockups 02, 21, and 23 all define a dedicated teal badge/chip (`.chip-transit`, `.badge-teal`) for "In Transit" and "CA Pilot" states, a color role distinct from any of the other 6 listed variants. |
| 2026-07-22 | Component catalog: added a `selectable` variant and `selected` state to `Card` — mockups 02 (`.driver-card.selected`, `.truck-card.selected`), 09 (`.plan-card.selected`), 12 (`.role-option.selected`), and 14 (`.type-option.selected`) all implement a persistent border/background highlight for single-choice option cards, a state the previous default/hover/focus matrix didn't cover. |
| 2026-07-22 | Spacing scale: added a note documenting that mockups pervasively use three unlisted half-step values (6px, 10px, 14px) for padding/gap — real and recurring (comparable frequency to listed steps) but left as a flagged note rather than new named aliases, since naming is a token-governance decision out of scope for this validation pass. |
| 2026-07-22 | Validation pass against all 23 mockups (typography, spacing, radius, shadow, motion, breakpoints, z-index, component catalog): no discrepancies found in the typography scale, motion durations, shadow/elevation levels, glow variants, z-index scale, or breakpoints — these match the mockups (or, for breakpoints/z-index, the mockups are static prototypes with no `@media` queries and only trivial local z-index values, so there's no counter-evidence either way). Toast, Skeleton, and EmptyState components appear in no mockup (Core is ahead of current usage, left as-is per governance rule). |
| 2026-07-22 | v1.1 — added data-visualization palette conventions (§2.10), ARIA/screen-reader and non-color-alone accessibility rules (§4), internationalization & RTL mechanics (new §5), layout grid system (new §6), destructive-action/confirmation pattern (new §7), expanded `Table` state matrix (§3), component deprecation policy (new §0 addendum), Storybook/visual-regression tooling recommendation (new §9), accepted `purple` as an 8th `StatusBadge` variant (§3, proposed by CarrierOS). All additions, no breaking changes — non-breaking per §0's versioning rule. |

### Deprecated — scheduled for removal

| Item | Deprecated in | Replacement | Removal target |
|---|---|---|---|
| _None currently._ | — | — | — |

_A change here that renames a token, alters a component's required props, or removes a variant is a
breaking change — bump the version and add a migration note for any product depending on this file._
