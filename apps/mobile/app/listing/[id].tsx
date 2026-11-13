import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { HaloProductStage, StageActionPill } from '@/components/ui/HaloProductStage';
import { Badge } from '@/components/ui/Badge';
import { GalleryThumbs } from '@/components/ui/GalleryThumbs';
import { PriceTile, SpecRow } from '@/components/ui/ProductFacts';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import {
  api,
  ApiError,
  isOfflineError,
  type ListingsPage,
  type PublicListing,
} from '@/services/apiClient';
import { productImages } from '@/services/gallery';
import { speak, stopSpeaking } from '@/services/speech';
import { useArtisanStore } from '@/store/useArtisanStore';
import { useT } from '@/i18n';

/**
 * One bazaar listing, read-only.
 *
 * This is a different screen from `product/[id]` on purpose. That one reads the
 * signed-in artisan's own inventory and carries the owner's tools (stock
 * adjustment, QR tags, the wholesale share). Someone else's product has none of
 * those, and must not show cost data it never receives.
 */

export default function ListingDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const profile = useArtisanStore((state) => state.profile);
  const { t, lang: language, isEnglish } = useT();

  const query = useQuery({
    queryKey: ['bazaar', 'listing', id],
    queryFn: async () => (await api.listing(id)).listing,
    enabled: Boolean(profile?.serverId && id),
    // The list the artisan just tapped from already holds this product, so
    // show it instantly and let the fetch refresh it behind the scenes.
    placeholderData: () => findInCachedLists(queryClient, id),
    // A 404 is an answer, not a flaky network: don't retry it.
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });

  const [pickedImage, setPickedImage] = useState<string | null>(null);

  useEffect(
    () => () => {
      void stopSpeaking();
    },
    [],
  );

  const listing = query.data;

  if (query.isPending) {
    return (
      <ScreenShell scroll={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.electricLime} />
        </View>
      </ScreenShell>
    );
  }

  if (!listing) {
    const gone = query.error instanceof ApiError && query.error.status === 404;
    return (
      <ScreenShell>
        <View style={{ marginTop: 24 }}>
          <SplitHeading
            subject={t('product.notFound.subject')}
            action={t('product.notFound.action')}
            size="title"
            subtitle={
              gone
                ? t('bazaar.detail.gone')
                : isOfflineError(query.error)
                  ? t('err.offline')
                  : t('bazaar.loadFailed')
            }
          />
        </View>
        {gone ? null : (
          <PrimaryButton label={t('bazaar.retry')} onPress={() => void query.refetch()} />
        )}
        <PrimaryButton label={t('product.goBack')} onPress={() => router.back()} muted={!gone} />
      </ScreenShell>
    );
  }

  const images = productImages(listing);
  const shownImage = pickedImage && images.includes(pickedImage) ? pickedImage : images[0]!;
  const title = isEnglish ? listing.title_en : listing.title_hi;
  const description = isEnglish ? listing.description_en : listing.description_hi;
  const soldOut = listing.stock_quantity === 0;
  const { seller } = listing;
  const dims = listing.dimensions_cm;

  return (
    <ScreenShell bottomInset={40}>
      <View className="mt-2 flex-row items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the bazaar"
          onPress={() => router.back()}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={26} color={colors.textPureWhite} />
        </Pressable>
        <Text
          className="ml-2 font-body"
          style={{ color: colors.textMutedSage, fontSize: typography.label }}
        >
          {listing.sku}
        </Text>
      </View>

      <View className="mt-4">
        <HaloProductStage
          imageUri={shownImage}
          caption={
            soldOut ? t('bazaar.soldOut') : t('product.inStock', { count: listing.stock_quantity })
          }
          actions={
            <StageActionPill
              label="Listen to the description"
              showConnector={false}
              onPress={() => void speak(`${title}. ${description}`, language)}
              icon={<Ionicons name="volume-high" size={18} color={colors.electricLime} />}
            />
          }
        />
      </View>

      {images.length > 1 ? (
        <View className="mt-4">
          <GalleryThumbs images={images} selected={shownImage} onSelect={setPickedImage} />
        </View>
      ) : null}

      <View style={{ marginTop: 24 }}>
        <SplitHeading subject={title} action="" size="heading" />
      </View>

      <View className="mt-3 flex-row flex-wrap items-center" style={{ gap: 8 }}>
        {listing.is_mine ? <Badge label={t('bazaar.yours')} tone="lime" solid /> : null}
        {soldOut ? <Badge label={t('bazaar.soldOut')} tone="red" /> : null}
        {seller.gi_tag_certified ? <Badge label={t('bazaar.giTag')} tone="lime" /> : null}
      </View>

      <Text
        className="mt-4 font-body"
        style={{ color: colors.textMutedSage, fontSize: typography.body - 1, lineHeight: 23 }}
      >
        {description}
      </Text>

      {/* Price tiers */}
      <View className="mt-7 flex-row" style={{ gap: spacing.cardGap }}>
        <PriceTile
          label={t('product.wholesale')}
          value={`₹${listing.recommended_wholesale_inr.toLocaleString('en-IN')}`}
          caption={t('product.onQty', { qty: listing.min_wholesale_qty })}
        />
        <PriceTile
          label={t('product.retail')}
          value={`₹${listing.recommended_retail_inr.toLocaleString('en-IN')}`}
          caption={t('product.directToCustomer')}
        />
      </View>

      {/* Seller */}
      <Text
        className="mb-3 mt-7 font-heading"
        style={{ color: colors.textMutedSage, fontSize: typography.label, letterSpacing: 1.2 }}
      >
        {t('bazaar.detail.seller')}
      </Text>
      <View
        className="rounded-bento p-5"
        style={{
          backgroundColor: colors.surfaceCharcoal,
          borderWidth: 1,
          borderColor: colors.borderHairline,
        }}
      >
        <Text
          className="font-heading"
          style={{ color: colors.textPureWhite, fontSize: typography.body + 1 }}
        >
          {seller.full_name}
        </Text>
        <View className="mt-3">
          <SpecRow label={t('bazaar.detail.craft')} value={seller.craft_category} last={!seller.cluster_location} />
          {seller.cluster_location ? (
            <SpecRow label={t('bazaar.detail.place')} value={seller.cluster_location} last />
          ) : null}
        </View>
      </View>

      {/* Specs */}
      <View
        className="mt-5 rounded-bento p-5"
        style={{
          backgroundColor: colors.surfaceCharcoal,
          borderWidth: 1,
          borderColor: colors.borderHairline,
        }}
      >
        <SpecRow label="SKU" value={listing.sku} />
        <SpecRow label="HSN" value={listing.hsn_code ?? '—'} />
        <SpecRow
          label={t('product.size')}
          value={`${dims.length} × ${dims.width} × ${dims.height} cm`}
        />
        <SpecRow label={t('product.stock')} value={String(listing.stock_quantity)} />
        <SpecRow
          label={t('product.tags')}
          value={listing.seo_tags.slice(0, 4).join(', ') || '—'}
          last
        />
      </View>

      {listing.is_mine ? (
        <View
          className="mt-6 rounded-bento p-5"
          style={{
            backgroundColor: 'rgba(168, 235, 52, 0.1)',
            borderWidth: 1,
            borderColor: colors.borderHairline,
          }}
        >
          <Text className="font-body" style={{ color: colors.textPureWhite, fontSize: typography.label + 1 }}>
            {t('bazaar.detail.yours')}
          </Text>
          <PrimaryButton
            label={t('bazaar.detail.manage')}
            onPress={() => router.push(`/product/${listing.id}`)}
          />
        </View>
      ) : null}
    </ScreenShell>
  );
}

/** Look the product up in whichever bazaar list pages are already cached. */
function findInCachedLists(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string | undefined,
): PublicListing | undefined {
  if (!id) return undefined;
  const caches = queryClient.getQueriesData<InfiniteData<ListingsPage>>({
    queryKey: ['bazaar', 'listings'],
  });
  for (const [, data] of caches) {
    for (const page of data?.pages ?? []) {
      const hit = page.listings.find((listing) => listing.id === id);
      if (hit) return hit;
    }
  }
  return undefined;
}

function PrimaryButton({
  label,
  onPress,
  muted = false,
}: {
  label: string;
  onPress: () => void;
  muted?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="mt-4 items-center justify-center"
      style={{
        minHeight: 56,
        borderRadius: radii.pill,
        backgroundColor: muted ? colors.surfaceElevated : colors.electricLime,
        borderWidth: muted ? 1 : 0,
        borderColor: colors.borderHairline,
      }}
    >
      <Text
        className="font-heading"
        style={{
          color: muted ? colors.textPureWhite : colors.textInverseDark,
          fontSize: typography.body,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
