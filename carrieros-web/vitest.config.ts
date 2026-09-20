import { defineConfig, configDefaults } from 'vitest/config'
import path from 'node:path'

// These tests are integration tests against the real local Supabase/Postgres
// instance (docker exec supabase_db_carrieros) — RLS behavior is enforced
// by Postgres itself and can't be meaningfully verified with mocks. Every
// test creates and tears down its own disposable org/user data (see
// tests/helpers.ts) rather than touching the persistent demo accounts
// (demo@carrieros.dev, Sierra Freight Co) documented in root CLAUDE.md.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globalSetup: ['./tests/global-teardown.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Sequential, not parallel — tests share one local Postgres instance and
    // some (entity numbering, admin-role checks) are order-sensitive within
    // their own describe block; cross-file parallelism is still fine.
    fileParallelism: true,
    // *.golden.test.ts hits the real Anthropic API (real tokens, real
    // latency, non-deterministic-ish output) — excluded from the default
    // `npm test` run so the fast/free suite stays fast and free. Run
    // explicitly via `npm run test:extraction`.
    //
    // tests/audit/** are black-box probes from the 2026-09-20 roles/tiers/billing/localization audit. Many are
    // RED ON PURPOSE (each red test is an open finding), so they stay out of the default run and CI until the
    // fix lands; when one is fixed, promote its assertion into a normal test. Run them: `npm run test:audit`.
    exclude: [...configDefaults.exclude, '**/*.golden.test.ts', 'tests/audit/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
