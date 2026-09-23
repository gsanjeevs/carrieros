// server/infrastructure/supabase/exception-query-repository.ts
// get_exceptions(): SECURITY DEFINER, no arguments — org scoping (my_org_id())
// and role filtering (owner/solo/dispatcher/finance) both happen inside the
// function, so this adapter is a thin pass-through through the caller's own client.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { ExceptionQueryRepository, ExceptionRow } from '../../ports'

export class SupabaseExceptionQueryRepository implements ExceptionQueryRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async list(_actor: ActorContext): Promise<Result<readonly ExceptionRow[]>> {
    const { data, error } = await this.supabase.rpc('get_exceptions')
    if (error) return err(domainError('PRECONDITION_FAILED', `exceptions list failed: ${error.message}`))
    return ok((data ?? []) as unknown as ExceptionRow[])
  }
}
