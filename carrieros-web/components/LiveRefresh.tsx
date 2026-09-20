'use client'

// Drop into a Server Component page to keep it live: when the backend signals a
// change to any of `entities`, the page's server data is re-fetched (through the
// same service that rendered it) without a full reload or losing client state.
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api-client'
import { useLiveRefresh } from '@/lib/generated/live-refresh'
import type { ChangeEntity } from '@/lib/generated/api-client'

export default function LiveRefresh({ entities }: { entities: readonly ChangeEntity[] }) {
  const router = useRouter()
  useLiveRefresh(apiClient, entities, () => router.refresh())
  return null
}
