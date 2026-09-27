// POST/DELETE /api/v1/me/avatar — self-service profile photo storage.
import { NextRequest, NextResponse } from 'next/server'
import { apiError, getAuthedContext, isErrorResponse } from '@/lib/api-auth'
import { createStorageProvider } from '@/lib/storage'
import { getProfileForUser, updateProfileAvatarPath } from '@/lib/queries/profiles'
import { OkResponseSchema, UploadAvatarBodySchema } from '@/server/contract/schemas'

const AVATARS_BUCKET = 'avatars'

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

  const { data: oldProfile, error: oldError } = await getProfileForUser(authed.supabase, authed.user.id)
  if (oldError) return apiError('SERVER_ERROR', 'Could not load profile', 500)

  const storage = createStorageProvider(authed.supabase, AVATARS_BUCKET)
  const path = `${authed.user.id}/${crypto.randomUUID()}.${EXTENSION[body.data.content_type]}`
  try {
    await storage.uploadFile(path, new Blob([bytes]), body.data.content_type)
  } catch {
    return apiError('SERVER_ERROR', 'Could not store avatar', 500)
  }

  const { error: updateError } = await updateProfileAvatarPath(authed.supabase, authed.user.id, path)
  if (updateError) {
    await storage.remove([path])
    return apiError('SERVER_ERROR', 'Could not save avatar', 500)
  }
  if (oldProfile.avatar_path) await storage.remove([oldProfile.avatar_path])
  return NextResponse.json(OkResponseSchema.parse({ ok: true }))
}

export async function DELETE(request: NextRequest) {
  const authed = await getAuthedContext(request)
  if (isErrorResponse(authed)) return authed
  const { data: profile, error } = await getProfileForUser(authed.supabase, authed.user.id)
  if (error) return apiError('SERVER_ERROR', 'Could not load profile', 500)
  if (profile.avatar_path) await createStorageProvider(authed.supabase, AVATARS_BUCKET).remove([profile.avatar_path])
  const { error: updateError } = await updateProfileAvatarPath(authed.supabase, authed.user.id, null)
  if (updateError) return apiError('SERVER_ERROR', 'Could not remove avatar', 500)
  return NextResponse.json(OkResponseSchema.parse({ ok: true }))
}
