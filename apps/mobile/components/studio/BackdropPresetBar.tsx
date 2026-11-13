import { Pressable, ScrollView, Text, View } from 'react-native';
import { colors, radii, typography } from '@/theme/tokens';
import { useT, type StringKey } from '@/i18n';

/**
 * Backdrop selector.
 *
 * Marketplace White is first and selected by default because it is the only
 * preset ONDC and GeM listings actually accept without review; the other three
 * are for Instagram and WhatsApp catalogue shots. Each swatch shows its real
 * colour, so the choice is legible without reading the label.
 */

export interface BackdropPreset {
  key: string;
  swatch: string;
  labelKey: StringKey;
  labelEn: string;
  /** Marked on the presets that marketplaces accept. */
  marketplaceSafe: boolean;
}

export const BACKDROP_PRESETS: BackdropPreset[] = [
  {
    key: 'marketplace-white',
    swatch: '#FFFFFF',
    labelKey: 'backdrop.white',
    labelEn: 'Marketplace White',
    marketplaceSafe: true,
  },
  {
    key: 'warm-sandstone',
    swatch: '#E7D3B3',
    labelKey: 'backdrop.sandstone',
    labelEn: 'Warm Sandstone',
    marketplaceSafe: false,
  },
  {
    key: 'handloom-wood',
    swatch: '#6B4A2B',
    labelKey: 'backdrop.wood',
    labelEn: 'Handloom Wood',
    marketplaceSafe: false,
  },
  {
    key: 'dark-editorial',
    swatch: '#060705',
    labelKey: 'backdrop.dark',
    labelEn: 'Dark Editorial',
    marketplaceSafe: false,
  },
];

export interface BackdropPresetBarProps {
  selected: string;
  onSelect: (key: string) => void;
  disabled?: boolean;
}

export function BackdropPresetBar({
  selected,
  onSelect,
  disabled = false,
}: BackdropPresetBarProps) {
  const { t } = useT();

  return (
    <View>
      <Text
        className="mb-3 font-heading"
        style={{ color: colors.textMutedSage, fontSize: typography.label, letterSpacing: 1.2 }}
      >
        {t('backdrop.label')}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingRight: 20 }}
      >
        {BACKDROP_PRESETS.map((preset) => {
          const active = preset.key === selected;
          return (
            <Pressable
              key={preset.key}
              accessibilityRole="button"
              accessibilityLabel={`${preset.labelEn}${
                preset.marketplaceSafe ? ', recommended for marketplaces' : ''
              }`}
              accessibilityState={{ selected: active, disabled }}
              disabled={disabled}
              onPress={() => onSelect(preset.key)}
              style={{
                width: 104,
                minHeight: 108,
                borderRadius: radii.card,
                padding: 10,
                opacity: disabled ? 0.5 : 1,
                backgroundColor: active ? 'rgba(168, 235, 52, 0.12)' : colors.surfaceCharcoal,
                borderWidth: active ? 1.5 : 1,
                borderColor: active ? colors.electricLime : colors.borderHairline,
              }}
            >
              <View
                style={{
                  height: 46,
                  borderRadius: 12,
                  backgroundColor: preset.swatch,
                  borderWidth: 1,
                  borderColor: colors.borderHairline,
                }}
              />
              <Text
                className="mt-2 font-heading"
                style={{
                  color: active ? colors.electricLime : colors.textPureWhite,
                  fontSize: typography.label,
                }}
              >
                {t(preset.labelKey)}
              </Text>
              <Text
                className="font-body"
                style={{ color: colors.textMutedSage, fontSize: typography.label - 2 }}
                numberOfLines={1}
              >
                {preset.marketplaceSafe ? 'ONDC ✓' : preset.labelEn}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
