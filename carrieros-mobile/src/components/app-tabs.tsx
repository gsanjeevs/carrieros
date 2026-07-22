import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Colors } from '@/constants/theme';
import { TAB_SETS } from '@/constants/tab-sets';
import { useLocale } from '@/hooks/use-locale';
import { useProfileRole } from '@/hooks/use-profile-role';

// Icon metadata per tab route name — see src/constants/tab-sets.ts for the
// shared (name, labelKey) list this keys off of. Native-only concern (SF
// Symbol + image fallback), so it lives here rather than in the shared file.
type IconMeta = {
  sf: SFSymbol;
  // Fallback image icon for platforms/situations where the `sf` (SF Symbol,
  // iOS-only) prop doesn't apply — this app only ships two tab icon image
  // assets (home.png / explore.png), so non-Home tabs reuse explore.png as a
  // generic fallback rather than adding new placeholder art. iOS (verified
  // via the Simulator) always shows the correct, distinct `sf` icon; only
  // Android/web fall back to this shared glyph. Noted as a judgement call.
  src: 'home' | 'explore';
};

const ICON_META: Record<string, IconMeta> = {
  home: { sf: 'house.fill', src: 'home' },
  loads: { sf: 'shippingbox.fill', src: 'explore' },
  alerts: { sf: 'bell.fill', src: 'explore' },
  fleet: { sf: 'truck.box.fill', src: 'explore' },
  customers: { sf: 'person.2.fill', src: 'explore' },
  more: { sf: 'ellipsis.circle.fill', src: 'explore' },
  'my-load': { sf: 'steeringwheel', src: 'home' },
  'dvir-start': { sf: 'checklist', src: 'explore' },
  history: { sf: 'clock.fill', src: 'explore' },
  profile: { sf: 'person.crop.circle.fill', src: 'explore' },
  invoices: { sf: 'doc.text.fill', src: 'explore' },
  reports: { sf: 'chart.bar.fill', src: 'explore' },
};

const ICON_SRC = {
  home: require('@/assets/images/tabIcons/home.png'),
  explore: require('@/assets/images/tabIcons/explore.png'),
} as const;

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];
  const { t } = useLocale();
  const { role, loading } = useProfileRole();

  // Brief window while profiles.role resolves (see use-profile-role.ts).
  // AuthGate in the root layout already guarantees a session exists by the
  // time this renders, so this is a one-frame flash at most, not a
  // meaningful loading state to design around.
  if (loading || !role) return null;

  const tabs = TAB_SETS[role];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      {tabs.map((tab) => {
        const icon = ICON_META[tab.name];
        return (
          <NativeTabs.Trigger key={tab.name} name={tab.name}>
            <NativeTabs.Trigger.Label>{t(tab.labelKey)}</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf={icon.sf} src={ICON_SRC[icon.src]} renderingMode="template" />
          </NativeTabs.Trigger>
        );
      })}
    </NativeTabs>
  );
}
