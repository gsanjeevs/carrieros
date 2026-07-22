// src/app/(tabs)/profile.tsx
// Driver's tab 4 ("Profile"). This is the old (tabs)/explore.tsx content
// (language/units/date/time prefs + sign out), repositioned — drivers don't
// get a separate "More" tab the way Owner/Solo/Finance do, so this is their
// one settings surface. See src/components/settings-content.tsx.
import { SettingsContent } from '@/components/settings-content';

export default function ProfileScreen() {
  return <SettingsContent />;
}
