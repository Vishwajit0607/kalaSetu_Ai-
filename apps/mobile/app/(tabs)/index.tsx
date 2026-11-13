import { useEffect, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { BentoStepCard } from '@/components/ui/BentoStepCard';
import { LimeCircleButton } from '@/components/ui/LimeCircleButton';
import { SplitBadgePill } from '@/components/ui/SplitBadgePill';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { api } from '@/services/apiClient';
import { playBase64Audio, speak } from '@/services/speech';
import { useShallow } from 'zustand/react/shallow';
import { useArtisanStore } from '@/store/useArtisanStore';
import { useCatalogDraftStore } from '@/store/useCatalogDraftStore';
import { AccountCard } from '@/components/ui/AccountCard';
import { useT } from '@/i18n';

/**
 * Screen 2 - Bento Command Center.
 *
 * The 01/02/03 strip is the product's spine: photograph, describe by voice,
 * price and stock. Card 02 is the elevated lime card because voice cataloging
 * is the step that actually removes the literacy barrier - the other two are
 * useful, that one is the reason the app exists.
 *
 * Which card is "active" is not a tab selection; it is derived from where the
 * artisan's current draft actually stands, so the dashboard always points at
 * the next thing to do.
 */

export default function CommandCenterScreen() {
  const router = useRouter();
  const profile = useArtisanStore((state) => state.profile);
  const { t, lang: language } = useT();
  const draft = useCatalogDraftStore(
    useShallow((state) => ({
      rawImageUri: state.rawImageUri,
      enhancedImageUrl: state.enhancedImageUrl,
      nativeTranscript: state.nativeTranscript,
      catalog: state.catalog,
    })),
  );

  const inventoryQuery = useQuery({
    queryKey: ['inventory', profile?.serverId],
    queryFn: () => api.inventory(),
    enabled: Boolean(profile?.serverId),
  });

  const marketplaceQuery = useQuery({
    queryKey: ['marketplace-status', profile?.serverId],
    queryFn: () => api.marketplaceStatus(),
    enabled: Boolean(profile?.serverId),
  });

  const lowStockCount = inventoryQuery.data?.low_stock.length ?? 0;
  const totalSkus = inventoryQuery.data?.total_skus ?? 0;
  const stockValue = inventoryQuery.data?.stock_value_inr ?? 0;

  /** Next step the artisan should take, from the live draft state. */
  const activeStep = useMemo<1 | 2 | 3>(() => {
    if (!draft.rawImageUri) return 1;
    if (!draft.catalog) return 2;
    return 3;
  }, [draft.catalog, draft.rawImageUri]);

  /* Spoken business summary on arrival - the artisan's morning briefing. */
  useEffect(() => {
    if (!profile || inventoryQuery.isLoading || !inventoryQuery.data) return;
    const line =
      totalSkus === 0
        ? t('home.greetingNone', { name: profile.fullName })
        : t('home.greetingSome', { name: profile.fullName, count: totalSkus }) +
          (lowStockCount > 0 ? t('home.greetingLow', { count: lowStockCount }) : '');
    void speak(line, language);
  }, [
    profile,
    language,
    totalSkus,
    lowStockCount,
    inventoryQuery.isLoading,
    inventoryQuery.data,
    t,
  ]);

  const playLowStockAlert = async (): Promise<void> => {
    if (!profile?.serverId) return;
    const alert = await api.lowStockAlert({ language_code: language });
    if (alert.audio_base64) await playBase64Audio(alert.audio_base64);
    else if (alert.spoken_text) await speak(alert.spoken_text, language);
  };

  return (
    <ScreenShell bottomInset={40}>
      {/* Header */}
      <View style={{ marginTop: 12 }}>
        <SplitHeading
          subject={t('home.hello', {
            name: profile?.fullName?.split(' ')[0] ?? t('common.artisan'),
          })}
          action={
            totalSkus > 0 ? t('home.onSale', { count: totalSkus }) : t('home.addFirst')
          }
          size="title"
          subtitle={
            totalSkus > 0
              ? t('home.stockWorth', {
                  value: Math.round(stockValue).toLocaleString('en-IN'),
                  craft: profile?.craftCategory ?? '',
                })
              : t('home.subtitleEmpty')
          }
        />
      </View>

      {/* Hero action card */}
      <View
        className="mt-6 flex-row items-center rounded-bento p-5"
        style={{
          backgroundColor: colors.surfaceCharcoal,
          borderWidth: 1,
          borderColor: colors.borderHairline,
        }}
      >
        <View className="flex-1 pr-4">
          <Text
            className="font-display"
            style={{ color: colors.textPureWhite, fontSize: typography.heading }}
          >
            {t('home.addProduct')}
          </Text>
          <Text
            className="mt-1.5 font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label, lineHeight: 18 }}
          >
            {t('home.addProductSub')}
          </Text>
        </View>

        <LimeCircleButton
          size={56}
          accessibilityLabel="Start a new product digitization"
          onPress={() => {
            useCatalogDraftStore.getState().reset();
            router.push('/(tabs)/studio');
          }}
          onLongPress={() =>
            void speak(t('home.addProductHint'), language)
          }
        />
      </View>

      {/* 01-02-03 bento workflow strip */}
      <View className="mt-7 flex-row" style={{ gap: spacing.cardGap }}>
        <BentoStepCard
          step="01"
          title="AI Photo Studio"
          summary={t('home.card1.summary')}
          active={activeStep === 1}
          badge={draft.enhancedImageUrl ? t('home.card1.badgeReady') : t('home.card1.badgeIdle')}
          accessibilityHint="Opens the camera and AI photo studio"
          onPress={() => router.push('/(tabs)/studio')}
        />

        <BentoStepCard
          step="02"
          title="Voice Auto-Catalog"
          summary={t('home.card2.summary')}
          active={activeStep === 2}
          badge={draft.nativeTranscript ? t('home.card2.badgeReady') : t('home.card2.badgeIdle')}
          accessibilityHint="Opens the voice cataloger"
          onPress={() => router.push('/(tabs)/catalog-voice')}
          trailing={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Quick launch voice recording"
              onPress={() => router.push('/(tabs)/catalog-voice')}
              hitSlop={10}
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor:
                  activeStep === 2 ? 'rgba(8, 10, 6, 0.18)' : 'rgba(168, 235, 52, 0.14)',
              }}
            >
              <Ionicons
                name="mic"
                size={18}
                color={activeStep === 2 ? colors.textInverseDark : colors.electricLime}
              />
            </Pressable>
          }
        />

        <BentoStepCard
          step="03"
          title="Smart Price & Stock"
          summary={t('home.card3.summary')}
          active={activeStep === 3}
          badge={
            lowStockCount > 0
              ? t('home.card3.badgeLow', { count: lowStockCount })
              : t('home.card3.badgeIdle')
          }
          accessibilityHint="Opens the pricing assistant"
          onPress={() => router.push('/(tabs)/pricing-engine')}
        />
      </View>

      {/* Marketplace status pill */}
      <View className="mt-7">
        <SplitBadgePill
          label="SYNCED"
          onPress={() => router.push('/(tabs)/marketplaces')}
          channels={[
            {
              key: 'ondc',
              mark: 'ONDC',
              synced: (marketplaceQuery.data?.synced.ondc ?? 0) > 0,
              accessibilityLabel: 'ONDC network',
            },
            {
              key: 'gem',
              mark: 'GeM',
              synced: (marketplaceQuery.data?.synced.gem ?? 0) > 0,
              accessibilityLabel: 'Government e-Marketplace',
            },
            {
              key: 'b2b',
              mark: 'WA B2B',
              synced: (marketplaceQuery.data?.synced.b2b ?? 0) > 0,
              accessibilityLabel: 'WhatsApp B2B buyers',
            },
          ]}
        />
      </View>

      {/* Low-stock alert strip */}
      {lowStockCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${lowStockCount} products are low on stock. Tap to hear the list.`}
          onPress={() => void playLowStockAlert()}
          className="mt-5 flex-row items-center rounded-bento p-4"
          style={{
            backgroundColor: colors.surfaceElevated,
            borderWidth: 1,
            borderColor: colors.borderHairline,
          }}
        >
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(228, 167, 46, 0.16)',
            }}
          >
            <Ionicons name="volume-high" size={20} color="#E4A72E" />
          </View>
          <View className="ml-3 flex-1">
            <Text
              className="font-heading"
              style={{ color: colors.textPureWhite, fontSize: typography.body - 1 }}
            >
              {t('home.lowStockTitle', { count: lowStockCount })}
            </Text>
            <Text
              className="mt-0.5 font-body"
              style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}
            >
              {t('home.lowStockSub')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMutedSage} />
        </Pressable>
      ) : null}

      {/* Quick stats */}
      <View className="mt-5 flex-row" style={{ gap: spacing.cardGap }}>
        <StatTile label={t('home.stat.total')} value={String(totalSkus)} caption="SKUs listed" />
        <StatTile
          label={t('home.stat.value')}
          value={`₹${Math.round(stockValue / 1000)}k`}
          caption="Wholesale value"
        />
        <StatTile
          label={t('home.stat.low')}
          value={String(lowStockCount)}
          caption="Need restocking"
          warn={lowStockCount > 0}
        />
      </View>

      {/* Insights card – links to the analytics screen */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open business insights and analytics"
        onPress={() => router.push('/analytics')}
        className="mt-5 flex-row items-center rounded-bento p-4"
        style={{
          backgroundColor: colors.surfaceElevated,
          borderWidth: 1,
          borderColor: colors.borderHairline,
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
          <Ionicons name="bar-chart-outline" size={20} color={colors.electricLime} />
        </View>
        <View className="ml-3 flex-1">
          <Text
            className="font-heading"
            style={{ color: colors.textPureWhite, fontSize: typography.body - 1 }}
          >
            Business Insights
          </Text>
          <Text
            className="mt-0.5 font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}
          >
            Stock value, sales trends & buyer inquiries
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMutedSage} />
      </Pressable>

      <AccountCard />
    </ScreenShell>
  );
}

function StatTile({
  label,
  value,
  caption,
  warn = false,
}: {
  label: string;
  value: string;
  caption: string;
  warn?: boolean;
}) {
  return (
    <View
      className="flex-1 p-4"
      style={{
        borderRadius: radii.card,
        backgroundColor: colors.surfaceCharcoal,
        borderWidth: 1,
        borderColor: colors.borderHairline,
      }}
    >
      <Text
        className="font-body"
        style={{ color: colors.textMutedSage, fontSize: typography.label - 2 }}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text
        className="mt-1 font-display"
        style={{
          color: warn ? '#E4A72E' : colors.electricLime,
          fontSize: typography.title - 2,
        }}
      >
        {value}
      </Text>
      <Text
        className="font-body"
        style={{ color: colors.textMutedSage, fontSize: typography.label - 3 }}
        numberOfLines={1}
      >
        {caption}
      </Text>
    </View>
  );
}
