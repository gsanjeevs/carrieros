// src/app/ifta-report/index.tsx
// Standalone route so Owner/Solo can reach the same IFTA quarterly summary
// Finance sees on their own "Reports" tab -- see src/components/ifta-summary.tsx
// for why this needs to be a route outside the (tabs) group rather than
// Owner/Solo pushing straight to '/reports' (expo-router/ui's Tabs only
// registers routes that are in the current role's TAB_SETS; Owner/Solo's
// tab set has no 'reports' entry, so that push would silently no-op back
// to their first tab). Same standalone-route pattern as
// customers/team/billing/settlements, all linked from settings-content.tsx.
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { IftaSummary } from '@/components/ifta-summary';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, StatusColors } from '@/constants/theme';
import { useLocale } from '@/hooks/use-locale';

const PAGE_BACKGROUND = StatusColors.grayLight;

export default function IftaReportScreen() {
  const router = useRouter();
  const { t } = useLocale();

  return (
    <ThemedView style={[styles.container, { backgroundColor: PAGE_BACKGROUND }]}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
        </Pressable>
        <IftaSummary />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  backLink: { paddingVertical: Spacing.two },
});
