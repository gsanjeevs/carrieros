import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MIN_PASSWORD_LENGTH, passwordMeetsPolicy } from '@/lib/password-policy'

describe('password policy', () => {
  it('accepts 12+ chars with upper, lower and a digit', () => {
    expect(passwordMeetsPolicy('Abcdefghij12')).toBe(true)
  })
  it.each([
    ['too short', 'Abcdefgh12'],
    ['no uppercase', 'abcdefghij12'],
    ['no lowercase', 'ABCDEFGHIJ12'],
    ['no digit', 'Abcdefghijkl'],
  ])('rejects %s', (_label, pw) => {
    expect(passwordMeetsPolicy(pw)).toBe(false)
  })

  // The app-side check must not drift from what Supabase Auth actually enforces.
  it('matches supabase/config.toml', () => {
    const toml = readFileSync(path.resolve(__dirname, '../../supabase/config.toml'), 'utf8')
    expect(Number(toml.match(/^minimum_password_length\s*=\s*(\d+)/m)![1])).toBe(MIN_PASSWORD_LENGTH)
    expect(toml.match(/^password_requirements\s*=\s*"([^"]*)"/m)![1]).toBe('lower_upper_letters_digits')
  })
})
