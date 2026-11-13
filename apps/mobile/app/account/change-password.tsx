import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { FormField } from '@/components/ui/FormField';
import { PasswordStrengthBar } from '@/components/ui/PasswordStrengthBar';
import { colors, radii, typography } from '@/theme/tokens';
import { api, ApiError } from '@/services/apiClient';
import { validatePasswordForm } from '@/services/password';
import { speak } from '@/services/speech';
import { useT } from '@/i18n';

/**
 * Change password.
 *
 * Asks for the CURRENT password as well as the new one, because a signed-in phone
 * is not proof that the person holding it knows the password. A wrong current
 * password is shown against that field and keeps the artisan signed in; the server
 * answers it with a 400 precisely so it cannot be mistaken for an expired session.
 */
export default function ChangePasswordScreen() {
  const router = useRouter();
  const { t, lang } = useT();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<'current' | 'next' | 'confirm', string>>>({});
  const [banner, setBanner] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBanner(null);

    const check = validatePasswordForm({ current, next, confirm });
    if (!check.ok) {
      setErrors(
        Object.fromEntries(Object.entries(check.errors).map(([field, key]) => [field, t(key)])),
      );
      return;
    }
    setErrors({});

    setBusy(true);
    try {
      const result = await api.changePassword({ current_password: current, new_password: next });
      void speak(result.spoken_hi, lang);
      router.back();
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.spokenHi : t('changePassword.failed');
      if (caught instanceof ApiError && caught.code === 'wrong_password') {
        // Point at the field to fix; the session is untouched.
        setErrors({ current: message });
      } else {
        setBanner(message);
      }
      void speak(message, lang);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={show ? t('auth.hidePassword') : t('auth.showPassword')}
      onPress={() => setShow((value) => !value)}
      hitSlop={10}
    >
      <Text className="font-heading" style={{ color: colors.electricLime, fontSize: typography.label }}>
        {show ? t('auth.hidePassword') : t('auth.showPassword')}
      </Text>
    </Pressable>
  );

  const passwordProps = {
    secureTextEntry: !show,
    autoCapitalize: 'none',
    autoCorrect: false,
  } as const;

  return (
    <ScreenShell bottomInset={40}>
      <View className="mt-2 flex-row items-center">
        <Pressable accessibilityRole="button" accessibilityLabel={t('account.back')} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.textPureWhite} />
        </Pressable>
      </View>

      <View style={{ marginTop: 8 }}>
        <SplitHeading
          subject={t('changePassword.title.subject')}
          action={t('changePassword.title.action')}
          size="title"
          subtitle={t('changePassword.subtitle')}
        />
      </View>

      <View className="mt-6" style={{ gap: 14 }}>
        <FormField
          label={t('changePassword.current')}
          value={current}
          onChangeText={setCurrent}
          error={errors.current}
          autoComplete="current-password"
          textContentType="password"
          {...passwordProps}
          trailing={toggle}
        />
        <View>
          <FormField
            label={t('changePassword.new')}
            value={next}
            onChangeText={setNext}
            error={errors.next}
            autoComplete="new-password"
            textContentType="newPassword"
            {...passwordProps}
          />
          <PasswordStrengthBar password={next} />
        </View>
        <FormField
          label={t('changePassword.confirm')}
          value={confirm}
          onChangeText={setConfirm}
          error={errors.confirm}
          autoComplete="new-password"
          textContentType="newPassword"
          {...passwordProps}
        />
      </View>

      {banner ? (
        <Text accessibilityRole="alert" className="mt-4 font-body" style={{ color: '#E4A72E', fontSize: typography.label + 1, lineHeight: 20 }}>
          {banner}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('changePassword.submit')}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => void submit()}
        className="mt-7 items-center justify-center"
        style={{ minHeight: 56, borderRadius: radii.pill, backgroundColor: colors.electricLime, opacity: busy ? 0.7 : 1 }}
      >
        {busy ? (
          <ActivityIndicator color={colors.textInverseDark} />
        ) : (
          <Text className="font-heading" style={{ color: colors.textInverseDark, fontSize: typography.body }}>
            {t('changePassword.submit')}
          </Text>
        )}
      </Pressable>
    </ScreenShell>
  );
}
