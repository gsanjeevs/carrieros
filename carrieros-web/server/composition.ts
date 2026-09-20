// server/composition.ts
// The one place concrete adapters are wired to application services. Callers
// (API route handlers and web Server Components) pass in the request-scoped
// Supabase client; nothing here holds a module-level client, so tenant scoping
// is always the caller's own session.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { LoadQueryService } from './application/load-query-service'
import { SupabaseLoadReadRepository } from './infrastructure/supabase/load-read-repository'

export function createLoadQueryService(supabase: SupabaseClient<Database>): LoadQueryService {
  return new LoadQueryService({ loads: new SupabaseLoadReadRepository(supabase) })
}

// The change feed is read with the service role (client roles have no access to
// change_events). Callers must only ever pass org ids from a verified ActorContext.
import { ChangeFeedService } from './application/change-feed-service'
import { SupabaseChangeFeedRepository } from './infrastructure/supabase/change-feed-repository'
import { createAdminClient } from '@/lib/supabase/server'

export function createChangeFeedService(): ChangeFeedService {
  return new ChangeFeedService({
    feed: new SupabaseChangeFeedRepository(createAdminClient()),
    clock: { now: () => new Date() },
  })
}
