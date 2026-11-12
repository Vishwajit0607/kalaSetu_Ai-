import { Text, View } from 'react-native';
import { colors, radii, typography } from '@/theme/tokens';

/**
 * Small status pill: "Yours", "Sold out", "GI". Lime for good news, red for
 * a stop sign; `solid` fills it for the one badge that should read first.
 */
export function Badge({
  label,
  tone,
  solid = false,
}: {
  label: string;
  tone: 'lime' | 'red';
  solid?: boolean;
}) {
  const color = tone === 'lime' ? colors.electricLime : '#E4572E';
  return (
    <View
      className="px-2.5 py-0.5"
      style={{
        borderRadius: radii.pill,
        backgroundColor: solid ? color : tone === 'lime' ? 'rgba(168, 235, 52, 0.14)' : 'rgba(228, 87, 46, 0.18)',
      }}
    >
      <Text
        className="font-heading"
        style={{
          color: solid ? colors.textInverseDark : color,
          fontSize: typography.label - 2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
