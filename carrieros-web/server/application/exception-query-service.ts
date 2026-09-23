// server/application/exception-query-service.ts
// Read use case for the org's exception feed (get_exceptions()). No extra
// application-layer gate: the RPC itself already filters by role internally
// (owner/solo/dispatcher/finance; a driver call returns an empty set), and
// adding a second, possibly-drifting role list here would risk disagreeing
// with it.
import type { Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { ExceptionQueryRepository, ExceptionRow } from '../ports'

export class ExceptionQueryService {
  constructor(private readonly deps: { readonly exceptions: ExceptionQueryRepository }) {}

  async list(actor: ActorContext): Promise<Result<readonly ExceptionRow[]>> {
    return this.deps.exceptions.list(actor)
  }
}
