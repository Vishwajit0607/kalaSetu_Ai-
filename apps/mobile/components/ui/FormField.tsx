import type { ReactNode } from 'react';
import { Text, TextInput, View } from 'react-native';
import { colors, radii, typography } from '@/theme/tokens';

/**
 * A labelled text box, used by every form in the app.
 *
 * Extracted from the signup screen so the account screens do not each carry their
 * own copy. `error` turns the border amber and shows the reason underneath, so the
 * artisan sees which field to fix, not just that the form failed.
 */

export type FormFieldProps = {
  label: string;
  /** Shown under the box, and marks it as invalid. */
  error?: string | null;
  /** Something at the right edge inside the box, e.g. a show/hide button. */
  trailing?: ReactNode;
} & React.ComponentProps<typeof TextInput>;

export function FormField({ label, error, trailing, ...inputProps }: FormFieldProps) {
  return (
    <View>
      <Text
        className="mb-1 font-heading"
        style={{ color: colors.textMutedSage, fontSize: typography.label - 1, letterSpacing: 0.8 }}
      >
        {label}
      </Text>
      <View
        className="flex-row items-center"
        style={{
          minHeight: 52,
          borderRadius: radii.card,
          paddingHorizontal: 16,
          backgroundColor: colors.surfaceCharcoal,
          borderWidth: 1,
          borderColor: error ? '#E4A72E' : colors.borderHairline,
        }}
      >
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.textMutedSage}
          style={{ flex: 1, color: colors.textPureWhite, fontSize: typography.body, minHeight: 50 }}
          {...inputProps}
        />
        {trailing}
      </View>
      {error ? (
        <Text
          accessibilityRole="alert"
          className="mt-1 font-body"
          style={{ color: '#E4A72E', fontSize: typography.label - 1, lineHeight: 17 }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
