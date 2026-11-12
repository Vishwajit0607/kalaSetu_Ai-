import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import { Canvas, Circle, RadialGradient, vec } from '@shopify/react-native-skia';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { colors, typography } from '@/theme/tokens';
import { useT } from '@/i18n';

/**
 * Radial Halo Product Stage.
 *
 * The product cutout sits inside concentric HUD rings over a soft radial
 * olive-lime glow, with floating icon pills down the right edge. The glow is
 * drawn in Skia rather than stacked translucent Views: three nested radial
 * gradients as RN Views cost ~8ms a frame on a low-end Android, while one
 * Skia canvas is a single GPU draw.
 */

export interface HaloProductStageProps {
  /** Local file URI or remote URL of the cutout (PNG with alpha). */
  imageUri: string | null;
  size?: number;
  /** Slow rotation of the outer dashed ring while a job is processing. */
  processing?: boolean;
  /** Vertical floating icon pills rendered on the right edge. */
  actions?: React.ReactNode;
  caption?: string;
}

export function HaloProductStage({
  imageUri,
  size = 320,
  processing = false,
  actions,
  caption,
}: HaloProductStageProps) {
  const { t } = useT();
  const spin = useSharedValue(0);

  useEffect(() => {
    if (processing) {
      spin.value = withRepeat(
        withTiming(360, { duration: 9000, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(spin);
      spin.value = withTiming(0, { duration: 300 });
    }
    return () => cancelAnimation(spin);
  }, [processing, spin]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
  }));

  const center = size / 2;
  const productSize = size * 0.62;

  return (
    <View className="w-full items-center">
      <View style={{ width: size, height: size }} className="items-center justify-center">
        {/* Soft radial olive-lime spotlight */}
        <Canvas style={{ position: 'absolute', width: size, height: size }}>
          <Circle cx={center} cy={center} r={center}>
            <RadialGradient
              c={vec(center, center)}
              r={center}
              colors={[
                'rgba(74, 107, 29, 0.45)',
                'rgba(74, 107, 29, 0.16)',
                'rgba(6, 7, 5, 0)',
              ]}
              positions={[0, 0.58, 1]}
            />
          </Circle>
        </Canvas>

        {/* Concentric HUD rings */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: size * 0.96,
            height: size * 0.96,
            borderRadius: size,
            borderWidth: 1,
            borderColor: colors.borderHairline,
          }}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            ringStyle,
            {
              position: 'absolute',
              width: size * 0.82,
              height: size * 0.82,
              borderRadius: size,
              borderWidth: 1.5,
              borderColor: colors.electricLime,
              borderStyle: 'dashed',
              opacity: 0.55,
            },
          ]}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: size * 0.7,
            height: size * 0.7,
            borderRadius: size,
            borderWidth: 1,
            borderColor: 'rgba(168, 235, 52, 0.28)',
          }}
        />

        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={{ width: productSize, height: productSize }}
            contentFit="contain"
            transition={220}
            accessibilityLabel={caption ?? 'Product photo'}
          />
        ) : (
          <View
            style={{ width: productSize, height: productSize }}
            className="items-center justify-center"
          >
            <Text
              className="text-center font-body"
              style={{ color: colors.textMutedSage, fontSize: typography.label }}
            >
              {t('halo.capture')}
            </Text>
          </View>
        )}

        {/* Right-edge floating action dock */}
        {actions ? (
          <View
            style={{ position: 'absolute', right: -6, top: size * 0.16 }}
            className="items-center"
          >
            {actions}
          </View>
        ) : null}
      </View>

      {caption ? (
        <Text
          className="mt-4 text-center font-body"
          style={{ color: colors.textMutedSage, fontSize: typography.label + 1 }}
        >
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A single pill in the right-edge dock. Rendered as a sibling list joined by a
 * hairline so the dock reads as one connected instrument cluster.
 */
export function StageActionPill({
  icon,
  label,
  active = false,
  onPress,
  showConnector = true,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onPress: () => void;
  showConnector?: boolean;
}) {
  return (
    <View className="items-center">
      <View
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        onTouchEnd={onPress}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active ? colors.electricLime : colors.surfaceElevated,
          borderWidth: 1,
          borderColor: active ? colors.electricLime : colors.borderHairline,
        }}
      >
        {icon}
      </View>
      {showConnector ? (
        <View
          style={{
            width: 1,
            height: 16,
            backgroundColor: colors.borderHairline,
          }}
        />
      ) : null}
    </View>
  );
}
