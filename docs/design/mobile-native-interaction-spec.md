# Mobile Native Interaction Spec — DVIR, Maintenance, Settlements, Billing

_Status: v1.0 — drafted 2026-09-23. Companion to `carrieros-design-system.md` §7 (Mobile Patterns)
and the four new mockups `mockups/mockup-24-dvir-native.html` through
`mockups/mockup-27-billing-native.html`. This document is the thing a developer implements
against for the native *behaviors* (gesture, haptic, transition, platform divergence) that a
static HTML mockup cannot itself demonstrate. It does not restate visual tokens already defined
in `carrieros-design-system.md` §1/§7 — only interaction._

**Scope.** The four mobile screens confirmed to have real functionality but no phone-frame
mockup and no interaction spec: DVIR (`dvir-start.tsx`, `dvir/[loadId].tsx`,
`dvir-history/index.tsx`), Maintenance (`maintenance/index.tsx`, and the per-vehicle screens it
links to), Settlements (`settlements/index.tsx`), Billing (`billing/index.tsx`). Everything below
is written against the actual current screen behavior read directly from those files, not a
guess at what they might do.

**Reading this doc.** "Both platforms" = build it once, it looks/feels the same. "iOS: / Android:"
= the two platforms genuinely diverge and both must be built, not one ported to the other.

---

## 0. Cross-cutting native conventions (apply to all four screens)

These aren't new inventions — they're Expo/React Native's platform-default behaviors, which is
exactly what "as native as possible" means: prefer the OS's own affordance over a custom one.

- **Navigation transitions.** Pushing a screen (e.g. DVIR hub → checklist, Maintenance list →
  vehicle detail) uses the platform's native stack transition: iOS slides in from the right with
  a parallax on the outgoing screen; Android uses the Material shared-axis/fade-through transition
  (not an iOS slide port). `expo-router`'s native-stack navigator gives both for free — the
  requirement here is *not disabling it* in favor of a custom JS-driven transition, which is the
  actual risk (a custom transition reads as "web app in a WebView," which is precisely the
  criticism this whole task exists to avoid).
- **Swipe-back gesture (iOS) / predictive back (Android).** Every pushed screen in these four
  flows (DVIR checklist, defect detail, vehicle detail, settlement detail, billing) must support
  edge-swipe-to-go-back on iOS (native-stack default, do not intercept the gesture with a custom
  `PanResponder` unless the screen has unsaved-state to guard — see DVIR checklist below, the one
  real exception). Android 13+ gets the predictive-back peek animation for free from the same
  navigator; do not suppress it.
- **Haptics.** `expo-haptics`. Three tiers used consistently across all four screens:
  - `ImpactFeedbackStyle.Light` — minor UI acknowledgment (toggle flipped, tab switched).
  - `ImpactFeedbackStyle.Medium` — a committing action about to happen (swipe-to-approve reaching
    its threshold, defect toggle about to navigate away).
  - `NotificationFeedbackType.Success` / `.Warning` / `.Error` — end-of-flow outcomes (DVIR
    submitted, defect flagged, settlement approved, upload failure).
  Never fire haptics on scroll or on every keystroke — reserved for discrete, meaningful state
  changes, per Apple's own HIG guidance on overuse numbing the signal.
- **Pull-to-refresh.** Already implemented via RN `RefreshControl` on DVIR history, maintenance
  overview, and settlements lists (confirmed in the actual source). No change needed —
  `tintColor` should resolve to `BrandColors.orange` on iOS and the `colors` prop equivalent
  (Material spinner tint) on Android; today it uses the RN default gray, a one-line polish gap
  flagged in §4 below.
- **Safe area.** All four screens already wrap in `SafeAreaView` in the real code — the new
  mockups' notch/home-indicator chrome makes that explicit visually. No content, action button,
  or list item may render under the notch or home-indicator strip on any of the new screens.
- **Reduced motion.** Per `ux-foundations.md` §2.6/§4: every transition/animation introduced by
  this spec (sheet presentations, swipe reveals, progress-bar fills) must degrade to an instant
  cut when `AccessibilityInfo.isReduceMotionEnabled()` is true, RN's equivalent of
  `prefers-reduced-motion`.

---

## 1. DVIR (mockup-24)

### 1.1 DVIR Hub (`dvir-start.tsx`)
- Tab icon transition when this tab is focused: no special native behavior beyond the existing
  tab bar (§7.2 of the design system) — flagged only to note nothing new is needed here.
- The "Start Pre-Trip" / "Start Post-Trip" buttons are full-width CTAs (§7.4) — standard
  `Pressable` with `android_ripple` on Android (`{ color: 'rgba(255,255,255,0.15)' }` over the
  orange fill) and the platform-default opacity-dim on iOS (`activeOpacity` via `TouchableOpacity`
  semantics, already RN's default `Pressable` behavior). This is the first concrete iOS/Android
  divergence point: **iOS never gets a visible ripple; Android always does** — do not disable
  Android's ripple to make the two platforms pixel-match, that itself is the anti-native mistake.

### 1.2 Pre/Post-Trip Checklist (`dvir/[loadId].tsx`)
- **Toggle interaction — tap is primary, swipe is an enhancement, not a replacement.** The real
  code's OK/Defect are two always-visible buttons per row (correct for gloved/one-handed use in a
  moving vehicle — do not remove them in favor of swipe-only, which fails outdoor/glove use).
  Mockup 24 screen 2 adds a swipe-right-to-OK gesture as a *secondary* accelerator for a driver
  standing still doing a careful walk-around with two free hands. Implementation:
  `react-native-gesture-handler`'s `Swipeable` (or `Reanimated`'s pan gesture) wrapping each row,
  threshold ~40% of row width, haptic `ImpactFeedbackStyle.Light` at the reveal threshold.
- **Back-gesture guard.** This is the one screen in-scope that should intercept the swipe-back/
  predictive-back gesture: a driver mid-checklist with unsaved defect descriptions loses real
  compliance work if the OS gesture silently discards it. On gesture-back attempt with any
  `areas[key].defect === true && description not yet saved locally` (state is already local per
  the real code, so this is a local check, not a server round-trip), show a native confirmation:
  iOS `Alert.alert` (native UIAlertController — never a custom in-app modal for this, per HIG's
  own guidance that destructive-navigation confirmations should look and feel like the system's
  own); Android `Alert.alert` renders as a Material dialog automatically via RN's platform
  branching — no extra code needed beyond calling the shared `Alert` API correctly.
- **Defect toggle → auto-navigate.** The real code shows/hides the defect fields inline
  (`state.defect && <ThemedView>...`); mockup-10's flow instead auto-navigates to a dedicated
  defect screen on `fail`. **Recommendation: keep the real code's inline-reveal pattern, not
  mockup-10's forced navigation** — inline reveal is fewer taps and matches how the rest of the
  checklist behaves (no context switch for a one-line description on a minor defect). Reserve the
  forced full-screen defect flow (mockup-24 screens 3/4) for the **photo-capture step specifically**,
  because camera launch is inherently a modal/full-screen native interaction anyway (see 1.3) — not
  for the defect description itself. This is a genuine, reasoned deviation from mockup-10, called
  out explicitly per the brief's own permission to diverge with a stated reason.
- **Progress header.** The bar-fill width animates with `Animated.timing`,
  `motion-duration-base` (200ms), `motion-easing-standard` — already Core-specified, applied here
  concretely.

### 1.3 Defect photo capture — the platform-divergence anchor screen
This is the single highest-value native-behavior gap: the real code (`ImagePicker.launchCameraAsync`
/ `launchImageLibraryAsync`) already calls the *correct* native camera, but the **choice UI**
between "Take Photo" and "Choose from Library" is left to whatever the two buttons in
`photoButtonRow` render as today (two plain outlined buttons side by side) — not a native chooser.
Mockup 24 screens 3 and 4 show the fix, and it is a real platform-divergence case, not a
cosmetic one:
- **iOS:** present via `ActionSheetIOS.showActionSheetWithOptions` (or the Expo equivalent) — a
  bottom action sheet with "Take Photo" / "Choose from Library" / "Cancel", translucent
  frosted-glass background, system font, destructive-style unused here. This is the system's own
  UIActionSheet, not a hand-styled lookalike — using the real API means it automatically picks up
  Dynamic Type and VoiceOver behavior for free.
- **Android:** present as a Material 3 bottom sheet (`@gorhom/bottom-sheet` or RN's
  `Modal` with `presentationStyle` tuned to match — there is no single first-party Android
  action-sheet primitive the way iOS has one) with a drag handle, section label, leading icons per
  row, and ripple feedback on press. Rounded-top-only corners (24px), not iOS's fully-rounded
  floating sheet.
- Haptic: `ImpactFeedbackStyle.Light` on sheet presentation (both platforms), `NotificationFeedbackType.Success` when a photo is successfully attached, `NotificationFeedbackType.Error` if `ImagePicker` permission is denied (already surfaced as a text error in the real code — pair it with the haptic, don't just rely on text a driver in bright sunlight may not immediately read).
- Camera permission pre-flight: if previously denied, do not silently reshow the OS dialog (iOS
  won't re-prompt after the first denial anyway) — detect `permission.granted === false` and
  `permission.canAskAgain === false` and route to a native "Open Settings" deep link
  (`Linking.openSettings()`), which is what the current code's plain error string cannot do.

### 1.4 Review & Sign
- **Signature pad.** Already implemented with `react-native-svg` + `react-native-view-shot`
  (`SignaturePad` component) — genuinely native-feeling since it's real touch-path capture, not a
  canvas hack. Add: haptic `ImpactFeedbackStyle.Light` on the *first* touch-down of a signature
  stroke (confirms the pad registered the touch, useful in bright sunlight where the ink trail can
  be hard to see), and `NotificationFeedbackType.Success` when `onChange(true)` fires (signature
  complete).
- **Odometer field.** `keyboardType="number-pad"` already correct in the real code (brings up the
  native numeric keypad, not the full QWERTY) — no change, flagged as already-correct.
- **Submit button loading state.** Real code already shows `ActivityIndicator` while `submitting`
  — keep; add `disabled` state's opacity transition at `motion-duration-fast` (150ms) rather than
  an instant snap, matching Core's interactive-state guidance.

### 1.5 Submission outcome (non-fatal warnings)
- The real `submit()` function's sequencing — inspection saves first and always, photo/signature
  upload failures are non-fatal warnings shown after — is a genuinely good architecture decision
  already in the code; the interaction gap is only that the confirmation screen currently renders
  those warnings as plain text with no distinct visual weight. Mockup 24 screen 6 gives the warning
  its own amber banner, separate from the green success state, so a driver scanning quickly still
  registers "1 photo failed" as an action item, not buried prose.
- Haptic sequencing on this screen: `NotificationFeedbackType.Success` fires once, immediately on
  screen mount (matching the moment the inspection record itself is confirmed saved) — not
  re-fired if a warning banner is also showing, since a success+warning double-haptic in the same
  half-second reads as contradictory, not informative.

### 1.6 DVIR History
- List row long-press: native context menu (iOS `ContextMenuView` / Android long-press ripple +
  Material menu) offering "View Full Record" / "Share as PDF" — a genuinely native affordance
  neither platform's plain `Pressable` gives by default, worth the extra library
  (`react-native-context-menu-view` or Expo's `expo-context-menu` where available) specifically
  because compliance records are exactly the kind of record a dispatcher or auditor wants to
  export/share on the spot.

---

## 2. Maintenance (mockup-25)

### 2.1 Fleet Maintenance Overview
- Segmented filter (All / Overdue / Due Soon) is a **native segmented control**, not a
  custom-styled row of buttons: iOS `UISegmentedControl` via `@react-native-segmented-control/segmented-control` (sliding selection indicator, haptic on selection change);
  Android renders the same data as Material 3 `Chip` toggle group (segmented controls are not a
  first-class Android pattern — chips are the idiomatic equivalent, another explicit
  platform-divergence point, not a shared component).
- Swipe-left-to-"Log Service" on a reminder row (mockup-25 screen 1): same `Swipeable` pattern as
  §1.2, single action revealed (not a multi-action swipe menu — one clear action per the "as
  native as possible, one-handed" brief). Haptic: `ImpactFeedbackStyle.Medium` at full-reveal
  threshold, confirming the action is about to commit.
- Status color + text pairing (`Overdue`/`Due Soon`/`OK`) already satisfies Core's "never color
  alone" rule (§4) via the pill's text label — carried through unchanged.

### 2.2 Log Service Entry (per-vehicle)
- **Date field → native date picker, not a custom calendar.** This is the other concrete
  iOS/Android divergence point, alongside the camera sheet:
  - **iOS:** `@react-native-community/datetimepicker` in `spinner` (wheel) mode, presented as a
    bottom sheet — the familiar iOS wheel, exactly as shown in mockup-25 screen 2.
  - **Android:** the same library's `default` mode renders Android's own Material calendar
    dialog (a month grid + "OK"/"Cancel"), shown in mockup-25 screen 3 — **do not force the iOS
    wheel style on Android**; that is the single most common native-feel violation seen in
    cross-platform apps and the mockup exists specifically to make the correct Android look
    explicit and unmissable to whoever implements this.
- **Receipt photo capture.** Reuses the exact camera-sheet pattern from §1.3 — one shared
  component (`useCameraOrLibraryPicker()` hook wrapping both the DVIR defect flow and this
  screen), not two separately hand-rolled implementations. This is a real reuse opportunity the
  current code doesn't have yet (DVIR's picker logic lives inline in `dvir/[loadId].tsx`).
- **Numeric fields (odometer, cost).** `keyboardType="number-pad"` / `"decimal-pad"` respectively
  — native numeric keypads, not the default QWERTY with a hint text.

### 2.3 Per-Vehicle Document View (new screen)
- Document row long-press → native share sheet (`expo-sharing`'s `Sharing.shareAsync`, which on
  iOS opens the real `UIActivityViewController` and on Android the real share intent chooser) —
  this is the correct way to let a driver hand a registration doc to a roadside inspector via
  AirDrop/Nearby Share/email, and is a one-line integration once the document URL is already
  fetched (it already is, via the same signed-URL pattern DVIR signatures use).
- Expired-document row (DOT Annual Inspection in the mockup) gets `NotificationFeedbackType.Warning`
  haptic on first screen focus if any document in the list is expired — a single "heads up" pulse
  the first time the screen appears that period, not on every scroll past the row.

---

## 3. Settlements (mockup-26)

### 3.1 Driver: My Settlements list + detail
- List → detail push is a plain native-stack transition (§0) — no special gesture needed, this is
  the "boring, correct" case.
- **Tabular numerals everywhere a dollar amount renders** — `font-variant-numeric: tabular-nums`
  equivalent on RN is `fontVariant: ['tabular-nums']` (iOS-only historically, but supported cross-
  platform via most modern system fonts RN ships with) — already a Core non-negotiable (§1.4 of
  `ux-foundations.md`), flagged here because the current `settlements/index.tsx` renders
  `formatMoney` output in a plain `<ThemedText>` with no numeric-variant styling — a real,
  concrete gap to fix, not a hypothetical one.
- Long-press a dollar amount → native "Copy" callout (RN's default `TextInput`/`Text`
  `selectable` + context menu, or `expo-clipboard` wired to a long-press gesture) — small, but a
  driver relaying their net pay over a phone call to family/accountant is a real use case worth
  the one-line addition.

### 3.2 Owner/Finance: All Settlements + Review/Approve
- Swipe-left-to-Approve on a pending row: **same `Swipeable` component as §1.2/§2.1** — third
  reuse of the identical primitive, reinforcing that this is one shared interaction pattern
  (`SwipeableRow`) across three screens, not three separate implementations.
- **"Run Settlement" stays web-only — explicitly not contradicted here.** The existing code
  comment in `settlements/index.tsx` calls this "a deliberate, infrequent, higher-stakes
  compute-then-write action best done with full context, not from a phone," and that reasoning
  holds: the compute step needs to reconcile potentially dozens of loads, deductions, and
  adjustments in one view, which a phone screen genuinely cannot do better than a desktop table.
  What mobile adds instead — Review & Approve on an *already-computed* settlement — is a smaller,
  lower-stakes, single-record action that fits the one-handed/on-the-move mobile context the rest
  of this app is built for. This is the brief's "don't contradict a locked decision without a
  strong, explicit reason" instruction applied literally: no reason to reopen it was found, so it
  wasn't reopened.
- Approve action confirmation: Tier 1 (reversible) per `ux-foundations.md` §7 — proceeds
  immediately with a `Toast` carrying "Undo" (a time-limited window before the approval is
  actually written), not a blocking confirmation modal. Haptic: `NotificationFeedbackType.Success`.
  "Flag for Correction" is also Tier 1 (reversible, just reroutes the record) — no modal there
  either.

---

## 4. Billing (mockup-27)

### 4.1 Plan, Payment Method & Fleet Usage (view)
- No interaction changes from the current read-only screen beyond visual polish (see §5) — this
  screen's job is display, and the real code already does that correctly. Flagged explicitly as
  "nothing new needed" rather than silently skipped, so the gap analysis is complete.

### 4.2 Manage Subscription → biometric confirm → web handoff
This is a genuinely new interaction chain, not a mockup-10-style port, and it's the strongest
argument in this whole spec for *keeping* Add-Payment-Method/Change-Tier web-only rather than
building native equivalents:
- **Biometric step-up before handoff.** Tapping "Manage Subscription" triggers `expo-local-
  authentication`'s Face ID / Touch ID (iOS) or BiometricPrompt (Android fingerprint/face) before
  opening the browser — not because it's required for login (T15 already settled passkey as
  optional, not mandatory, for login itself), but as a *step-up* confirmation specific to a
  billing-sensitive action, the same pattern banking apps use before a money-moving action. This
  is additive to T15, not a reopening of it: T15 governs authentication into the app;
  this is a per-action re-confirmation inside an already-authenticated session.
- **Web handoff via in-app browser, not a WebView.** `expo-web-browser`'s
  `WebBrowser.openBrowserAsync()` opens `SFSafariViewController` on iOS / Chrome Custom Tabs on
  Android — both share the device's existing cookies/session and are visibly "the browser," which
  matters for a Stripe checkout form (users are trained not to enter card details inside an
  unfamiliar in-app WebView, a known phishing-adjacent pattern). This is the concrete reasoning
  behind mockup-27 screen 3's explanatory copy, not filler text.
- **Why this reinforces the existing "web-only" decision rather than just repeating it:** App
  Store Review Guideline 3.1.1 and Play's equivalent policy require Apple/Google's own in-app
  purchase system for subscriptions *initiated and paid for inside a native app* — building a
  native Stripe card-entry flow for plan changes would put CarrierOS in that IAP-compliance
  territory (30% platform fee, no real Stripe integration allowed) for no product benefit, since
  the web flow already exists and works. Routing to web isn't a shortcut taken because Stripe
  "isn't live yet" (the code comment's current framing) — it is the *permanently correct*
  architecture for a B2B SaaS billing flow on mobile, and should be documented as such rather than
  as a temporary stub, so a future engineer doesn't try to "finish" it by building native IAP.

---

## 5. Proposed visual-language refinements (component-level polish only — palette untouched)

Per the brief: navy `#0f1e35` / orange `#f47920` (V6) and the dark-web-default decision (V1) are
locked and **not** touched below. These are typography/spacing/elevation/component-polish
proposals only, each with a stated reason, each opt-in (a product doc addition, not a Core
breaking change per `ux-foundations.md` §0's versioning rule).

1. **Loading/refresh accent color.** `RefreshControl`'s `tintColor` and `ActivityIndicator`'s
   `color` prop currently render the RN default gray across all four screens (confirmed in the
   real source — none of `dvir-history/index.tsx`, `maintenance/index.tsx`,
   `settlements/index.tsx` set a custom tint). One-line fix: `tintColor={BrandColors.orange}` /
   `color={BrandColors.orange}`. Small, but a gray spinner against these screens' otherwise
   fully-branded surfaces is a real, visible "unfinished" signal — plausibly part of what the
   product owner's unpinned "I don't like it" criticism is picking up on, since it's the kind of
   inconsistency that reads as "generic" without being easy to name.
2. **Swipeable-row reveal color consistency.** Three screens in this spec (§1.2, §2.1, §3.2) now
   share one `SwipeableRow` component — its reveal-action background should be a single
   consistent color keyed to the action's semantic meaning (`StatusColors.success` green for
   OK/Approve, `StatusColors.teal` for the neutral "Log"/utility actions), reusing existing
   `StatusColors` tokens, not inventing new hex values.
3. **Elevation on pressed states.** Current mobile cards (§7.5 of the design system) have a
   resting shadow but no distinct pressed/active elevation change — native iOS/Android list rows
   both dim or lift slightly on press. Recommend adding a `pressed` style variant (`opacity: 0.85`
   plus, on Android only, a `1dp` elevation reduction to mimic Material's "sink on press") to the
   shared `Card`/list-row components used across all four screens' new list content.
4. **Typography — numeral tabular-nums as a real component prop, not manual styling.** §3.1 above
   flags this as a Settlements-specific gap, but it recurs at every dollar/mileage/date figure
   across all four screens (odometer readings, settlement amounts, overage fees). Recommend
   promoting it from "remember to add this style" to a dedicated `<Figure>` text component
   (wrapping `ThemedText` with `fontVariant: ['tabular-nums']` baked in) so it can't be
   forgotten screen-by-screen the way it evidently already has been.

None of these are palette changes, and none contradict V1/V3/V4/V6 — they're the "typography
scale, spacing, elevation, and component-level polish" category the brief explicitly invited.

---

## 6. Summary table — native behavior by screen

| Screen | Key native behavior added | iOS | Android |
|---|---|---|---|
| DVIR checklist | Swipe-to-OK accelerator + back-gesture guard | `Swipeable` + native `Alert` | Same, Material dialog auto-renders |
| DVIR defect photo | Camera/library chooser | `ActionSheetIOS` | Material bottom sheet |
| DVIR signature | Haptic on stroke start/complete | `expo-haptics` | `expo-haptics` |
| DVIR history | Long-press context menu | `ContextMenuView` | Long-press + Material menu |
| Maintenance list | Segmented filter, swipe-to-log | `UISegmentedControl` | Material `Chip` group |
| Maintenance service log | Native date picker | Wheel (spinner mode) | Material calendar dialog |
| Maintenance documents | Native share sheet | `UIActivityViewController` | Share intent chooser |
| Settlements (driver) | Tabular-nums, copy-on-long-press | shared | shared |
| Settlements (owner) | Swipe-to-approve, Tier-1 undo toast | shared | shared |
| Billing | Biometric step-up, in-app-browser handoff | Face/Touch ID, `SFSafariViewController` | BiometricPrompt, Custom Tabs |

---

## 7. Changelog

| Date | Change |
|---|---|
| 2026-09-23 | v1.0 — initial spec covering DVIR, Maintenance, Settlements, Billing native interaction patterns, platform divergence, and component-polish proposals. Companion to mockups 24–27. |
