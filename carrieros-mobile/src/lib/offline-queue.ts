// src/lib/offline-queue.ts
// Offline mode for the actions a driver must be able to take without signal (a
// load marked delivered in a warehouse with no bars must not be lost). Actions
// are queued in AsyncStorage as typed COMMANDS and replayed through the shared
// API once connectivity returns -- the same endpoint online use goes through, so
// an offline action gets the same rules (who may do it, legal transition,
// atomic write) as an online one.
//
// Three command kinds today: load status advances, DVIR (pre/post-trip
// inspection, FMCSA 49 CFR 396.11), and proof-of-delivery photo uploads -- the
// three actions a driver on rural cellular cannot be allowed to lose.
//
// Each command carries the idempotency key minted when the driver tapped, so a
// flush that is interrupted and retried can never apply an action twice.
//
// Photos (DVIR signature/defect photos, POD photos) are never put in this queue
// directly -- AsyncStorage is sized for small JSON, not binary blobs. Instead the
// bytes are written to local storage at queue time (lib/local-photo-store.ts) and
// the command carries only the local file URI. The actual signed-URL upload
// (fresh slot -> PUT -> finalize) happens at REPLAY time, in send() below, because
// a signed URL is short-lived and must not be requested until it's about to be used.
//
// Replay outcomes (per command, based on the http status of its defining call --
// filing the inspection, or finalizing the POD document; attachment photo
// uploads are best-effort within a command and never change its outcome, exactly
// as they are online):
//   200 (applied or replayed)  -> synced, removed
//   400/403/404/409            -> the server REFUSED it (e.g. someone else already
//                                 moved the load: 409). Retrying cannot help, so it
//                                 is removed and counted as `rejected`.
//   network error / 5xx / 401  -> kept for the next flush
import AsyncStorage from '@react-native-async-storage/async-storage'
import { apiClient } from '@/lib/api-client'
import { base64ToArrayBuffer } from '@/lib/base64'
import type { DvirArea } from '@/lib/dvir-attachments'
import { uploadDvirAttachment } from '@/lib/dvir-attachments'
import { deletePhotoLocally, readPhotoLocally } from '@/lib/local-photo-store'
import { logError } from '@/lib/observability'
import { uploadPodPhoto } from '@/lib/pod-upload'

const QUEUE_KEY = 'carrieros:offline-queue:v2'
const LEGACY_QUEUE_KEY = 'carrieros:offline-queue:v1'

export interface MilestonePayload {
  loadId: number
  /** Status the driver saw when they tapped; null = advance from whatever the server holds. */
  expectedStatus: string | null
  newStatus: string
  idempotencyKey: string
  /** When it actually happened, so a late replay keeps the real timestamp. */
  occurredAt: string
}

export interface DvirDefectPayload {
  area: DvirArea
  description: string
  severity: 'minor' | 'major'
}

/** A photo captured for a queued DVIR. Bytes live on local storage (lib/local-photo-store.ts);
 *  only the reference and enough metadata to re-request a signed URL are queued. */
export type DvirAttachmentPayload =
  | { kind: 'signature'; localUri: string; contentType: 'image/png' }
  | { kind: 'defect_photo'; area: DvirArea; localUri: string; contentType: 'image/jpeg' }

export interface DvirSubmitPayload {
  loadId: number
  idempotencyKey: string
  type: 'pre_trip' | 'post_trip'
  odometer: number | null
  defects: DvirDefectPayload[]
  attachments: DvirAttachmentPayload[]
}

export interface PodUploadPayload {
  loadId: number
  idempotencyKey: string
  localUri: string
  contentType: 'image/jpeg'
}

export type QueuedCommand =
  | { id: string; kind: 'load.milestone'; payload: MilestonePayload; queuedAt: string }
  | { id: string; kind: 'dvir.submit'; payload: DvirSubmitPayload; queuedAt: string }
  | { id: string; kind: 'pod.upload'; payload: PodUploadPayload; queuedAt: string }

// v1 held raw table updates ({ table, match, patch }); only load status advances
// were ever queued. Convert any left over from before the API-only change so an
// upgrade doesn't silently drop a driver's pending action.
interface LegacyEntry {
  id: string
  table: string
  match: Record<string, string | number>
  patch: Record<string, unknown>
  queuedAt: string
}

async function migrateLegacy(): Promise<QueuedCommand[]> {
  const raw = await AsyncStorage.getItem(LEGACY_QUEUE_KEY)
  if (!raw) return []
  await AsyncStorage.removeItem(LEGACY_QUEUE_KEY)
  try {
    return (JSON.parse(raw) as LegacyEntry[])
      .filter((e) => e.table === 'loads' && typeof e.match?.id === 'number' && typeof e.patch?.status === 'string')
      .map((e) => ({
        id: e.id,
        kind: 'load.milestone' as const,
        payload: {
          loadId: Number(e.match.id),
          expectedStatus: null,
          newStatus: String(e.patch.status),
          idempotencyKey: `legacy-${e.id}`,
          occurredAt: e.queuedAt,
        },
        queuedAt: e.queuedAt,
      }))
  } catch {
    return []
  }
}

async function readQueue(): Promise<QueuedCommand[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY)
  let queue: QueuedCommand[] = []
  if (raw) {
    try {
      queue = JSON.parse(raw) as QueuedCommand[]
    } catch {
      queue = []
    }
  }
  const legacy = await migrateLegacy()
  if (legacy.length > 0) {
    queue = [...legacy, ...queue]
    await writeQueue(queue)
  }
  return queue
}

async function writeQueue(queue: QueuedCommand[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

function newCommandId(timestamp: string): string {
  return `${timestamp}-${Math.floor(Math.random() * 1e6)}`
}

export async function enqueueMilestone(payload: MilestonePayload, timestamp: string): Promise<void> {
  const queue = await readQueue()
  queue.push({ id: newCommandId(timestamp), kind: 'load.milestone', payload, queuedAt: timestamp })
  await writeQueue(queue)
}

export async function enqueueDvirSubmit(payload: DvirSubmitPayload, timestamp: string): Promise<void> {
  const queue = await readQueue()
  queue.push({ id: newCommandId(timestamp), kind: 'dvir.submit', payload, queuedAt: timestamp })
  await writeQueue(queue)
}

export async function enqueuePodUpload(payload: PodUploadPayload, timestamp: string): Promise<void> {
  const queue = await readQueue()
  queue.push({ id: newCommandId(timestamp), kind: 'pod.upload', payload, queuedAt: timestamp })
  await writeQueue(queue)
}

export async function getQueueLength(): Promise<number> {
  return (await readQueue()).length
}

async function sendMilestone(payload: MilestonePayload): Promise<'synced' | 'rejected' | 'retry'> {
  try {
    const { response } = await apiClient.http.POST('/api/v1/loads/{id}/milestones', {
      params: { path: { id: payload.loadId }, header: { 'Idempotency-Key': payload.idempotencyKey } },
      body: {
        expected_status: payload.expectedStatus,
        new_status: payload.newStatus,
        occurred_at: payload.occurredAt,
      },
    })
    if (response.ok) return 'synced'
    return [400, 403, 404, 409].includes(response.status) ? 'rejected' : 'retry'
  } catch {
    return 'retry' // offline again, DNS blip, aborted...
  }
}

// Attachments (signature + defect photos) are best-effort, exactly like the online
// dvir/[loadId].tsx flow: the inspection is the compliance record and is already
// filed by the time this runs, so a failed/missing photo is logged and skipped, never
// something that re-queues (and thus risks re-filing) the inspection.
async function sendDvirAttachments(inspectionId: number, attachments: DvirAttachmentPayload[]): Promise<void> {
  for (const attachment of attachments) {
    const base64 = await readPhotoLocally(attachment.localUri)
    if (base64 == null) {
      logError(
        { where: 'offline-queue', step: 'dvir-attachment-missing', kind: attachment.kind, inspectionId },
        `local photo missing at replay: ${attachment.localUri}`
      )
      continue
    }
    const ok = await uploadDvirAttachment(
      inspectionId,
      attachment.kind === 'defect_photo' ? { kind: 'defect_photo', area: attachment.area } : { kind: 'signature' },
      attachment.contentType,
      base64ToArrayBuffer(base64)
    )
    if (!ok) {
      logError({ where: 'offline-queue', step: 'dvir-attachment-upload-failed', kind: attachment.kind, inspectionId }, null)
    }
    deletePhotoLocally(attachment.localUri)
  }
}

async function sendDvirSubmit(payload: DvirSubmitPayload): Promise<'synced' | 'rejected' | 'retry'> {
  let filed: { id: number } | null = null
  try {
    const { data, response } = await apiClient.http.POST('/api/v1/loads/{id}/dvir-inspections', {
      params: { path: { id: payload.loadId }, header: { 'Idempotency-Key': payload.idempotencyKey } },
      body: { type: payload.type, odometer: payload.odometer, defects: payload.defects },
    })
    if (!response.ok) {
      return [400, 403, 404, 409].includes(response.status) ? 'rejected' : 'retry'
    }
    filed = data ?? null
  } catch {
    return 'retry'
  }
  if (!filed) return 'retry'

  await sendDvirAttachments(filed.id, payload.attachments)
  return 'synced'
}

async function sendPodUpload(payload: PodUploadPayload): Promise<'synced' | 'rejected' | 'retry'> {
  const base64 = await readPhotoLocally(payload.localUri)
  if (base64 == null) {
    // The bytes are gone (OS reclaimed storage, app data cleared, ...) -- nothing to
    // retry. Drop it rather than looping on it forever; this is the one case where
    // "rejected" doesn't mean the server said no.
    logError({ where: 'offline-queue', step: 'pod-photo-missing' }, `local POD photo missing at replay: ${payload.localUri}`)
    return 'rejected'
  }

  const result = await uploadPodPhoto(payload.loadId, payload.contentType, base64ToArrayBuffer(base64))
  if (result.ok) {
    deletePhotoLocally(payload.localUri)
    return 'synced'
  }
  if (result.step === 'slot' || result.step === 'finalize') {
    return typeof result.status === 'number' && [400, 403, 404, 409].includes(result.status) ? 'rejected' : 'retry'
  }
  // 'put' (storage hiccup) or 'exception' (no signal after all): transient, try again
  // next flush -- a fresh slot will be requested since signed URLs are short-lived.
  return 'retry'
}

async function send(command: QueuedCommand): Promise<'synced' | 'rejected' | 'retry'> {
  switch (command.kind) {
    case 'load.milestone':
      return sendMilestone(command.payload)
    case 'dvir.submit':
      return sendDvirSubmit(command.payload)
    case 'pod.upload':
      return sendPodUpload(command.payload)
  }
}

// Replays in the order queued, so two actions on one load apply in the sequence
// the driver made them. Stops at the first entry that needs a retry: a later
// command for the same load would otherwise be refused as a conflict.
export async function flushQueue(): Promise<{ synced: number; rejected: number; remaining: number }> {
  const queue = await readQueue()
  if (queue.length === 0) return { synced: 0, rejected: 0, remaining: 0 }

  let synced = 0
  let rejected = 0
  let index = 0
  for (; index < queue.length; index++) {
    const outcome = await send(queue[index])
    if (outcome === 'retry') break
    if (outcome === 'synced') synced++
    else rejected++
  }

  const stillQueued = queue.slice(index)
  await writeQueue(stillQueued)
  return { synced, rejected, remaining: stillQueued.length }
}
