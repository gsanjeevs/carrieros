// src/app/(tabs)/reports.tsx
// "Reports" tab (Finance) — genuinely out of scope for this pass (no
// reporting feature exists anywhere in this app yet; Growth/Pro-tier scope
// per the wider CarrierOS mockup-parity plan). Simple placeholder only, no
// fabricated charts/data.
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, StatusColors } from '@/constants/theme';
import { useLocale } from '@/hooks/use-locale';

const PAGE_BACKGROUND = StatusColors.grayLight;

export default function ReportsScreen() {
  const { t } = useLocale();
  return (
    <ThemedView style={[styles.container, { backgroundColor: PAGE_BACKGROUND }]}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.centered}>
          <ThemedText type="subtitle" style={styles.heading}>{t('reports.comingSoon')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.detail}>
            {t('reports.comingSoonDetail')}
          </ThemedText>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.two },
  heading: { textAlign: 'center' },
  detail: { textAlign: 'center', maxWidth: 280 },
});
