// src/components/onboarding-status-error.tsx
// Shown by _layout.tsx's AuthGate when useOnboardingStatus's "does this
// user have a company yet" check fails (network error, Supabase
// unreachable, etc) — distinct from a successful check that confirms no
// org exists. Before this existed, a failed check was indistinguishable
// from "needs onboarding", so a network hiccup could show an already-
// onboarded user the onboarding wizard with no explanation and (until
// onboarding/index.tsx got its own sign-out link) no way out at all.
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing } from '@/constants/theme';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';

const ORANGE = BrandColors.orange;

export function OnboardingStatusError({ onRetry }: { onRetry: () => void }) {
  const { t } = useLocale();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>{t('common.somethingWentWrongTitle')}</ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.subtitle}>
          {/* Not common.loadErrorRetry — that string ends "Pull down to try
              again," and this screen has a Retry button rather than a
              pull-to-refresh gesture. */}
          {t('common.connectionError')}
        </ThemedText>

        <Pressable onPress={onRetry} style={styles.button}>
          <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('common.retry')}</ThemedText>
        </Pressable>
        <Pressable onPress={() => supabase.auth.signOut()} style={styles.signOutLink}>
          <ThemedText type="small" themeColor="textSecondary">{t('onboarding.signOut')}</ThemedText>
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
  button: { backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  signOutLink: { alignItems: 'center', marginTop: Spacing.four },
});
