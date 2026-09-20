// server/infrastructure/supabase/document-repository.ts
// documents rows, through the caller's client (RLS applies). Org and uploader
// come from the ActorContext, never from request input.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { DocumentRecord, DocumentRepository } from '../../ports'

const COLUMNS = 'id, type, storage_path, created_at'
const toRecord = (r: { id: number; type: string | null; storage_path: string | null; created_at: string | null }): DocumentRecord => ({
  id: Number(r.id),
  type: r.type ?? '',
  storagePath: r.storage_path ?? '',
  createdAt: r.created_at,
})

export class SupabaseDocumentRepository implements DocumentRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async findByPath(actor: ActorContext, storagePath: string): Promise<Result<DocumentRecord | null>> {
    const { data, error } = await this.supabase.from('documents').select(COLUMNS).eq('carrier_org_id', actor.orgId).eq('storage_path', storagePath).maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `document lookup failed: ${error.message}`))
    return ok(data ? toRecord(data) : null)
  }

  async insert(actor: ActorContext, input: { loadId: number; type: string; storagePath: string }): Promise<Result<DocumentRecord>> {
    const { data, error } = await this.supabase
      .from('documents')
      .insert({ load_id: input.loadId, carrier_org_id: actor.orgId, type: input.type, storage_path: input.storagePath, uploaded_by: actor.userId })
      .select(COLUMNS)
      .single()
    if (error || !data) return err(domainError('PRECONDITION_FAILED', `document insert failed: ${error?.message}`))
    return ok(toRecord(data))
  }

  async listForLoad(actor: ActorContext, loadId: number, type: string): Promise<Result<readonly DocumentRecord[]>> {
    const { data, error } = await this.supabase
      .from('documents')
      .select(COLUMNS)
      .eq('carrier_org_id', actor.orgId)
      .eq('load_id', loadId)
      .eq('type', type)
      .order('created_at', { ascending: false })
    if (error) return err(domainError('PRECONDITION_FAILED', `document list failed: ${error.message}`))
    return ok((data ?? []).map(toRecord))
  }
}
