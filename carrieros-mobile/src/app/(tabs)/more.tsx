// src/app/(tabs)/more.tsx
// Overflow tab for Owner/Solo/Finance (they don't get a dedicated
// Profile/Settings tab in their assigned tab sets) — same content as
// Driver's "Profile" tab: language picker, unit/date/time prefs, sign out.
// See src/components/settings-content.tsx.
import { SettingsContent } from '@/components/settings-content';

export default function MoreScreen() {
  return <SettingsContent />;
}
