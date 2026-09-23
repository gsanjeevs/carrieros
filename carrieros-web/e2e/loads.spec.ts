import { test, expect } from '@playwright/test'
import { login, OWNER } from './helpers'

test('owner creates a load, sees it in the list, and opens its detail page', async ({ page }) => {
  await login(page, OWNER.email, OWNER.password)

  await page.goto('/loads/new/manual')
  const customerName = `E2E Test Shipper ${Date.now()}`
  await page.getByLabel('Customer / Broker').fill(customerName)
  await page.locator('#pickup_city').fill('Sacramento')
  await page.locator('#pickup_state').fill('CA')
  await page.locator('#delivery_city').fill('Reno')
  await page.locator('#delivery_state').fill('NV')

  await page.getByRole('button', { name: 'Create Load' }).click()

  await page.waitForURL(/\/loads\?created=/)
  await expect(page.getByText(/created successfully/)).toBeVisible()

  const loadNumber = new URL(page.url()).searchParams.get('created')
  expect(loadNumber).toBeTruthy()

  // Each row is a `<Link>` wrapping its whole card (load number, status,
  // customer, route all inside one anchor), so its accessible name includes
  // all of that text — match by href instead of by name.
  const row = page.locator(`a[href="/loads/${loadNumber}"]`)
  await expect(row).toBeVisible()
  await expect(row.getByText(loadNumber!)).toBeVisible()
  await row.click()

  await page.waitForURL(new RegExp(`/loads/${loadNumber}$`))
  await expect(page.getByRole('heading', { name: loadNumber! })).toBeVisible()
  // The detail page's route strip separates pickup/delivery with a Material
  // Symbols icon ligature ("arrow_forward"), not the "→" glyph the loads
  // list row uses for the same route text — assert each city independently
  // instead of the combined string.
  await expect(page.getByText('Sacramento, CA').first()).toBeVisible()
  await expect(page.getByText('Reno, NV').first()).toBeVisible()
})
