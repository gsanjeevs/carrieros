export const AVATAR_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const
export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number]

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024

const EXTENSION: Record<AvatarContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
}

export function buildAvatarStoragePath(orgId: number, userId: string, uuid: string, contentType: AvatarContentType): string {
  return `${orgId}/profiles/${userId}/avatar-${uuid}.${EXTENSION[contentType]}`
}

export function isIssuedAvatarPath(path: string, orgId: number, userId: string): boolean {
  return new RegExp(`^${orgId}/profiles/${userId}/avatar-[0-9a-f-]{36}\\.(jpg|png|webp|heic)$`).test(path)
}
