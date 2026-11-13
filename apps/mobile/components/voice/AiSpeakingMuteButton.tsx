import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  FadeInRight,
  FadeOutRight,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, radii, typography } from '@/theme/tokens';
import { stopSpeaking, useIsSpeaking } from '@/services/speech';
import { useT } from '@/i18n';

/**
 * Floating Mute AI button that appears whenever AI voice is actively speaking.
 * Tapping it immediately stops and mutes the AI playback.
 */
export function AiSpeakingMuteButton() {
  const isSpeaking = useIsSpeaking();
  const { t } = useT();

  const pulse = useSharedValue(1);

  useEffect(() => {
    if (isSpeaking) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 600 }),
          withTiming(1, { duration: 600 }),
        ),
        -1,
        true,
      );
    } else {
      pulse.value = 1;
    }
  }, [isSpeaking, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  if (!isSpeaking) return null;

  return (
    <Animated.View
      entering={FadeInRight.duration(220)}
      exiting={FadeOutRight.duration(180)}
      className="absolute top-2 right-4 z-50"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Mute AI voice"
        accessibilityHint="Stops current AI voice speech immediately"
        hitSlop={12}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          void stopSpeaking();
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: 'rgba(18, 22, 16, 0.94)',
          borderWidth: 1.5,
          borderColor: colors.electricLime,
          borderRadius: radii.pill,
          paddingVertical: 8,
          paddingHorizontal: 14,
          minHeight: 40,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.45,
          shadowRadius: 5,
          elevation: 6,
        }}
      >
        <Animated.View style={pulseStyle}>
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: 'rgba(168, 235, 52, 0.22)',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 6,
            }}
          >
            <Ionicons name="volume-mute" size={14} color={colors.electricLime} />
          </View>
        </Animated.View>

        <Text
          className="font-heading"
          style={{
            color: colors.textPureWhite,
            fontSize: typography.label - 1,
            letterSpacing: 0.5,
          }}
        >
          {t('common.muteAi')}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

