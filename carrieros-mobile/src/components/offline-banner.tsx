// src/components/offline-banner.tsx
// Global "you're offline" / "N changes queued" strip. Mounted once in
// _layout.tsx so it's visible everywhere, not per-screen. The count is the
// shared offline queue's length (lib/offline-queue.ts), so it already covers
// queued load-status changes, DVIR submissions, and POD uploads together --
// this component doesn't need to know which kinds exist.
import { StyleSheet } from 'react-native'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { useLocale } from '@/hooks/use-locale'
import { useOfflineSync } from '@/hooks/use-offline-sync'

export function OfflineBanner() {
  const { t } = useLocale()
  const { isOnline, queueLength } = useOfflineSync()

  if (isOnline && queueLength === 0) return null

  return (
    <ThemedView style={[styles.banner, { backgroundColor: isOnline ? '#f59e0b' : '#6b7280' }]}>
      <ThemedText type="small" style={styles.text}>
        {isOnline
          ? t('offline.syncing', { count: queueLength })
          : queueLength > 0
            ? t('offline.offlineWithQueue', { count: queueLength })
            : t('offline.offline')}
      </ThemedText>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  banner: { paddingVertical: 6, paddingHorizontal: 16, alignItems: 'center' },
  text: { color: '#ffffff', fontWeight: '600' },
})
