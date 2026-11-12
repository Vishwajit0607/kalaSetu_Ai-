import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { LimeCircleButton } from '@/components/ui/LimeCircleButton';
import { GlowingTimeline, type TimelineNode } from '@/components/ui/GlowingTimeline';
import { VoiceOrbRecorder } from '@/components/voice/VoiceOrbRecorder';
import { colors, radii, typography } from '@/theme/tokens';
import { api, ApiError, toSession } from '@/services/apiClient';
import { speak, stopSpeaking } from '@/services/speech';
import { isValidPassword, isValidPhone } from '@/services/phone';
import { useArtisanStore } from '@/store/useArtisanStore';
import { useT, type StringKey } from '@/i18n';

/**
 * Screen 1b - Create an account.
 *
 * Three spoken answers - name, craft, village - each captured by the orb and
 * transcribed by Saaras V4, then a typed mobile number and password. The text
 * fields exist as a correction affordance, not as the primary path: a
 * transcript of a name is the one thing STT gets wrong often enough to matter,
 * and a wrong name follows the artisan onto every invoice.
 *
 * The number and password are typed because dictating digits over a loom is
 * unreliable, and a password must never be spoken aloud in a workshop.
 */

type Step = 'name' | 'craft' | 'village' | 'phone' | 'password';

const PROMPT_KEYS: Record<Step, StringKey> = {
  name: 'profile.prompt.name',
  craft: 'profile.prompt.craft',
  village: 'profile.prompt.village',
  phone: 'profile.prompt.phone',
  password: 'profile.prompt.password',
};

export default function SignupScreen() {
  const router = useRouter();
  const { t, lang } = useT();
  const signIn = useArtisanStore((state) => state.signIn);

  const [step, setStep] = useState<Step>('name');
  const [fullName, setFullName] = useState('');
  const [craftCategory, setCraftCategory] = useState('');
  const [clusterLocation, setClusterLocation] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void speak(t(PROMPT_KEYS[step]), lang);
    return () => {
      void stopSpeaking();
    };
  }, [step, lang, t]);

  const handleVoice = useCallback(
    async ({ uri }: { uri: string; durationMs: number }) => {
      setBusy(true);
      setError(null);
      await stopSpeaking();
      try {
        const { transcript } = await api.transcribe({ fileUri: uri, languageCode: lang });
        const clean = transcript.trim().replace(/[।.]$/, '');

        if (!clean) {
          void speak(t('profile.notHeard'), lang);
          return;
        }

        if (step === 'name') {
          setFullName(clean);
          void speak(t('profile.gotName', { name: clean }), lang);
          setStep('craft');
        } else if (step === 'craft') {
          setCraftCategory(clean);
          void speak(t('profile.gotCraft', { craft: clean }), lang);
          setStep('village');
        } else if (step === 'village') {
          setClusterLocation(clean);
          void speak(t('profile.gotVillage'), lang);
          setStep('phone');
        }
      } catch (caught) {
        const message = caught instanceof ApiError ? caught.spokenHi : t('err.generic');
        setError(message);
        void speak(message, lang);
      } finally {
        setBusy(false);
      }
    },
    [lang, step, t],
  );

  const canFinish =
    fullName.trim().length > 0 &&
    craftCategory.trim().length > 0 &&
    isValidPhone(phoneNumber) &&
    isValidPassword(password);

  const finish = useCallback(async () => {
    if (busy) return;

    if (!canFinish) {
      const message = !isValidPhone(phoneNumber)
        ? t('auth.invalidPhone')
        : !isValidPassword(password)
          ? t('auth.weakPassword')
          : t('profile.incomplete');
      setError(message);
      void speak(message, lang);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await api.signup({
        phone: phoneNumber.trim(),
        password,
        full_name: fullName.trim(),
        craft_category: craftCategory.trim(),
        cluster_location: clusterLocation.trim() || null,
        preferred_language: lang,
      });

      await signIn({ session: toSession(result.session), artisan: result.artisan });
      void speak(t('profile.created', { name: fullName.trim() }), lang);
      // The route guard also reacts to the new session; this just avoids a frame
      // of the signup form after the account exists.
      router.replace('/(tabs)');
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.spokenHi : t('profile.createFailed');
      setError(message);
      void speak(message, lang);
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    canFinish,
    clusterLocation,
    craftCategory,
    fullName,
    lang,
    password,
    phoneNumber,
    router,
    signIn,
    t,
  ]);

  const nodes: TimelineNode[] = [
    {
      label: t('profile.node.name'),
      detail: fullName || t('profile.node.sayIt'),
      state: fullName ? 'complete' : step === 'name' ? 'active' : 'pending',
    },
    {
      label: t('profile.node.craft'),
      detail: craftCategory || t('profile.node.craftExample'),
      state: craftCategory ? 'complete' : step === 'craft' ? 'active' : 'pending',
    },
    {
      label: t('profile.node.village'),
      detail: clusterLocation || t('common.optional'),
      state: clusterLocation ? 'complete' : step === 'village' ? 'active' : 'pending',
    },
    {
      label: t('profile.node.phone'),
      detail: phoneNumber || t('profile.node.typeIt'),
      state: isValidPhone(phoneNumber) ? 'complete' : step === 'phone' ? 'active' : 'pending',
    },
    {
      label: t('profile.node.password'),
      detail: password ? '••••••' : t('profile.node.typeIt'),
      state: isValidPassword(password) ? 'complete' : step === 'password' ? 'active' : 'pending',
    },
  ];

  return (
    <ScreenShell watermark>
      <View style={{ marginTop: 24 }}>
        <SplitHeading
          subject={t('profile.title.subject')}
          action={t('profile.title.action')}
          size="title"
          subtitle={t('profile.subtitle')}
        />
      </View>

      <View className="mt-7 items-center">
        <VoiceOrbRecorder
          onComplete={(result) => void handleVoice(result)}
          languageCode={lang}
          busy={busy}
          disabled={step === 'phone' || step === 'password'}
          label={
            step === 'phone' || step === 'password'
              ? t('profile.typeNumber')
              : t('profile.holdToSpeak')
          }
          hint={t(PROMPT_KEYS[step])}
        />
      </View>

      <View className="mt-8">
        <GlowingTimeline nodes={nodes} compact />
      </View>

      {/* Correction fields - secondary to voice, but always reachable. */}
      <View className="mt-2" style={{ gap: 10 }}>
        <Field
          label={t('profile.field.name')}
          value={fullName}
          onChangeText={setFullName}
          placeholder={t('profile.placeholder.name')}
          autoCapitalize="words"
          onFocus={() => setStep('name')}
        />
        <Field
          label={t('profile.field.craft')}
          value={craftCategory}
          onChangeText={setCraftCategory}
          placeholder={t('profile.placeholder.craft')}
          onFocus={() => setStep('craft')}
        />
        <Field
          label={t('profile.field.village')}
          value={clusterLocation}
          onChangeText={setClusterLocation}
          placeholder={t('profile.placeholder.village')}
          onFocus={() => setStep('village')}
        />
        <Field
          label={t('profile.field.phone')}
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          placeholder={t('auth.phonePlaceholder')}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          onFocus={() => setStep('phone')}
        />
        <Field
          label={t('profile.field.password')}
          value={password}
          onChangeText={setPassword}
          placeholder={t('profile.passwordPlaceholder')}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          onFocus={() => setStep('password')}
          trailing={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              onPress={() => setShowPassword((value) => !value)}
              hitSlop={10}
            >
              <Text
                className="font-heading"
                style={{ color: colors.electricLime, fontSize: typography.label }}
              >
                {showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              </Text>
            </Pressable>
          }
        />
        <Text className="font-body" style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}>
          {t('auth.passwordHint')}
        </Text>
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
        className="mt-6 flex-row items-center rounded-bento p-5"
        style={{
          backgroundColor: colors.surfaceCharcoal,
          borderWidth: 1,
          borderColor: colors.borderHairline,
        }}
      >
        <View className="flex-1 pr-4">
          <Text
            className="font-heading"
            style={{ color: colors.textPureWhite, fontSize: typography.body }}
          >
            {t('profile.createAccount')}
          </Text>
          <Text
            className="mt-1 font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label }}
          >
            {t('profile.createAccountSub')}
          </Text>
        </View>

        {busy ? (
          <ActivityIndicator color={colors.electricLime} />
        ) : (
          <LimeCircleButton
            accessibilityLabel="Create account and continue"
            disabled={!canFinish}
            onPress={() => void finish()}
          />
        )}
      </View>

      <Pressable
        accessibilityRole="link"
        onPress={() => router.replace('/(onboarding)/login')}
        hitSlop={12}
        className="mt-5 items-center py-3"
      >
        <Text className="font-heading" style={{ color: colors.electricLime, fontSize: typography.body - 1 }}>
          {t('profile.haveAccount')}
        </Text>
      </Pressable>
    </ScreenShell>
  );
}

function Field({
  label,
  trailing,
  ...inputProps
}: { label: string; trailing?: React.ReactNode } & React.ComponentProps<typeof TextInput>) {
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
          borderColor: colors.borderHairline,
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
    </View>
  );
}
