import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/manrope';
import { queryClient } from '../src/api/queryClient';
import { useAuthStore } from '../src/state/auth';
import { colors } from '../src/theme';
import { KlyvoToast } from '../src/components/ui';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const initialize = useAuthStore((state) => state.initialize);
  const hydrated = useAuthStore((state) => state.hydrated);
  const [loaded] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });
  useEffect(() => {
    void initialize();
  }, [initialize]);
  // Одна заставка вместо двух: системный splash держится ровно до готовности приложения.
  useEffect(() => {
    if (loaded && hydrated) void SplashScreen.hideAsync();
  }, [loaded, hydrated]);
  if (!loaded || !hydrated) {
    return (
      <View style={styles.bootstrap}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }
  return (
    // Корень для жестов нужен явно: без него щипок в просмотре картинки не работает на Android.
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" backgroundColor={colors.background} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
              animation: 'fade_from_bottom',
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
            <Stack.Screen name="auth" options={{ animation: 'fade' }} />
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            <Stack.Screen name="shop" options={{ presentation: 'modal' }} />
            <Stack.Screen name="transactions" />
            <Stack.Screen name="legal/[doc]" />
            <Stack.Screen name="generation/[id]" options={{ gestureEnabled: false }} />
            <Stack.Screen name="video/[id]" />
          </Stack>
          <KlyvoToast />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bootstrap: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
  },
});
