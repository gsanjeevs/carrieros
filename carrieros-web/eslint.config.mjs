import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Ad-hoc-Tailwind-card pattern guard, scoped to app/(admin)/** — see
// docs/design/carrieros-design-system.md §5/§9 and this project's own
// SuperAdmin UI, whose first draft used exactly these literal patterns
// (bg-white/5, shadow-card-dark, border-white/8) instead of the real
// components/ui/* library (Card/KpiTile/StatusBadge/Table/Button) that
// exists specifically to prevent this. The doc alone didn't stop that
// regression, so this catches it mechanically for this route group going
// forward. NOT applied repo-wide: the pre-existing tenant app (`app/(app)/`)
// uses these same literals pervasively and migrating all of it is a much
// larger, separate effort (see that doc's §11 changelog) — this guard only
// locks in the standard for new/small surfaces, starting with `/admin`.
const adminCardPatternGuard = {
  files: ["app/(admin)/**/*.tsx"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector:
          "JSXAttribute[name.name='className'] Literal[value=/shadow-card-dark|bg-white\\/(5|7)|border-white\\/(5|8|10)/]",
        message:
          "Use components/ui/* (Card/KpiTile/StatusBadge/Table/Button) instead of hand-rolled card/badge Tailwind classes in app/(admin)/** — see docs/design/carrieros-design-system.md §5.",
      },
      {
        selector:
          "JSXAttribute[name.name='className'] TemplateElement[value.raw=/shadow-card-dark|bg-white\\/(5|7)|border-white\\/(5|8|10)/]",
        message:
          "Use components/ui/* (Card/KpiTile/StatusBadge/Table/Button) instead of hand-rolled card/badge Tailwind classes in app/(admin)/** — see docs/design/carrieros-design-system.md §5.",
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  adminCardPatternGuard,
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
