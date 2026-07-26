#!/usr/bin/env node
// Cross-source sync guard for the brand/status palette (decision V6,
// 2026-07-25 re-skin). `app/globals.css`'s `@theme` block is the single
// source of truth; `lib/design-tokens.ts` and
// `carrieros-mobile/src/constants/theme.ts` are hand-mirrors of it with no
// generation tooling behind them — this script is what makes "hand-mirror"
// mean something instead of "eventually drifts." Pure static parse, no DB,
// runs in well under a second — see CLAUDE.md "Gated checks".
//
// This does NOT assert every web token has a mobile/design-tokens
// counterpart — most don't need one (e.g. --color-avatar-text is web-only).
// It asserts the reverse: every value the OTHER two files claim to mirror
// still matches what globals.css actually says today. The MAPPINGS below are
// the explicit, by-hand list of "these two names mean the same color" — see
// the comment above each mapping array for why explicit beats name-matching.

import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd() // run from carrieros-web/
const REPO_ROOT = path.join(ROOT, '..')

const violations = []

function fail(label, detail) {
  violations.push(`[${label}] ${detail}`)
}

// ── 1. Parse app/globals.css's @theme block into a name -> value map ──────
// Matches literal-hex and literal-px custom properties only (`--color-X:
// #hex;` / `--radius-X: 14px;`) — deliberately excludes `@theme inline` and
// the semantic-token re-registration block at the bottom, both of which are
// `var(...)` references, not values, so they have nothing to drift.
const globalsCssPath = path.join(ROOT, 'app/globals.css')
const globalsCss = readFileSync(globalsCssPath, 'utf8')

const webTokens = {}
for (const m of globalsCss.matchAll(/--(color-[\w-]+|radius-[\w-]+):\s*(#[0-9a-fA-F]{3,8}|[\d.]+px);/g)) {
  webTokens[m[1]] = m[2].toLowerCase()
}

if (Object.keys(webTokens).length === 0) {
  fail('parse', `${globalsCssPath}: found zero --color-*/--radius-* declarations — @theme block regex is broken or the file moved.`)
}

// ── 2. Parse lib/design-tokens.ts's exported hex constants ─────────────────
const designTokensPath = path.join(ROOT, 'lib/design-tokens.ts')
const designTokensSrc = readFileSync(designTokensPath, 'utf8')

const designTokens = {}
for (const m of designTokensSrc.matchAll(/export const (\w+) = '(#[0-9a-fA-F]{3,8})'/g)) {
  designTokens[m[1]] = m[2].toLowerCase()
}

// Explicit web-token -> lib/design-tokens.ts export mapping. Explicit, not
// derived from casing, because the two files' names don't algorithmically
// correspond in one case (`brand-orange-hover` -> `BRAND_ORANGE_HOVER` is
// regular, but nothing stops a future export using a different word).
const DESIGN_TOKENS_MAP = [
  ['color-navy', 'NAVY'],
  ['color-brand-orange', 'BRAND_ORANGE'],
  ['color-brand-orange-hover', 'BRAND_ORANGE_HOVER'],
  ['color-brand-orange-light', 'BRAND_ORANGE_LIGHT'],
  ['color-success', 'SUCCESS'],
  ['color-warning', 'WARNING'],
  ['color-danger', 'DANGER'],
  ['color-teal', 'TEAL'],
  ['color-teal-hover', 'TEAL_HOVER'],
  ['color-info', 'INFO'],
  ['color-purple', 'PURPLE'],
  ['color-brand-blue', 'BRAND_BLUE'],
  ['color-brand-blue-dark', 'BRAND_BLUE_DARK'],
  ['color-slate', 'SLATE'],
  ['color-slate-light', 'SLATE_LIGHT'],
  ['color-slate-dark', 'SLATE_DARK'],
  ['color-score-warning', 'SCORE_WARNING'],
  ['color-score-critical', 'SCORE_CRITICAL'],
]

for (const [webName, exportName] of DESIGN_TOKENS_MAP) {
  const webValue = webTokens[webName]
  const tokenValue = designTokens[exportName]
  if (webValue === undefined) {
    fail('design-tokens', `globals.css no longer declares --${webName} — remove or repoint lib/design-tokens.ts's ${exportName} (currently ${tokenValue ?? 'MISSING'}).`)
    continue
  }
  if (tokenValue === undefined) {
    fail('design-tokens', `lib/design-tokens.ts has no export named ${exportName} — expected it to mirror globals.css --${webName} (${webValue}).`)
    continue
  }
  if (tokenValue !== webValue) {
    fail('design-tokens', `lib/design-tokens.ts's ${exportName} is ${tokenValue} but globals.css --${webName} is ${webValue}.`)
  }
}

// ── 3. Parse carrieros-mobile/src/constants/theme.ts's BrandColors/
//        StatusColors object literals ─────────────────────────────────────
const mobileThemePath = path.join(REPO_ROOT, 'carrieros-mobile/src/constants/theme.ts')
const mobileThemeSrc = readFileSync(mobileThemePath, 'utf8')

function parseObjectLiteral(src, exportName) {
  const re = new RegExp(`export const ${exportName} = \\{([\\s\\S]*?)\\} as const;`)
  const m = src.match(re)
  if (!m) return null
  const obj = {}
  for (const km of m[1].matchAll(/(\w+):\s*'(#[0-9a-fA-F]{3,8})'/g)) {
    obj[km[1]] = km[2].toLowerCase()
  }
  return obj
}

const brandColors = parseObjectLiteral(mobileThemeSrc, 'BrandColors')
const statusColors = parseObjectLiteral(mobileThemeSrc, 'StatusColors')

if (!brandColors) fail('parse', `${mobileThemePath}: could not find/parse "export const BrandColors = {...} as const" — regex broken or shape changed.`)
if (!statusColors) fail('parse', `${mobileThemePath}: could not find/parse "export const StatusColors = {...} as const" — regex broken or shape changed.`)

// Explicit web-token -> {file, key} mapping. Explicit, not name-matching,
// because mobile has same-named keys that mean DIFFERENT things — e.g.
// StatusColors.grayLight (#f4f6f9, a surface/background pastel) is unrelated
// to BrandColors.grayLight (#d6e0ea, the mockups' --gray-lt body-copy-on-navy
// tone) despite sharing a name. Auto-matching by key name would silently
// compare the wrong pair.
const MOBILE_MAP = [
  ['color-navy', brandColors, 'navy'],
  ['color-navy-mid', brandColors, 'navyMid'],
  ['color-navy-light', brandColors, 'navyLight'],
  ['color-navy-card', brandColors, 'navyCard'],
  ['color-navy-muted', brandColors, 'navyMuted'],
  ['color-brand-orange', brandColors, 'orange'],
  ['color-brand-orange-hover', brandColors, 'orangeHover'],
  ['color-brand-orange-light', brandColors, 'orangeLight'],
  ['color-gray', brandColors, 'gray'],
  ['color-gray-light', brandColors, 'grayLight'],

  ['color-success', statusColors, 'success'],
  ['color-success-light', statusColors, 'successLight'],
  ['color-success-dark', statusColors, 'successDark'],
  ['color-warning', statusColors, 'warning'],
  ['color-danger', statusColors, 'danger'],
  ['color-danger-light', statusColors, 'dangerLight'],
  ['color-danger-dark', statusColors, 'dangerDark'],
  ['color-teal', statusColors, 'teal'],
  ['color-info', statusColors, 'info'],
  ['color-info-light', statusColors, 'infoLight'],
  ['color-brand-orange', statusColors, 'orange'], // StatusColors.orange duplicates BrandColors.orange
  ['color-purple', statusColors, 'purple'],
  ['color-purple-light', statusColors, 'purpleLight'],
]

if (brandColors && statusColors) {
  for (const [webName, obj, key] of MOBILE_MAP) {
    const webValue = webTokens[webName]
    const objName = obj === brandColors ? 'BrandColors' : 'StatusColors'
    const mobileValue = obj[key]
    if (webValue === undefined) {
      fail('mobile-theme', `globals.css no longer declares --${webName} — remove or repoint mobile ${objName}.${key} (currently ${mobileValue ?? 'MISSING'}).`)
      continue
    }
    if (mobileValue === undefined) {
      fail('mobile-theme', `mobile ${objName} has no key "${key}" — expected it to mirror globals.css --${webName} (${webValue}).`)
      continue
    }
    if (mobileValue !== webValue) {
      fail('mobile-theme', `mobile ${objName}.${key} is ${mobileValue} but globals.css --${webName} is ${webValue}.`)
    }
  }

  // warningLight/warningDark deliberately do NOT map 1:1 to web — see the
  // 2026-07-25 note in theme.ts. Assert they at least match web now that
  // both were manually reconciled, so a future edit to one side is caught.
  for (const [webName, key] of [['color-warning-light', 'warningLight'], ['color-warning-dark', 'warningDark']]) {
    const webValue = webTokens[webName]
    const mobileValue = statusColors[key]
    if (webValue && mobileValue && webValue !== mobileValue) {
      fail('mobile-theme', `mobile StatusColors.${key} is ${mobileValue} but globals.css --${webName} is ${webValue} — these were reconciled 2026-07-25, re-check which side changed.`)
    }
  }
}

// ── 4. Radius scale — mobile stores a number (RN needs points, not CSS
//        lengths), web stores a px string. Compare the numeric value. ─────
const mobileRadius = (() => {
  const m = mobileThemeSrc.match(/export const Radius = \{([\s\S]*?)\} as const;/)
  if (!m) return null
  const obj = {}
  for (const km of m[1].matchAll(/(\w+):\s*(\d+)/g)) obj[km[1]] = Number(km[2])
  return obj
})()

if (!mobileRadius) {
  fail('parse', `${mobileThemePath}: could not find/parse "export const Radius = {...} as const".`)
} else {
  const webRadiusCard = webTokens['radius-card']
  const webRadiusPx = webRadiusCard ? Number(webRadiusCard.replace('px', '')) : undefined
  if (webRadiusPx === undefined) {
    fail('mobile-theme', `globals.css no longer declares --radius-card — remove or repoint mobile Radius.card (currently ${mobileRadius.card ?? 'MISSING'}).`)
  } else if (mobileRadius.card !== webRadiusPx) {
    fail('mobile-theme', `mobile Radius.card is ${mobileRadius.card} but globals.css --radius-card is ${webRadiusPx}px.`)
  }
}

// ── Report ──────────────────────────────────────────────────────────────
if (violations.length > 0) {
  console.error(`\n✗ Token sync check failed (${violations.length} mismatch(es)):\n`)
  console.error(violations.join('\n'))
  console.error(`\nSource of truth is carrieros-web/app/globals.css's @theme block. Update the\ndrifted side (lib/design-tokens.ts or carrieros-mobile/src/constants/theme.ts)\nto match it, or update the MAPPINGS in this script if the token was\ndeliberately renamed/removed.\n`)
  process.exit(1)
}

console.log('✓ Token sync check passed (globals.css ↔ design-tokens.ts ↔ mobile theme.ts)')
