import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Separate config (not just a CLI --exclude override — vitest's exclude patterns apply even to an
// explicitly-named test file), same shape as vitest.extraction.config.ts, so the golden-set support-
// triage test can run on its own via `npm run test:support-triage` while staying out of the default
// `npm test` run's exclude list.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 20_000,
    include: ['tests/support-triage.golden.test.ts', 'tests/support-tickets-creation.golden.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
