import { Stack } from 'expo-router';
import { colors } from '@/theme/tokens';

/**
 * Onboarding group layout.
 *
 * Without this file expo-router does not treat `(onboarding)` as a single
 * route - it hoists `language-select` and `artisan-profile` into the root
 * navigator individually, and the root layout's `<Stack.Screen
 * name="(onboarding)" />` then refers to a route that does not exist.
 *
 * Language first, then signup: the signup screen's spoken prompts are read in
 * whichever language was just chosen. Login is reachable from both, and has its
 * own language toggle for someone arriving on a fresh install.
 */
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.canvasObsidian },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="language-select" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="login" />
    </Stack>
  );
}
