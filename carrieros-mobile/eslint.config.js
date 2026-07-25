// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

// Hex-literal + local-color-const guard (2026-07-25, mockup-06 re-skin
// Phase 6) — mirrors carrieros-web/eslint.config.mjs's hex guard, adapted
// for RN StyleSheet objects instead of Tailwind classNames. Added right
// after a mechanical sweep fixed the exact pattern this catches: 16 files
// each declared `const ORANGE = '#f97316'` instead of importing
// `BrandColors` from src/constants/theme.ts, so BrandColors had zero
// importers and editing it changed nothing on screen. Needs more property
// names than web's version (RN style objects, not Tailwind classes) and
// 3-digit hex too.
const HEX_PATTERN_SELECTOR =
  "Property[key.name=/^(color|backgroundColor|borderColor|borderTopColor|borderBottomColor|borderLeftColor|borderRightColor|tintColor|shadowColor)$/] > Literal[value=/#[0-9a-fA-F]{3,8}/]";
const HEX_PATTERN_MESSAGE =
  "Use a BrandColors/StatusColors token from src/constants/theme.ts instead of a raw hex color — see carrieros-web/app/globals.css's @theme block for the canonical values (carrieros-mobile mirrors it, enforced by carrieros-web/scripts/check-tokens.mjs).";

const LOCAL_COLOR_CONST_SELECTOR =
  "VariableDeclarator[id.name=/^(ORANGE|NAVY|GREEN|GRAY|SUCCESS|DANGER|WARNING|TEAL)$/] > Literal[value=/^#[0-9a-fA-F]{3,8}$/]";
const LOCAL_COLOR_CONST_MESSAGE =
  "Don't shadow a theme token with a local const — import it from src/constants/theme.ts instead (e.g. `const ORANGE = BrandColors.orange`), so a future palette change actually reaches this screen.";

// `warn`, not `error`: this session only swept the specific 16-file
// `const ORANGE` cluster + 6 named inline `#f97316` sites (the pattern the
// user asked to fix). Turning this rule on revealed the wider mobile hex
// debt is real and much bigger — 33 files still hit it (raw #ffffff/
// #000000/#dc2626/etc. inline in style objects), matching the ~90-site
// figure from the original audit. Promoting this to `error` belongs to
// whoever does that fuller sweep, the same ratchet posture web's
// eslint.config.mjs uses (ERROR_SURFACES per-surface, not all-or-nothing).
const colorTokenGuard = {
  files: ["src/**/*.ts", "src/**/*.tsx"],
  rules: {
    "no-restricted-syntax": [
      "warn",
      { selector: HEX_PATTERN_SELECTOR, message: HEX_PATTERN_MESSAGE },
      { selector: LOCAL_COLOR_CONST_SELECTOR, message: LOCAL_COLOR_CONST_MESSAGE },
    ],
  },
};

module.exports = defineConfig([
  expoConfig,
  colorTokenGuard,
  {
    ignores: ["dist/*"],
  }
]);
