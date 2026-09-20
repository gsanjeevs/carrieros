// src/components/app-error-screen.tsx
// Rendered by expo-router's ErrorBoundary export in _layout.tsx when a screen
// throws during render. Uses the bound `t` (not useLocale) because a failure
// at the root sits ABOVE LocaleProvider; i18n.locale is global so the user's
// language is still respected. Reuses the existing common.* strings.
import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing } from '@/constants/theme';
import { t } from '@/lib/i18n';
import { logError } from '@/lib/observability';

export function AppErrorScreen({ error, retry }: { error: Error; retry: () => Promise<unknown> }) {
  useEffect(() => {
    logError({ where: 'route-error-boundary' }, error);
  }, [error]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>{t('common.somethingWentWrongTitle')}</ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.subtitle}>
          {t('common.unexpectedError')}
        </ThemedText>
        <Pressable onPress={() => void retry()} style={styles.button}>
          <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('common.retry')}</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.four, gap: Spacing.two },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center', marginBottom: Spacing.three },
  button: { backgroundColor: BrandColors.orange, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
});
