// server/application/load-query-service.ts
// Read use cases for loads. This is where "who may see what" is decided, once,
// for every client: the web page renders from it in-process, and the
// /api/v1/loads endpoint (used by mobile and by web client components) returns
// it as JSON. Before this existed, mobile enforced "drivers never see rate" by
// switching to a database view while web queried the base table and merely hid
// the column in the UI.
//
// Imports only domain, ports, and the generated (pure-data) capability table.

import { LOAD_STATUS_GROUPS, type LoadStatusGroup } from '../domain/load/status-groups'
import type { LoadSummary } from '../domain/load/read-model'
import { roleHasCapability } from '../../lib/generated/role-capabilities'
import { ok, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { LoadReadRepository } from '../ports'

export interface ListLoadsInput {
  readonly statusGroup?: LoadStatusGroup
  readonly limit?: number
}

export interface ListLoadsOutput {
  readonly loads: readonly LoadSummary[]
  readonly canSeeRate: boolean
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export class LoadQueryService {
  constructor(private readonly deps: { readonly loads: LoadReadRepository }) {}

  async list(actor: ActorContext, input: ListLoadsInput = {}): Promise<Result<ListLoadsOutput>> {
    const canSeeRate = roleHasCapability(actor.role, 'invoice_actions')
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

    const result = await this.deps.loads.listForActor(actor, {
      statuses: input.statusGroup ? LOAD_STATUS_GROUPS[input.statusGroup] : undefined,
      limit,
      includeRate: canSeeRate,
    })
    if (!result.ok) return result

    return ok({ loads: result.value, canSeeRate })
  }
}
