// src/lib/offline-queue.ts
// Offline mode (audit gap #13 cluster, last item — driver chat, fuel
// stops, IFTA log, and the live map are all built; this is the queue-and-
// sync half of "works without signal"). A driver marking a load delivered
// in a warehouse with no bars must not lose that action — this queues the
// write in AsyncStorage and replays it once connectivity returns, instead
// of just showing an error and making the driver retry manually later.
//
// Deliberately generic (table + row match + patch), not a bespoke queue
// per action type — the one call site wired up today (load status
// advancement, src/app/load/[id].tsx) is the highest-value case (PRD:
// driver must be able to update load status from the road), but any
// future direct-Supabase-update call site can reuse this without a new
// queue implementation.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'

const QUEUE_KEY = 'carrieros:offline-queue:v1'

export interface QueuedUpdate {
  id: string
  table: string
  match: Record<string, string | number>
  patch: Record<string, unknown>
  queuedAt: string
}

async function readQueue(): Promise<QueuedUpdate[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as QueuedUpdate[]
  } catch {
    return []
  }
}

async function writeQueue(queue: QueuedUpdate[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export async function enqueueUpdate(entry: Omit<QueuedUpdate, 'id' | 'queuedAt'>, timestamp: string): Promise<void> {
  const queue = await readQueue()
  queue.push({ ...entry, id: `${timestamp}-${Math.floor(Math.random() * 1e6)}`, queuedAt: timestamp })
  await writeQueue(queue)
}

export async function getQueueLength(): Promise<number> {
  return (await readQueue()).length
}

// Replays every queued update against Supabase, in the order they were
// queued (so e.g. two status advances on the same load apply in the
// sequence the driver actually made them). A row that still fails (rare —
// would mean connectivity flickered back off mid-flush) stays queued for
// the next flush rather than being dropped.
export async function flushQueue(): Promise<{ synced: number; remaining: number }> {
  const queue = await readQueue()
  if (queue.length === 0) return { synced: 0, remaining: 0 }

  const stillQueued: QueuedUpdate[] = []
  let synced = 0

  for (const entry of queue) {
    // Generic by design (see file header) — the table name and patch shape
    // are only known at runtime (whatever the call site queued), so this
    // one spot opts out of the generated Database types rather than
    // widening every table's Update type to accept arbitrary tables.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase.from(entry.table as any) as any).update(entry.patch)
    for (const [key, value] of Object.entries(entry.match)) {
      query = query.eq(key, value)
    }
    const { error } = await query
    if (error) {
      stillQueued.push(entry)
    } else {
      synced++
    }
  }

  await writeQueue(stillQueued)
  return { synced, remaining: stillQueued.length }
}
