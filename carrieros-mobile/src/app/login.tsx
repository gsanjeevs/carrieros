import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';

const ORANGE = BrandColors.orange;

export default function LoginScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSignIn() {
    if (!email || !password) return;
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    // On success, the root layout's AuthGate picks up the new session via
    // onAuthStateChange and redirects automatically — no manual nav here.
    if (error) setError(t('login.invalidCredentials'));
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.logoRow}>
          <ThemedText type="title" style={{ color: ORANGE, fontSize: 32 }}>
            Carrier
          </ThemedText>
          <ThemedText type="title" style={{ fontSize: 32 }}>
            OS
          </ThemedText>
        </ThemedView>

        <ThemedText type="subtitle" style={styles.heading}>
          {t('login.subtitle')}
        </ThemedText>

        <ThemedView style={styles.form}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('login.email')}
          </ThemedText>
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor={theme.textSecondary}
          />

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldSpacing}>
            {t('login.password')}
          </ThemedText>
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            placeholder="••••••••"
            placeholderTextColor={theme.textSecondary}
          />

          {error ? (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          ) : null}

          <Pressable
            onPress={handleSignIn}
            disabled={loading || !email || !password}
            style={[styles.button, (loading || !email || !password) && styles.buttonDisabled]}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <ThemedText type="smallBold" style={{ color: '#ffffff' }}>
                {t('login.signIn')}
              </ThemedText>
            )}
          </Pressable>

          <Pressable onPress={() => router.push('/signup')} style={styles.signUpLink}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('login.noAccount')} <ThemedText type="small" style={{ color: ORANGE }}>{t('login.signUp')}</ThemedText>
            </ThemedText>
          </Pressable>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  logoRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  heading: {
    textAlign: 'center',
  },
  form: {
    gap: 4,
  },
  fieldSpacing: {
    marginTop: Spacing.three,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  error: {
    color: '#dc2626',
    marginTop: 4,
  },
  button: {
    marginTop: Spacing.four,
    backgroundColor: ORANGE,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  signUpLink: {
    alignItems: 'center',
    marginTop: Spacing.three,
  },
});
