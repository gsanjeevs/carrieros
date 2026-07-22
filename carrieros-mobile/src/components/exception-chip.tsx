// src/components/exception-chip.tsx
// Small colored pill surfacing a single live exception (from
// get_exceptions(), via src/lib/exceptions.ts) inline on a list row — Fleet
// and Customers tabs. Same pastel-bg/dark-text pill shape as
// VEHICLE_STATUS_PILL/LOAD_STATUS_PILL, colored via EXCEPTION_TIER_PILL
// (constants/theme.ts) — the same today=danger/this_week=warning/
// upcoming=info mapping the Alerts tab's tiers use.
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { EXCEPTION_TIER_PILL } from '@/constants/theme';
import type { ExceptionRow } from '@/lib/exceptions';

export function ExceptionChip({ item }: { item: ExceptionRow }) {
  const pill = EXCEPTION_TIER_PILL[item.tier] ?? EXCEPTION_TIER_PILL.upcoming;
  return (
    <View style={[styles.pill, { backgroundColor: pill.bg }]}>
      <ThemedText type="small" numberOfLines={1} style={[styles.text, { color: pill.text }]}>
        {item.title}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start', marginTop: 4 },
  text: { fontWeight: '700' },
});
