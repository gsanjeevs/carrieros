// src/hooks/use-photo-picker.ts
// Native camera/library chooser -- design/mobile-native-interaction-spec.md
// §1.3, the spec's "platform-divergence anchor": the real code already
// calls the correct native camera (expo-image-picker), the gap was that the
// CHOICE between "Take Photo" / "Choose from Library" was two plain
// outlined buttons instead of a native chooser.
//
//   iOS:     ActionSheetIOS.showActionSheetWithOptions -- the real system
//            action sheet (built into react-native core, no extra native
//            module needed), so it gets Dynamic Type/VoiceOver for free.
//   Android: there's no first-party Android action-sheet primitive the way
//            iOS has one (spec's own words). @gorhom/bottom-sheet would be
//            the fullest version of this, but it's not an installed
//            dependency and pulling in a new native module for one sheet
//            isn't worth the native-rebuild risk here -- so this renders a
//            Material-styled bottom sheet with RN's own <Modal>
//            (rounded-top-only corners, drag handle, leading icons, section
//            label) exactly as the spec allows ("or RN's Modal with
//            presentationStyle tuned to match").
//
// One shared hook (not two hand-rolled pickers) per spec §2.2's explicit
// reuse note: DVIR's defect photo and Maintenance's receipt photo both
// route through this.
import { useCallback, useState } from 'react';
import { ActionSheetIOS, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { haptics } from '@/lib/haptics';

export type PickedPhoto = { uri: string; base64: string };

type Options = {
  cameraDeniedMessage: string;
  libraryDeniedMessage: string;
  noImageDataMessage: string;
  takePhotoLabel: string;
  chooseFromLibraryLabel: string;
  cancelLabel: string;
  sheetTitle?: string;
};

export function usePhotoPicker(options: Options) {
  const [error, setError] = useState('');
  // Android-only: RN Modal-backed bottom sheet visibility, since ActionSheetIOS
  // is imperative and needs no local render state.
  const [androidSheetOpen, setAndroidSheetOpen] = useState(false);

  async function pick(source: 'camera' | 'library'): Promise<PickedPhoto | null> {
    setError('');
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setError(source === 'camera' ? options.cameraDeniedMessage : options.libraryDeniedMessage);
      await haptics.error();
      return null;
    }

    const pickerOptions: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, base64: true };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(pickerOptions)
        : await ImagePicker.launchImageLibraryAsync(pickerOptions);

    if (result.canceled) return null;

    const asset = result.assets?.[0];
    if (!asset?.base64) {
      setError(options.noImageDataMessage);
      await haptics.error();
      return null;
    }

    await haptics.success();
    return { uri: asset.uri, base64: asset.base64 };
  }

  const open = useCallback(
    (onPicked: (photo: PickedPhoto) => void) => {
      haptics.light();

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: options.sheetTitle,
            options: [options.takePhotoLabel, options.chooseFromLibraryLabel, options.cancelLabel],
            cancelButtonIndex: 2,
          },
          async (index) => {
            if (index === 0) {
              const photo = await pick('camera');
              if (photo) onPicked(photo);
            } else if (index === 1) {
              const photo = await pick('library');
              if (photo) onPicked(photo);
            }
          }
        );
        return;
      }

      // Android: open the Material-styled bottom sheet Modal; the sheet
      // itself calls back into pick() per-option (see the component this
      // hook is paired with in each screen).
      setAndroidSheetOpen(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.sheetTitle, options.takePhotoLabel, options.chooseFromLibraryLabel, options.cancelLabel]
  );

  const closeAndroidSheet = useCallback(() => setAndroidSheetOpen(false), []);

  const pickFromAndroidSheet = useCallback(
    async (source: 'camera' | 'library', onPicked: (photo: PickedPhoto) => void) => {
      setAndroidSheetOpen(false);
      const photo = await pick(source);
      if (photo) onPicked(photo);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return { open, error, androidSheetOpen, closeAndroidSheet, pickFromAndroidSheet };
}
