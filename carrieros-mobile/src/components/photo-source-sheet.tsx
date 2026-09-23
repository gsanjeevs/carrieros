// src/components/photo-source-sheet.tsx
// Android half of use-photo-picker.ts's camera/library chooser -- a
// Material-styled bottom sheet built on RN's own <Modal> (drag handle,
// section label, leading icons, rounded-top-only corners) rather than the
// iOS ActionSheetIOS this same choice renders as on iOS. See
// use-photo-picker.ts's header comment for why this isn't
// @gorhom/bottom-sheet. Not platform-suffixed: the hook only ever flips
// `visible` to true on Android (`open()` uses ActionSheetIOS directly on
// iOS and never touches this component's state there), so a single file
// mounted unconditionally is simpler than a filename-based platform split.
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';

type Props = {
  visible: boolean;
  title: string;
  takePhotoLabel: string;
  chooseFromLibraryLabel: string;
  cancelLabel: string;
  onTakePhoto: () => void;
  onChooseFromLibrary: () => void;
  onClose: () => void;
};

export function PhotoSourceSheet({
  visible,
  title,
  takePhotoLabel,
  chooseFromLibraryLabel,
  cancelLabel,
  onTakePhoto,
  onChooseFromLibrary,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.title}>
            {title.toUpperCase()}
          </ThemedText>
          <Pressable android_ripple={{ color: 'rgba(0,0,0,0.08)' }} style={styles.item} onPress={onTakePhoto}>
            <ThemedText type="default">{takePhotoLabel}</ThemedText>
          </Pressable>
          <Pressable android_ripple={{ color: 'rgba(0,0,0,0.08)' }} style={styles.item} onPress={onChooseFromLibrary}>
            <ThemedText type="default">{chooseFromLibraryLabel}</ThemedText>
          </Pressable>
          <Pressable android_ripple={{ color: 'rgba(0,0,0,0.08)' }} style={styles.item} onPress={onClose}>
            <ThemedText type="default" themeColor="textSecondary">{cancelLabel}</ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 20 },
  handle: { width: 32, height: 4, backgroundColor: '#d0d0d0', borderRadius: 2, alignSelf: 'center', marginTop: 8, marginBottom: 12 },
  title: { paddingHorizontal: 20, paddingBottom: 8 },
  item: { paddingHorizontal: 20, paddingVertical: 14 },
});
