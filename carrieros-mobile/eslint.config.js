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

// Locale-unaware date/currency/number formatting guard (2026-09-19,
// currency/date localization audit) — mirrors the ratchet-guard shape of
// colorTokenGuard above (and carrieros-web/eslint.config.mjs's
// no-restricted-syntax UI guards), but starts at `error` rather than `warn`:
// the audit's sweep already brought every existing call site in src/ to
// zero violations (routed through src/lib/format-money.ts, format-date.ts,
// format-number.ts instead), so this is "clean when written" — same posture
// carrieros-web/eslint.config.mjs uses for its libHexPatternGuard.
//
// The underlying bug: `.toLocaleString()`/`.toLocaleDateString()`/
// `.toLocaleTimeString()` called with no arguments (or `undefined`) use the
// *device's* locale, not `profiles.preferred_language` (the locale
// `useLocale()` in src/hooks/use-locale.tsx actually resolves and that the
// rest of the app is translated into) — so a Spanish-speaking user with an
// English-locale phone silently got English-formatted dates/currency/
// numbers. Flagging the bare method call outright (rather than trying to
// detect "called with no locale argument" via AST, which no-restricted-
// syntax's selector language can't easily express) forces every call site
// through the shared helpers, which take `locale` as a required parameter.
const LOCALE_METHOD_SELECTOR =
  "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(toLocaleString|toLocaleDateString|toLocaleTimeString)$/]";
const LOCALE_METHOD_MESSAGE =
  "Don't call .toLocaleString()/.toLocaleDateString()/.toLocaleTimeString() directly — it silently falls back to the device's locale instead of the user's selected profiles.preferred_language. Use formatMoney (src/lib/format-money.ts), formatDate/formatDateTime (src/lib/format-date.ts), or formatNumber (src/lib/format-number.ts) instead, passing `locale` from useLocale().";

const localeFormattingGuard = {
  files: ["src/**/*.ts", "src/**/*.tsx"],
  // The shared helpers are the only place allowed to call these methods
  // directly — everything else must go through them.
  ignores: ["src/lib/format-money.ts", "src/lib/format-date.ts", "src/lib/format-number.ts"],
  rules: {
    "no-restricted-syntax": [
      "error",
      { selector: LOCALE_METHOD_SELECTOR, message: LOCALE_METHOD_MESSAGE },
    ],
  },
};

module.exports = defineConfig([
  expoConfig,
  colorTokenGuard,
  localeFormattingGuard,
  {
    ignores: ["dist/*"],
  }
]);
