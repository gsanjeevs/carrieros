// tests/use-photo-picker.test.ts
// Platform-branching tests for src/hooks/use-photo-picker.ts (design/
// mobile-native-interaction-spec.md §1.3's "platform-divergence anchor":
// iOS routes the camera/library choice through the real ActionSheetIOS,
// Android renders the Material-styled <PhotoSourceSheet> Modal instead).
// These tests assert the branch actually taken per Platform.OS, not just
// that the hook "works", since silently falling back to one platform's
// behavior on both is exactly the bug this hook exists to prevent.
//
// No renderHook helper is used here: @testing-library/react-native's
// renderHook does not come up cleanly under this project's React 19 +
// jest-expo setup (result.current stays undefined even for a trivial
// useState hook, unrelated to this feature). A small react-test-renderer
// harness -- render a component that calls the hook and stashes its return
// value in a variable the test can read/drive through act() -- is the
// well-supported classic pattern and needs no new project-wide test
// convention beyond the react-test-renderer dependency already installed.
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { Platform, ActionSheetIOS } from 'react-native';
import { PermissionStatus } from 'expo-modules-core';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('@/lib/haptics', () => ({
  haptics: { light: jest.fn(), success: jest.fn(), error: jest.fn(), warning: jest.fn(), medium: jest.fn() },
}));

import * as ImagePicker from 'expo-image-picker';
import { usePhotoPicker, type PickedPhoto } from '@/hooks/use-photo-picker';
import { haptics } from '@/lib/haptics';

const options = {
  cameraDeniedMessage: 'camera denied',
  libraryDeniedMessage: 'library denied',
  noImageDataMessage: 'no image data',
  takePhotoLabel: 'Take Photo',
  chooseFromLibraryLabel: 'Choose from Library',
  cancelLabel: 'Cancel',
  sheetTitle: 'Add Photo',
};

const originalOS = Platform.OS;

function mountPicker() {
  let hook!: ReturnType<typeof usePhotoPicker>;
  function Harness() {
    hook = usePhotoPicker(options);
    return null;
  }
  act(() => {
    TestRenderer.create(React.createElement(Harness));
  });
  return {
    get current() {
      return hook;
    },
  };
}

describe('usePhotoPicker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  describe('iOS', () => {
    beforeEach(() => {
      Platform.OS = 'ios';
    });

    it('opens the real ActionSheetIOS with Take Photo / Choose from Library / Cancel, and never flips the Android sheet flag', () => {
      const spy = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
      const result = mountPicker();

      act(() => {
        result.current.open(() => {});
      });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          options: ['Take Photo', 'Choose from Library', 'Cancel'],
          cancelButtonIndex: 2,
        }),
        expect.any(Function)
      );
      expect(result.current.androidSheetOpen).toBe(false);
      expect(haptics.light).toHaveBeenCalledTimes(1);
    });

    it('picking "Take Photo" from the action sheet launches the camera and invokes onPicked with the result', async () => {
      (ImagePicker.requestCameraPermissionsAsync as jest.MockedFunction<typeof ImagePicker.requestCameraPermissionsAsync>).mockResolvedValue({ granted: true, status: PermissionStatus.GRANTED, expires: 'never', canAskAgain: true });
      (ImagePicker.launchCameraAsync as jest.MockedFunction<typeof ImagePicker.launchCameraAsync>).mockResolvedValue({
        canceled: false,
        assets: [{ uri: 'file://photo.jpg', base64: 'AAAA', width: 100, height: 100 }],
      });

      let sheetCallback!: (index: number) => Promise<void> | void;
      jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((_cfg, cb) => {
        sheetCallback = cb as (index: number) => void;
      });

      const result = mountPicker();
      const onPicked = jest.fn<(photo: PickedPhoto) => void>();

      act(() => {
        result.current.open(onPicked);
      });
      await act(async () => {
        await sheetCallback(0);
      });

      expect(ImagePicker.launchCameraAsync).toHaveBeenCalled();
      expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
      expect(onPicked).toHaveBeenCalledWith({ uri: 'file://photo.jpg', base64: 'AAAA' });
      expect(haptics.success).toHaveBeenCalledTimes(1);
    });
  });

  describe('Android', () => {
    beforeEach(() => {
      Platform.OS = 'android';
    });

    it('never calls ActionSheetIOS and instead flips androidSheetOpen so <PhotoSourceSheet> can render', () => {
      const spy = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
      const result = mountPicker();

      act(() => {
        result.current.open(() => {});
      });

      expect(spy).not.toHaveBeenCalled();
      expect(result.current.androidSheetOpen).toBe(true);
    });

    it('pickFromAndroidSheet closes the sheet and routes the chosen source through the same permission/launch flow', async () => {
      (ImagePicker.requestMediaLibraryPermissionsAsync as jest.MockedFunction<typeof ImagePicker.requestMediaLibraryPermissionsAsync>).mockResolvedValue({ granted: true, status: PermissionStatus.GRANTED, expires: 'never', canAskAgain: true });
      (ImagePicker.launchImageLibraryAsync as jest.MockedFunction<typeof ImagePicker.launchImageLibraryAsync>).mockResolvedValue({
        canceled: false,
        assets: [{ uri: 'file://library.jpg', base64: 'BBBB', width: 100, height: 100 }],
      });

      const result = mountPicker();
      const onPicked = jest.fn<(photo: PickedPhoto) => void>();

      act(() => {
        result.current.open(() => {});
      });
      expect(result.current.androidSheetOpen).toBe(true);

      await act(async () => {
        await result.current.pickFromAndroidSheet('library', onPicked);
      });

      expect(result.current.androidSheetOpen).toBe(false);
      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
      expect(onPicked).toHaveBeenCalledWith({ uri: 'file://library.jpg', base64: 'BBBB' });
    });
  });

  it('a denied permission sets the platform-appropriate error message, fires the error haptic, and never opens the picker', async () => {
    Platform.OS = 'ios';
    (ImagePicker.requestCameraPermissionsAsync as jest.MockedFunction<typeof ImagePicker.requestCameraPermissionsAsync>).mockResolvedValue({ granted: false, status: PermissionStatus.DENIED, expires: 'never', canAskAgain: true });

    let sheetCallback!: (index: number) => Promise<void> | void;
    jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((_cfg, cb) => {
      sheetCallback = cb as (index: number) => void;
    });

    const result = mountPicker();

    act(() => {
      result.current.open(() => {});
    });
    await act(async () => {
      await sheetCallback(0);
    });

    expect(result.current.error).toBe('camera denied');
    expect(haptics.error).toHaveBeenCalledTimes(1);
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });
});
