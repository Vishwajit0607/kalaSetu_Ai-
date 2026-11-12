import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { SplitBadgePill } from '@/components/ui/SplitBadgePill';
import { LimeCircleButton } from '@/components/ui/LimeCircleButton';
import { GlowingTimeline, type TimelineNode } from '@/components/ui/GlowingTimeline';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { api, ApiError } from '@/services/apiClient';
import { playBase64Audio, speak } from '@/services/speech';
import { enqueue } from '@/services/offlineQueue';
import { useArtisanStore } from '@/store/useArtisanStore';
import { useT, type StringKey } from '@/i18n';

/**
 * Screen 7 - B2B & Government Marketplace Sync Hub.
 *
 * Two halves. Outbound: select products, pick channels, and the server formats
 * ONDC beckn payloads and GeM catalog rows in one tap. Inbound: the buyer
 * inquiry feed, where every message is translated into the artisan's language
 * and read aloud.
 *
 * The inbound half is the one that converts. A wholesale inquiry written in
 * English, sitting unread in an app the artisan cannot parse, is a lost order -
 * so each card leads with the translation and a speaker button, and the
 * original English text is secondary.
 */

type Channel = 'ondc' | 'gem' | 'b2b';

const CHANNEL_META: Record<Channel, { label: string; nameKey: StringKey; note: string }> = {
  ondc: {
    label: 'ONDC',
    nameKey: 'market.channel.ondc',
    note: 'Open Network for Digital Commerce · beckn RET10',
  },
  gem: {
    label: 'GeM',
    nameKey: 'market.channel.gem',
    note: 'Government e-Marketplace · MSME artisan listing',
  },
  b2b: {
    label: 'WhatsApp B2B',
    nameKey: 'market.channel.b2b',
    note: 'Forwardable bilingual wholesale pitch',
  },
};

export default function MarketplacesScreen() {
  const router = useRouter();
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  const queryClient = useQueryClient();
  const profile = useArtisanStore((state) => state.profile);
  const { t, lang: language } = useT();

  const [channels, setChannels] = useState<Channel[]>(['ondc', 'gem', 'b2b']);
  const [selected, setSelected] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  useEffect(() => {
    if (productId) {
      setSelected([productId]);
      setChannels(['ondc', 'gem', 'b2b']);
    }
  }, [productId]);

  const inventoryQuery = useQuery({
    queryKey: ['inventory', profile?.serverId],
    queryFn: () => api.inventory(),
    enabled: Boolean(profile?.serverId),
  });

  const statusQuery = useQuery({
    queryKey: ['marketplace-status', profile?.serverId],
    queryFn: () => api.marketplaceStatus(),
    enabled: Boolean(profile?.serverId),
  });

  const inquiriesQuery = useQuery({
    queryKey: ['inquiries', profile?.serverId, language],
    queryFn: () => api.inquiries(language),
    enabled: Boolean(profile?.serverId),
  });

  const products = inventoryQuery.data?.products ?? [];
  const inquiries = inquiriesQuery.data?.inquiries ?? [];

  const toggleChannel = (channel: Channel): void => {
    setChannels((current) =>
      current.includes(channel)
        ? current.filter((entry) => entry !== channel)
        : [...current, channel],
    );
  };

  const toggleProduct = (id: string): void => {
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };

  const syndicate = useCallback(async () => {
    if (!profile?.serverId || channels.length === 0) return;

    const productIds = selected.length > 0 ? selected : products.map((product) => product.id);
    if (productIds.length === 0) {
      void speak(t('market.noProducts'), language);
      return;
    }

    setExporting(true);
    setExportNote(null);
    try {
      const result = await api.exportToMarketplaces({ product_ids: productIds, channels });

      const note = t('market.exported', {
        count: result.exported_count,
        channels: channels.map((channel) => CHANNEL_META[channel].label).join(', '),
      });
      setExportNote(note);
      void speak(note, language);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['marketplace-status', profile.serverId] }),
        queryClient.invalidateQueries({ queryKey: ['inventory', profile.serverId] }),
      ]);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'offline') {
        await enqueue({
          kind: 'marketplace_export',
          payload: { productIds, channels },
        });
        setExportNote(caught.spokenHi);
        void speak(caught.spokenHi, language);
      } else {
        const message =
          caught instanceof ApiError ? caught.spokenHi : t('market.exportFailed');
        setExportNote(message);
        void speak(message, language);
      }
    } finally {
      setExporting(false);
    }
  }, [channels, language, products, profile?.serverId, queryClient, selected]);

  const syncNodes: TimelineNode[] = [
    {
      label: t('market.node.ondc'),
      detail: `${statusQuery.data?.synced.ondc ?? 0} products live on the ONDC network`,
      state: (statusQuery.data?.synced.ondc ?? 0) > 0 ? 'complete' : 'pending',
    },
    {
      label: t('market.node.gem'),
      detail: `${statusQuery.data?.synced.gem ?? 0} products in the Government e-Marketplace catalog`,
      state: (statusQuery.data?.synced.gem ?? 0) > 0 ? 'complete' : 'pending',
    },
    {
      label: t('market.node.b2b'),
      detail: `${statusQuery.data?.synced.b2b ?? 0} products shared with B2B buyers`,
      state: (statusQuery.data?.synced.b2b ?? 0) > 0 ? 'complete' : 'pending',
    },
  ];

  return (
    <ScreenShell bottomInset={40}>
      <View style={{ marginTop: 12 }}>
        <SplitHeading
          subject={t('market.title.subject')}
          action={t('market.title.action')}
          size="title"
          subtitle={t('market.subtitle')}
        />
      </View>

      <View className="mt-5">
        <SplitBadgePill
          label="CHANNELS"
          channels={[
            {
              key: 'ondc',
              mark: 'ONDC',
              synced: (statusQuery.data?.synced.ondc ?? 0) > 0,
              accessibilityLabel: 'ONDC',
            },
            {
              key: 'gem',
              mark: 'GeM',
              synced: (statusQuery.data?.synced.gem ?? 0) > 0,
              accessibilityLabel: 'Government e-Marketplace',
            },
            {
              key: 'b2b',
              mark: 'WA B2B',
              synced: (statusQuery.data?.synced.b2b ?? 0) > 0,
              accessibilityLabel: 'WhatsApp B2B',
            },
          ]}
        />
      </View>

      {/* Channel selection */}
      <View className="mt-7" style={{ gap: 10 }}>
        {(Object.keys(CHANNEL_META) as Channel[]).map((channel) => {
          const active = channels.includes(channel);
          const meta = CHANNEL_META[channel];
          return (
            <Pressable
              key={channel}
              accessibilityRole="checkbox"
              accessibilityLabel={`${meta.label}. ${meta.note}`}
              accessibilityState={{ checked: active }}
              onPress={() => toggleChannel(channel)}
              className="flex-row items-center rounded-bento p-4"
              style={{
                backgroundColor: active ? 'rgba(168, 235, 52, 0.1)' : colors.surfaceCharcoal,
                borderWidth: active ? 1.5 : 1,
                borderColor: active ? colors.electricLime : colors.borderHairline,
              }}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 7,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? colors.electricLime : 'transparent',
                  borderWidth: active ? 0 : 1.5,
                  borderColor: colors.borderHairline,
                }}
              >
                {active ? (
                  <Ionicons name="checkmark" size={15} color={colors.textInverseDark} />
                ) : null}
              </View>

              <View className="ml-3 flex-1">
                <Text
                  className="font-heading"
                  style={{ color: colors.textPureWhite, fontSize: typography.body - 1 }}
                >
                  {t(meta.nameKey)} · {meta.label}
                </Text>
                <Text
                  className="mt-0.5 font-body"
                  style={{ color: colors.textMutedSage, fontSize: typography.label - 2 }}
                >
                  {meta.note}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Product selection */}
      {products.length > 0 ? (
        <View className="mt-7">
          <View className="mb-3 flex-row items-center justify-between">
            <Text
              className="font-heading"
              style={{ color: colors.textMutedSage, fontSize: typography.label, letterSpacing: 1.2 }}
            >
              {t('market.selectItems')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                selected.length === products.length ? 'Clear selection' : 'Select all products'
              }
              onPress={() =>
                setSelected(
                  selected.length === products.length ? [] : products.map((p) => p.id),
                )
              }
            >
              <Text
                className="font-heading"
                style={{ color: colors.electricLime, fontSize: typography.label }}
              >
                {selected.length === products.length ? t('market.clear') : t('market.selectAll')}
              </Text>
            </Pressable>
          </View>

          <View style={{ gap: 8 }}>
            {products.map((product) => {
              const active = selected.includes(product.id);
              return (
                <Pressable
                  key={product.id}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${product.title_hi}, SKU ${product.sku}`}
                  accessibilityState={{ checked: active }}
                  onPress={() => toggleProduct(product.id)}
                  className="flex-row items-center rounded-bento px-4 py-3"
                  style={{
                    backgroundColor: colors.surfaceCharcoal,
                    borderWidth: 1,
                    borderColor: active ? colors.electricLime : colors.borderHairline,
                  }}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: active ? colors.electricLime : 'transparent',
                      borderWidth: active ? 0 : 1.5,
                      borderColor: colors.borderHairline,
                    }}
                  >
                    {active ? (
                      <Ionicons name="checkmark" size={13} color={colors.textInverseDark} />
                    ) : null}
                  </View>
                  <Text
                    className="ml-3 flex-1 font-body"
                    style={{ color: colors.textPureWhite, fontSize: typography.label + 1 }}
                    numberOfLines={1}
                  >
                    {product.title_hi}
                  </Text>
                  <View className="flex-row" style={{ gap: 5 }}>
                    {(['ondc', 'gem', 'b2b'] as Channel[]).map((channel) => (
                      <View
                        key={channel}
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 4,
                          backgroundColor: product.marketplace_sync_status[channel]
                            ? colors.electricLime
                            : colors.borderHairline,
                        }}
                      />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Syndicate action */}
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
            {t('market.syndicateTitle')}
          </Text>
          <Text
            className="mt-1 font-body"
            style={{ color: colors.textMutedSage, fontSize: typography.label }}
          >
            {selected.length > 0
              ? `${selected.length} items → ${channels.length} channels`
              : `All ${products.length} items → ${channels.length} channels`}
          </Text>
        </View>
        {exporting ? (
          <ActivityIndicator color={colors.electricLime} />
        ) : (
          <LimeCircleButton
            accessibilityLabel="Syndicate the selected products"
            disabled={channels.length === 0 || products.length === 0}
            onPress={() => void syndicate()}
          />
        )}
      </View>

      {exportNote ? (
        <Text
          accessibilityRole="alert"
          className="mt-4 font-body"
          style={{ color: colors.electricLime, fontSize: typography.label, lineHeight: 19 }}
        >
          {exportNote}
        </Text>
      ) : null}

      {/* Sync status timeline */}
      <View
        className="mt-7 rounded-bento p-5"
        style={{
          backgroundColor: colors.surfaceElevated,
          borderWidth: 1,
          borderColor: colors.borderHairline,
        }}
      >
        <Text
          className="mb-4 font-heading"
          style={{ color: colors.textMutedSage, fontSize: typography.label, letterSpacing: 1.2 }}
        >
          {t('market.syncStatus')}
        </Text>
        <GlowingTimeline nodes={syncNodes} compact />
      </View>

      {/* Buyer inquiry feed */}
      <View className="mt-8">
        <Text
          className="mb-4 font-heading"
          style={{ color: colors.textMutedSage, fontSize: typography.label, letterSpacing: 1.2 }}
        >
          {t('market.inquiries')}
        </Text>

        {inquiriesQuery.isLoading ? (
          <ActivityIndicator color={colors.electricLime} />
        ) : inquiries.length === 0 ? (
          <View
            className="items-center rounded-bento p-7"
            style={{
              backgroundColor: colors.surfaceCharcoal,
              borderWidth: 1,
              borderColor: colors.borderHairline,
            }}
          >
            <Ionicons name="mail-outline" size={26} color={colors.textMutedSage} />
            <Text
              className="mt-3 text-center font-body"
              style={{ color: colors.textMutedSage, fontSize: typography.label }}
            >
              {t('market.noInquiries')}
            </Text>
          </View>
        ) : (
          <View style={{ gap: spacing.cardGap }}>
            {inquiries.map((inquiry) => (
              <View
                key={inquiry.id}
                className="rounded-bento p-4"
                style={{
                  backgroundColor: colors.surfaceCharcoal,
                  borderWidth: 1,
                  borderColor: colors.borderHairline,
                }}
              >
                <View className="flex-row items-start">
                  <View className="flex-1">
                    <Text
                      className="font-heading"
                      style={{ color: colors.textPureWhite, fontSize: typography.body - 1 }}
                    >
                      {inquiry.buyer_name}
                    </Text>
                    {inquiry.buyer_company ? (
                      <Text
                        className="font-body"
                        style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}
                      >
                        {inquiry.buyer_company}
                      </Text>
                    ) : null}
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Listen to the message from ${inquiry.buyer_name}`}
                    hitSlop={10}
                    onPress={() => {
                      if (inquiry.audio_base64) void playBase64Audio(inquiry.audio_base64);
                      else void speak(inquiry.translated_text, language);
                    }}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 19,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: 'rgba(168, 235, 52, 0.14)',
                    }}
                  >
                    <Ionicons name="volume-high" size={17} color={colors.electricLime} />
                  </Pressable>
                </View>

                {/* Translation leads; the original is secondary. */}
                <Text
                  className="mt-3 font-body"
                  style={{
                    color: colors.textPureWhite,
                    fontSize: typography.body - 1,
                    lineHeight: 22,
                  }}
                >
                  {inquiry.translated_text}
                </Text>
                <Text
                  className="mt-2 font-body"
                  style={{
                    color: colors.textMutedSage,
                    fontSize: typography.label - 1,
                    lineHeight: 17,
                  }}
                >
                  {inquiry.message_text}
                </Text>

                <View className="mt-3 flex-row items-center" style={{ gap: 14 }}>
                  {inquiry.requested_quantity ? (
                    <InquiryMeta
                      label={t('market.quantity')}
                      value={`${inquiry.requested_quantity} pcs`}
                    />
                  ) : null}
                  {inquiry.offered_price_inr ? (
                    <InquiryMeta
                      label={t('market.offered')}
                      value={`₹${Number(inquiry.offered_price_inr).toLocaleString('en-IN')}`}
                    />
                  ) : null}
                  <View
                    className="px-2.5 py-1"
                    style={{
                      borderRadius: radii.pill,
                      backgroundColor: 'rgba(168, 235, 52, 0.12)',
                    }}
                  >
                    <Text
                      className="font-heading"
                      style={{ color: colors.electricLime, fontSize: typography.label - 3 }}
                    >
                      {inquiry.channel.toUpperCase()}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScreenShell>
  );
}

function InquiryMeta({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text
        className="font-body"
        style={{ color: colors.textMutedSage, fontSize: typography.label - 3 }}
      >
        {label}
      </Text>
      <Text
        className="font-heading"
        style={{ color: colors.textPureWhite, fontSize: typography.label + 1 }}
      >
        {value}
      </Text>
    </View>
  );
}
