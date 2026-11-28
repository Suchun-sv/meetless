import { useFonts } from 'expo-font';

/** One static file per weight; `fontFor` picks the family. Native only (the web uses public/fonts). */
export const NATIVE_FONTS = {
  'Geist-Regular': require('../../assets/fonts/Geist-Regular.ttf'),
  'Geist-Medium': require('../../assets/fonts/Geist-Medium.ttf'),
  'Geist-SemiBold': require('../../assets/fonts/Geist-SemiBold.ttf'),
  'GeistMono-Regular': require('../../assets/fonts/GeistMono-Regular.ttf'),
  'NotoSansSC-Regular': require('../../assets/fonts/NotoSansSC-Regular.otf'),
  'NotoSansSC-Medium': require('../../assets/fonts/NotoSansSC-Medium.otf'),
} as const;

/** Native: loads the bundled fonts; true once they can be used (or failed: the system font stands in). */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(NATIVE_FONTS);
  return loaded || error !== null;
}
