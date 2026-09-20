import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Hand-rolled-Tailwind-card/badge pattern guard — see
// docs/design/carrieros-design-system.md §5/§9. This project's own
// SuperAdmin UI (Phase 8) shipped its first draft with exactly these literal
// patterns (bg-white/5, shadow-card-dark, border-white/8) instead of the
// real components/ui/* library (Card/KpiTile/StatusBadge/Table/Button) that
// exists specifically to prevent this. The doc alone didn't stop that
// regression — see MEMORY feedback_design_system_enforcement — so this
// catches it mechanically.
//
// Ratchet strategy: "warn" repo-wide so the pre-existing debt in
// app/(app)/** (which uses these literals pervasively — near-zero
// components/ui/* adoption there, see architecture-principles.md) is visible
// without breaking the build; "error" for surfaces already fully migrated.
// As a surface gets migrated, add its glob to ERROR_SURFACES below to lock
// the regression out permanently instead of leaving it at warn forever.
// Widened 2026-07-25 (Phase 5 of the mockup-06 re-skin): the original
// bg-white\/(5|7) / border-white\/(5|8|10) alternation missed the bracketed
// arbitrary-value form (bg-white/[0.05]) — semantically the same debt,
// spelled differently. Did NOT add /10, /12, /16 to the bg- side or /12,
// /16 to the border- side, despite the re-skin plan suggesting it: bg-white
// /10 in particular is a widely-used, legitimate hover/progress-track
// convention throughout already-migrated ERROR_SURFACES code (onboarding's
// step dots, LoadActionGrid's row hovers, etc.), completely distinct from
// the 5/7% "someone hand-rolled a whole card" pattern this guard targets.
// Verified by trying the wider set first — it broke the build on 21
// pre-existing, legitimate uses across files nowhere near this migration.
const CARD_PATTERN_SELECTOR_LITERAL =
  "JSXAttribute[name.name='className'] Literal[value=/shadow-card-dark|bg-white\\/(\\[[^\\]]+\\]|5|7)|border-white\\/(\\[[^\\]]+\\]|5|8|10)/]";
const CARD_PATTERN_SELECTOR_TEMPLATE =
  "JSXAttribute[name.name='className'] TemplateElement[value.raw=/shadow-card-dark|bg-white\\/(\\[[^\\]]+\\]|5|7)|border-white\\/(\\[[^\\]]+\\]|5|8|10)/]";
const CARD_PATTERN_MESSAGE =
  "Use components/ui/* (Card/KpiTile/StatusBadge/Table/Button) instead of hand-rolled card/badge Tailwind classes — see docs/design/carrieros-design-system.md §5.";

// Raw-hex-color guard (added 2026-07-24, raw-hex audit) — the card-pattern
// guard above only ever matched specific literal Tailwind fragments
// (bg-white/5 etc.), so a raw hex color like bg-[#f97316] or a style prop's
// color: '#f97316' was a silent blind spot even on surfaces the card-pattern
// rule already gates at error. Catches: (a) Tailwind arbitrary-value hex in
// a className (bg-[#hex], hover:text-[#hex], border-l-[#hex], etc.), (b) a
// hex string literal assigned to a color-ish object property (color,
// backgroundColor, borderColor) for the handful of call sites that need a
// literal hex at runtime (see lib/design-tokens.ts) rather than a Tailwind
// class. Deliberately does NOT match arbitrary object-literal properties
// named anything else (e.g. AddVehicleButton.tsx's `hex: '#f8fafc'` paint-
// color picker data is real domain data, not UI styling, and must keep its
// own literal values) — the property-name allowlist below is intentionally
// narrow.
const HEX_PATTERN_SELECTOR_CLASSNAME =
  "JSXAttribute[name.name='className'] Literal[value=/#[0-9a-fA-F]{6}/]";
const HEX_PATTERN_SELECTOR_CLASSNAME_TEMPLATE =
  "JSXAttribute[name.name='className'] TemplateElement[value.raw=/#[0-9a-fA-F]{6}/]";
const HEX_PATTERN_SELECTOR_STYLE_PROP =
  "Property[key.name=/^(color|backgroundColor|borderColor)$/] > Literal[value=/#[0-9a-fA-F]{6}/]";
const HEX_PATTERN_MESSAGE =
  "Use a design-system token (bg-brand-orange, text-teal, etc. — see app/globals.css's @theme block) or lib/design-tokens.ts instead of a raw hex color — see docs/design/carrieros-design-system.md §1.2.";

// lib/domain/*.ts's status-pill helpers used to return plain strings like
// `'bg-[#f97316]/20 text-[#f97316]'` (converted to token classes in the
// 2026-07-25 re-skin, see docs/decisions.md V6). The HEX_PATTERN_SELECTOR_*
// rules above couldn't have caught these even with a wider `files` glob —
// they require a `JSXAttribute[name.name='className']` ancestor, and a
// domain function's return value has no such wrapper. This is a second,
// narrower selector for exactly that shape: a bare string literal containing
// a Tailwind arbitrary-hex utility, regardless of JSX context. Scoped to
// lib/**/*.ts only (not app/lib.ts generally) to avoid false-positiving on
// unrelated string literals elsewhere in business logic.
const LIB_HEX_PATTERN_SELECTOR =
  "Literal[value=/(?:bg|text|border)-\\[#[0-9a-fA-F]{6}\\]/]";
const LIB_HEX_PATTERN_MESSAGE =
  "Return a semantic token class (bg-brand-orange/20 text-brand-orange, etc.) instead of a raw hex Tailwind class — see docs/design/carrieros-design-system.md §1.2.";

function hexPatternRule(severity) {
  return [
    "no-restricted-syntax",
    severity,
    { selector: HEX_PATTERN_SELECTOR_CLASSNAME, message: HEX_PATTERN_MESSAGE },
    { selector: HEX_PATTERN_SELECTOR_CLASSNAME_TEMPLATE, message: HEX_PATTERN_MESSAGE },
    { selector: HEX_PATTERN_SELECTOR_STYLE_PROP, message: HEX_PATTERN_MESSAGE },
  ];
}

function cardPatternRule(severity) {
  return [
    "no-restricted-syntax",
    severity,
    { selector: CARD_PATTERN_SELECTOR_LITERAL, message: CARD_PATTERN_MESSAGE },
    { selector: CARD_PATTERN_SELECTOR_TEMPLATE, message: CARD_PATTERN_MESSAGE },
    ...hexPatternRule(severity).slice(2),
  ];
}

// Component files were previously entirely unguarded by this rule (glob was
// app/**/*.tsx only) — a real gap the raw-hex audit found, since several
// components/*.tsx files hand-roll the exact patterns this guard exists to
// catch. Both globs share the same "warn repo-wide" ratchet posture as app/.
const uiComponentPatternGuardWarn = {
  files: ["app/**/*.tsx", "components/**/*.tsx"],
  rules: { "no-restricted-syntax": cardPatternRule("warn").slice(1) },
};

// Surfaces confirmed fully migrated onto components/ui/* — violations here
// are regressions, not pre-existing debt, so they fail the build.
const ERROR_SURFACES = [
  "app/(admin)/**/*.tsx",
  "app/(app)/dashboard/**/*.tsx",
  "app/(app)/invoices/**/*.tsx",
  "app/(app)/drivers/**/*.tsx",
  "app/(app)/loads/**/*.tsx",
  "app/(app)/customers/**/*.tsx",
  "app/(app)/vehicles/**/*.tsx",
  "app/(app)/maintenance/**/*.tsx",
  "app/(app)/team/**/*.tsx",
  "app/(app)/billing/**/*.tsx",
  "app/(app)/settlements/**/*.tsx",
  "app/(app)/dispatch/**/*.tsx",
  "app/(app)/exceptions/**/*.tsx",
  "app/(app)/settings/**/*.tsx",
  "app/(app)/finance/**/*.tsx",
  // Migrated onto components/ui/* (Field/Input/Button/Card/StepProgress/
  // ChecklistItem/Callout) 2026-07-25, Phase 5b of the mockup-06 re-skin —
  // this is the flow those primitives were built for.
  "app/onboarding/**/*.tsx",
];
// components/** migrated onto components/ui/* clean 2026-07-25 (Phase 5 of
// the mockup-06 re-skin, 18 files) — promoted from the warn block above.
// EXCLUDES components/ui/** itself: Button.tsx's `ghost` variant and
// Table.tsx intentionally use bg-white/7 as the canonical implementation
// this whole guard exists to point everyone else at — it stays on the warn
// tier (via uiComponentPatternGuardWarn above), same as before.
const uiComponentPatternGuardError = {
  files: [...ERROR_SURFACES, "components/**/*.tsx"],
  ignores: ["components/ui/**"],
  rules: { "no-restricted-syntax": cardPatternRule("error").slice(1) },
};

// lib/domain/*.ts's hex-return sites (see LIB_HEX_PATTERN_SELECTOR above)
// were fixed to zero violations in the same pass — start this at `error`,
// not `warn`, per the same "clean when written" posture check-architecture.mjs
// documents for its own checks.
const libHexPatternGuard = {
  files: ["lib/**/*.ts"],
  rules: {
    "no-restricted-syntax": [
      "error",
      { selector: LIB_HEX_PATTERN_SELECTOR, message: LIB_HEX_PATTERN_MESSAGE },
    ],
  },
};


// Hardcoded-JSX-text guard (i18n audit, 2026-09-19) — a prior audit found
// dozens of untranslated English strings shipped straight in JSX (headings,
// button labels, aria-labels) instead of going through next-intl's
// useTranslations()/getTranslations() + messages/{en,es,pa,ur}.json, same
// class of "doc alone didn't stop it" regression as the card-pattern guard
// above. No i18n-lint plugin (e.g. eslint-plugin-i18next) was already
// installed, so this mirrors the card-pattern guard's own
// no-restricted-syntax/AST-selector approach rather than pulling in a new
// dependency for one rule shape.
//
// Heuristic: flag a JSXText child, or an aria-label/title/alt attribute
// literal (direct-child combinator only, so a `title={t('key')}` expression
// container is never inspected — only a literal string value), that looks
// like a real sentence-case English phrase — two or more alphabetic words
// of 3+ letters separated by a space. Uses a literal `[ ]` rather than
// `\s+` in the embedded regex: the no-restricted-syntax selector string is
// re-parsed by ESLint's bundled esquery, which mangles a `\s` escape inside
// a selector's own regex literal (silently drops the backslash, so it
// matched a bare `s` instead — caught this INSIDE this same pass, when
// component prop names like `noEventsTitle` and even `auto_awesome` false-
// positived on a stray "...s+letters..." substring). Deliberately does NOT
// cover `placeholder` — illustrative sample values (`"Big Red"`,
// `"Jane Doe"`, example rate-con placeholder text) are real, intentional,
// non-UI-copy content per docs' own placeholder-vs-copy distinction, and
// flagging them would make the ERROR_SURFACES tier fight the sample data
// the design intentionally left alone. Also does not fire on short
// all-caps tokens (SX, PDF, IL) or single words, which are far more likely
// to be an abbreviation/status code than untranslated copy.
const TEXT_PATTERN_SELECTOR_JSXTEXT =
  "JSXElement > JSXText[value=/[A-Za-z]{3,}[ ][A-Za-z]{3,}/]";
const TEXT_PATTERN_SELECTOR_ATTR =
  "JSXAttribute[name.name=/^(aria-label|title|alt)$/] > Literal[value=/[A-Za-z]{3,}[ ][A-Za-z]{3,}/]";
const TEXT_PATTERN_MESSAGE =
  "Hardcoded UI text — use useTranslations()/getTranslations() and messages/{en,es,pa,ur}.json instead of a literal string. See messages/en.json for the existing namespace layout.";

function textPatternRule(severity) {
  return [
    "no-restricted-syntax",
    severity,
    { selector: TEXT_PATTERN_SELECTOR_JSXTEXT, message: TEXT_PATTERN_MESSAGE },
    { selector: TEXT_PATTERN_SELECTOR_ATTR, message: TEXT_PATTERN_MESSAGE },
  ];
}

// Warn repo-wide first — this is a large, real, pre-existing debt (the
// audit found ~60+ strings just in the surfaces fixed today; there's more
// outside that scope) — same ratchet posture as the card-pattern guard.
const textPatternGuardWarn = {
  files: ["app/**/*.tsx", "components/**/*.tsx"],
  rules: { "no-restricted-syntax": textPatternRule("warn").slice(1) },
};

// Surfaces wired into next-intl in the 2026-09-19 i18n pass — a regression
// here is a real bug, not pre-existing debt, so these fail the build.
const TEXT_ERROR_SURFACES = [
  "app/(admin)/**/*.tsx",
  "app/(app)/loads/new/page.tsx",
  "app/(app)/loads/new/paste/page.tsx",
  "app/(app)/loads/new/CopyIntakeEmailButton.tsx",
  "app/(app)/my-loads/page.tsx",
  "app/(app)/dispatch/DispatchMapClient.tsx",
  "app/(app)/invoices/[invoice_number]/print/PrintButton.tsx",
  "app/(app)/layout.tsx",
  "components/AdminSidebar.tsx",
  "components/ManualLoadForm.tsx",
  "components/ExtractionReview.tsx",
  "components/ui/Toast.tsx",
  "components/ui/Modal.tsx",
  "components/LanguageSwitcher.tsx",
];
const textPatternGuardError = {
  files: TEXT_ERROR_SURFACES,
  rules: { "no-restricted-syntax": textPatternRule("error").slice(1) },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  uiComponentPatternGuardWarn,
  uiComponentPatternGuardError,
  libHexPatternGuard,
  textPatternGuardWarn,
  textPatternGuardError,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
