// server/application/idempotency.ts
// Wraps a command so a retry (offline replay, double-tap, proxy resend) applies
// exactly once. Successes are stored and replayed; failures release the key so the
// client can retry.
import { domainError, err, ok, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import type { IdempotencyRepository } from '../ports'

export async function withIdempotency<T>(
  repo: IdempotencyRepository,
  actor: ActorContext,
  endpoint: string,
  key: string,
  requestBody: unknown,
  work: () => Promise<Result<T>>
): Promise<Result<T>> {
  const begun = await repo.begin(actor, endpoint, key, requestBody)
  if (!begun.ok) return begun

  switch (begun.value.kind) {
    case 'replay':
      return ok(begun.value.responseBody as T)
    case 'in_progress':
      return err(domainError('REQUEST_IN_PROGRESS', 'The same request is still being processed'))
    case 'key_reused':
      return err(domainError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request'))
    case 'proceed':
      break
  }

  let result: Result<T>
  try {
    result = await work()
  } catch (e) {
    await repo.abandon(actor, endpoint, key)
    throw e
  }

  if (!result.ok) {
    await repo.abandon(actor, endpoint, key)
    return result
  }
  // The work is done; failing to store the response only costs a future replay
  // its shortcut, so it must not turn a success into an error.
  await repo.complete(actor, endpoint, key, result.value)
  return result
}
