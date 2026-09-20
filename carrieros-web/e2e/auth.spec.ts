import { test, expect } from '@playwright/test'
import { login, OWNER } from './helpers'

test('owner logs in and lands on the fleet dashboard', async ({ page }) => {
  await login(page, OWNER.email, OWNER.password)

  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: 'Fleet Overview' })).toBeVisible()

  // The dashboard itself never renders the carrier org's name (verified by
  // reading OwnerView/Sidebar — neither fetches `organizations.name`); the
  // sidebar identifies the account by user name + role instead. Assert that,
  // since asserting text the page doesn't render would be meaningless.
  await expect(page.getByText('Sam Rivera')).toBeVisible()
})
