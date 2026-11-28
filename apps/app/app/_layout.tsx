/**
 * Owner: P0 / integrator. Root layout: fonts, safe area, gestures, i18n, the bridge and the app
 * state. The route table is documented in src/state/routes.ts.
 */
import { useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Slot, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createBridge } from '@/bridge';
import { I18nProvider } from '@/i18n';
import { AppProvider } from '@/state';
import { colors, useAppFonts } from '@/theme';
import { Button, Text } from '@/components/ui';

function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.textSecondary} />
    </View>
  );
}

/**
 * The last line of defence (legacy app/ErrorBoundary): a render error shows a plain bilingual message
 * with the error text instead of a blank screen. There may be no locale yet here, so both languages.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View testID="app-error" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: colors.bg }}>
      <Text align="center">Meetless 出错了，请重试 / Meetless hit an error. Try again.</Text>
      <Text size="xs" color="textSecondary" mono align="center">
        {error.message}
      </Text>
      <Button label="重试 / Retry" onPress={() => void retry()} />
    </View>
  );
}

export default function RootLayout() {
  const fontsReady = useAppFonts();
  const bridge = useMemo(createBridge, []);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {fontsReady ? (
          <I18nProvider>
            <AppProvider bridge={bridge} fallback={<Loading />}>
              <Slot />
            </AppProvider>
          </I18nProvider>
        ) : (
          <Loading />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
