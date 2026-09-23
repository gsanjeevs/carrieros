// src/lib/local-photo-store.ts
// Durable local storage for photo bytes that back an offline-queued command (DVIR
// signature/defect photos, POD photos). AsyncStorage (lib/offline-queue.ts) is sized
// for small JSON, not binary blobs, so a queued command carries only a local file URI
// + content type; the bytes themselves live here and are read back and uploaded at
// REPLAY time, once connectivity returns (see offline-queue.ts's send()).
//
// Written under Paths.document, not Paths.cache: the cache directory can be purged by
// the OS under storage pressure while a command is still sitting in the queue, and a
// silently-vanished compliance photo is worse than one that takes a little permanent
// space until it's synced or explicitly cleaned up here.
import { Directory, File, Paths } from 'expo-file-system';

const DIR_NAME = 'offline-queue-photos';

function offlinePhotoDir(): Directory {
  const dir = new Directory(Paths.document, DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/**
 * Persist base64 photo bytes to local storage and return a file URI stable enough to
 * put in a queued command's payload. Never throws away the caller's base64 -- if this
 * fails (disk full, permissions), it throws, and the caller should treat that the same
 * as any other failed submit (the compliance record itself is not touched).
 */
export async function savePhotoLocally(base64: string, extension: 'png' | 'jpg'): Promise<string> {
  const file = new File(offlinePhotoDir(), `${Date.now()}-${Math.floor(Math.random() * 1e6)}.${extension}`);
  file.write(base64, { encoding: 'base64' });
  return file.uri;
}

/**
 * Read back base64 bytes for a locally-saved photo. Returns null (never throws) if the
 * file is missing -- e.g. the OS reclaimed storage, the app was reinstalled, or the
 * user cleared app data while a command sat in the queue. Callers must treat null as
 * "this attachment/photo is gone", not crash the flush loop.
 */
export async function readPhotoLocally(localUri: string): Promise<string | null> {
  try {
    const file = new File(localUri);
    if (!file.exists) return null;
    return await file.base64();
  } catch {
    return null;
  }
}

/** Best-effort cleanup once a photo has been uploaded (or permanently given up on). */
export function deletePhotoLocally(localUri: string): void {
  try {
    const file = new File(localUri);
    if (file.exists) file.delete();
  } catch {
    // Reclaiming disk space is a nicety, not a correctness requirement.
  }
}
