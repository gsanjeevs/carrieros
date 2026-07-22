// app/api/admin/orgs/[org_id]/notes/route.ts
// ShipmentX admin console — add a note to a carrier org (Phase 8
// foundation, 2026-07-22). Any sx_* role may add a note.
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, apiError } from '@/lib/api-auth'
import { requireAdminRole } from '@/lib/admin-auth'

export async function POST(request: NextRequest, { params }: { params: Promise<{ org_id: string }> }) {
  const ctx = await requireAdminRole(request)
  if (isErrorResponse(ctx)) return ctx
  const { admin, userId } = ctx

  const orgId = Number((await params).org_id)
  if (!Number.isInteger(orgId)) return apiError('VALIDATION_ERROR', 'org_id must be an integer', 400)

  const body = await request.json()
  const noteBody = typeof body?.body === 'string' ? body.body.trim() : ''
  if (!noteBody) return apiError('VALIDATION_ERROR', 'A non-empty note body is required', 400)

  const { data: note, error } = await admin
    .from('admin_notes')
    .insert({ org_id: orgId, body: noteBody, admin_id: userId })
    .select('id, body, admin_id, created_at')
    .single()

  if (error) {
    console.error('[admin/orgs/:id/notes] insert:', error)
    return apiError('SERVER_ERROR', error.message, 500)
  }

  await admin.from('admin_events').insert({
    org_id: orgId,
    admin_id: userId,
    event_type: 'admin.note_add',
    metadata: { note_id: note.id },
  })

  return NextResponse.json(note, { status: 201 })
}
