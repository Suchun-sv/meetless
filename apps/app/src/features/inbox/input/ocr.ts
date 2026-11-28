import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/*
 * On-device text recognition for photos and screenshots on iOS: the local `meetless-ocr` Expo module
 * (apps/app/modules/meetless-ocr) wraps Apple Vision's VNRecognizeTextRequest with zh-Hans and en.
 * Elsewhere (web, desktop, or an iOS build without the module) this returns null and the server
 * OCRs the image instead.
 */

interface MeetlessOcr {
  recognize(input: { uri?: string; base64?: string }): Promise<string>;
}

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<MeetlessOcr>('MeetlessOcr') : null;

/** The recognised text of an image (a file URI or base64), or null when recognition is not available here or fails. */
export async function recognizeText(input: { uri?: string; base64?: string }): Promise<string | null> {
  if (!native) return null;
  try {
    const text = (await native.recognize(input)).trim();
    return text || null;
  } catch {
    return null;
  }
}
