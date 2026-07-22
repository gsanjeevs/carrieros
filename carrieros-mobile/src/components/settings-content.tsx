// src/components/settings-content.tsx
// Shared settings/profile content — language, units, date/time format, sign
// out. Extracted from the old (tabs)/explore.tsx (previously the app's only
// "Settings" tab) so it can be reused by two tabs in the new per-role tab
// bars: Driver's "Profile" tab and the Owner/Solo/Finance "More" tab. Both
// need the same personal-preferences functionality plus a way to sign out,
// since neither of those role groups has any other settings surface.
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLocale, type DateFormat, type TimeFormat, type Uom } from '@/hooks/use-locale';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

const ORANGE = '#f97316';

const LANGUAGE_LABEL_KEY: Record<Locale, string> = {
  en: 'settings.english',
  es: 'settings.spanish',
  pa: 'settings.punjabi',
  ur: 'settings.urdu',
};

const DATE_FORMAT_EXAMPLES: Record<DateFormat, string> = {
  'MM/DD/YYYY': '07/20/2026',
  'DD/MM/YYYY': '20/07/2026',
  'YYYY-MM-DD': '2026-07-20',
};

type OptionKey = string;

export function SettingsContent() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { locale, setLocale, t, prefs, setUomSystem, setDateFormat, setTimeFormat } = useLocale();
  const [saving, setSaving] = useState<OptionKey | null>(null);

  async function withSaving(key: OptionKey, run: () => Promise<void>) {
    if (saving) return;
    setSaving(key);
    try {
      await run();
    } finally {
      setSaving(null);
    }
  }

  function OptionRow({
    optionKey,
    label,
    selected,
    onPress,
  }: {
    optionKey: OptionKey;
    label: string;
    selected: boolean;
    onPress: () => void;
  }) {
    return (
      <Pressable
        onPress={onPress}
        disabled={saving !== null}
        style={[
          styles.option,
          { borderColor: selected ? ORANGE : theme.backgroundSelected, backgroundColor: theme.backgroundElement },
        ]}
      >
        <ThemedText type="default" style={selected ? { color: ORANGE, fontWeight: 700 } : undefined}>
          {label}
        </ThemedText>
        {saving === optionKey ? (
          <ActivityIndicator color={ORANGE} />
        ) : selected ? (
          <ThemedText type="smallBold" style={{ color: ORANGE }}>✓</ThemedText>
        ) : null}
      </Pressable>
    );
  }

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingTop: insets.top + Spacing.six, paddingBottom: insets.bottom + BottomTabInset + Spacing.three },
      ]}
    >
      <ThemedView style={styles.container}>
        <ThemedText type="subtitle" style={styles.title}>{t('settings.title')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
          {t('settings.subtitle')}
        </ThemedText>

        {/* Language */}
        <ThemedText type="default" style={[styles.sectionHeading, styles.sectionHeadingText]}>{t('settings.languageSection')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionSubtitle}>
          {t('settings.languageSubtitle')}
        </ThemedText>
        <ThemedView style={styles.options}>
          {SUPPORTED_LOCALES.map((code) => (
            <OptionRow
              key={code}
              optionKey={`locale-${code}`}
              label={t(LANGUAGE_LABEL_KEY[code])}
              selected={code === locale}
              onPress={() => withSaving(`locale-${code}`, () => setLocale(code))}
            />
          ))}
        </ThemedView>
        {/* Urdu is right-to-left. See the applyRTL() comment in
            src/hooks/use-locale.tsx for exactly what does and doesn't take
            effect immediately — short version: native needs a restart, this
            web preview mirrors immediately via the DOM `dir` attribute. */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.notice}>
          {t('settings.restartNotice')}
        </ThemedText>

        {/* Units */}
        <ThemedText type="default" style={[styles.sectionHeading, styles.sectionHeadingText]}>{t('settings.unitsSection')}</ThemedText>
        <ThemedView style={styles.options}>
          <OptionRow
            optionKey="uom-default"
            label={t('settings.unitsCompanyDefault', {
              unit: t(prefs.orgDefaultUom === 'imperial' ? 'settings.unitsImperialShort' : 'settings.unitsMetricShort'),
            })}
            selected={prefs.uomSystem === null}
            onPress={() => withSaving('uom-default', () => setUomSystem(null))}
          />
          {(['imperial', 'metric'] as Uom[]).map((uom) => (
            <OptionRow
              key={uom}
              optionKey={`uom-${uom}`}
              label={t(uom === 'imperial' ? 'settings.unitsImperial' : 'settings.unitsMetric')}
              selected={prefs.uomSystem === uom}
              onPress={() => withSaving(`uom-${uom}`, () => setUomSystem(uom))}
            />
          ))}
        </ThemedView>

        {/* Date format */}
        <ThemedText type="default" style={[styles.sectionHeading, styles.sectionHeadingText]}>{t('settings.dateFormatSection')}</ThemedText>
        <ThemedView style={styles.options}>
          {(Object.keys(DATE_FORMAT_EXAMPLES) as DateFormat[]).map((format) => (
            <OptionRow
              key={format}
              optionKey={`date-${format}`}
              label={`${format} (${DATE_FORMAT_EXAMPLES[format]})`}
              selected={prefs.dateFormat === format}
              onPress={() => withSaving(`date-${format}`, () => setDateFormat(format))}
            />
          ))}
        </ThemedView>

        {/* Time format */}
        <ThemedText type="default" style={[styles.sectionHeading, styles.sectionHeadingText]}>{t('settings.timeFormatSection')}</ThemedText>
        <ThemedView style={styles.options}>
          {(['12h', '24h'] as TimeFormat[]).map((format) => (
            <OptionRow
              key={format}
              optionKey={`time-${format}`}
              label={t(format === '12h' ? 'settings.time12h' : 'settings.time24h')}
              selected={prefs.timeFormat === format}
              onPress={() => withSaving(`time-${format}`, () => setTimeFormat(format))}
            />
          ))}
        </ThemedView>

        <Pressable onPress={() => supabase.auth.signOut()} style={styles.signOut}>
          <ThemedText type="link" themeColor="textSecondary">{t('loads.signOut')}</ThemedText>
        </Pressable>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: { flex: 1 },
  contentContainer: { flexDirection: 'row', justifyContent: 'center' },
  container: { maxWidth: MaxContentWidth, flexGrow: 1, paddingHorizontal: Spacing.four, gap: Spacing.two },
  title: {},
  subtitle: { marginTop: -Spacing.two, marginBottom: Spacing.two },
  sectionHeading: { marginTop: Spacing.three },
  sectionHeadingText: { fontWeight: 700 },
  sectionSubtitle: { marginTop: -Spacing.one },
  options: { gap: Spacing.two, marginTop: Spacing.one },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  notice: { marginTop: Spacing.one },
  signOut: { alignItems: 'center', paddingVertical: Spacing.four, marginTop: Spacing.three },
});
