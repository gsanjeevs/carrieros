// src/app/(tabs)/reports.tsx
// "Reports" tab (Finance) — Growth+ quarterly IFTA state-mileage summary
// (mockup-20). See src/components/ifta-summary.tsx for the shared content
// and app/ifta-report/index.tsx for how Owner/Solo reach the same screen.
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IftaSummary } from '@/components/ifta-summary';
import { ThemedView } from '@/components/themed-view';
import { Spacing, StatusColors } from '@/constants/theme';

const PAGE_BACKGROUND = StatusColors.grayLight;

export default function ReportsScreen() {
  return (
    <ThemedView style={[styles.container, { backgroundColor: PAGE_BACKGROUND }]}>
      <SafeAreaView style={styles.safeArea}>
        <IftaSummary />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
});
