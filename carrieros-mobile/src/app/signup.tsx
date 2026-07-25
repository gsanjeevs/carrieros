// src/app/signup.tsx
// Account creation — the prerequisite step before any of mockup-06's onboarding
// screens (company/vehicle/customer/billing/completion in src/app/onboarding/
// index.tsx) can run, since those all need an authenticated user. Mirrors
// carrieros-web/app/signup/actions.ts's field shape (name split into
// first/last, email, password) but runs supabase.auth.signUp() directly
// client-side rather than via a server action — mobile has no server-action
// equivalent, and this is the same client-side auth pattern login.tsx
// already uses for signInWithPassword. No tier/plan picker: mockup-06 (what
// was asked to be implemented) has no plan-picker screen; POST /api/onboarding
// already defaults an omitted tier to 'starter'.
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';

const ORANGE = BrandColors.orange;

export default function SignupScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useLocale();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = name.trim().length > 0 && email.trim().length > 0 && password.length >= 8;

  async function handleSignUp() {
    if (!canSubmit) return;
    setLoading(true);
    setError('');

    const trimmedName = name.trim();
    const [first_name, ...rest] = trimmedName.split(' ');
    const last_name = rest.join(' ') || first_name;

    const { error: signUpErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { first_name, last_name } },
    });

    setLoading(false);

    if (signUpErr) {
      setError(
        signUpErr.message.toLowerCase().includes('already registered')
          ? t('signup.emailExists')
          : t('signup.signupFailed')
      );
      return;
    }

    // enable_confirmations is false locally (supabase/config.toml), so
    // signUp() returns a live session immediately — the root layout's
    // AuthGate picks it up via onAuthStateChange and routes to /onboarding
    // on its own (no org_id yet), same handoff login.tsx relies on for
    // signInWithPassword.
    router.replace('/onboarding');
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <ThemedText type="link" themeColor="textSecondary">{t('common.back')}</ThemedText>
          </Pressable>

          <ThemedText type="title" style={styles.heading}>{t('signup.title')}</ThemedText>
          <ThemedText type="default" themeColor="textSecondary" style={styles.subheading}>
            {t('signup.subtitle')}
          </ThemedText>

          <ThemedView style={styles.form} type="background">
            <ThemedText type="small" themeColor="textSecondary">{t('signup.name')}</ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoComplete="name"
              placeholder="Sam Johnson"
              placeholderTextColor={theme.textSecondary}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldSpacing}>
              {t('signup.email')}
            </ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@yourcompany.com"
              placeholderTextColor={theme.textSecondary}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldSpacing}>
              {t('signup.password')}
            </ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              placeholder="••••••••"
              placeholderTextColor={theme.textSecondary}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              {t('signup.passwordHint')}
            </ThemedText>

            {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

            <Pressable
              onPress={handleSignUp}
              disabled={loading || !canSubmit}
              style={[styles.button, (loading || !canSubmit) && styles.buttonDisabled]}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{t('signup.createAccount')}</ThemedText>
              )}
            </Pressable>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four },
  scrollContent: { paddingBottom: Spacing.six },
  backLink: { paddingVertical: Spacing.two },
  heading: { fontSize: 26, marginTop: Spacing.two },
  subheading: { marginTop: 4, marginBottom: Spacing.four },
  form: { gap: 4 },
  fieldSpacing: { marginTop: Spacing.three },
  hint: { marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  error: { color: StatusColors.danger, marginTop: Spacing.two },
  button: { marginTop: Spacing.four, backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
});
