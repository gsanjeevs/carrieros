import { test, expect } from '@playwright/test'
import { login, SUPERADMIN } from './helpers'

test('sx_owner reaches the SuperAdmin triage queue', async ({ page }) => {
  await login(page, SUPERADMIN.email, SUPERADMIN.password)

  await page.goto('/admin')
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: 'Triage Queue' })).toBeVisible()
})
