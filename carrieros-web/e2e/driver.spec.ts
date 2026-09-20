import { test, expect } from '@playwright/test'
import { login, DRIVER } from './helpers'

test('driver logs in and sees their assigned load', async ({ page }) => {
  await login(page, DRIVER.email, DRIVER.password)

  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByText('Mike Rodriguez')).toBeVisible()
  await expect(page.getByText('My Load Today')).toBeVisible()

  // The driver's active-load card is a `<Link href="/loads/{load_number}">`
  // showing the load number as its heading text — assert one is present
  // rather than hardcoding a specific demo load number, since which load is
  // "active" can shift as demo data is exercised by other tests/sessions.
  const loadLink = page.locator('a[href^="/loads/"]').filter({ hasText: /L-\d+/ })
  await expect(loadLink.first()).toBeVisible()
})
