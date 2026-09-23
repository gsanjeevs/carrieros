// src/components/figure-text.tsx
// Shared numeric-display text component -- per
// design/mobile-native-interaction-spec.md §5.4, every dollar/mileage/date
// figure across DVIR, Maintenance, Settlements and Billing must render with
// tabular numerals (fixed-width digits) so stacked figures align in a
// column instead of jittering as digit widths vary. Promoted to a real
// component (rather than "remember to add `fontVariant: ['tabular-nums']`"
// at each call site) specifically because that reminder had already been
// forgotten screen-by-screen before this component existed.
import { StyleSheet } from 'react-native';

import { ThemedText, type ThemedTextProps } from '@/components/themed-text';

export function Figure({ style, ...rest }: ThemedTextProps) {
  return <ThemedText {...rest} style={[styles.tabular, style]} />;
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ['tabular-nums'] },
});
