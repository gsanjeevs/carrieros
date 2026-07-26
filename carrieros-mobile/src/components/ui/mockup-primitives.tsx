// src/components/ui/mockup-primitives.tsx
// The rest of mockup-06's visual vocabulary, none of which existed on mobile
// before 2026-07-26. Grouped in one file rather than split across six because
// they're a single small design language that's always adopted together, and
// a screen typically imports four of them at once.
//
// Each component below maps 1:1 onto a class in
// docs/design/mockups/mockup-06-onboarding.html — the class name is named in
// each doc comment so the mapping stays checkable by hand.
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BrandColors, Radius, StatusColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Tints must sit at low alpha over BOTH navy and white, so they stay literal
// rgba rather than becoming solid tokens — see the same note in field.tsx.
const TONES = {
  orange: { bg: 'rgba(244,121,32,.1)', border: 'rgba(244,121,32,.28)', text: BrandColors.orange },
  success: { bg: 'rgba(46,204,113,.1)', border: 'rgba(46,204,113,.3)', text: StatusColors.successDark },
  warning: { bg: 'rgba(240,165,0,.12)', border: 'rgba(240,165,0,.3)', text: StatusColors.warningDark },
  danger: { bg: 'rgba(220,38,38,.1)', border: 'rgba(220,38,38,.28)', text: StatusColors.dangerDark },
} as const;

export type Tone = keyof typeof TONES;

/** Mockup `.section-title` — orange, uppercase, letter-spaced. */
export function SectionTitle({ children }: { children: string }) {
  return <ThemedText style={styles.sectionTitle}>{children}</ThemedText>;
}

/**
 * Mockup `.callout` — a tinted, bordered note. Used for the things the
 * mockup states inline rather than hiding in help text: plan limits, trial
 * terms, "you can change this later".
 */
export function Callout({
  tone = 'orange',
  icon,
  children,
}: {
  tone?: Tone;
  icon?: string;
  children: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <View style={[styles.callout, { backgroundColor: t.bg, borderColor: t.border }]}>
      {icon ? <ThemedText style={styles.calloutIcon}>{icon}</ThemedText> : null}
      <View style={styles.calloutBody}>{children}</View>
    </View>
  );
}

/**
 * Mockup `.entity-card` — a thing you've just created (a truck, a customer),
 * shown back with a confirming green border and ✓. This is the mockup's main
 * device for making setup feel like it's accumulating rather than just
 * consuming input, and the app had no equivalent.
 */
export function EntityCard({
  icon,
  name,
  sub,
  confirmed = true,
}: {
  icon: string;
  name: string;
  sub?: string;
  confirmed?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.entityCard,
        {
          backgroundColor: confirmed ? 'rgba(46,204,113,.07)' : theme.backgroundElement,
          borderColor: confirmed ? 'rgba(46,204,113,.35)' : theme.border,
        },
      ]}
    >
      <ThemedText style={styles.entityIcon}>{icon}</ThemedText>
      <View style={styles.entityInfo}>
        <ThemedText type="smallBold" style={styles.entityName}>{name}</ThemedText>
        {sub ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.entitySub}>{sub}</ThemedText>
        ) : null}
      </View>
      {confirmed ? <ThemedText style={styles.entityCheck}>✓</ThemedText> : null}
    </View>
  );
}

/** Mockup `.add-another` — an orange inline "＋ Add another X" affordance. */
export function AddAnother({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.addAnother} accessibilityRole="button">
      <ThemedText style={styles.addAnotherText}>＋ {label}</ThemedText>
    </Pressable>
  );
}

/**
 * Mockup `.ob-progress` + `.ob-step-label` — a continuous bar with the step
 * count right-aligned beneath it. Turns green on the final step, which is how
 * the mockup signals "setup complete" rather than "step 5 of 5".
 */
export function StepProgress({
  current,
  total,
  label,
  complete,
}: {
  current: number;
  total: number;
  label: string;
  complete?: boolean;
}) {
  const theme = useTheme();
  const pct = Math.min(100, Math.max(0, (current / total) * 100));
  return (
    <View style={styles.progressWrap}>
      <View style={[styles.progressTrack, { backgroundColor: theme.divider }]}>
        <View
          style={[
            styles.progressFill,
            { width: `${pct}%`, backgroundColor: complete ? StatusColors.success : BrandColors.orange },
          ]}
        />
      </View>
      <ThemedText
        type="small"
        style={[styles.progressLabel, complete ? { color: StatusColors.success } : { color: theme.textSecondary }]}
      >
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * Mockup `.checklist-item` — done / active / pending, each with a subtitle
 * and an optional action. The old completion screen rendered a bare ○/✓ and
 * a single line of text, losing the subtitle and the "Start →" call to
 * action that make this a next-steps list rather than a receipt.
 */
export function ChecklistItem({
  state,
  title,
  sub,
  actionLabel,
  onAction,
}: {
  state: 'done' | 'active' | 'pending';
  title: string;
  sub?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  const done = state === 'done';
  const active = state === 'active';

  return (
    <View
      style={[
        styles.checklistItem,
        {
          backgroundColor: done
            ? 'rgba(46,204,113,.06)'
            : active
              ? 'rgba(244,121,32,.06)'
              : theme.backgroundElement,
          borderColor: done
            ? 'rgba(46,204,113,.28)'
            : active
              ? 'rgba(244,121,32,.32)'
              : theme.border,
        },
        state === 'pending' && styles.checklistPending,
      ]}
    >
      <View
        style={[
          styles.ciCheck,
          done && { backgroundColor: StatusColors.success, borderColor: StatusColors.success },
          active && { backgroundColor: BrandColors.orange, borderColor: BrandColors.orange },
          state === 'pending' && { borderColor: theme.border },
        ]}
      >
        {done ? <ThemedText style={styles.ciCheckMark}>✓</ThemedText> : null}
        {active ? <ThemedText style={styles.ciCheckMark}>→</ThemedText> : null}
      </View>
      <View style={styles.ciText}>
        <ThemedText type="smallBold" style={styles.ciTitle}>{title}</ThemedText>
        {sub ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.ciSub}>{sub}</ThemedText>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={8}>
          <ThemedText style={styles.ciAction}>{actionLabel}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Mockup `.btn` and its variants. Exists because button treatment was one of
 * the specific inconsistencies called out on 2026-07-26 — secondary actions
 * were rendering as bare text with no affordance, so "Skip for now" read as
 * a caption rather than a control, and primary/secondary pairs sat at
 * different heights.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'success' | 'ghost';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const theme = useTheme();

  const bg =
    variant === 'primary'
      ? BrandColors.orange
      : variant === 'success'
        ? StatusColors.success
        : variant === 'ghost'
          ? 'transparent'
          : theme.backgroundElement;
  const borderColor =
    variant === 'ghost' ? 'rgba(244,121,32,.4)' : variant === 'secondary' ? theme.border : 'transparent';
  // White on a filled button is intentionally literal: it's text ON brand
  // colour, not themed surface text, so it must not follow light/dark.
  const color =
    variant === 'primary' || variant === 'success'
      ? '#ffffff'
      : variant === 'ghost'
        ? BrandColors.orange
        : theme.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.btn, { backgroundColor: bg, borderColor }, disabled && styles.btnDisabled, style]}
    >
      <ThemedText type="smallBold" style={[styles.btnLabel, { color }]}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: BrandColors.orange,
  },

  callout: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  calloutIcon: { fontSize: 18 },
  calloutBody: { flex: 1, gap: 2 },

  entityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderRadius: Radius.card,
    padding: 14,
  },
  entityIcon: { fontSize: 28 },
  entityInfo: { flex: 1 },
  entityName: { fontSize: 14 },
  entitySub: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  entityCheck: { color: StatusColors.success, fontSize: 18, fontWeight: '700' },

  addAnother: { paddingVertical: 8 },
  addAnotherText: { color: BrandColors.orange, fontSize: 13, fontWeight: '600' },

  progressWrap: { gap: 4 },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  progressLabel: { fontSize: 10, fontWeight: '600', textAlign: 'right' },

  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  checklistPending: { opacity: 0.6 },
  ciCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ciCheckMark: { color: '#ffffff', fontSize: 11, fontWeight: '700', lineHeight: 14 },
  ciText: { flex: 1 },
  ciTitle: { fontSize: 13 },
  ciSub: { fontSize: 11, marginTop: 1 },
  ciAction: { color: BrandColors.orange, fontSize: 12, fontWeight: '700' },

  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: Radius.sm,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  btnDisabled: { opacity: 0.5 },
  btnLabel: { fontSize: 14, fontWeight: '700' },
});
