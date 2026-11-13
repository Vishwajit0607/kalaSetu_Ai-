import { Text, View } from 'react-native';
import { colors, radii, typography } from '@/theme/tokens';

/**
 * Presentational pieces shared by the owner's product screen and the bazaar's
 * read-only listing screen, so a price tile or spec row looks identical in both.
 */

export function PriceTile({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <View
      className="flex-1 p-5"
      style={{
        borderRadius: radii.bento,
        backgroundColor: colors.surfaceCharcoal,
        borderWidth: 1,
        borderColor: colors.borderHairline,
      }}
    >
      <Text
        className="font-heading"
        style={{ color: colors.electricLime, fontSize: typography.label - 1, letterSpacing: 1 }}
      >
        {label}
      </Text>
      <Text
        className="mt-2 font-display"
        style={{ color: colors.textPureWhite, fontSize: typography.title - 2 }}
      >
        {value}
      </Text>
      <Text
        className="mt-1 font-body"
        style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}
      >
        {caption}
      </Text>
    </View>
  );
}

export function SpecRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View
      className="flex-row items-center justify-between py-2.5"
      style={
        last
          ? undefined
          : { borderBottomWidth: 1, borderBottomColor: colors.borderHairline }
      }
    >
      <Text
        className="font-body"
        style={{ color: colors.textMutedSage, fontSize: typography.label + 1 }}
      >
        {label}
      </Text>
      <Text
        className="ml-4 flex-1 text-right font-heading"
        style={{ color: colors.textPureWhite, fontSize: typography.label + 1 }}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}
