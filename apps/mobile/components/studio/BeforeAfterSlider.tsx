import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  clamp,
} from 'react-native-reanimated';
import { colors, motion, radii, typography } from '@/theme/tokens';
import { useT } from '@/i18n';

/**
 * Before / After reveal slider.
 *
 * Proof, not decoration. The artisan's own dim phone snap sits under the
 * studio cutout, and dragging the lime handle wipes between them. This is the
 * moment the product earns trust - "the app did that to my photo" - so the
 * gesture runs entirely on the UI thread and never drops a frame.
 */

export interface BeforeAfterSliderProps {
  beforeUri: string;
  afterUri: string;
  height?: number;
  beforeLabel?: string;
  afterLabel?: string;
}

const HANDLE_WIDTH = 3;
const KNOB_SIZE = 40;

export function BeforeAfterSlider({
  beforeUri,
  afterUri,
  height = 300,
  beforeLabel,
  afterLabel,
}: BeforeAfterSliderProps) {
  const { t } = useT();
  const before = beforeLabel ?? t('common.before');
  const after = afterLabel ?? t('common.after');
  const width = useSharedValue(0);
  // Reveal fraction, 0..1. Starts at 55% so both states are visible at rest.
  const position = useSharedValue(0.55);
  const dragStart = useSharedValue(0.55);

  const pan = Gesture.Pan()
    .onStart(() => {
      dragStart.value = position.value;
    })
    .onUpdate((event) => {
      if (width.value === 0) return;
      position.value = clamp(dragStart.value + event.translationX / width.value, 0, 1);
    })
    .onEnd(() => {
      // Snap to the edges when the artisan flicks past 92% / 8%.
      if (position.value > 0.92) position.value = withSpring(1, motion.springy);
      else if (position.value < 0.08) position.value = withSpring(0, motion.springy);
    });

  const revealStyle = useAnimatedStyle(() => ({
    width: `${position.value * 100}%`,
  }));

  const handleStyle = useAnimatedStyle(() => ({
    left: `${position.value * 100}%`,
  }));

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel="Before and after comparison slider"
          accessibilityHint="Drag left or right to compare the original photo with the studio version"
          onLayout={(event) => {
            width.value = event.nativeEvent.layout.width;
          }}
          style={{
            height,
            borderRadius: radii.card,
            overflow: 'hidden',
            backgroundColor: colors.surfaceCharcoal,
            borderWidth: 1,
            borderColor: colors.borderHairline,
          }}
        >
          {/* Original capture sits underneath */}
          <Image
            source={{ uri: beforeUri }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            accessibilityLabel={before}
          />

          {/* Enhanced cutout revealed from the left */}
          <Animated.View
            style={[
              revealStyle,
              { position: 'absolute', top: 0, bottom: 0, left: 0, overflow: 'hidden' },
            ]}
          >
            <Image
              source={{ uri: afterUri }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              accessibilityLabel={after}
            />
          </Animated.View>

          {/* Lime divider + knob */}
          <Animated.View
            pointerEvents="none"
            style={[
              handleStyle,
              {
                position: 'absolute',
                top: 0,
                bottom: 0,
                width: HANDLE_WIDTH,
                marginLeft: -HANDLE_WIDTH / 2,
                backgroundColor: colors.electricLime,
              },
            ]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              handleStyle,
              {
                position: 'absolute',
                top: height / 2 - KNOB_SIZE / 2,
                width: KNOB_SIZE,
                height: KNOB_SIZE,
                marginLeft: -KNOB_SIZE / 2,
                borderRadius: KNOB_SIZE / 2,
                backgroundColor: colors.electricLime,
                alignItems: 'center',
                justifyContent: 'center',
              },
            ]}
          >
            <Text
              className="font-display"
              style={{ color: colors.textInverseDark, fontSize: typography.label }}
            >
              ⇆
            </Text>
          </Animated.View>
        </View>
      </GestureDetector>

      <View className="mt-3 flex-row justify-between">
        <Text className="font-body" style={{ color: colors.textMutedSage, fontSize: typography.label }}>
          {after}
        </Text>
        <Text className="font-body" style={{ color: colors.textMutedSage, fontSize: typography.label }}>
          {before}
        </Text>
      </View>
    </View>
  );
}
