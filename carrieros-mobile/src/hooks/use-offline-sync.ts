// src/hooks/use-offline-sync.ts
// Watches connectivity (expo-network — already an Expo SDK package, works
// in Expo Go, unlike @react-native-community/netinfo which needs a custom
// dev client) and flushes the offline queue the instant the app comes back
// online. Exposes isOnline + queueLength so screens/banners can reflect
// current state without each re-implementing the listener.
import { useEffect, useRef, useState } from 'react'
import { useNetworkState } from 'expo-network'
import { flushQueue, getQueueLength } from '@/lib/offline-queue'

export function useOfflineSync() {
  const network = useNetworkState()
  const isOnline = network.isConnected !== false && network.isInternetReachable !== false
  const [queueLength, setQueueLength] = useState(0)
  const wasOffline = useRef(false)

  useEffect(() => {
    getQueueLength().then(setQueueLength)
  }, [])

  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true
      return
    }
    if (!wasOffline.current) return
    wasOffline.current = false

    flushQueue().then(({ remaining }) => setQueueLength(remaining))
  }, [isOnline])

  return { isOnline, queueLength, refreshQueueLength: () => getQueueLength().then(setQueueLength) }
}
