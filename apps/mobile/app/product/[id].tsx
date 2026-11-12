import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Share, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { HaloProductStage, StageActionPill } from '@/components/ui/HaloProductStage';
import { SplitBadgePill } from '@/components/ui/SplitBadgePill';
import { LimeCircleButton } from '@/components/ui/LimeCircleButton';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { api, type ProductRow } from '@/services/apiClient';
import { buildWholesalePitch } from '@/services/catalogExports';
import { speak } from '@/services/speech';
import { useArtisanStore } from '@/store/useArtisanStore';
import { useT } from '@/i18n';

/**
 * Product Detail & Wholesale Share.
 *
 * The share action is the point of this screen. It produces the exact bilingual
 * WhatsApp block a buyer expects - Hindi title, English title, both price
 * tiers, MOQ, stock, HSN, photo URL, SKU - because that message, forwarded into
 * a trader group, is how these products actually sell today.
 */

export default function ProductDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const profile = useArtisanStore((state) => state.profile);
  const { t, lang: language, isEnglish } = useT();
  // Lead with whichever language the artisan reads; both are generated.
  const [tabOverride, setTab] = useState<'hi' | 'en' | null>(null);
  const tab: 'hi' | 'en' = tabOverride ?? (isEnglish ? 'en' : 'hi');

  const inventoryQuery = useQuery({
    queryKey: ['inventory', profile?.serverId],
    queryFn: () => api.inventory(),
    enabled: Boolean(profile?.serverId),
  });

  const product = inventoryQuery.data?.products.find((row) => row.id === id);

  const shareWholesale = useCallback(async () => {
    if (!product) return;
    await Share.share({
      message: buildWholesalePitch(product),
      title: product.title_en,
    });
  }, [product]);

  const printQrTag = useCallback(async () => {
    if (!product) return;
    const tag = await api.productQr(product.id);
    void speak(t('product.tagReady', { sku: tag.sku }), language);
  }, [language, product]);

  if (inventoryQuery.isLoading) {
    return (
      <ScreenShell scroll={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.electricLime} />
        </View>
      </ScreenShell>
    );
  }

  if (!product) {
    return (
      <ScreenShell>
        <View style={{ marginTop: 24 }}>
          <SplitHeading
            subject={t('product.notFound.subject')}
            action={t('product.notFound.action')}
            size="title"
            subtitle={t('product.notFound.sub')}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="mt-6 items-center justify-center"
          style={{ minHeight: 56, borderRadius: radii.pill, backgroundColor: colors.electricLime }}
        >
          <Text
            className="font-heading"
            style={{ color: colors.textInverseDark, fontSize: typography.body }}
          >
            {t('product.goBack')}
          </Text>
        </Pressable>
      </ScreenShell>
    );
  }

  const title = tab === 'hi' ? product.title_hi : product.title_en;
  const description = tab === 'hi' ? product.description_hi : product.description_en;

  return (
    <ScreenShell bottomInset={40}>
      <View className="mt-2 flex-row items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to inventory"
          onPress={() => router.back()}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={26} color={colors.textPureWhite} />
        </Pressable>
        <Text
          className="ml-2 font-body"
          style={{ color: colors.textMutedSage, fontSize: typography.label }}
        >
          {product.sku}
        </Text>
      </View>

      <View className="mt-4">
        <HaloProductStage
          imageUri={product.enhanced_image_url}
          caption={t('product.inStock', { count: product.stock_quantity })}
          actions={
            <>
              <StageActionPill
                label="Share wholesale pitch"
                onPress={() => void shareWholesale()}
                icon={<Ionicons name="share-social" size={18} color={colors.electricLime} />}
              />
              <StageActionPill
                label="Print QR tag"
                onPress={() => void printQrTag()}
                icon={<Ionicons name="qr-code" size={18} color={colors.electricLime} />}
              />
              <StageActionPill
                label="Listen to the description"
                showConnector={false}
                onPress={() => void speak(`${title}. ${description}`, tab === 'hi' ? 'hi-IN' : 'en-IN')}
                icon={<Ionicons name="volume-high" size={18} color={colors.electricLime} />}
              />
            </>
          }
        />
      </View>

      <View style={{ marginTop: 24 }}>
        <SplitHeading
          subject={tab === 'hi' ? product.title_hi : product.title_en}
          action=""
          size="heading"
        />
      </View>

      {/* Language toggle */}
      <View className="mt-4 flex-row" style={{ gap: 8 }}>
        {(['hi', 'en'] as const).map((key) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityLabel={key === 'hi' ? 'Hindi' : 'English'}
              accessibilityState={{ selected: active }}
              onPress={() => setTab(key)}
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
                  fontSize: typography.label + 1,
                }}
              >
                {key === 'hi' ? 'हिन्दी' : 'English'}
              </Text>
            </Pressable>
          );
        })}
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
          value={`₹${Number(product.recommended_wholesale_inr).toLocaleString('en-IN')}`}
          caption={t('product.onQty', { qty: product.min_wholesale_qty })}
        />
        <PriceTile
          label={t('product.retail')}
          value={`₹${Number(product.recommended_retail_inr).toLocaleString('en-IN')}`}
          caption={t('product.directToCustomer')}
        />
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
        <SpecRow label="SKU" value={product.sku} />
        <SpecRow label="HSN" value={product.hsn_code ?? '—'} />
        <SpecRow
          label={t('product.size')}
          value={`${product.dimensions_cm.length} × ${product.dimensions_cm.width} × ${product.dimensions_cm.height} cm`}
        />
        <SpecRow label={t('product.stock')} value={String(product.stock_quantity)} />
        <SpecRow
          label={t('product.tags')}
          value={product.seo_tags.slice(0, 4).join(', ') || '—'}
          last
        />
      </View>

      <View className="mt-6">
        <SplitBadgePill
          label="LISTED ON"
          channels={[
            {
              key: 'ondc',
              mark: 'ONDC',
              synced: product.marketplace_sync_status.ondc,
              accessibilityLabel: 'ONDC',
            },
            {
              key: 'gem',
              mark: 'GeM',
              synced: product.marketplace_sync_status.gem,
              accessibilityLabel: 'Government e-Marketplace',
            },
            {
              key: 'b2b',
              mark: 'WA B2B',
              synced: product.marketplace_sync_status.b2b,
              accessibilityLabel: 'WhatsApp B2B',
            },
          ]}
        />
      </View>

      {/* Wholesale share */}
      <View
        className="mt-7 flex-row items-center rounded-bento p-5"
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
            {t('product.shareTitle')}
          </Text>
          <Text
            className="mt-1 font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label }}
          >
            {t('product.shareSub')}
          </Text>
        </View>
        <LimeCircleButton
          accessibilityLabel="Share the wholesale pitch"
          direction="right"
          onPress={() => void shareWholesale()}
        />
      </View>
    </ScreenShell>
  );
}

function PriceTile({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <View
      className="flex-1 p-5"
      style={{
        borderRadius: radii.bento,
        backgroundColor: colors.surfaceCharcoal,
        borderWidth: 1,
        borderColor: colors.borderHairline,
      }}
    >
      <Text
        className="font-heading"
        style={{ color: colors.electricLime, fontSize: typography.label - 1, letterSpacing: 1 }}
      >
        {label}
      </Text>
      <Text
        className="mt-2 font-display"
        style={{ color: colors.textPureWhite, fontSize: typography.title - 2 }}
      >
        {value}
      </Text>
      <Text
        className="mt-1 font-body"
        style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}
      >
        {caption}
      </Text>
    </View>
  );
}

function SpecRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View
      className="flex-row items-center justify-between py-2.5"
      style={
        last
          ? undefined
          : { borderBottomWidth: 1, borderBottomColor: colors.borderHairline }
      }
    >
      <Text
        className="font-body"
        style={{ color: colors.textMutedSage, fontSize: typography.label + 1 }}
      >
        {label}
      </Text>
      <Text
        className="ml-4 flex-1 text-right font-heading"
        style={{ color: colors.textPureWhite, fontSize: typography.label + 1 }}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}
