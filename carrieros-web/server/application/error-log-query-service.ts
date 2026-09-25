// server/application/error-log-query-service.ts
// Read use case for the ShipmentX admin "Debug / Error Log" viewer (migration
// 0038). No authorization gate here — that already happened in the route via
// requireAdminRole() (lib/admin-auth.ts), exactly like app/api/admin/audit's
// route; adding a second, possibly-drifting role check here would risk
// disagreeing with it.
import type { Result } from '../domain/shared/result'
import type { ErrorLogFilters, ErrorLogQueryRepository, ErrorLogRow } from '../ports'

export class ErrorLogQueryService {
  constructor(private readonly deps: { readonly errorLog: ErrorLogQueryRepository }) {}

  async list(filters: ErrorLogFilters): Promise<Result<{ readonly rows: readonly ErrorLogRow[]; readonly total: number }>> {
    return this.deps.errorLog.list(filters)
  }
}
