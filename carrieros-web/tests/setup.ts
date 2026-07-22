// tests/setup.ts — loads carrieros-web/.env.local so tests see the same
// NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY the app itself uses.
// Vitest runs as a standalone process, unlike `next dev`, which loads
// .env.local automatically — this is the one place that gap gets closed.
import { config } from 'dotenv'
import path from 'node:path'

config({ path: path.resolve(__dirname, '..', '.env.local') })

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in carrieros-web/.env.local ' +
    '(local Supabase must be running: docker ps | grep supabase_db_carrieros)'
  )
}
