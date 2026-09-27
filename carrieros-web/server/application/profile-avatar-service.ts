import { err, ok, validationFailed, type Result } from '../domain/shared/result'
import type { ActorContext } from '../domain/shared/identity'
import { buildAvatarStoragePath, isIssuedAvatarPath, MAX_AVATAR_BYTES, type AvatarContentType } from '../domain/profile/avatar-upload'
import type { ObjectStorage, ProfileWriteRepository } from '../ports'

export interface AvatarUploadIntent {
  readonly uploadUrl: string
  readonly storagePath: string
  readonly contentType: AvatarContentType
}

export class ProfileAvatarService {
  constructor(private readonly deps: {
    readonly profiles: ProfileWriteRepository
    readonly storage: ObjectStorage
    readonly ids: { uuid(): string }
  }) {}

  async requestUpload(actor: ActorContext, input: { contentType: AvatarContentType; sizeBytes: number }): Promise<Result<AvatarUploadIntent>> {
    if (input.sizeBytes <= 0 || input.sizeBytes > MAX_AVATAR_BYTES) {
      return err(validationFailed('Avatar must be between 1 byte and 5 MB', { size_bytes: 'INVALID' }))
    }
    const storagePath = buildAvatarStoragePath(actor.orgId, actor.userId, this.deps.ids.uuid(), input.contentType)
    const uploadUrl = await this.deps.storage.createUploadUrl(storagePath)
    if (!uploadUrl.ok) return uploadUrl
    return ok({ uploadUrl: uploadUrl.value, storagePath, contentType: input.contentType })
  }

  async finalize(actor: ActorContext, storagePath: string): Promise<Result<void>> {
    if (!isIssuedAvatarPath(storagePath, actor.orgId, actor.userId)) {
      return err(validationFailed('That path was not issued for this profile', { storage_path: 'NOT_ISSUED' }))
    }
    const present = await this.deps.storage.exists(storagePath)
    if (!present.ok) return present
    if (!present.value) return err(validationFailed('No uploaded avatar found at that path', { storage_path: 'UPLOAD_NOT_FOUND' }))

    const oldPath = await this.deps.profiles.getAvatarPath(actor)
    if (!oldPath.ok) return oldPath
    const updated = await this.deps.profiles.updateAvatarPath(actor, storagePath)
    if (!updated.ok) {
      await this.deps.storage.remove([storagePath])
      return updated
    }
    if (oldPath.value && oldPath.value !== storagePath) await this.deps.storage.remove([oldPath.value])
    return ok(undefined)
  }

  async delete(actor: ActorContext): Promise<Result<void>> {
    const current = await this.deps.profiles.getAvatarPath(actor)
    if (!current.ok) return current
    const updated = await this.deps.profiles.updateAvatarPath(actor, null)
    if (!updated.ok) return updated
    if (current.value) await this.deps.storage.remove([current.value])
    return ok(undefined)
  }

  async signedUrl(actor: ActorContext, storagePath: string | null): Promise<Result<string | null>> {
    if (!storagePath) return ok(null)
    if (!isIssuedAvatarPath(storagePath, actor.orgId, actor.userId)) return ok(null)
    const url = await this.deps.storage.createDownloadUrl(storagePath, 3600)
    return url.ok ? ok(url.value) : url
  }
}
