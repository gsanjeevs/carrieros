import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Pure contract tests do not need the local Supabase setup used by the
// integration suite, so they remain runnable in generation-only environments.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/contract-*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
