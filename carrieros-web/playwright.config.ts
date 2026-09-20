import { defineConfig, devices } from '@playwright/test'

// This machine has an unrelated Docker container (open-webui) permanently
// bound to :3000, so `next dev` on the default port silently talks to the
// wrong server (a wall of false 401/403/404s that look like broken auth).
// Force a port that's actually free instead of assuming 3000 works — see
// .claude/memory/project_test_port_3000_conflict.md.
const PORT = process.env.PLAYWRIGHT_PORT ?? '3100'
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `PORT=${PORT} npm run dev`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
