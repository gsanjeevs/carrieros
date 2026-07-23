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

function cardPatternRule(severity) {
  return [
    "no-restricted-syntax",
    severity,
    { selector: CARD_PATTERN_SELECTOR_LITERAL, message: CARD_PATTERN_MESSAGE },
    { selector: CARD_PATTERN_SELECTOR_TEMPLATE, message: CARD_PATTERN_MESSAGE },
  ];
}

const uiComponentPatternGuardWarn = {
  files: ["app/**/*.tsx"],
  rules: { "no-restricted-syntax": cardPatternRule("warn").slice(1) },
};

// Surfaces confirmed fully migrated onto components/ui/* — violations here
// are regressions, not pre-existing debt, so they fail the build.
const ERROR_SURFACES = ["app/(admin)/**/*.tsx"];
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
