// src/app/welcome.tsx
// mockup-06 Screen 1 ("Welcome") — the entry point for an unauthenticated
// user, added because mobile previously had no path to sign up at all: the
// root layout's AuthGate hardcoded "unauthenticated users can only reach
// /login." "Get Started" begins account creation (/signup); "Sign in" goes
// to the existing /login screen. This screen itself has no auth logic —
// AuthGate still owns the redirect rules (see _layout.tsx).
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing } from '@/constants/theme';
import { useLocale } from '@/hooks/use-locale';

const ORANGE = BrandColors.orange;

const FEATURES = [
  { icon: '📧', titleKey: 'welcome.featureForwardTitle', subKey: 'welcome.featureForwardSub' },
  { icon: '🚛', titleKey: 'welcome.featureDispatchTitle', subKey: 'welcome.featureDispatchSub' },
  { icon: '🧾', titleKey: 'welcome.featureInvoiceTitle', subKey: 'welcome.featureInvoiceSub' },
] as const;

export default function WelcomeScreen() {
  const router = useRouter();
  const { t } = useLocale();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <ThemedView style={styles.hero} type="transparent">
            <ThemedText style={styles.heroIcon}>🚛</ThemedText>
            <ThemedText type="title" style={styles.heroTitle}>{t('welcome.title')}</ThemedText>
            <ThemedText type="default" themeColor="textSecondary" style={styles.heroSub}>
              {t('welcome.subtitle')}
            </ThemedText>
          </ThemedView>

          <ThemedView style={styles.featureList} type="transparent">
            {FEATURES.map((f) => (
              <ThemedView key={f.titleKey} style={styles.featureRow} type="backgroundElement">
                <ThemedText style={styles.featureIcon}>{f.icon}</ThemedText>
                <ThemedView style={styles.featureText} type="backgroundElement">
                  <ThemedText type="smallBold">{t(f.titleKey)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{t(f.subKey)}</ThemedText>
                </ThemedView>
              </ThemedView>
            ))}
          </ThemedView>
        </ScrollView>

        <ThemedView style={styles.footer} type="transparent">
          <Pressable onPress={() => router.push('/signup')} style={styles.primaryButton}>
            <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('welcome.getStarted')}</ThemedText>
          </Pressable>
          <Pressable onPress={() => router.push('/login')} style={styles.signInLink}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('welcome.alreadyHaveAccount')} <ThemedText type="small" style={{ color: ORANGE }}>{t('welcome.signIn')}</ThemedText>
            </ThemedText>
          </Pressable>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four },
  scrollContent: { flexGrow: 1, justifyContent: 'center', gap: Spacing.five, paddingVertical: Spacing.five },
  hero: { alignItems: 'center', gap: Spacing.two },
  heroIcon: { fontSize: 56 },
  heroTitle: { fontSize: 26, textAlign: 'center' },
  heroSub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  featureList: { gap: Spacing.two },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 12, padding: Spacing.three },
  featureIcon: { fontSize: 22 },
  featureText: { flex: 1, gap: 2 },
  footer: { paddingBottom: Spacing.four, gap: Spacing.three },
  primaryButton: { backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  signInLink: { alignItems: 'center' },
});
