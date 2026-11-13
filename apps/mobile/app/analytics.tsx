import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { TrendBars } from '@/components/ui/TrendBars';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { api } from '@/services/apiClient';
import { useArtisanStore } from '@/store/useArtisanStore';
import { useT } from '@/i18n';

/**
 * Insights & Inventory Analytics Screen (Nikhil Telkar / Developer 3).
 *
 * Surfaces business health:
 * - Inventory value (retail vs wholesale)
 * - Daily sales/movement trend via TrendBars
 * - Low-stock alerts requiring restock
 * - Buyer inquiries count
 */

export default function AnalyticsScreen() {
  const router = useRouter();
  const profile = useArtisanStore((state) => state.profile);
  const { t, lang: language } = useT();
  const [trendDays, setTrendDays] = useState(7);

  const summaryQuery = useQuery({
    queryKey: ['analyticsSummary', profile?.serverId],
    queryFn: () => api.inventorySummary(),
    enabled: Boolean(profile?.serverId),
  });

  const trendQuery = useQuery({
    queryKey: ['stockTrend', profile?.serverId, trendDays],
    queryFn: () => api.stockTrend(trendDays),
    enabled: Boolean(profile?.serverId),
  });

  const inquiriesQuery = useQuery({
    queryKey: ['inquiries', language],
    queryFn: () => api.inquiries(language),
    enabled: Boolean(profile?.serverId),
  });

  const summary = summaryQuery.data?.summary;
  const trend = trendQuery.data?.trend ?? [];
  const inquiryCount = inquiriesQuery.data?.inquiries?.length ?? 0;

  return (
    <ScreenShell bottomInset={40}>
      {/* Top navigation */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          marginTop: 12,
          marginBottom: 16,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          hitSlop={12}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.surfaceElevated,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: colors.borderHairline,
            marginRight: 12,
          }}
        >
          <Ionicons name="arrow-back" size={20} color={colors.textPureWhite} />
        </Pressable>
        <SplitHeading
          subject="Business"
          action="Insights"
          size="title"
          subtitle="Real-time stock valuation & sales trends"
        />
      </View>

      {summaryQuery.isLoading ? (
        <ActivityIndicator
          color={colors.electricLime}
          style={{ marginTop: spacing.sectionGap }}
        />
      ) : (
        <View style={{ gap: spacing.cardGap }}>
          {/* Key Metrics Bento */}
          <View
            style={{
              flexDirection: 'row',
              gap: spacing.cardGap,
            }}
          >
            {/* Total Value */}
            <View
              style={{
                flex: 1,
                backgroundColor: colors.surfaceCharcoal,
                borderRadius: radii.card,
                borderWidth: 1,
                borderColor: colors.borderHairline,
                padding: spacing.cardGap,
              }}
            >
              <Text
                style={{
                  color: colors.textMutedSage,
                  fontSize: typography.label,
                  textTransform: 'uppercase',
                  letterSpacing: 0.8,
                }}
              >
                Retail Value
              </Text>
              <Text
                style={{
                  color: colors.electricLime,
                  fontSize: typography.title,
                  fontWeight: '700',
                  marginTop: 4,
                }}
              >
                ₹{Number(summary?.total_inventory_value_retail ?? 0).toLocaleString('en-IN')}
              </Text>
              <Text
                style={{
                  color: colors.textMutedSage,
                  fontSize: typography.label - 1,
                  marginTop: 2,
                }}
              >
                Wholesale: ₹
                {Number(summary?.total_inventory_value_wholesale ?? 0).toLocaleString('en-IN')}
              </Text>
            </View>

            {/* Total Units */}
            <View
              style={{
                flex: 1,
                backgroundColor: colors.surfaceCharcoal,
                borderRadius: radii.card,
                borderWidth: 1,
                borderColor: colors.borderHairline,
                padding: spacing.cardGap,
              }}
            >
              <Text
                style={{
                  color: colors.textMutedSage,
                  fontSize: typography.label,
                  textTransform: 'uppercase',
                  letterSpacing: 0.8,
                }}
              >
                Active Units
              </Text>
              <Text
                style={{
                  color: colors.textPureWhite,
                  fontSize: typography.title,
                  fontWeight: '700',
                  marginTop: 4,
                }}
              >
                {summary?.total_stock_units ?? 0}
              </Text>
              <Text
                style={{
                  color: colors.textMutedSage,
                  fontSize: typography.label - 1,
                  marginTop: 2,
                }}
              >
                Across {summary?.total_products ?? 0} SKUs
              </Text>
            </View>
          </View>

          {/* Quick status counters */}
          <View
            style={{
              flexDirection: 'row',
              gap: spacing.cardGap,
            }}
          >
            <View
              style={{
                flex: 1,
                backgroundColor: colors.surfaceElevated,
                borderRadius: radii.card,
                borderWidth: 1,
                borderColor:
                  (summary?.low_stock_count ?? 0) > 0 ? '#E4A72E' : colors.borderHairline,
                padding: spacing.cardGap,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <Ionicons
                name="alert-circle-outline"
                size={22}
                color={(summary?.low_stock_count ?? 0) > 0 ? '#E4A72E' : colors.textMutedSage}
              />
              <View>
                <Text
                  style={{
                    color: colors.textPureWhite,
                    fontSize: typography.body,
                    fontWeight: '600',
                  }}
                >
                  {summary?.low_stock_count ?? 0} Low Stock
                </Text>
                <Text
                  style={{
                    color: colors.textMutedSage,
                    fontSize: typography.label - 1,
                  }}
                >
                  Need restocking
                </Text>
              </View>
            </View>

            <View
              style={{
                flex: 1,
                backgroundColor: colors.surfaceElevated,
                borderRadius: radii.card,
                borderWidth: 1,
                borderColor: colors.borderHairline,
                padding: spacing.cardGap,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <Ionicons name="mail-outline" size={22} color={colors.electricLime} />
              <View>
                <Text
                  style={{
                    color: colors.textPureWhite,
                    fontSize: typography.body,
                    fontWeight: '600',
                  }}
                >
                  {inquiryCount} Inquiries
                </Text>
                <Text
                  style={{
                    color: colors.textMutedSage,
                    fontSize: typography.label - 1,
                  }}
                >
                  Buyer leads
                </Text>
              </View>
            </View>
          </View>

          {/* Trend Section */}
          <View style={{ marginTop: 8 }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 10,
              }}
            >
              <Text
                style={{
                  color: colors.textMutedSage,
                  fontSize: typography.label,
                  letterSpacing: 1.2,
                  textTransform: 'uppercase',
                }}
              >
                Movement Trends
              </Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {[7, 14, 30].map((d) => (
                  <Pressable
                    key={d}
                    onPress={() => setTrendDays(d)}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: radii.pill,
                      backgroundColor:
                        trendDays === d
                          ? 'rgba(168, 235, 52, 0.2)'
                          : colors.surfaceElevated,
                      borderWidth: 1,
                      borderColor:
                        trendDays === d ? colors.electricLime : colors.borderHairline,
                    }}
                  >
                    <Text
                      style={{
                        color: trendDays === d ? colors.electricLime : colors.textMutedSage,
                        fontSize: typography.label - 1,
                        fontWeight: trendDays === d ? '600' : '400',
                      }}
                    >
                      {d}d
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {trendQuery.isLoading ? (
              <ActivityIndicator color={colors.electricLime} style={{ marginVertical: 20 }} />
            ) : (
              <TrendBars data={trend} days={trendDays} />
            )}
          </View>
        </View>
      )}
    </ScreenShell>
  );
}
