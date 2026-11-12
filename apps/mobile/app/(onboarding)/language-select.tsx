import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { LimeCircleButton } from '@/components/ui/LimeCircleButton';
import { LanguageSwitcherPill, LANGUAGES } from '@/components/voice/LanguageSwitcherPill';
import { colors, spacing, typography } from '@/theme/tokens';
import { prefetchSpeech, speak } from '@/services/speech';
import { tFor, useT } from '@/i18n';
import { useArtisanStore, type AppLanguage } from '@/store/useArtisanStore';

/**
 * Screen 1a - Language selection.
 *
 * This is the first screen a new artisan ever sees, and it has to work for
 * someone who cannot read any of the words on it. So: the two languages appear
 * in their own scripts, a greeting plays on arrival, and every tap speaks a
 * confirmation in the language just chosen. Choosing wrongly is self-
 * correcting - you hear a language you do not speak and tap again.
 *
 * The choice is written straight to the store, so this screen's own copy -
 * and the signup and login screens after it - flip the instant a card is
 * tapped. There is no profile yet to hold it, which is why language is a
 * store-level setting and not a profile field.
 */

export default function LanguageSelectScreen() {
  const router = useRouter();
  const { t, lang } = useT();
  const setUiLanguage = useArtisanStore((state) => state.setUiLanguage);

  useEffect(() => {
    // Greet in Hindi on arrival: nothing is chosen yet, and it is the wider
    // shared language. Runs once.
    void speak(tFor('hi-IN')('lang.greeting'), 'hi-IN');
  }, []);

  useEffect(() => {
    // Warm the TTS cache for the next screen so the first registration prompt
    // plays instantly even if the link drops.
    void prefetchSpeech(
      [t('profile.prompt.name'), t('profile.prompt.craft'), t('profile.prompt.village')],
      lang,
    );
  }, [t, lang]);

  const selected = LANGUAGES.find((language) => language.code === lang) ?? LANGUAGES[0];

  return (
    <ScreenShell watermark>
      <View style={{ marginTop: 28 }}>
        <SplitHeading
          subject={t('lang.title.subject')}
          action={t('lang.title.action')}
          subtitle={t('lang.subtitle')}
          accessibilityLabel="Choose your language"
        />
      </View>

      <View style={{ marginTop: spacing.sectionGap }}>
        <LanguageSwitcherPill
          selected={lang}
          onSelect={(code) => void setUiLanguage(code as AppLanguage)}
          variant="grid"
        />
      </View>

      {/* Hero continue row: dark description container + lime arrow trigger */}
      <View
        className="mt-8 flex-row items-center rounded-bento p-5"
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
            {t('lang.continueIn', { language: selected?.native ?? '' })}
          </Text>
          <Text
            className="mt-1 font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label }}
          >
            {t('lang.continueSub', { language: selected?.english ?? '' })}
          </Text>
        </View>

        <LimeCircleButton
          accessibilityLabel="Continue to create an account"
          onPress={() => router.push('/(onboarding)/signup')}
          onLongPress={() => void speak(t('lang.continueHint'), lang)}
        />
      </View>

      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('auth.haveAccount')}
        onPress={() => router.push('/(onboarding)/login')}
        hitSlop={12}
        className="mt-6 items-center py-3"
      >
        <Text
          className="font-heading"
          style={{ color: colors.electricLime, fontSize: typography.body - 1 }}
        >
          {t('auth.haveAccount')}
        </Text>
      </Pressable>

      <Text
        className="mt-4 font-body"
        style={{ color: colors.textMutedSage, fontSize: typography.label - 1, lineHeight: 18 }}
      >
        {t('lang.footer')}
      </Text>
    </ScreenShell>
  );
}
