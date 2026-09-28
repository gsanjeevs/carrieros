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
    // This is an integration suite against a real Next server + local Supabase.
    // A fresh Next dev process can spend 20–30s compiling its first-hit route;
    // the old 20s ceiling turned cold-start latency into false failures.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // All files share one local Postgres/Storage stack and a single Next test
    // server. Keep concurrency low enough to avoid dropping connections to
    // that server while it compiles routes and serves the integration suite.
    maxWorkers: 2,
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
    // fix lands; when one is fixed, promote its assertion into a normal test. Run them: `npm run test:audit` (vitest.audit.config.ts).
    //
    // e2e/**/*.spec.ts are Playwright specs (`npm run test:e2e`), not vitest tests — Playwright's
    // test() throws "did not expect test() to be called here" if vitest tries to collect them too,
    // since vitest's default include glob matches *.spec.ts anywhere in the project.
    //
    // Leading '**/' (not a bare 'tests/audit/**') on purpose: a real Next.js build-tracing bug
    // (app/api/admin/roles/regenerate/route.ts's dynamic readFileSync calls, fixed alongside this)
    // used to copy the ENTIRE repo -- tests/ included -- into .next/standalone/, so `npm test` run
    // against a built app picked up a second, un-excluded copy at .next/standalone/tests/audit/**
    // (a bare prefix glob only anchors at the project root) and failed CI on every commit for over
    // a week on these deliberately-red probes. The build-tracing fix removes the duplication at its
    // source; this is defense in depth against the same class of anchoring mistake recurring.
    exclude: [...configDefaults.exclude, '**/*.golden.test.ts', '**/tests/audit/**', 'e2e/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
