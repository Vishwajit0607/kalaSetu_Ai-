import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { HaloProductStage, StageActionPill } from '@/components/ui/HaloProductStage';
import { SplitBadgePill } from '@/components/ui/SplitBadgePill';
import { LimeCircleButton } from '@/components/ui/LimeCircleButton';
import { PriceTile, SpecRow } from '@/components/ui/ProductFacts';
import { GalleryThumbs } from '@/components/ui/GalleryThumbs';
import { PriceHistoryList } from '@/components/ui/PriceHistoryList';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { api, ApiError, type ProductRow } from '@/services/apiClient';
import { buildWholesalePitch } from '@/services/catalogExports';
import { productImages } from '@/services/gallery';
import { withProduct, withoutProduct, type InventoryData } from '@/services/inventoryCache';
import { speak } from '@/services/speech';
import { useArtisanStore } from '@/store/useArtisanStore';
import { useT, type StringKey } from '@/i18n';

/**
 * Product Detail & Wholesale Share.
 *
 * The share action is the point of this screen. It produces the exact bilingual
 * WhatsApp block a buyer expects - Hindi title, English title, both price
 * tiers, MOQ, stock, HSN, photo URL, SKU - because that message, forwarded into
 * a trader group, is how these products actually sell today.
 *
 * Also here: delete with an immediate Undo (a delete only hides the product, so it can be
 * brought back), "make this the cover photo", and the product's price history.
 */

export default function ProductDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const profile = useArtisanStore((state) => state.profile);
  const { t, lang: language, isEnglish } = useT();
  // Lead with whichever language the artisan reads; both are generated.
  const [tabOverride, setTab] = useState<'hi' | 'en' | null>(null);
  const tab: 'hi' | 'en' = tabOverride ?? (isEnglish ? 'en' : 'hi');
  const [pickedImage, setPickedImage] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const serverId = profile?.serverId;
  const inventoryKey = ['inventory', serverId] as const;
  // What is busy right now, so a second tap cannot start a second delete or cover change.
  const [busy, setBusy] = useState<'delete' | 'restore' | 'cover' | null>(null);
  // Set after a delete, so the screen can offer Undo even though the inventory no longer lists the product.
  const [deleted, setDeleted] = useState<ProductRow | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const inventoryQuery = useQuery({
    queryKey: inventoryKey,
    queryFn: () => api.inventory(),
    enabled: Boolean(serverId),
  });

  const product = inventoryQuery.data?.products.find((row) => row.id === id);

  const historyQuery = useQuery({
    queryKey: ['price-history', serverId, id],
    queryFn: () => api.priceHistory(id, { limit: 10 }),
    enabled: Boolean(serverId) && Boolean(product) && !deleted,
  });

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

  const failureMessage = (caught: unknown, fallback: StringKey): string =>
    caught instanceof ApiError ? caught.spokenHi : t(fallback);

  const remove = async (): Promise<void> => {
    if (!product || busy) return;
    setBusy('delete');
    try {
      await api.deleteProduct(product.id);
      setDeleted(product);
      // Take it out of the list we already hold. We do not refetch the list here: until the
      // inventory endpoint itself leaves deleted products out, a refetch would bring it back.
      queryClient.setQueryData<InventoryData>(inventoryKey, (old) => (old ? withoutProduct(old, product.id) : old));
      queryClient.removeQueries({ queryKey: ['product', serverId, product.id] });
      void queryClient.invalidateQueries({ queryKey: ['bazaar'] });
      void speak(t('product.deleted.spoken'), language);
    } catch (caught) {
      const message = failureMessage(caught, 'product.deleteFailed');
      void speak(message, language);
      Alert.alert(message);
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = (): void => {
    Alert.alert(t('product.delete.confirmTitle'), t('product.delete.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void remove() },
    ]);
  };

  const undoDelete = async (): Promise<void> => {
    if (!deleted || busy) return;
    setBusy('restore');
    try {
      await api.restoreProduct(deleted.id);
      // Wait for the list to come back with it, so this screen does not flash "not found".
      await queryClient.invalidateQueries({ queryKey: inventoryKey });
      void queryClient.invalidateQueries({ queryKey: ['bazaar'] });
      setDeleted(null);
      void speak(t('product.restored'), language);
    } catch (caught) {
      const message = failureMessage(caught, 'product.restoreFailed');
      void speak(message, language);
      Alert.alert(message);
    } finally {
      setBusy(null);
    }
  };

  const makeCover = async (cover: string): Promise<void> => {
    if (!product || busy) return;
    setBusy('cover');
    try {
      const { product: saved } = await api.updateProduct(product.id, { cover_image_url: cover });
      queryClient.setQueryData<InventoryData>(inventoryKey, (old) => (old ? withProduct(old, saved) : old));
      queryClient.setQueryData(['product', serverId, product.id], saved);
      void queryClient.invalidateQueries({ queryKey: ['bazaar'] });
      void speak(t('product.coverChanged'), language);
    } catch (caught) {
      const message = failureMessage(caught, 'product.coverFailed');
      void speak(message, language);
      Alert.alert(message);
    } finally {
      setBusy(null);
    }
  };

  if (deleted) {
    return (
      <ScreenShell>
        <View style={{ marginTop: 24 }}>
          <SplitHeading
            subject={t('product.deleted.subject')}
            action={t('product.deleted.action')}
            size="title"
            subtitle={t('product.deleted.sub')}
          />
        </View>
        <Text className="mt-4 font-body" style={{ color: colors.textMutedSage, fontSize: typography.body - 1 }}>
          {deleted.title_en} · {deleted.sku}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('product.undo')}
          accessibilityState={{ disabled: busy !== null }}
          disabled={busy !== null}
          onPress={() => void undoDelete()}
          className="mt-7 items-center justify-center"
          style={{ minHeight: 56, borderRadius: radii.pill, backgroundColor: colors.electricLime, opacity: busy ? 0.7 : 1 }}
        >
          {busy === 'restore' ? (
            <ActivityIndicator color={colors.textInverseDark} />
          ) : (
            <Text className="font-heading" style={{ color: colors.textInverseDark, fontSize: typography.body }}>
              {t('product.undo')}
            </Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('product.goBack')}
          disabled={busy !== null}
          onPress={() => router.back()}
          className="mt-3 items-center justify-center"
          style={{ minHeight: 56, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.borderHairline }}
        >
          <Text className="font-heading" style={{ color: colors.textPureWhite, fontSize: typography.body }}>
            {t('product.goBack')}
          </Text>
        </Pressable>
      </ScreenShell>
    );
  }

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

  const images = productImages(product);
  const shownImage = pickedImage && images.includes(pickedImage) ? pickedImage : images[0]!;
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
        <View className="flex-1" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('editProduct.open')}
          onPress={() => router.push({ pathname: '/product/edit/[id]', params: { id: product.id } })}
          hitSlop={12}
        >
          <Ionicons name="create-outline" size={24} color={colors.electricLime} />
        </Pressable>
      </View>

      <View className="mt-4">
        <HaloProductStage
          imageUri={shownImage}
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

      {images.length > 1 ? (
        <View className="mt-4">
          <GalleryThumbs images={images} selected={shownImage} onSelect={setPickedImage} />
          {shownImage !== images[0] ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('product.makeCover')}
              accessibilityState={{ disabled: busy !== null }}
              disabled={busy !== null}
              onPress={() => void makeCover(shownImage)}
              className="mt-3 flex-row items-center self-start px-4"
              style={{
                minHeight: 44,
                borderRadius: radii.pill,
                borderWidth: 1,
                borderColor: colors.electricLime,
                opacity: busy === 'cover' ? 0.6 : 1,
              }}
            >
              {busy === 'cover' ? (
                <ActivityIndicator color={colors.electricLime} />
              ) : (
                <>
                  <Ionicons name="image" size={16} color={colors.electricLime} />
                  <Text className="ml-2 font-heading" style={{ color: colors.electricLime, fontSize: typography.label + 1 }}>
                    {t('product.makeCover')}
                  </Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}

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

      <PriceHistoryList
        status={historyQuery.isLoading ? 'loading' : historyQuery.isError ? 'error' : 'ready'}
        entries={historyQuery.data?.history ?? []}
        expanded={historyExpanded}
        onToggle={() => setHistoryExpanded((open) => !open)}
        t={t}
        language={isEnglish ? 'en' : 'hi'}
      />

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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('product.delete')}
        accessibilityState={{ disabled: busy !== null }}
        disabled={busy !== null}
        onPress={confirmDelete}
        className="mt-7 flex-row items-center justify-center"
        style={{ minHeight: 52, borderRadius: radii.pill, borderWidth: 1, borderColor: '#E4A72E', opacity: busy === 'delete' ? 0.6 : 1 }}
      >
        {busy === 'delete' ? (
          <ActivityIndicator color="#E4A72E" />
        ) : (
          <>
            <Ionicons name="trash-outline" size={18} color="#E4A72E" />
            <Text className="ml-2 font-heading" style={{ color: '#E4A72E', fontSize: typography.body }}>
              {t('product.delete')}
            </Text>
          </>
        )}
      </Pressable>
    </ScreenShell>
  );
}
