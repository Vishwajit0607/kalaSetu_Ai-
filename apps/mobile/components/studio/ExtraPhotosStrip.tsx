import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, typography } from '@/theme/tokens';
import { useT } from '@/i18n';
import { MAX_EXTRA_PHOTOS, type ExtraPhoto } from '@/store/useCatalogDraftStore';

/**
 * More angles of the same product: the cover is the studio photo above; these
 * are the extras a buyer scrolls through. Each shows the studio result as soon
 * as it exists and the phone's own copy until then.
 */

const TILE = 84;

export interface ExtraPhotosStripProps {
  photos: ExtraPhoto[];
  /** Adding is paused while the cover is being edited, and when offline. */
  disabled?: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

export function ExtraPhotosStrip({ photos, disabled = false, onAdd, onRemove }: ExtraPhotosStripProps) {
  const { t } = useT();
  const full = photos.length >= MAX_EXTRA_PHOTOS;

  return (
    <View>
      <Text
        className="mb-1 font-heading"
        style={{ color: colors.textMutedSage, fontSize: typography.label, letterSpacing: 1.2 }}
      >
        {t('studio.more.label')}
      </Text>
      <Text className="mb-3 font-body" style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}>
        {t('studio.more.hint', { count: photos.length, max: MAX_EXTRA_PHOTOS })}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingRight: 20 }}
      >
        {photos.map((photo) => (
          <View key={photo.id} style={{ width: TILE, height: TILE }}>
            <Image
              source={{ uri: photo.enhancedUrl ?? photo.previewUri }}
              accessibilityIgnoresInvertColors
              style={{
                width: TILE,
                height: TILE,
                borderRadius: radii.card,
                backgroundColor: colors.surfaceCharcoal,
                borderWidth: 1,
                borderColor: colors.borderHairline,
              }}
              resizeMode="cover"
            />

            {photo.busy ? (
              <View
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: radii.card,
                  backgroundColor: 'rgba(6, 7, 5, 0.55)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ActivityIndicator color={colors.electricLime} />
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('studio.more.remove')}
                onPress={() => onRemove(photo.id)}
                hitSlop={8}
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  backgroundColor: colors.canvasObsidian,
                  borderWidth: 1,
                  borderColor: colors.borderHairline,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="close" size={15} color={colors.textPureWhite} />
              </Pressable>
            )}
          </View>
        ))}

        {full ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('studio.more.add')}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onAdd}
            style={{
              width: TILE,
              height: TILE,
              borderRadius: radii.card,
              borderWidth: 1.5,
              borderStyle: 'dashed',
              borderColor: colors.electricLime,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: disabled ? 0.4 : 1,
            }}
          >
            <Ionicons name="add" size={26} color={colors.electricLime} />
            <Text className="mt-0.5 font-heading" style={{ color: colors.electricLime, fontSize: typography.label - 2 }}>
              {t('studio.more.addShort')}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}
