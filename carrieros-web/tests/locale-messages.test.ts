// tests/locale-messages.test.ts
// Structural completeness for messages/*.json. This repo's i18n catalogs are
// hand-translated (no extraction tooling), so the failure mode this guards
// against is a translated file drifting from en.json's key set, or an
// interpolation placeholder getting mistranslated/dropped/renamed.
//
// Deliberately does NOT do full ICU plural-category validation (e.g.
// requiring the exact same `one`/`few`/`many`/`other` branches as English) —
// languages have different CLDR plural rules (Russian has one/few/many/
// other, Arabic has zero/one/two/few/many/other, Chinese/Vietnamese/etc.
// have just other), so a translated plural message legitimately has a
// different set of category branches than English. What must still match is
// the interpolation *argument name* passed into each placeholder/plural/
// select (e.g. `count` in `{count, plural, ...}`, `name` in `{name}`) — a
// renamed or dropped argument would throw at render time regardless of
// plural-rule differences.
//
// Uses @formatjs/icu-messageformat-parser (next-intl's own ICU parser,
// promoted from an already-present transitive dependency to an explicit
// devDependency here) rather than a naive regex — a plural branch commonly
// wraps a single literal word in braces with no comma (e.g.
// `{count, plural, one {vehicle} other {vehicles}}`), which a regex can't
// distinguish from a real `{argName}` reference without parsing the message.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { parse, TYPE } from '@formatjs/icu-messageformat-parser'
import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser'

const MESSAGES_DIR = path.resolve(__dirname, '../messages')
const EN_FILE = path.join(MESSAGES_DIR, 'en.json')

type MessageTree = { [key: string]: string | MessageTree }

function flattenKeys(obj: MessageTree, prefix = ''): string[] {
  let keys: string[] = []
  for (const k of Object.keys(obj)) {
    const full = prefix ? `${prefix}.${k}` : k
    const v = obj[k]
    if (v !== null && typeof v === 'object') {
      keys = keys.concat(flattenKeys(v, full))
    } else {
      keys.push(full)
    }
  }
  return keys
}

function flattenValues(obj: MessageTree, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj)) {
    const full = prefix ? `${prefix}.${k}` : k
    const v = obj[k]
    if (v !== null && typeof v === 'object') {
      Object.assign(out, flattenValues(v, full))
    } else {
      out[full] = v
    }
  }
  return out
}

function collectArgNames(nodes: MessageFormatElement[], out: Set<string>): void {
  for (const node of nodes) {
    switch (node.type) {
      case TYPE.argument:
      case TYPE.number:
      case TYPE.date:
      case TYPE.time:
        out.add(node.value)
        break
      case TYPE.select:
      case TYPE.plural:
        out.add(node.value)
        for (const opt of Object.values(node.options)) collectArgNames(opt.value, out)
        break
      default:
        break
    }
  }
}

function argNamesOf(value: unknown): string[] {
  if (typeof value !== 'string' || !value.includes('{')) return []
  const ast = parse(value, { ignoreTag: true })
  const names = new Set<string>()
  collectArgNames(ast, names)
  return [...names].sort()
}

const en = JSON.parse(readFileSync(EN_FILE, 'utf8')) as MessageTree
const enKeys = new Set(flattenKeys(en))
const enValues = flattenValues(en)

const localeFiles = readdirSync(MESSAGES_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'en.json')
  .sort()

// Sanity check on the test itself: this repo expanded from 4 to 24 supported
// languages (migration 0054) — fail loudly if the messages/ directory
// doesn't actually have all 24 files, rather than silently testing fewer.
describe('messages/en.json baseline', () => {
  it('has at least 1000 leaf keys (sanity check that the catalog loaded correctly)', () => {
    expect(enKeys.size).toBeGreaterThan(1000)
  })
})

describe.each(localeFiles)('messages/%s', (filename) => {
  const code = filename.replace(/\.json$/, '')
  const data = JSON.parse(readFileSync(path.join(MESSAGES_DIR, filename), 'utf8')) as MessageTree
  const keys = new Set(flattenKeys(data))
  const values = flattenValues(data)

  it('has exactly the same key set as en.json (no missing or extra keys)', () => {
    const missing = [...enKeys].filter((k) => !keys.has(k))
    const extra = [...keys].filter((k) => !enKeys.has(k))
    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })

  it('has no empty or non-string values', () => {
    const bad = Object.entries(values).filter(([, v]) => typeof v !== 'string' || v.trim() === '')
    expect(bad.map(([k]) => k)).toEqual([])
  })

  it('preserves every interpolation argument name exactly (renamed/dropped placeholders would break at render time)', () => {
    const mismatches: string[] = []
    for (const key of enKeys) {
      const enArgs = argNamesOf(enValues[key])
      if (enArgs.length === 0) continue
      const otherArgs = argNamesOf(values[key])
      if (enArgs.join(',') !== otherArgs.join(',')) {
        mismatches.push(`${key}: en=[${enArgs.join(',')}] ${code}=[${otherArgs.join(',')}]`)
      }
    }
    expect(mismatches).toEqual([])
  })

  // Threshold set above every locale's observed rate at the time all 24
  // catalogs were added (2026-09-27): most sit at 1-7% (short nav/UI labels
  // like "Email"/"Status" are common English loanwords even in translated
  // catalogs), but Tagalog's business/tech register legitimately keeps a
  // larger share of terms in English (~23%, verified by manual spot-check —
  // "Dashboard", "Status", "Billing" etc. are normal Filipino professional
  // usage, not an untranslated file). 30% still catches an actually-untouched
  // copy of en.json (which would be ~100% identical).
  it('is a real translation, not a copy of en.json (fewer than 30% of values are byte-identical to English)', () => {
    const total = Object.keys(enValues).length
    const identical = Object.keys(enValues).filter((k) => values[k] === enValues[k]).length
    expect(identical / total).toBeLessThan(0.3)
  })
})

describe('supported language count (migration 0054)', () => {
  it('has all 24 locale catalogs (4 original + 20 added)', () => {
    const expected = [
      'en', 'es', 'pa', 'ur',
      'ru', 'uk', 'mn', 'ar', 'so', 'ht', 'pt', 'vi', 'zh', 'ko',
      'tl', 'fr', 'pl', 'ro', 'de', 'hi', 'gu', 'am', 'fa', 'ne',
    ].sort()
    const actual = readdirSync(MESSAGES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort()
    expect(actual).toEqual(expected)
  })
})
