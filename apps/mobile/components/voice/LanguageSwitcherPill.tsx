import { Pressable, ScrollView, Text, View } from 'react-native';
import { colors, radii, typography } from '@/theme/tokens';
import { speak } from '@/services/speech';

/**
 * Language picker - Hindi and English.
 *
 * Each pill shows the language in its own script first and the English name
 * beneath - an artisan scans for the shape of their own script, not for a
 * transliteration. Selecting a pill speaks a confirmation in that language,
 * which doubles as a check that TTS actually works for it on this device.
 */

export interface LanguageOption {
  code: string;
  native: string;
  english: string;
  /** Spoken on selection. */
  confirmation: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'hi-IN', native: 'हिन्दी', english: 'Hindi', confirmation: 'आपने हिन्दी चुनी है।' },
  { code: 'en-IN', native: 'English', english: 'English', confirmation: 'You have selected English.' },
];

export interface LanguageSwitcherPillProps {
  selected: string;
  onSelect: (code: string) => void;
  /** 'rail' scrolls horizontally; 'grid' is the 2-column onboarding layout. */
  variant?: 'rail' | 'grid';
}

export function LanguageSwitcherPill({
  selected,
  onSelect,
  variant = 'rail',
}: LanguageSwitcherPillProps) {
  const handleSelect = (option: LanguageOption): void => {
    onSelect(option.code);
    void speak(option.confirmation, option.code);
  };

  if (variant === 'grid') {
    return (
      <View className="flex-row flex-wrap" style={{ gap: 12 }}>
        {LANGUAGES.map((option) => (
          <LanguageCard
            key={option.code}
            option={option}
            active={option.code === selected}
            onPress={() => handleSelect(option)}
          />
        ))}
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingRight: 20 }}
    >
      {LANGUAGES.map((option) => {
        const active = option.code === selected;
        return (
          <Pressable
            key={option.code}
            accessibilityRole="button"
            accessibilityLabel={`${option.english}. ${option.native}`}
            accessibilityState={{ selected: active }}
            onPress={() => handleSelect(option)}
            className="px-4 py-2"
            style={{
              borderRadius: radii.pill,
              minHeight: 44,
              justifyContent: 'center',
              backgroundColor: active ? colors.electricLime : colors.surfaceCharcoal,
              borderWidth: 1,
              borderColor: active ? colors.electricLime : colors.borderHairline,
            }}
          >
            <Text
              className="font-heading"
              style={{
                color: active ? colors.textInverseDark : colors.textPureWhite,
                fontSize: typography.body - 1,
              }}
            >
              {option.native}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function LanguageCard({
  option,
  active,
  onPress,
}: {
  option: LanguageOption;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${option.english}. ${option.native}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        // Two columns inside a 20px-gutter screen with a 12px gap.
        width: '47.5%',
        minHeight: 92,
        borderRadius: radii.card,
        padding: 16,
        justifyContent: 'center',
        backgroundColor: active ? colors.electricLime : colors.surfaceCharcoal,
        borderWidth: 1,
        borderColor: active ? colors.electricLime : colors.borderHairline,
      }}
    >
      <Text
        className="font-display"
        style={{
          color: active ? colors.textInverseDark : colors.textPureWhite,
          fontSize: typography.heading + 2,
        }}
      >
        {option.native}
      </Text>
      <Text
        className="mt-1 font-body"
        style={{
          color: active ? 'rgba(8, 10, 6, 0.7)' : colors.textMutedSage,
          fontSize: typography.label,
        }}
      >
        {option.english}
      </Text>
    </Pressable>
  );
}
