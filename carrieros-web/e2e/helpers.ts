import { Page, expect } from '@playwright/test'

export const OWNER = { email: 'demo@carrieros.dev', password: 'Demo123!' }
export const DRIVER = { email: 'mike.driver@carrieros.dev', password: 'Demo123!' }
export const SUPERADMIN = { email: 'info@shipmentx.com', password: 'Demo123!' }

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  // exact: true -- staging's login page also renders a "Sign in with a
  // passkey" button (WebAuthn is configured there, see
  // architecture/deployment.md's "One-time setup already done for staging"),
  // whose accessible name contains "Sign in" as a substring and otherwise
  // makes this locator ambiguous (strict-mode violation).
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  // signInWithEmail always redirects to /dashboard, but proxy.ts's
  // ROLE_ROUTES then bounces roles without the `dashboard` capability
  // onward (sx_* -> /admin, driver -> /my-loads, etc.) before the browser
  // ever renders it — don't assume /dashboard is the final URL for every
  // role. "Sign out" is present in both the tenant Sidebar and AdminSidebar,
  // so it's a reliable "login succeeded" signal regardless of destination.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
}
