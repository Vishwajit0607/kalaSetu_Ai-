import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider } from '@tanstack/react-query';
import * as Network from 'expo-network';
import * as SplashScreen from 'expo-splash-screen';
import { colors, typography } from '@/theme/tokens';
import { profileFromArtisan, useArtisanStore } from '@/store/useArtisanStore';
import { startBackgroundSync, pendingSyncCount } from '@/db/sync';
import { tFor } from '@/i18n';
import { queryClient } from '@/lib/queryClient';
import { api, isOfflineError } from '@/services/apiClient';
import '../global.css';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const hydrate = useArtisanStore((state) => state.hydrate);
  const hydrated = useArtisanStore((state) => state.hydrated);
  const session = useArtisanStore((state) => state.session);
  const profile = useArtisanStore((state) => state.profile);
  const uiLanguage = useArtisanStore((state) => state.uiLanguage);
  const setProfile = useArtisanStore((state) => state.setProfile);
  const setOffline = useArtisanStore((state) => state.setOffline);
  const setPendingSyncCount = useArtisanStore((state) => state.setPendingSyncCount);

  const router = useRouter();
  const segments = useSegments();
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    hydrate()
      .catch((error: unknown) =>
        setBootError(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => void SplashScreen.hideAsync());
  }, [hydrate]);

  /*
   * Route guard, keyed on the *session*, not the profile: being signed in is a
   * property of holding a valid login, and the profile is just data that can
   * be re-fetched. No session means the onboarding group (language, signup,
   * login); a session means the app proper.
   */
  useEffect(() => {
    if (!hydrated) return;
    const inOnboarding = segments[0] === '(onboarding)';

    if (!session && !inOnboarding) {
      router.replace('/(onboarding)/language-select');
    } else if (session && inOnboarding) {
      router.replace('/(tabs)');
    }
  }, [hydrated, session, router, segments]);

  /*
   * A session with no cached profile happens after a reinstall restoring the
   * keystore, or if the profile file was lost. Rebuild it from the server
   * rather than showing a signed-in app with no name.
   */
  useEffect(() => {
    if (!hydrated || !session || profile) return;
    let cancelled = false;
    api
      .me()
      .then(({ artisan }) => {
        if (cancelled) return;
        void setProfile(profileFromArtisan(artisan));
      })
      .catch((error: unknown) => {
        // Offline is fine - retry next launch. A 401 already ended the session.
        if (!isOfflineError(error)) console.warn('[auth] could not load profile', error);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, session, profile, setProfile]);

  /* Connectivity watch - drives the offline banner and the sync chip. */
  useEffect(() => {
    let cancelled = false;

    const check = async (): Promise<void> => {
      const state = await Network.getNetworkStateAsync();
      if (cancelled) return;
      setOffline(!state.isConnected || state.isInternetReachable === false);
      setPendingSyncCount(await pendingSyncCount());
    };

    void check();
    const interval = setInterval(() => void check(), 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [setOffline, setPendingSyncCount]);

  /* Background delta sync, started once a profile exists. */
  useEffect(() => {
    if (!profile?.serverId) return;
    return startBackgroundSync(profile.serverId, (report) => {
      void pendingSyncCount().then(setPendingSyncCount);
      if (report.error) console.warn('[sync]', report.error);
    });
  }, [profile?.serverId, setPendingSyncCount]);

  if (bootError) {
    return (
      <View
        className="flex-1 items-center justify-center px-6"
        style={{ backgroundColor: colors.canvasObsidian }}
      >
        <Text
          className="text-center font-heading"
          style={{ color: colors.electricLime, fontSize: typography.heading }}
        >
          {tFor(uiLanguage)('boot.failed')}
        </Text>
        <Text
          className="mt-3 text-center font-body"
          style={{ color: colors.textMutedSage, fontSize: typography.label }}
        >
          {bootError}
        </Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.canvasObsidian }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" backgroundColor={colors.canvasObsidian} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.canvasObsidian },
              animation: 'fade',
            }}
          >
            <Stack.Screen name="(onboarding)" options={{ animation: 'fade' }} />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="product/[id]"
              options={{ presentation: 'card', animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="listing/[id]"
              options={{ presentation: 'card', animation: 'slide_from_right' }}
            />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
