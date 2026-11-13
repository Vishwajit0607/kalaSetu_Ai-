import { Text, View } from 'react-native';
import { passwordStrength, STRENGTH_LABEL } from '@/services/password';
import { colors, typography } from '@/theme/tokens';
import { useT } from '@/i18n';

/**
 * Four segments that fill as a password gets stronger, with the word for it and the
 * single most useful suggestion. Advice only: it never blocks submitting.
 */
export function PasswordStrengthBar({ password }: { password: string }) {
  const { t } = useT();
  const strength = passwordStrength(password);
  if (strength.level === 'empty') return null;

  const tone = strength.level === 'weak' ? '#E4A72E' : colors.electricLime;
  const label = t(STRENGTH_LABEL[strength.level]);
  const hint = strength.hints[0];

  return (
    <View accessible accessibilityLabel={label} className="mt-2">
      <View className="flex-row" style={{ gap: 4 }}>
        {[1, 2, 3, 4].map((segment) => (
          <View
            key={segment}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: segment <= strength.score ? tone : colors.borderHairline,
            }}
          />
        ))}
      </View>
      <Text className="mt-1 font-body" style={{ color: tone, fontSize: typography.label - 1 }}>
        {label}
        {hint ? <Text style={{ color: colors.textMutedSage }}>{`  ·  ${t(hint)}`}</Text> : null}
      </Text>
    </View>
  );
}
