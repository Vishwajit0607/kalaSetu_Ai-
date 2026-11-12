import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { LimeCircleButton } from '@/components/ui/LimeCircleButton';
import { LanguageSwitcherPill } from '@/components/voice/LanguageSwitcherPill';
import { colors, radii, typography } from '@/theme/tokens';
import { api, ApiError, toSession } from '@/services/apiClient';
import { speak } from '@/services/speech';
import { useArtisanStore, type AppLanguage } from '@/store/useArtisanStore';
import { tFor, useT } from '@/i18n';

/**
 * Log in with a mobile number and password.
 *
 * On success the artisan's *saved* language replaces whatever was chosen on
 * this screen: someone logging in on a new phone gets the app the way they
 * left it, not in the default language of a fresh install.
 */
export default function LoginScreen() {
  const router = useRouter();
  const { t, lang } = useT();
  const signIn = useArtisanStore((state) => state.signIn);
  const setUiLanguage = useArtisanStore((state) => state.setUiLanguage);

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (busy) return;

    if (!phone.trim() || !password) {
      const message = t('auth.fillBoth');
      setError(message);
      void speak(message, lang);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await api.login({ phone: phone.trim(), password });
      await signIn({ session: toSession(result.session), artisan: result.artisan });

      // Greet in the language the artisan saved, which signIn just applied.
      const saved = result.artisan.preferred_language;
      void speak(tFor(saved)('auth.welcomeBack', { name: result.artisan.full_name }), saved);
      router.replace('/(tabs)');
    } catch (caught) {
      // The server answers in the language we sent, and uses one message for
      // both "no such number" and "wrong password" - this screen must not
      // reveal which.
      const message = caught instanceof ApiError ? caught.spokenHi : t('err.generic');
      setError(message);
      void speak(message, lang);
    } finally {
      setBusy(false);
    }
  }, [busy, lang, password, phone, router, signIn, t]);

  return (
    <ScreenShell watermark>
      <View style={{ marginTop: 28 }}>
        <SplitHeading
          subject={t('auth.login.title.subject')}
          action={t('auth.login.title.action')}
          subtitle={t('auth.login.subtitle')}
        />
      </View>

      <View className="mt-6">
        <Text
          className="mb-2 font-heading"
          style={{ color: colors.textMutedSage, fontSize: typography.label - 1, letterSpacing: 0.8 }}
        >
          {t('auth.language')}
        </Text>
        <LanguageSwitcherPill
          selected={lang}
          onSelect={(code) => void setUiLanguage(code as AppLanguage)}
        />
      </View>

      <View className="mt-7" style={{ gap: 14 }}>
        <View>
          <Text
            className="mb-1 font-heading"
            style={{ color: colors.textMutedSage, fontSize: typography.label - 1, letterSpacing: 0.8 }}
          >
            {t('auth.phone')}
          </Text>
          <TextInput
            accessibilityLabel={t('auth.phone')}
            value={phone}
            onChangeText={setPhone}
            placeholder={t('auth.phonePlaceholder')}
            placeholderTextColor={colors.textMutedSage}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            style={inputStyle}
          />
        </View>

        <View>
          <Text
            className="mb-1 font-heading"
            style={{ color: colors.textMutedSage, fontSize: typography.label - 1, letterSpacing: 0.8 }}
          >
            {t('auth.password')}
          </Text>
          <View className="flex-row items-center" style={[inputStyle, { paddingRight: 16 }]}>
            <TextInput
              accessibilityLabel={t('auth.password')}
              value={password}
              onChangeText={setPassword}
              placeholderTextColor={colors.textMutedSage}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              onSubmitEditing={() => void submit()}
              style={{ flex: 1, color: colors.textPureWhite, fontSize: typography.body, minHeight: 50 }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              onPress={() => setShowPassword((value) => !value)}
              hitSlop={10}
            >
              <Text className="font-heading" style={{ color: colors.electricLime, fontSize: typography.label }}>
                {showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {error ? (
        <Text
          accessibilityRole="alert"
          className="mt-4 font-body"
          style={{ color: '#E4A72E', fontSize: typography.label + 1, lineHeight: 20 }}
        >
          {error}
        </Text>
      ) : null}

      <View
        className="mt-7 flex-row items-center rounded-bento p-5"
        style={{
          backgroundColor: colors.surfaceCharcoal,
          borderWidth: 1,
          borderColor: colors.borderHairline,
        }}
      >
        <View className="flex-1 pr-4">
          <Text className="font-heading" style={{ color: colors.textPureWhite, fontSize: typography.body }}>
            {t('auth.login')}
          </Text>
          <Text className="mt-1 font-body" style={{ color: colors.textMutedSage, fontSize: typography.label }}>
            {t('auth.loginSub')}
          </Text>
        </View>

        {busy ? (
          <ActivityIndicator color={colors.electricLime} />
        ) : (
          <LimeCircleButton accessibilityLabel={t('auth.login')} onPress={() => void submit()} />
        )}
      </View>

      <Pressable
        accessibilityRole="link"
        onPress={() => router.replace('/(onboarding)/language-select')}
        hitSlop={12}
        className="mt-6 items-center py-3"
      >
        <Text className="font-heading" style={{ color: colors.electricLime, fontSize: typography.body - 1 }}>
          {t('auth.noAccount')}
        </Text>
      </Pressable>
    </ScreenShell>
  );
}

const inputStyle = {
  minHeight: 52,
  borderRadius: radii.card,
  paddingHorizontal: 16,
  color: colors.textPureWhite,
  fontSize: typography.body,
  backgroundColor: colors.surfaceCharcoal,
  borderWidth: 1,
  borderColor: colors.borderHairline,
} as const;
