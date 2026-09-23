import { test, expect } from '@playwright/test'
import { login, OWNER } from './helpers'

// Demo load L-1 is billable (status 'invoiced') but demo data does not
// ship a materialized invoice row for it, so the "Create Invoice" button on
// its detail page is available — unless a previous run of this same test
// already created one, in which case the load detail page instead shows a
// link to the existing invoice. Either way we land on an invoice detail
// page and can exercise "mark paid" idempotently (the button disables once
// already paid).
test('owner views an invoice and marks it paid', async ({ page }) => {
  await login(page, OWNER.email, OWNER.password)

  await page.goto('/loads/L-1')

  const createButton = page.getByRole('button', { name: 'Create Invoice' })
  // The link's accessible name includes the material-icon ligature text
  // ("receipt_long INV-1"), not just the invoice number — match as a
  // substring rather than anchoring the whole name.
  const existingInvoiceLink = page.getByRole('link', { name: /INV-\d+/ })

  if (await createButton.isVisible().catch(() => false)) {
    await createButton.click()
    await page.waitForURL(/\/invoices\/INV-\d+$/)
  } else {
    await expect(existingInvoiceLink).toBeVisible()
    await existingInvoiceLink.click()
    await page.waitForURL(/\/invoices\/INV-\d+$/)
  }

  const invoiceNumber = page.url().split('/').pop()!
  await expect(page.getByRole('heading', { name: invoiceNumber })).toBeVisible()

  const markPaidButton = page.getByRole('button', { name: 'Mark as Paid' })
  await expect(markPaidButton).toBeVisible()

  if (await markPaidButton.isEnabled()) {
    await markPaidButton.click()
    await expect(markPaidButton).toBeDisabled()
  }

  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible()
})
