import { Pressable, Text, View } from 'react-native';
import { colors, radii, typography } from '@/theme/tokens';

/**
 * Split Compatibility Badge Pill.
 *
 * Two-tone container: a solid lime left segment carrying black label text, and
 * a dark bordered right segment housing the platform icons. Used for the
 * marketplace sync status row (ONDC / GeM / WhatsApp B2B).
 *
 * A synced channel shows its icon in full lime; an unsynced one is dimmed to
 * sage, so connection state is legible without reading a single word.
 */

export interface ChannelIcon {
  key: string;
  /** Short platform mark, e.g. 'ONDC', 'GeM', 'WA'. */
  mark: string;
  synced: boolean;
  accessibilityLabel: string;
}

export interface SplitBadgePillProps {
  /** Label inside the solid lime segment. */
  label: string;
  channels: ChannelIcon[];
  onPress?: () => void;
}

export function SplitBadgePill({ label, channels, onPress }: SplitBadgePillProps) {
  const syncedCount = channels.filter((channel) => channel.synced).length;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${syncedCount} of ${channels.length} marketplaces connected.`}
      onPress={onPress}
      className="flex-row self-start"
      style={{ borderRadius: radii.pill, overflow: 'hidden', minHeight: 44 }}
    >
      {/* Solid lime segment */}
      <View
        className="justify-center px-4"
        style={{ backgroundColor: colors.electricLime }}
      >
        <Text
          className="font-heading"
          style={{
            color: colors.textInverseDark,
            fontSize: typography.label,
            letterSpacing: 0.3,
          }}
        >
          {label}
        </Text>
      </View>

      {/* Dark bordered segment with the platform marks */}
      <View
        className="flex-row items-center px-3"
        style={{
          backgroundColor: colors.surfaceCharcoal,
          borderWidth: 1,
          borderLeftWidth: 0,
          borderColor: colors.borderHairline,
          borderTopRightRadius: radii.pill,
          borderBottomRightRadius: radii.pill,
        }}
      >
        {channels.map((channel, index) => (
          <View
            key={channel.key}
            accessibilityLabel={`${channel.accessibilityLabel}: ${
              channel.synced ? 'connected' : 'not connected'
            }`}
            className="flex-row items-center"
          >
            <Text
              className="font-heading"
              style={{
                color: channel.synced ? colors.electricLime : colors.textMutedSage,
                fontSize: typography.label - 1,
                letterSpacing: 0.6,
                opacity: channel.synced ? 1 : 0.55,
              }}
            >
              {channel.mark}
            </Text>
            {index < channels.length - 1 ? (
              <View
                style={{
                  width: 1,
                  height: 12,
                  marginHorizontal: 8,
                  backgroundColor: colors.borderHairline,
                }}
              />
            ) : null}
          </View>
        ))}
      </View>
    </Pressable>
  );
}
