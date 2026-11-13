import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { colors, motion, radii, typography } from '@/theme/tokens';

/**
 * Staggered Numbered Bento Card (01 / 02 / 03).
 *
 * Inactive cards are dark #11150E with a lime step number. The active card
 * lifts vertically and fills with the #A8EB34 -> #78C214 gradient, flipping
 * all of its text to #080A06. That vertical lift is the only affordance a
 * non-reading user needs to know which step they are on.
 */

export interface BentoStepCardProps {
  /** '01' | '02' | '03' - rendered verbatim, zero-padded by the caller. */
  step: string;
  title: string;
  summary: string;
  active?: boolean;
  onPress?: () => void;
  /** Rendered bottom-right: a live count, alert or mic affordance. */
  badge?: string;
  /** Slot for the quick-launch mic trigger on card 02. */
  trailing?: React.ReactNode;
  accessibilityHint?: string;
}

/** The active card sits 14px higher than its neighbours. */
const LIFT = 14;

export function BentoStepCard({
  step,
  title,
  summary,
  active = false,
  onPress,
  badge,
  trailing,
  accessibilityHint,
}: BentoStepCardProps) {
  const lift = useSharedValue(active ? -LIFT : 0);
  const press = useSharedValue(1);

  useEffect(() => {
    lift.value = withSpring(active ? -LIFT : 0, motion.springy);
  }, [active, lift]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value }, { scale: press.value }],
  }));

  const inverse = active;
  const titleColor = inverse ? colors.textInverseDark : colors.textPureWhite;
  const summaryColor = inverse ? 'rgba(8, 10, 6, 0.72)' : colors.textMutedSage;
  const stepColor = inverse ? colors.textInverseDark : colors.electricLime;

  const body = (
    <View className="flex-1 justify-between" style={{ padding: 18 }}>
      <View className="flex-row items-start justify-between">
        <Text
          className="font-display"
          style={{
            color: stepColor,
            fontSize: typography.stepNumber,
            letterSpacing: 1.6,
            opacity: inverse ? 0.85 : 1,
          }}
        >
          {step}
        </Text>
        {trailing}
      </View>

      <View style={{ marginTop: 22 }}>
        <Text
          className="font-heading"
          style={{ color: titleColor, fontSize: typography.heading, lineHeight: 24 }}
        >
          {title}
        </Text>
        <Text
          className="mt-2 font-body"
          style={{ color: summaryColor, fontSize: typography.label + 1, lineHeight: 18 }}
          numberOfLines={3}
        >
          {summary}
        </Text>

        {badge ? (
          <View
            className="mt-3 self-start rounded-pill px-3 py-1"
            style={{
              backgroundColor: inverse ? 'rgba(8, 10, 6, 0.14)' : 'rgba(168, 235, 52, 0.12)',
              borderWidth: 1,
              borderColor: inverse ? 'rgba(8, 10, 6, 0.28)' : colors.borderHairline,
            }}
          >
            <Text
              className="font-heading"
              style={{
                color: inverse ? colors.textInverseDark : colors.electricLime,
                fontSize: typography.label - 1,
                letterSpacing: 0.4,
              }}
            >
              {badge}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <Animated.View style={[containerStyle, { flex: 1 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Step ${step}. ${title}. ${summary}`}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ selected: active }}
        onPressIn={() => {
          press.value = withSpring(0.97, motion.springy);
        }}
        onPressOut={() => {
          press.value = withSpring(1, motion.springy);
        }}
        onPress={onPress}
        style={{ minHeight: 196, borderRadius: radii.bento, overflow: 'hidden' }}
      >
        {active ? (
          <LinearGradient
            colors={[colors.electricLime, colors.limeGradientEnd]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={{ flex: 1 }}
          >
            {body}
          </LinearGradient>
        ) : (
          <View
            style={{
              flex: 1,
              backgroundColor: colors.surfaceCharcoal,
              borderWidth: 1,
              borderColor: colors.borderHairline,
              borderRadius: radii.bento,
            }}
          >
            {body}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}
