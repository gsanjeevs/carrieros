// server/http-errors.ts
// Maps application Results to the existing typed API error contract
// (apiError + ErrorCode in lib/api-auth.ts), so /api/v1 speaks the same
// language as the legacy routes.
import type { DomainError } from './domain/shared/result'
import { apiError, type ErrorCode } from '@/lib/api-auth'

const STATUS: Record<string, number> = {
  VALIDATION_FAILED: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ENTITLEMENT_REQUIRED: 402,
  VERSION_CONFLICT: 409,
  ILLEGAL_TRANSITION: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  REQUEST_IN_PROGRESS: 409,
  PRECONDITION_FAILED: 500,
}

const CODE: Record<string, ErrorCode> = {
  VALIDATION_FAILED: 'VALIDATION_ERROR',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  ENTITLEMENT_REQUIRED: 'TIER_UPGRADE_REQUIRED',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  REQUEST_IN_PROGRESS: 'REQUEST_IN_PROGRESS',
}

export function domainErrorResponse(error: DomainError) {
  return apiError(CODE[error.code] ?? 'SERVER_ERROR', error.detail, STATUS[error.code] ?? 500, error.meta)
}
