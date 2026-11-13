import { Image, Pressable, ScrollView } from 'react-native';
import { colors, radii } from '@/theme/tokens';

/** Row of thumbnails under a product photo; the selected one has a lime ring. */
export function GalleryThumbs({
  images,
  selected,
  onSelect,
}: {
  images: string[];
  selected: string;
  onSelect: (url: string) => void;
}) {
  if (images.length < 2) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 10, paddingRight: 20 }}
    >
      {images.map((url, index) => {
        const active = url === selected;
        return (
          <Pressable
            key={url}
            accessibilityRole="button"
            accessibilityLabel={`Photo ${index + 1} of ${images.length}`}
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(url)}
          >
            <Image
              source={{ uri: url }}
              accessibilityIgnoresInvertColors
              style={{
                width: 64,
                height: 64,
                borderRadius: radii.card,
                backgroundColor: colors.surfaceCharcoal,
                borderWidth: active ? 2 : 1,
                borderColor: active ? colors.electricLime : colors.borderHairline,
              }}
            />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
