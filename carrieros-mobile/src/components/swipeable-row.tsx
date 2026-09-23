// src/components/swipeable-row.tsx
// Shared single-action swipe-to-reveal row, used by three screens per
// design/mobile-native-interaction-spec.md (DVIR checklist §1.2, Maintenance
// overview §2.1, Settlements owner list §3.2) -- one primitive, not three
// hand-rolled implementations, per the spec's explicit reuse note in §3.2.
//
// Deliberately ONE action per row, not a multi-action swipe menu: the spec's
// "as native as possible, one-handed" brief calls for a single clear action,
// and every current call site (swipe-to-OK, swipe-to-log-service,
// swipe-to-approve) only ever needs one.
//
// Built on react-native-gesture-handler's ReanimatedSwipeable (both
// react-native-gesture-handler and react-native-reanimated are already
// dependencies -- no new native module required). Swiping past the open
// threshold commits the action immediately (matching the "swipe threshold
// reached = a committing action about to happen" framing in the spec's
// haptic-tier definitions), with the row snapping closed right after.
import { useRef } from 'react';
import { AccessibilityInfo, StyleSheet, View, type ViewStyle } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import type { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { ThemedText } from '@/components/themed-text';
import { haptics } from '@/lib/haptics';

type Props = {
  children: React.ReactNode;
  /** Label shown in the revealed action panel, e.g. "OK", "Log", "Approve". */
  label: string;
  /** Semantic StatusColors token for the reveal background -- see spec §5.2. */
  color: string;
  /** Which edge the action is revealed from. DVIR/Settlements swipe right-to-reveal (left edge drag); Maintenance swipes left-to-reveal. */
  side?: 'left' | 'right';
  onAction: () => void;
  hapticTier?: 'light' | 'medium';
  width?: number;
  containerStyle?: ViewStyle;
};

export function SwipeableRow({
  children,
  label,
  color,
  side = 'right',
  onAction,
  hapticTier = 'medium',
  width = 84,
  containerStyle,
}: Props) {
  const ref = useRef<SwipeableMethods>(null);

  function fireThresholdHaptic() {
    // Reduced-motion doesn't disable the gesture itself (it's not an
    // animation the user is watching passively) but a Success/Impact pulse
    // tied to a spring-driven reveal is still a motion-adjacent signal --
    // skip it when the OS setting is on, matching spec §0's reduced-motion
    // rule for other transitions.
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!reduced) haptics[hapticTier]();
    });
  }

  // Purely visual -- release-past-threshold is what commits the action (via
  // onSwipeableOpen below), matching an iOS Mail-style swipe-to-commit. This
  // panel isn't itself a second Pressable, which would otherwise let the
  // same swipe fire the action twice (once on auto-open, once on a
  // follow-up tap).
  function renderAction() {
    return (
      <View style={[styles.action, { backgroundColor: color, width }]}>
        <ThemedText type="smallBold" style={styles.actionLabel}>
          {label}
        </ThemedText>
      </View>
    );
  }

  return (
    <Swipeable
      ref={ref}
      friction={2}
      overshootFriction={8}
      leftThreshold={side === 'left' ? width * 0.6 : undefined}
      rightThreshold={side === 'right' ? width * 0.6 : undefined}
      renderLeftActions={side === 'left' ? renderAction : undefined}
      renderRightActions={side === 'right' ? renderAction : undefined}
      onSwipeableWillOpen={fireThresholdHaptic}
      onSwipeableOpen={() => {
        onAction();
        ref.current?.close();
      }}
      containerStyle={containerStyle}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: { justifyContent: 'center', alignItems: 'center' },
  actionLabel: { color: '#ffffff' },
});
