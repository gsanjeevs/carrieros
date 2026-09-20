// Runs the black-box audit probes in tests/audit/** (excluded from the default config; many are red on purpose —
// each red test is an open finding). Same environment as the default run, but only the audit files.
//   npm run test:audit
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globalSetup: ['./tests/global-teardown.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    include: ['tests/audit/**/*.test.ts'],
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
