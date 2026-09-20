// src/lib/offline-queue.ts
// Offline mode for the actions a driver must be able to take without signal (a
// load marked delivered in a warehouse with no bars must not be lost). Actions
// are queued in AsyncStorage as typed COMMANDS and replayed through the shared
// API once connectivity returns -- the same endpoint online use goes through, so
// an offline action gets the same rules (who may do it, legal transition,
// atomic write) as an online one.
//
// Each command carries the idempotency key minted when the driver tapped, so a
// flush that is interrupted and retried can never apply an action twice.
//
// Replay outcomes:
//   200 (applied or replayed)  -> synced, removed
//   400/403/404/409            -> the server REFUSED it (e.g. someone else already
//                                 moved the load: 409). Retrying cannot help, so it
//                                 is removed and counted as `rejected`.
//   network error / 5xx / 401  -> kept for the next flush
import AsyncStorage from '@react-native-async-storage/async-storage'
import { apiClient } from '@/lib/api-client'

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

export interface QueuedCommand {
  id: string
  kind: 'load.milestone'
  payload: MilestonePayload
  queuedAt: string
}

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

export async function enqueueMilestone(payload: MilestonePayload, timestamp: string): Promise<void> {
  const queue = await readQueue()
  queue.push({ id: `${timestamp}-${Math.floor(Math.random() * 1e6)}`, kind: 'load.milestone', payload, queuedAt: timestamp })
  await writeQueue(queue)
}

export async function getQueueLength(): Promise<number> {
  return (await readQueue()).length
}

async function send(command: QueuedCommand): Promise<'synced' | 'rejected' | 'retry'> {
  const { payload } = command
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

// Replays in the order queued, so two advances on one load apply in the sequence
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
