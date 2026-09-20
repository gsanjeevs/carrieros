// server/application/change-feed-service.ts
// Use cases behind the live-update stream. Signals are entity-level and carry
// no ids or data: a driver learns only "loads changed", then refetches through
// the API, which applies their role and tenant rules as for any read. That is
// what keeps live updates from becoming a second, unfiltered data path.

import { isChangeEntity, type ChangeEntity } from '../domain/events/entities'
import { ok, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { ChangeFeedRepository, Clock } from '../ports'

export interface PolledChanges {
  /** Highest id seen; pass it back as `afterId` on the next poll. */
  readonly cursor: number
  /** Distinct entities that changed since `afterId`, in first-seen order. */
  readonly entities: readonly ChangeEntity[]
}

const BATCH = 200
const RETENTION_MS = 24 * 60 * 60 * 1000

export class ChangeFeedService {
  constructor(private readonly deps: { readonly feed: ChangeFeedRepository; readonly clock: Clock }) {}

  /** Where a brand-new subscriber starts: "now", so it is not flooded with history. */
  currentCursor(actor: ActorContext): Promise<Result<number>> {
    return this.deps.feed.latestId(actor.orgId)
  }

  async poll(
    actor: ActorContext,
    afterId: number,
    wanted: readonly ChangeEntity[]
  ): Promise<Result<PolledChanges>> {
    const read = await this.deps.feed.readAfter(actor.orgId, afterId, BATCH)
    if (!read.ok) return read

    let cursor = afterId
    const seen = new Set<ChangeEntity>()
    for (const signal of read.value) {
      cursor = Math.max(cursor, signal.id)
      if (isChangeEntity(signal.entity) && wanted.includes(signal.entity)) seen.add(signal.entity)
    }
    return ok({ cursor, entities: [...seen] })
  }

  /** Best-effort retention; failure here must never affect a subscriber. */
  async prune(): Promise<void> {
    await this.deps.feed.pruneOlderThan(new Date(this.deps.clock.now().getTime() - RETENTION_MS))
  }
}
