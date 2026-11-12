import { Text, View } from 'react-native';
import { colors, typography } from '@/theme/tokens';

/**
 * Split-Tone Display Typography.
 *
 * The screen title is one sentence rendered in two colours: the subject noun
 * stays pure white, the action phrase goes electric lime. Keeping both halves
 * inside a single <Text> (rather than two side-by-side views) lets the line
 * wrap naturally in Devanagari and Tamil, where a translated action phrase can
 * be twice the English width.
 */

export interface SplitHeadingProps {
  /** Rendered in #FFFFFF - the subject. */
  subject: string;
  /** Rendered in #A8EB34 - the action. */
  action: string;
  subtitle?: string;
  size?: 'display' | 'title' | 'heading';
  /** Order swap for languages that front the verb. */
  actionFirst?: boolean;
  accessibilityLabel?: string;
}

const SIZES = {
  display: { fontSize: typography.display, lineHeight: typography.display * 1.14 },
  title: { fontSize: typography.title, lineHeight: typography.title * 1.18 },
  heading: { fontSize: typography.heading, lineHeight: typography.heading * 1.25 },
} as const;

export function SplitHeading({
  subject,
  action,
  subtitle,
  size = 'display',
  actionFirst = false,
  accessibilityLabel,
}: SplitHeadingProps) {
  const metrics = SIZES[size];

  const white = (
    <Text style={{ color: colors.textPureWhite }} className="font-display">
      {actionFirst ? `${subject}` : `${subject} `}
    </Text>
  );
  const lime = (
    <Text style={{ color: colors.electricLime }} className="font-display">
      {actionFirst ? `${action} ` : action}
    </Text>
  );

  return (
    <View className="w-full">
      <Text
        accessibilityRole="header"
        accessibilityLabel={accessibilityLabel ?? `${subject} ${action}`}
        className="font-display tracking-tight"
        style={[metrics, { letterSpacing: -0.6 }]}
      >
        {actionFirst ? (
          <>
            {lime}
            {white}
          </>
        ) : (
          <>
            {white}
            {lime}
          </>
        )}
      </Text>

      {subtitle ? (
        <Text
          className="mt-2 font-body"
          style={{ color: colors.textMutedSage, fontSize: typography.body, lineHeight: 22 }}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
