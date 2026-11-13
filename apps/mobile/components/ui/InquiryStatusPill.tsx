import { Text, View } from 'react-native';
import { colors, radii, typography } from '@/theme/tokens';
import type { InquiryStatus } from '@/services/apiClient';

/**
 * A coloured pill that shows the current status of a buyer inquiry.
 * new → yellow, replied → lime, won → green, lost → red-grey.
 */

const STATUS_COLORS: Record<InquiryStatus, { bg: string; text: string }> = {
  new: { bg: 'rgba(228, 167, 46, 0.18)', text: '#E4A72E' },
  replied: { bg: 'rgba(168, 235, 52, 0.18)', text: '#A8EB34' },
  won: { bg: 'rgba(74, 222, 128, 0.18)', text: '#4ade80' },
  lost: { bg: 'rgba(155, 163, 148, 0.18)', text: '#9BA394' },
};

interface InquiryStatusPillProps {
  status: InquiryStatus;
}

export function InquiryStatusPill({ status }: InquiryStatusPillProps) {
  const palette = STATUS_COLORS[status] ?? STATUS_COLORS.new;

  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: radii.pill,
        backgroundColor: palette.bg,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={{
          color: palette.text,
          fontSize: typography.label - 1,
          fontWeight: '600',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {status}
      </Text>
    </View>
  );
}
