import { View, type ViewProps } from 'react-native';

import { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * `type` picks the surface this view paints.
 *
 * `'transparent'` is the right choice for the many purely-structural
 * wrappers (rows, chip groups, header rows) that exist only for flex layout
 * — they should show whatever surface is already behind them. These used to
 * be written as `type="transparent"`, which was harmless only while mobile
 * was light-only and page/card were both white. With a real dark theme,
 * `background` (navy) painted over a `card` (navyCard) reads as a stray
 * block inside every card, so structural wrappers now inherit instead.
 */
export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  type?: ThemeColor | 'transparent';
};

export function ThemedView({ style, lightColor, darkColor, type, ...otherProps }: ThemedViewProps) {
  const theme = useTheme();
  const backgroundColor = type === 'transparent' ? 'transparent' : theme[type ?? 'background'];

  return <View style={[{ backgroundColor }, style]} {...otherProps} />;
}
