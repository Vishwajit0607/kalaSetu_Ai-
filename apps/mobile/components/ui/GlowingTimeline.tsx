import { Text, View } from 'react-native';
import { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';
import { colors, typography } from '@/theme/tokens';

/**
 * Glowing Timeline Connector.
 *
 * A 2px vertical lime rail punctuated by 10px glowing nodes. Used for the AI
 * pipeline (transcribe -> translate -> generate) and for order status. The
 * active node pulses; completed nodes are solid; pending nodes are hollow.
 *
 * The pulse is a single shared value driving one scale transform, so a
 * three-stage pipeline costs one animation, not three - this runs while
 * Photoroom and Gemini are both in flight on a budget device.
 */

export type TimelineNodeState = 'pending' | 'active' | 'complete' | 'failed';

export interface TimelineNode {
  label: string;
  /** Result text shown under the label, e.g. the native-script transcript. */
  detail?: string;
  state: TimelineNodeState;
}

export interface GlowingTimelineProps {
  nodes: TimelineNode[];
  compact?: boolean;
}

const NODE_SIZE = 10;
const RAIL_WIDTH = 2;
const RAIL_X = NODE_SIZE / 2 - RAIL_WIDTH / 2;

export function GlowingTimeline({ nodes, compact = false }: GlowingTimelineProps) {
  return (
    <View className="w-full">
      {nodes.map((node, index) => (
        <TimelineRow
          key={`${node.label}-${index}`}
          node={node}
          isLast={index === nodes.length - 1}
          compact={compact}
        />
      ))}
    </View>
  );
}

function TimelineRow({
  node,
  isLast,
  compact,
}: {
  node: TimelineNode;
  isLast: boolean;
  compact: boolean;
}) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (node.state === 'active') {
      pulse.value = withRepeat(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(0, { duration: 200 });
    }
    return () => cancelAnimation(pulse);
  }, [node.state, pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.18 + pulse.value * 0.42,
    transform: [{ scale: 1.6 + pulse.value * 1.1 }],
  }));

  const dotColor =
    node.state === 'failed'
      ? '#E4572E'
      : node.state === 'pending'
        ? 'transparent'
        : colors.electricLime;

  const labelColor =
    node.state === 'pending' ? colors.textMutedSage : colors.textPureWhite;

  return (
    <View className="flex-row" style={{ minHeight: compact ? 46 : 64 }}>
      <View style={{ width: NODE_SIZE, alignItems: 'center' }}>
        {/* Pulsing halo behind the active node */}
        {node.state === 'active' ? (
          <Animated.View
            pointerEvents="none"
            style={[
              haloStyle,
              {
                position: 'absolute',
                top: 3,
                width: NODE_SIZE,
                height: NODE_SIZE,
                borderRadius: NODE_SIZE / 2,
                backgroundColor: colors.electricLime,
              },
            ]}
          />
        ) : null}

        <View
          style={{
            marginTop: 3,
            width: NODE_SIZE,
            height: NODE_SIZE,
            borderRadius: NODE_SIZE / 2,
            backgroundColor: dotColor,
            borderWidth: node.state === 'pending' ? 1.5 : 0,
            borderColor: colors.borderHairline,
          }}
        />

        {!isLast ? (
          <View
            style={{
              position: 'absolute',
              top: NODE_SIZE + 5,
              left: RAIL_X,
              bottom: -2,
              width: RAIL_WIDTH,
              backgroundColor:
                node.state === 'complete' ? colors.electricLime : colors.borderHairline,
              opacity: node.state === 'complete' ? 1 : 0.7,
            }}
          />
        ) : null}
      </View>

      <View style={{ flex: 1, paddingLeft: 14, paddingBottom: compact ? 10 : 18 }}>
        <Text
          className="font-heading"
          style={{ color: labelColor, fontSize: typography.body - 1, lineHeight: 20 }}
        >
          {node.label}
        </Text>
        {node.detail ? (
          <Text
            className="mt-1 font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label, lineHeight: 18 }}
            numberOfLines={compact ? 2 : 4}
          >
            {node.detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
