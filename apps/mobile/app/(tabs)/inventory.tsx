import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { VoiceOrbRecorder } from '@/components/voice/VoiceOrbRecorder';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { api, ApiError, type ProductRow } from '@/services/apiClient';
import { speak, stopSpeaking } from '@/services/speech';
import { useArtisanStore } from '@/store/useArtisanStore';
import { buildLookbookHtml, buildQrTagHtml } from '@/services/catalogExports';
import { StockHistorySheet } from '@/components/ui/StockHistorySheet';
import { useT } from '@/i18n';

/**
 * Screen 6 - Digital Inventory & Catalog Ledger.
 *
 * Three jobs: show what is in stock, let the artisan change it by voice, and
 * produce the two paper artefacts a trade fair actually needs - a printable QR
 * tag per SKU and a bilingual wholesale lookbook PDF.
 *
 * The voice adjustment is the feature that gets used daily. "तीन नीली सूती
 * साड़ी बिक गईं" decrements the right SKU and reads the new count back, which
 * is the entire stock-keeping workflow for someone who will never open a
 * spreadsheet.
 */

export default function InventoryScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const profile = useArtisanStore((state) => state.profile);
  const { t, lang: language } = useT();

  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [historyProduct, setHistoryProduct] = useState<ProductRow | null>(null);

  const inventoryQuery = useQuery({
    queryKey: ['inventory', profile?.serverId],
    queryFn: () => api.inventory(),
    enabled: Boolean(profile?.serverId),
  });

  const products = inventoryQuery.data?.products ?? [];

  useEffect(() => {
    return () => {
      void stopSpeaking();
    };
  }, []);

  /** Voice stock adjustment: "Sold 3 blue cotton sarees". */
  const handleVoiceStock = useCallback(
    async ({ uri }: { uri: string }) => {
      if (!profile?.serverId) return;
      setBusy(true);
      await stopSpeaking();
      try {
        const { transcript } = await api.transcribe({ fileUri: uri, languageCode: language });
        if (!transcript.trim()) {
          void speak(t('inv.notHeard'), language);
          return;
        }

        const result = await api.voiceAdjustStock({
          transcript,
          language_code: language,
        });

        setLastAction(result.spoken_confirmation);
        void speak(result.spoken_confirmation, language);

        if (result.matched) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['inventory', profile.serverId] }),
            // Stock shows in the bazaar as "Sold out".
            queryClient.invalidateQueries({ queryKey: ['bazaar'] }),
          ]);
        }
      } catch (caught) {
        const message =
          caught instanceof ApiError ? caught.spokenHi : t('inv.stockFailed');
        setLastAction(message);
        void speak(message, language);
      } finally {
        setBusy(false);
      }
    },
    [language, profile?.serverId, queryClient],
  );

  /** Bilingual wholesale lookbook, printed or shared as a PDF. */
  const generateLookbook = useCallback(async () => {
    if (products.length === 0 || !profile) return;
    setGeneratingPdf(true);
    try {
      const html = buildLookbookHtml(products, profile.fullName, profile.craftCategory);
      const { uri } = await Print.printToFileAsync({ html, base64: false });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Wholesale lookbook',
          UTI: 'com.adobe.pdf',
        });
      }
      void speak(t('inv.lookbookReady'), language);
    } catch {
      void speak(t('inv.lookbookFailed'), language);
    } finally {
      setGeneratingPdf(false);
    }
  }, [language, products, profile]);

  const showQrTag = useCallback(
    async (product: ProductRow) => {
      try {
        const tag = await api.productQr(product.id);
        const html = buildQrTagHtml(tag, product);
        await Print.printAsync({ html });
      } catch {
        void speak(t('inv.qrFailed'), language);
      }
    },
    [language],
  );

  return (
    <ScreenShell bottomInset={40}>
      <View style={{ marginTop: 12 }}>
        <SplitHeading
          subject={t('inv.title.subject')}
          action={t('inv.title.action')}
          size="title"
          subtitle={
            inventoryQuery.data
              ? t('inv.subtitle', {
                  count: inventoryQuery.data.total_skus,
                  value: Math.round(inventoryQuery.data.stock_value_inr).toLocaleString('en-IN'),
                })
              : t('inv.subtitleEmpty')
          }
        />
      </View>

      {/* Voice stock adjustment */}
      <View
        className="mt-6 flex-row items-center rounded-bento p-4"
        style={{
          backgroundColor: colors.surfaceCharcoal,
          borderWidth: 1,
          borderColor: colors.borderHairline,
        }}
      >
        <View style={{ transform: [{ scale: 0.52 }], marginLeft: -24, marginVertical: -26 }}>
          <VoiceOrbRecorder
            onComplete={(result) => void handleVoiceStock(result)}
            languageCode={language}
            busy={busy}
            label=""
            hint=""
          />
        </View>
        <View className="ml-1 flex-1">
          <Text
            className="font-heading"
            style={{ color: colors.textPureWhite, fontSize: typography.body - 1 }}
          >
            {t('inv.voiceTitle')}
          </Text>
          <Text
            className="mt-1 font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label - 1, lineHeight: 17 }}
          >
            {t('inv.voiceExample')}
          </Text>
        </View>
      </View>

      {lastAction ? (
        <View
          accessibilityRole="alert"
          className="mt-3 rounded-bento p-4"
          style={{
            backgroundColor: 'rgba(168, 235, 52, 0.1)',
            borderWidth: 1,
            borderColor: colors.borderHairline,
          }}
        >
          <Text
            className="font-body"
            style={{ color: colors.textPureWhite, fontSize: typography.label + 1, lineHeight: 20 }}
          >
            {lastAction}
          </Text>
        </View>
      ) : null}

      {/* Lookbook action */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Generate a bilingual wholesale lookbook PDF"
        onPress={() => void generateLookbook()}
        disabled={products.length === 0 || generatingPdf}
        className="mt-5 flex-row items-center rounded-bento p-4"
        style={{
          backgroundColor: colors.surfaceElevated,
          borderWidth: 1,
          borderColor: colors.borderHairline,
          opacity: products.length === 0 ? 0.5 : 1,
        }}
      >
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(168, 235, 52, 0.14)',
          }}
        >
          {generatingPdf ? (
            <ActivityIndicator color={colors.electricLime} size="small" />
          ) : (
            <Ionicons name="document-text-outline" size={20} color={colors.electricLime} />
          )}
        </View>
        <View className="ml-3 flex-1">
          <Text
            className="font-heading"
            style={{ color: colors.textPureWhite, fontSize: typography.body - 1 }}
          >
            {t('inv.lookbookTitle')}
          </Text>
          <Text
            className="mt-0.5 font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}
          >
            {t('inv.lookbookSub')}
          </Text>
        </View>
        <Ionicons name="share-outline" size={18} color={colors.textMutedSage} />
      </Pressable>

      {/* Stock grid */}
      <View className="mt-7">
        <Text
          className="mb-4 font-heading"
          style={{ color: colors.textMutedSage, fontSize: typography.label, letterSpacing: 1.2 }}
        >
          {t('inv.catalog')}
        </Text>

        {inventoryQuery.isLoading ? (
          <ActivityIndicator color={colors.electricLime} />
        ) : products.length === 0 ? (
          <View
            className="items-center rounded-bento p-8"
            style={{
              backgroundColor: colors.surfaceCharcoal,
              borderWidth: 1,
              borderColor: colors.borderHairline,
            }}
          >
            <Ionicons name="cube-outline" size={30} color={colors.textMutedSage} />
            <Text
              className="mt-3 text-center font-body"
              style={{ color: colors.textMutedSage, fontSize: typography.label }}
            >
              {t('inv.empty')}
            </Text>
          </View>
        ) : (
          <View style={{ gap: spacing.cardGap }}>
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onPress={() => router.push(`/product/${product.id}`)}
                onHistory={() => setHistoryProduct(product)}
                onQr={() => void showQrTag(product)}
                onAdjust={async (delta) => {
                  if (!profile?.serverId) return;
                  await api.adjustStock(product.id, { delta });
                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['inventory', profile.serverId] }),
                    queryClient.invalidateQueries({ queryKey: ['bazaar'] }),
                  ]);
                }}
              />
            ))}
          </View>
        )}
      </View>

      <StockHistorySheet
        productId={historyProduct?.id ?? null}
        productTitle={historyProduct?.title_hi || historyProduct?.title_en || ''}
        onClose={() => setHistoryProduct(null)}
      />
    </ScreenShell>
  );
}

function ProductCard({
  product,
  onPress,
  onHistory,
  onQr,
  onAdjust,
}: {
  product: ProductRow;
  onPress: () => void;
  onHistory: () => void;
  onQr: () => void;
  onAdjust: (delta: number) => Promise<void>;
}) {
  const { t } = useT();
  const low = product.stock_quantity <= 3;
  const out = product.stock_quantity === 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.title_hi}. SKU ${product.sku}. ${product.stock_quantity} in stock. Wholesale ${product.recommended_wholesale_inr} rupees.`}
      onPress={onPress}
      onLongPress={onHistory}
      className="flex-row items-center rounded-bento p-4"
      style={{
        backgroundColor: colors.surfaceCharcoal,
        borderWidth: 1,
        borderColor: out ? '#E4572E' : low ? '#E4A72E' : colors.borderHairline,
      }}
    >
      {/* Circular thumbnail cutout */}
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          overflow: 'hidden',
          backgroundColor: colors.surfaceElevated,
          borderWidth: 1,
          borderColor: colors.borderHairline,
        }}
      >
        <Image
          source={{ uri: product.enhanced_image_url }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          transition={160}
        />
      </View>

      <View className="ml-4 flex-1">
        <Text
          className="font-heading"
          style={{ color: colors.textPureWhite, fontSize: typography.body - 1 }}
          numberOfLines={1}
        >
          {product.title_hi}
        </Text>
        <Text
          className="mt-0.5 font-body"
          style={{ color: colors.textMutedSage, fontSize: typography.label - 2 }}
        >
          {product.sku}
        </Text>

        <View className="mt-2 flex-row items-center" style={{ gap: 10 }}>
          <Text
            className="font-heading"
            style={{ color: colors.electricLime, fontSize: typography.label }}
          >
            {t('inv.wholesaleShort')} ₹
            {Number(product.recommended_wholesale_inr).toLocaleString('en-IN')}
          </Text>
          <Text
            className="font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}
          >
            MRP ₹{Number(product.recommended_retail_inr).toLocaleString('en-IN')}
          </Text>
        </View>
      </View>

      <View className="items-end" style={{ gap: 6 }}>
        <View
          className="px-3 py-1"
          style={{
            borderRadius: radii.pill,
            backgroundColor: out
              ? 'rgba(228, 87, 46, 0.18)'
              : low
                ? 'rgba(228, 167, 46, 0.18)'
                : 'rgba(168, 235, 52, 0.14)',
          }}
        >
          <Text
            className="font-display"
            style={{
              color: out ? '#E4572E' : low ? '#E4A72E' : colors.electricLime,
              fontSize: typography.label,
            }}
          >
            {product.stock_quantity}
          </Text>
        </View>

        <View className="flex-row" style={{ gap: 6 }}>
          <IconChip
            label={`Reduce stock of ${product.title_en}`}
            icon="remove"
            onPress={() => void onAdjust(-1)}
          />
          <IconChip
            label={`Add stock of ${product.title_en}`}
            icon="add"
            onPress={() => void onAdjust(1)}
          />
          <IconChip label={`Stock history for ${product.sku}`} icon="time-outline" onPress={onHistory} />
          <IconChip label={`Print QR tag for ${product.sku}`} icon="qr-code" onPress={onQr} />
        </View>
      </View>
    </Pressable>
  );
}

function IconChip({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={10}
      style={{
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surfaceElevated,
        borderWidth: 1,
        borderColor: colors.borderHairline,
      }}
    >
      <Ionicons name={icon} size={14} color={colors.electricLime} />
    </Pressable>
  );
}
