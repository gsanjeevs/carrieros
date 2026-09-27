// POST/DELETE /api/v1/me/avatar — self-service profile photo storage.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { OkResponseSchema, UploadAvatarBodySchema } from '@/server/contract/schemas'

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
}
const MAX_BYTES = 5 * 1024 * 1024

export async function POST(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed

  let json: unknown
  try { json = await request.json() } catch { return apiError('VALIDATION_ERROR', 'Body must be JSON', 400) }
  const body = UploadAvatarBodySchema.safeParse(json)
  if (!body.success) return apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid avatar', 400)

  const bytes = Buffer.from(body.data.base64, 'base64')
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return apiError('VALIDATION_ERROR', 'Avatar must be between 1 byte and 5 MB', 413)

  const { data: oldProfile, error: oldError } = await authed.supabase
    .from('profiles').select('avatar_path').eq('id', authed.user.id).single()
  if (oldError) return apiError('INTERNAL_ERROR', 'Could not load profile', 500)

  const path = `${authed.user.id}/${crypto.randomUUID()}.${EXTENSION[body.data.content_type]}`
  const { error: uploadError } = await authed.supabase.storage.from('avatars').upload(path, bytes, {
    contentType: body.data.content_type,
    upsert: false,
  })
  if (uploadError) return apiError('INTERNAL_ERROR', 'Could not store avatar', 500)

  const { error: updateError } = await authed.supabase.from('profiles').update({ avatar_path: path }).eq('id', authed.user.id)
  if (updateError) {
    await authed.supabase.storage.from('avatars').remove([path])
    return apiError('INTERNAL_ERROR', 'Could not save avatar', 500)
  }
  if (oldProfile.avatar_path) await authed.supabase.storage.from('avatars').remove([oldProfile.avatar_path])
  return NextResponse.json(OkResponseSchema.parse({ ok: true }))
}

export async function DELETE(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed
  const { data: profile, error } = await authed.supabase.from('profiles').select('avatar_path').eq('id', authed.user.id).single()
  if (error) return apiError('INTERNAL_ERROR', 'Could not load profile', 500)
  if (profile.avatar_path) await authed.supabase.storage.from('avatars').remove([profile.avatar_path])
  const { error: updateError } = await authed.supabase.from('profiles').update({ avatar_path: null }).eq('id', authed.user.id)
  if (updateError) return apiError('INTERNAL_ERROR', 'Could not remove avatar', 500)
  return NextResponse.json(OkResponseSchema.parse({ ok: true }))
}
