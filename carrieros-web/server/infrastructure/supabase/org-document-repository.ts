// server/infrastructure/supabase/org-document-repository.ts
// org_documents rows, through the CALLER'S client (RLS applies:
// owner_solo_org_docs_all / finance_org_docs_select). Table and storage
// convention already exist for the web app (components/CompanyDocuments.tsx);
// this is the same table, reached the /api/v1 way.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { domainError, err, ok, type Result } from '../../domain/shared/result'
import type { ActorContext } from '../../domain/shared/identity'
import type { OrgDocumentRecord, OrgDocumentRepository } from '../../ports'

const COLUMNS = 'id, doc_type, storage_path, expiry_date, created_at'
const toRecord = (r: { id: number; doc_type: string; storage_path: string; expiry_date: string | null; created_at: string | null }): OrgDocumentRecord => ({
  id: Number(r.id),
  docType: r.doc_type,
  storagePath: r.storage_path,
  expiryDate: r.expiry_date,
  createdAt: r.created_at,
})

export class SupabaseOrgDocumentRepository implements OrgDocumentRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async findByPath(actor: ActorContext, storagePath: string): Promise<Result<OrgDocumentRecord | null>> {
    const { data, error } = await this.supabase.from('org_documents').select(COLUMNS).eq('org_id', actor.orgId).eq('storage_path', storagePath).maybeSingle()
    if (error) return err(domainError('PRECONDITION_FAILED', `org document lookup failed: ${error.message}`))
    return ok(data ? toRecord(data) : null)
  }

  async insert(actor: ActorContext, input: { docType: string; storagePath: string; expiryDate: string | null }): Promise<Result<OrgDocumentRecord>> {
    const { data, error } = await this.supabase
      .from('org_documents')
      .insert({ org_id: actor.orgId, doc_type: input.docType, storage_path: input.storagePath, expiry_date: input.expiryDate, uploaded_by: actor.userId })
      .select(COLUMNS)
      .single()
    if (error || !data) return err(domainError('PRECONDITION_FAILED', `org document insert failed: ${error?.message}`))
    return ok(toRecord(data))
  }

  async list(actor: ActorContext): Promise<Result<readonly OrgDocumentRecord[]>> {
    const { data, error } = await this.supabase
      .from('org_documents')
      .select(COLUMNS)
      .eq('org_id', actor.orgId)
      .order('created_at', { ascending: false })
    if (error) return err(domainError('PRECONDITION_FAILED', `org document list failed: ${error.message}`))
    return ok((data ?? []).map(toRecord))
  }
}
