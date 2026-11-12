import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { Badge } from '@/components/ui/Badge';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { api, isOfflineError, type PublicListing } from '@/services/apiClient';
import { useArtisanStore } from '@/store/useArtisanStore';
import { useT } from '@/i18n';

/**
 * The bazaar - every artisan's products in one place.
 *
 * The rest of the app is one artisan looking at their own stock. This is the
 * outward-facing half: what the other weavers, potters and metalworkers on
 * KalaSetu have made, so an artisan can see the market they sell into, price
 * against it, and find work to buy or resell.
 *
 * What is shown here is deliberately a subset of a product. The server sends a
 * public projection (no cost price, labour hours, raw photo or phone number),
 * so nothing on this screen can leak an artisan's margin.
 */

const SEARCH_DEBOUNCE_MS = 350;

export default function BazaarScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const profile = useArtisanStore((state) => state.profile);
  const { t, isEnglish } = useT();

  const [input, setInput] = useState('');
  const [craft, setCraft] = useState<string | null>(null);
  const search = useDebounced(input.trim(), SEARCH_DEBOUNCE_MS);
  const enabled = Boolean(profile?.serverId);

  const craftsQuery = useQuery({
    queryKey: ['bazaar', 'crafts', profile?.serverId],
    queryFn: () => api.crafts(),
    enabled,
    staleTime: 5 * 60_000,
  });

  const listingsQuery = useInfiniteQuery({
    queryKey: ['bazaar', 'listings', profile?.serverId, search, craft],
    queryFn: ({ pageParam }) => api.listings({ q: search, craft, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      // `listings.length > 0` guards a server that says "more" but returns none,
      // which would otherwise ask for the same offset forever.
      last.has_more && last.listings.length > 0 ? last.offset + last.listings.length : undefined,
    enabled,
    // Keep showing the previous results while a new search loads, so typing
    // doesn't flash the list empty on every keystroke.
    placeholderData: keepPreviousData,
  });

  /*
   * Tabs stay mounted, so this screen would otherwise show whatever it fetched
   * the first time until the artisan thinks to refresh. On focus, refetch only
   * if the data has gone stale - not on every tab switch, which on a slow
   * connection (and with many pages loaded) would be a request storm.
   */
  useFocusEffect(
    useCallback(() => {
      void queryClient.refetchQueries({
        queryKey: ['bazaar', 'listings'],
        type: 'active',
        stale: true,
      });
    }, [queryClient]),
  );

  // Offset paging can repeat a row when someone lists a product mid-scroll (it
  // shifts everything down by one), so de-duplicate across pages by id.
  const listings = useMemo(() => {
    const seen = new Map<string, PublicListing>();
    for (const page of listingsQuery.data?.pages ?? []) {
      for (const listing of page.listings) seen.set(listing.id, listing);
    }
    return [...seen.values()];
  }, [listingsQuery.data]);

  const total = listingsQuery.data?.pages[0]?.total ?? 0;
  const filtering = search.length > 0 || craft !== null;
  const crafts = craftsQuery.data?.crafts ?? [];

  return (
    <ScreenShell bottomInset={40}>
      <View style={{ marginTop: 12 }}>
        <SplitHeading
          subject={t('bazaar.title.subject')}
          action={t('bazaar.title.action')}
          size="title"
          subtitle={t('bazaar.subtitle')}
        />
      </View>

      {/* Search */}
      <View
        className="mt-6 flex-row items-center px-4"
        style={{
          minHeight: 52,
          borderRadius: radii.pill,
          backgroundColor: colors.surfaceCharcoal,
          borderWidth: 1,
          borderColor: colors.borderHairline,
        }}
      >
        <Ionicons name="search" size={18} color={colors.textMutedSage} />
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={t('bazaar.searchPlaceholder')}
          placeholderTextColor={colors.textMutedSage}
          accessibilityLabel={t('bazaar.searchLabel')}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          maxLength={60}
          className="ml-3 flex-1 font-body"
          style={{ color: colors.textPureWhite, fontSize: typography.body, paddingVertical: 12 }}
        />
        {input.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('bazaar.clearSearch')}
            onPress={() => setInput('')}
            hitSlop={12}
          >
            <Ionicons name="close-circle" size={20} color={colors.textMutedSage} />
          </Pressable>
        ) : null}
      </View>

      {/* Craft filter */}
      {crafts.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // Bleed to the screen edge so the chips scroll under the gutter.
          style={{ marginHorizontal: -spacing.gutter, marginTop: 14 }}
          contentContainerStyle={{ paddingHorizontal: spacing.gutter, gap: 8 }}
        >
          <CraftChip
            label={t('bazaar.all')}
            active={craft === null}
            onPress={() => setCraft(null)}
          />
          {crafts.map((entry) => (
            <CraftChip
              key={entry.name}
              label={`${entry.name} · ${entry.count}`}
              active={craft === entry.name}
              onPress={() => setCraft(craft === entry.name ? null : entry.name)}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* Count + refresh */}
      <View className="mt-6 flex-row items-center justify-between">
        <Text
          className="font-heading"
          style={{ color: colors.textMutedSage, fontSize: typography.label, letterSpacing: 1.2 }}
        >
          {listingsQuery.data ? t('bazaar.count', { count: total }).toUpperCase() : ' '}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('bazaar.refresh')}
          onPress={() => void listingsQuery.refetch()}
          disabled={listingsQuery.isFetching}
          hitSlop={12}
        >
          {listingsQuery.isFetching && !listingsQuery.isFetchingNextPage ? (
            <ActivityIndicator size="small" color={colors.electricLime} />
          ) : (
            <Ionicons name="refresh" size={18} color={colors.textMutedSage} />
          )}
        </Pressable>
      </View>

      <View className="mt-4">
        {listingsQuery.isPending ? (
          <ActivityIndicator color={colors.electricLime} style={{ marginTop: 24 }} />
        ) : listingsQuery.isError && listings.length === 0 ? (
          // Only a real connection failure may say "offline". A server error
          // (a 404 from a stale API, a 500) is not the phone's network, and
          // blaming it sends the artisan to fix the wrong thing.
          <Notice
            icon={isOfflineError(listingsQuery.error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
            text={isOfflineError(listingsQuery.error) ? t('err.offline') : t('bazaar.loadFailed')}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('bazaar.retry')}
              onPress={() => void listingsQuery.refetch()}
              className="mt-4 items-center justify-center px-6"
              style={{ minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.electricLime }}
            >
              <Text
                className="font-heading"
                style={{ color: colors.textInverseDark, fontSize: typography.body - 1 }}
              >
                {t('bazaar.retry')}
              </Text>
            </Pressable>
          </Notice>
        ) : listings.length === 0 ? (
          <Notice
            icon={filtering ? 'search-outline' : 'storefront-outline'}
            text={filtering ? t('bazaar.noMatch') : t('bazaar.empty')}
          />
        ) : (
          <View style={{ gap: spacing.cardGap }}>
            {listings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                english={isEnglish}
                onPress={() => router.push(`/listing/${listing.id}`)}
              />
            ))}

            {listingsQuery.isFetchNextPageError ? (
              <Text
                accessibilityRole="alert"
                className="text-center font-body"
                style={{ color: '#E4A72E', fontSize: typography.label }}
              >
                {t('bazaar.loadFailed')}
              </Text>
            ) : null}

            {listingsQuery.hasNextPage ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('bazaar.loadMore')}
                onPress={() => void listingsQuery.fetchNextPage()}
                disabled={listingsQuery.isFetchingNextPage}
                className="items-center justify-center"
                style={{
                  minHeight: 52,
                  borderRadius: radii.pill,
                  backgroundColor: colors.surfaceElevated,
                  borderWidth: 1,
                  borderColor: colors.borderHairline,
                }}
              >
                {listingsQuery.isFetchingNextPage ? (
                  <ActivityIndicator color={colors.electricLime} />
                ) : (
                  <Text
                    className="font-heading"
                    style={{ color: colors.electricLime, fontSize: typography.body - 1 }}
                  >
                    {t('bazaar.loadMore')}
                  </Text>
                )}
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </ScreenShell>
  );
}

/** A value that follows `value` only after it has stopped changing for `delayMs`. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function CraftChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className="justify-center px-4"
      style={{
        minHeight: 44,
        borderRadius: radii.pill,
        backgroundColor: active ? colors.electricLime : colors.surfaceCharcoal,
        borderWidth: 1,
        borderColor: active ? colors.electricLime : colors.borderHairline,
      }}
    >
      <Text
        className="font-heading"
        style={{
          color: active ? colors.textInverseDark : colors.textPureWhite,
          fontSize: typography.label + 1,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Notice({
  icon,
  text,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <View
      className="items-center rounded-bento p-8"
      style={{
        backgroundColor: colors.surfaceCharcoal,
        borderWidth: 1,
        borderColor: colors.borderHairline,
      }}
    >
      <Ionicons name={icon} size={30} color={colors.textMutedSage} />
      <Text
        className="mt-3 text-center font-body"
        style={{ color: colors.textMutedSage, fontSize: typography.label + 1, lineHeight: 20 }}
      >
        {text}
      </Text>
      {children}
    </View>
  );
}

function ListingCard({
  listing,
  english,
  onPress,
}: {
  listing: PublicListing;
  english: boolean;
  onPress: () => void;
}) {
  const { t } = useT();
  const title = english ? listing.title_en : listing.title_hi;
  const soldOut = listing.stock_quantity === 0;
  const place = listing.seller.cluster_location;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${t('bazaar.by', { name: listing.seller.full_name })}. MRP ${listing.recommended_retail_inr} rupees.${soldOut ? ' Sold out.' : ''}`}
      onPress={onPress}
      className="flex-row rounded-bento p-3"
      style={{
        backgroundColor: colors.surfaceCharcoal,
        borderWidth: 1,
        borderColor: listing.is_mine ? colors.electricLime : colors.borderHairline,
        opacity: soldOut ? 0.72 : 1,
      }}
    >
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: radii.bento - 6,
          overflow: 'hidden',
          backgroundColor: colors.surfaceElevated,
        }}
      >
        <Image
          source={{ uri: listing.enhanced_image_url }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          transition={160}
          accessibilityIgnoresInvertColors
        />
      </View>

      <View className="ml-3 flex-1 justify-between">
        <View>
          <Text
            className="font-heading"
            style={{ color: colors.textPureWhite, fontSize: typography.body - 1, lineHeight: 21 }}
            numberOfLines={2}
          >
            {title}
          </Text>
          <Text
            className="mt-0.5 font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}
            numberOfLines={1}
          >
            {t('bazaar.by', { name: listing.seller.full_name })}
            {place ? ` · ${place}` : ''}
          </Text>
        </View>

        <View className="mt-2 flex-row flex-wrap items-center" style={{ gap: 6 }}>
          <Text
            className="font-display"
            style={{ color: colors.electricLime, fontSize: typography.body + 1 }}
          >
            ₹{listing.recommended_retail_inr.toLocaleString('en-IN')}
          </Text>
          {listing.is_mine ? <Badge label={t('bazaar.yours')} tone="lime" solid /> : null}
          {soldOut ? <Badge label={t('bazaar.soldOut')} tone="red" /> : null}
          {listing.seller.gi_tag_certified ? <Badge label="GI" tone="lime" /> : null}
        </View>
      </View>
    </Pressable>
  );
}
