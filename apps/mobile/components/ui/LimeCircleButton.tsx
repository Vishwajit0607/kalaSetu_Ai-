import { Pressable, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { colors, motion, touch } from '@/theme/tokens';

/**
 * Circular Arrow Action Trigger.
 *
 * A 48px solid electric-lime disc holding a crisp black 45-degree diagonal
 * arrow. It is the single "go" gesture in the whole product, so it carries
 * haptics and a spoken label - an artisan who cannot read the surrounding
 * description still learns what the button does by long-pressing it.
 */

export interface LimeCircleButtonProps {
  onPress: () => void;
  /** Spoken aloud via Bulbul TTS on long-press. */
  accessibilityLabel: string;
  size?: number;
  disabled?: boolean;
  /** 'up-right' is the reference 45-degree diagonal; 'right' for inline rows. */
  direction?: 'up-right' | 'right';
  onLongPress?: () => void;
}

export function LimeCircleButton({
  onPress,
  accessibilityLabel,
  size = touch.circleButton,
  disabled = false,
  direction = 'up-right',
  onLongPress,
}: LimeCircleButtonProps) {
  const scale = useSharedValue(1);
  const glow = useSharedValue(0);

  const discStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity: glow.value * 0.45,
    transform: [{ scale: 1 + glow.value * 0.35 }],
  }));

  const iconSize = size * 0.42;

  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      {/* Ambient olive halo that blooms on press - pure decoration, runs on the
          UI thread so it never competes with the navigation transition. */}
      <Animated.View
        pointerEvents="none"
        style={[
          haloStyle,
          {
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.electricLime,
          },
        ]}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={12}
        onPressIn={() => {
          scale.value = withSpring(0.92, motion.springy);
          glow.value = withTiming(1, { duration: motion.fast });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, motion.springy);
          glow.value = withTiming(0, { duration: motion.base });
        }}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onPress();
        }}
        onLongPress={onLongPress}
      >
        <Animated.View
          style={[
            discStyle,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: disabled ? colors.borderHairline : colors.electricLime,
              alignItems: 'center',
              justifyContent: 'center',
            },
          ]}
        >
          <Svg width={iconSize} height={iconSize} viewBox="0 0 24 24">
            {direction === 'up-right' ? (
              <Path
                d="M7 17 17 7M17 7H9M17 7v8"
                stroke={disabled ? colors.textMutedSage : colors.textInverseDark}
                strokeWidth={2.6}
                strokeLinecap="square"
                strokeLinejoin="miter"
                fill="none"
              />
            ) : (
              <Path
                d="M4 12h15M13 6l6 6-6 6"
                stroke={disabled ? colors.textMutedSage : colors.textInverseDark}
                strokeWidth={2.6}
                strokeLinecap="square"
                strokeLinejoin="miter"
                fill="none"
              />
            )}
          </Svg>
        </Animated.View>
      </Pressable>
    </View>
  );
}
