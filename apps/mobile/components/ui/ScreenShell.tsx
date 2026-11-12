import { ScrollView, Text, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, Circle, RadialGradient, vec } from '@shopify/react-native-skia';
import { colors, spacing, typography } from '@/theme/tokens';
import { AiSpeakingMuteButton } from '@/components/voice/AiSpeakingMuteButton';
import { useArtisanStore } from '@/store/useArtisanStore';
import { useT } from '@/i18n';

/**
 * Shared screen chrome: obsidian canvas, the vertical KALASETU watermark, an
 * ambient olive spotlight, and the offline / pending-sync banner.
 *
 * The banner is not dismissible on purpose. An artisan working offline needs a
 * standing promise that their work is saved, not a toast they might miss.
 */

export interface ScreenShellProps extends ViewProps {
  children: React.ReactNode;
  scroll?: boolean;
  /** Show the rotated KALASETU wordmark down the left edge. */
  watermark?: boolean;
  /** Extra bottom padding so content clears the tab bar. */
  bottomInset?: number;
}

export function ScreenShell({
  children,
  scroll = true,
  watermark = false,
  bottomInset = 24,
  ...rest
}: ScreenShellProps) {
  const insets = useSafeAreaInsets();
  const { t } = useT();
  const offline = useArtisanStore((state) => state.offline);
  const pending = useArtisanStore((state) => state.pendingSyncCount);

  const body = (
    <View
      style={{
        paddingHorizontal: spacing.gutter,
        paddingLeft: watermark ? spacing.gutter + 26 : spacing.gutter,
        paddingBottom: bottomInset,
      }}
      {...rest}
    >
      {children}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvasObsidian }}>
      {/* Ambient olive spotlight, top-right */}
      <Canvas
        pointerEvents="none"
        style={{ position: 'absolute', top: -120, right: -120, width: 420, height: 420 }}
      >
        <Circle cx={210} cy={210} r={210}>
          <RadialGradient
            c={vec(210, 210)}
            r={210}
            colors={['rgba(74, 107, 29, 0.30)', 'rgba(6, 7, 5, 0)']}
          />
        </Circle>
      </Canvas>

      {watermark ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: -16,
            top: insets.top + 90,
            width: 160,
            transform: [{ rotate: '-90deg' }],
          }}
        >
          <Text
            className="font-display"
            style={{
              color: colors.electricLime,
              fontSize: typography.label,
              letterSpacing: 5,
              opacity: 0.6,
            }}
          >
            KALASETU
          </Text>
        </View>
      ) : null}

      <View style={{ paddingTop: insets.top + 8, flex: 1 }}>
        <AiSpeakingMuteButton />
        {offline || pending > 0 ? (
          <View
            accessibilityRole="alert"
            className="mx-5 mb-3 flex-row items-center rounded-pill px-4 py-2"
            style={{
              backgroundColor: offline ? 'rgba(168, 235, 52, 0.12)' : colors.surfaceCharcoal,
              borderWidth: 1,
              borderColor: colors.borderHairline,
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                marginRight: 10,
                backgroundColor: offline ? '#E4A72E' : colors.electricLime,
              }}
            />
            <Text
              className="flex-1 font-body"
              style={{ color: colors.textMutedSage, fontSize: typography.label }}
            >
              {offline
                ? t('shell.offlineBanner', { count: pending })
                : t('shell.syncingBanner', { count: pending })}
            </Text>
          </View>
        ) : null}

        {scroll ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1 }}
          >
            {body}
          </ScrollView>
        ) : (
          <View style={{ flex: 1 }}>{body}</View>
        )}
      </View>
    </View>
  );
}
