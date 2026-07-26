// src/components/ui/field.tsx
// The labelled form field from mockup-06 (`.field-group` / `.field-label` /
// `.field-input`). Mobile had no such primitive at all — every screen
// hand-rolled a plain sentence-case grey label above a bare TextInput, which
// is a large part of why the app never read like the mockups even once the
// palette matched.
//
// Three things the hand-rolled version didn't do, all load-bearing to the
// mockup's look:
//   1. The label is 10px, BOLD, UPPERCASE and letter-spaced — a micro-label,
//      not body text — with the required marker in brand orange.
//   2. The input has real STATE. Focused draws an orange border over an
//      orange wash; filled draws green plus a ✓. That feedback is most of
//      what makes the mockup's forms feel alive rather than inert.
//   3. An optional hint line under the field, for the things the mockup
//      spells out ("EIN or SSN (sole proprietor) — used on invoices only").
import { useState } from 'react';
import { StyleSheet, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BrandColors, Radius, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Mockup `.field-input.filled` / `.focused`: a tinted wash plus a coloured
// border, not a solid fill. Kept as literal rgba because they must sit at the
// same low alpha over BOTH a navy and a white surface — a solid token would
// be wrong in one theme or the other.
const FILLED_BORDER = 'rgba(46,204,113,.45)';
const FILLED_BG = 'rgba(46,204,113,.07)';
const FOCUSED_BORDER = 'rgba(244,121,32,.55)';
const FOCUSED_BG = 'rgba(244,121,32,.07)';

export function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
      {label}
      {required ? <ThemedText style={styles.required}> *</ThemedText> : null}
    </ThemedText>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  required,
  hint,
  keyboardType,
  autoCapitalize,
  secureTextEntry,
  autoComplete,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  secureTextEntry?: boolean;
  autoComplete?: 'off' | 'email' | 'name' | 'tel' | 'postal-code';
  multiline?: boolean;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const filled = value.trim().length > 0;

  // Focus wins over filled: while you're typing in a field that already has
  // content, the mockup shows the orange focus treatment, not the green
  // done treatment.
  const borderColor = focused ? FOCUSED_BORDER : filled ? FILLED_BORDER : theme.border;
  const backgroundColor = focused ? FOCUSED_BG : filled ? FILLED_BG : theme.backgroundElement;

  return (
    <View style={styles.group}>
      <FieldLabel label={label} required={required} />
      <View style={[styles.inputWrap, { borderColor, backgroundColor }]}>
        <TextInput
          style={[styles.input, { color: theme.text }, multiline && styles.inputMultiline]}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          secureTextEntry={secureTextEntry}
          autoComplete={autoComplete}
          multiline={multiline}
        />
        {/* The ✓ appears only once the field is both filled and no longer
            focused — i.e. "this one's done", which is exactly when the
            mockup shows it. */}
        {filled && !focused ? <ThemedText style={styles.check}>✓</ThemedText> : null}
      </View>
      {hint ? (
        <ThemedText type="small" themeColor="textMuted" style={styles.hint}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 5 },
  // Mockup `.field-label`: 10px / 700 / uppercase / 1px tracking.
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  required: { color: BrandColors.orange, fontWeight: '700' },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
  },
  // Mockup `.field-input`: 10px 12px padding, 13px text. Vertical padding
  // lives here rather than on the wrapper so the tap target covers the full
  // field height.
  input: { flex: 1, paddingVertical: 10, fontSize: 13 },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  check: { color: StatusColors.success, fontSize: 14, fontWeight: '700' },
  hint: { fontSize: 10, lineHeight: 14 },
});
