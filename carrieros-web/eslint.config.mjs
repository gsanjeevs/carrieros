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
const CARD_PATTERN_SELECTOR_LITERAL =
  "JSXAttribute[name.name='className'] Literal[value=/shadow-card-dark|bg-white\\/(5|7)|border-white\\/(5|8|10)/]";
const CARD_PATTERN_SELECTOR_TEMPLATE =
  "JSXAttribute[name.name='className'] TemplateElement[value.raw=/shadow-card-dark|bg-white\\/(5|7)|border-white\\/(5|8|10)/]";
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
];
const uiComponentPatternGuardError = {
  files: ERROR_SURFACES,
  rules: { "no-restricted-syntax": cardPatternRule("error").slice(1) },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  uiComponentPatternGuardWarn,
  uiComponentPatternGuardError,
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
