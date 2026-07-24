// src/components/signature-pad.tsx
// Captures a finger-drawn signature and exports it as a base64 PNG. Replaces
// the "certify" checkbox previously used as a signature stand-in in
// src/app/dvir/[loadId].tsx (dvir_inspections.signature_url stayed null).
//
// Drawn as an SVG path (react-native-svg — works identically on native and
// react-native-web) and rasterized via react-native-view-shot, which mirrors
// the existing photo-capture pattern (see pod-section.tsx) in that the
// caller gets back a base64 string ready for base64ToArrayBuffer() upload,
// not a Blob (RN Blob uploads 0 bytes — src/lib/base64.ts).
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { PanResponder, Pressable, View, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

const ORANGE = '#f97316';

export type SignaturePadHandle = {
  capture: () => Promise<string | null>;
  isEmpty: () => boolean;
};

type Props = {
  onChange?: (hasSignature: boolean) => void;
  clearLabel: string;
  emptyLabel: string;
};

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  { onChange, clearLabel, emptyLabel },
  ref
) {
  const viewRef = useRef<View>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const currentPath = useRef('');
  const [, forceRender] = useState(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        currentPath.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        forceRender((n) => n + 1);
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        currentPath.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        forceRender((n) => n + 1);
      },
      onPanResponderRelease: () => {
        // Capture the finished stroke into a local before resetting the ref
        // — setPaths' functional updater runs later, during React's render
        // phase, so resetting currentPath.current right after calling
        // setPaths (as this used to) cleared it before the updater ever
        // read it, silently pushing an empty string every time.
        const finishedStroke = currentPath.current;
        if (finishedStroke) {
          setPaths((prev) => [...prev, finishedStroke]);
          currentPath.current = '';
        }
      },
    })
  ).current;

  // Reporting hasSignature up to the parent must happen in an effect, not
  // inline inside the setPaths updater above — calling the parent's setState
  // from within this component's own updater triggered React's "Cannot
  // update a component while rendering a different component" warning.
  useEffect(() => {
    onChange?.(paths.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths.length]);

  useImperativeHandle(ref, () => ({
    isEmpty: () => paths.length === 0,
    capture: async () => {
      if (paths.length === 0 || !viewRef.current) return null;
      return captureRef(viewRef, { format: 'png', quality: 1, result: 'base64' });
    },
  }));

  function clear() {
    setPaths([]);
    currentPath.current = '';
  }

  return (
    <View>
      <View
        ref={viewRef}
        collapsable={false}
        style={styles.pad}
        {...panResponder.panHandlers}
      >
        {paths.length === 0 && !currentPath.current ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            {emptyLabel}
          </ThemedText>
        ) : null}
        <Svg style={StyleSheet.absoluteFill}>
          {paths.map((d, i) => (
            <Path key={i} d={d} stroke="#111827" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {currentPath.current ? (
            <Path d={currentPath.current} stroke="#111827" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ) : null}
        </Svg>
      </View>
      {paths.length > 0 && (
        <Pressable onPress={clear} style={styles.clearButton}>
          <ThemedText type="small" style={{ color: ORANGE }}>{clearLabel}</ThemedText>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  pad: {
    height: 160,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: { position: 'absolute' },
  clearButton: { alignSelf: 'flex-end', paddingVertical: Spacing.two },
});
