import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { brandForegroundColor, brandingCssVars } from '@/lib/domain/branding'
import { loadStatusColor } from '@/lib/domain/load-status'

const globalCss = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

function themeColor(selector: ':root' | '.dark', token: string): string {
  const blocks = [...globalCss.matchAll(/(:root|\.dark)\s*\{([^}]*)\}/g)]
  const block = blocks.filter((match) => match[1] === selector && match[2].includes('--status-dispatched-text')).at(-1)
  const value = block?.[2].match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
  if (!value) throw new Error(`Missing ${token} value for ${selector}`)
  return value
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/.{2}/g)!.map((channel) => Number.parseInt(channel, 16) / 255)
    const [red, green, blue] = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    )
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const left = luminance(foreground)
  const right = luminance(background)
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05)
}

describe('carrier brand tokens', () => {
  it('uses a readable dark foreground on the default orange', () => {
    expect(brandForegroundColor('#f47920')).toBe('#000000')
    expect(brandForegroundColor('#1abc9c')).toBe('#000000')
  })

  it('uses white on a dark customer-selected brand color', () => {
    expect(brandForegroundColor('#123456')).toBe('#ffffff')
  })

  it('uses black near the midpoint to preserve WCAG AA contrast', () => {
    expect(brandForegroundColor('#777777')).toBe('#000000')
  })

  it('only emits primary foreground variables for valid custom colors', () => {
    expect(brandingCssVars({ primaryColor: '#123456', accentColor: null })).toEqual({
      '--color-brand-orange': '#123456',
      '--color-brand-on-primary': '#ffffff',
    })
    expect(brandingCssVars({ primaryColor: null, accentColor: '#123456' })).toEqual({
      '--color-teal': '#123456',
      '--color-brand-on-accent': '#ffffff',
    })
    expect(brandingCssVars({ primaryColor: 'url(javascript:alert(1))', accentColor: null })).toEqual({})
  })

  it('registers nested semantic overrides inline for auth and tracking shells', () => {
    expect(globalCss).toMatch(/\.auth-shell\s*\{[^}]*--color-text-primary:\s*#ffffff/)
    expect(globalCss).toMatch(/@theme inline\s*\{[^}]*--color-text-pri:\s*var\(--color-text-primary\)/)
  })

  it('keeps dispatch statuses fixed when organization brand colors change', () => {
    expect(loadStatusColor('dispatched')).toBe('bg-status-dispatched-surface text-status-dispatched')
    expect(loadStatusColor('in_transit')).toBe('bg-status-in-transit-surface text-status-in-transit')
    expect(loadStatusColor('scheduled')).toBe('bg-status-info-surface text-status-info')
    expect(loadStatusColor('cancelled')).toBe('bg-status-danger-surface text-status-danger')
  })

  it('keeps every load-status pair at WCAG AA contrast in both themes', () => {
    const statuses = ['dispatched', 'in-transit', 'neutral', 'info', 'warning', 'success', 'purple', 'danger']
    for (const theme of [':root', '.dark'] as const) {
      for (const status of statuses) {
        const text = themeColor(theme, `status-${status}-text`)
        const surface = themeColor(theme, `status-${status}-surface`)
        expect(contrastRatio(text, surface), `${theme} ${status}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
