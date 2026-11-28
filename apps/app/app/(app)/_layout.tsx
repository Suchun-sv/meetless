/** Owner: P0. Signed-in area: the shell (sidebar or drawer) around a stack of pages. */
import { Platform } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useApp } from '@/state';
import { ChromeProvider } from '@/shell/chrome';
import { Shell } from '@/shell/Shell';
import { ScreenshotTour } from '@/state/screenshotTour';
import { colors } from '@/theme';

export default function AppLayout() {
  const { snapshot } = useApp();
  if (!snapshot.session) return <Redirect href="/sign-in" />;
  return (
    <ChromeProvider>
    <Shell>
      <ScreenshotTour />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: Platform.OS === 'web' ? 'none' : 'default' }} />
    </Shell>
    </ChromeProvider>
  );
}
