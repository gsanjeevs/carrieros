// src/lib/haptics.ts
// Thin wrapper around expo-haptics implementing the three tiers defined in
// design/mobile-native-interaction-spec.md §0 ("Haptics"):
//   - light   -> minor UI acknowledgment (toggle flipped, tab switched)
//   - medium  -> a committing action about to happen (swipe threshold reached)
//   - success/warning/error -> end-of-flow outcomes
//
// A single call site per tier keeps every screen calling the same five
// functions instead of importing expo-haptics directly and re-deciding
// which ImpactFeedbackStyle/NotificationFeedbackType to use each time.
// expo-haptics already no-ops safely on web, but wrapped in a try/catch
// here too since haptic failures must never block the interaction they're
// decorating (a vibration failing is not a reason to fail a DVIR submit).
import * as Haptics from 'expo-haptics';

async function safe(fn: () => Promise<void>) {
  try {
    await fn();
  } catch {
    // Haptics are pure feedback -- never let a platform/permissions quirk
    // surface as a user-facing error.
  }
}

export const haptics = {
  light: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
