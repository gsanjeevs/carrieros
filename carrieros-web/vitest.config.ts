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
    exclude: [...configDefaults.exclude, '**/*.golden.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
