import { test, expect } from '@playwright/test'
import { login, OWNER } from './helpers'

// Zero test coverage existed for this flow anywhere in the repo before this
// spec. Demo customer C-1 (Sierra Steel Fabricators) starts with no
// contacts, so this test adds one (with a unique name/email per run) and
// then invites it to portal access, rather than depending on seeded contact
// data. The bonus check below confirms the magic-link email actually landed
// in the local Mailpit capture inbox; it doesn't assert the email body.
test('owner adds a customer contact and invites them to portal access', async ({ page }) => {
  await login(page, OWNER.email, OWNER.password)

  await page.goto('/customers/C-1')
  await page.getByRole('tab', { name: 'Contacts' }).click()

  const panel = page.getByRole('tabpanel')
  const contactName = `E2E Contact ${Date.now()}`
  const contactEmail = `e2e-contact-${Date.now()}@example.com`

  await panel.locator('input').first().fill(contactName)
  await panel.locator('input[type="email"]').fill(contactEmail)
  await panel.getByRole('button', { name: 'Add Contact' }).click()

  const row = page.getByRole('row', { name: new RegExp(contactName) })
  await expect(row).toBeVisible()
  await expect(row.getByText('Not linked')).toBeVisible()

  await row.getByRole('button', { name: 'Invite to portal' }).click()

  await expect(row.getByText('Linked', { exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Revoke access' })).toBeVisible()

  // Bonus check: lib/send-email.ts falls back to the local Mailpit instance
  // that `supabase start` runs (127.0.0.1:54324, see supabase/config.toml),
  // and the invite route sends a real magic-link email via Supabase Auth's
  // admin inviteUserByEmail. Confirm it actually landed there rather than
  // just trusting the UI state — this repo's whole working pattern is to
  // verify independently instead of taking a success state at face value.
  // Only meaningful against a local Supabase stack — a remote target
  // (PLAYWRIGHT_BASE_URL, e.g. staging) has no local Mailpit to check, and
  // the UI assertions above already confirm the invite succeeded end-to-end.
  if (!process.env.PLAYWRIGHT_BASE_URL) {
    const search = await page.request.get(
      `http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:${contactEmail}`)}`
    )
    expect(search.ok()).toBeTruthy()
    const { messages } = await search.json()
    expect(messages.length).toBeGreaterThan(0)
  }
})
