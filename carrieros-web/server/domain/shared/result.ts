// server/domain/shared/result.ts
// Explicit success/failure values for domain and application operations.
//
// Domain code does not throw for expected outcomes. "This tender was already
// accepted" and "this milestone is out of order" are ordinary business results
// that a caller must handle, not exceptional conditions — modelling them as
// thrown errors makes them invisible to the type system and easy to swallow in
// a catch that was meant for something else. Exceptions remain reserved for
// genuine faults (a failed database connection, a bug).
//
// This file is intentionally dependency-free. Everything under server/domain
// must be runnable without Next.js, React, Supabase, or any HTTP object — see
// scripts/check-architecture.mjs, which enforces that.

export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok
}

/**
 * Stable, language-neutral failure codes.
 *
 * These cross the API boundary verbatim and clients map them to localized
 * copy (next-intl on web, i18n-js on mobile). They are part of the public
 * contract: renaming one is a breaking API change. Human-readable text in
 * `detail` is for logs and developers, never for direct display.
 */
export type DomainErrorCode =
  // Input the caller could fix
  | 'VALIDATION_FAILED'
  // The requested transition is not legal from the aggregate's current state
  | 'ILLEGAL_TRANSITION'
  // Someone else changed the aggregate since the caller read it
  | 'VERSION_CONFLICT'
  // Caller is authenticated but not permitted
  | 'FORBIDDEN'
  // Caller's plan/subscription does not include this capability
  | 'ENTITLEMENT_REQUIRED'
  // A usage allowance for the current period is exhausted
  | 'LIMIT_EXCEEDED'
  | 'NOT_FOUND'
  // Same Idempotency-Key replayed with a different request body
  | 'IDEMPOTENCY_KEY_REUSED'
  // The same Idempotency-Key is still being processed by another request
  | 'REQUEST_IN_PROGRESS'
  // A precondition about related data failed (e.g. load not delivered yet)
  | 'PRECONDITION_FAILED'
  // The actor may not perform this step on this record (segregation of duties)
  | 'SEGREGATION_OF_DUTIES'

export interface DomainError {
  readonly code: DomainErrorCode
  /** Developer-facing. Never rendered to end users. */
  readonly detail: string
  /** Field-level problems, keyed by JSON pointer-ish path. */
  readonly fields?: Readonly<Record<string, string>>
  /**
   * Machine-readable context for the caller — e.g. which capability was
   * missing, what the current state actually was. Must not contain data the
   * caller is not authorized to see.
   */
  readonly meta?: Readonly<Record<string, string | number | boolean | null>>
}

export const domainError = (
  code: DomainErrorCode,
  detail: string,
  extra?: Pick<DomainError, 'fields' | 'meta'>
): DomainError => ({ code, detail, ...extra })

// Constructors for the cases used often enough that spelling them out at each
// call site adds noise rather than clarity.
export const validationFailed = (detail: string, fields?: Record<string, string>) =>
  domainError('VALIDATION_FAILED', detail, { fields })

export const illegalTransition = (from: string, to: string, aggregate: string) =>
  domainError('ILLEGAL_TRANSITION', `${aggregate} cannot move from ${from} to ${to}`, {
    meta: { aggregate, from, to },
  })

export const versionConflict = (expected: number, actual: number) =>
  domainError(
    'VERSION_CONFLICT',
    `Expected version ${expected} but the record is at ${actual}`,
    { meta: { expectedVersion: expected, actualVersion: actual } }
  )

export const notFound = (aggregate: string) =>
  domainError('NOT_FOUND', `${aggregate} not found`, { meta: { aggregate } })

export const forbidden = (detail: string, meta?: Record<string, string>) =>
  domainError('FORBIDDEN', detail, { meta })
