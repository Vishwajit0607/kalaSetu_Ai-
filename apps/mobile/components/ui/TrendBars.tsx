import { Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { DailyStockMovementTrend } from '@/services/apiClient';

interface TrendBarsProps {
  data: DailyStockMovementTrend[];
  days?: number;
}

export function TrendBars({ data, days = 7 }: TrendBarsProps) {
  if (!data || data.length === 0) {
    return (
      <View
        style={{
          padding: spacing.gutter,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surfaceElevated,
          borderRadius: radii.card,
          borderWidth: 1,
          borderColor: colors.borderHairline,
        }}
      >
        <Text style={{ color: colors.textMutedSage, fontSize: typography.label }}>
          No movement data for the selected period
        </Text>
      </View>
    );
  }

  // Aggregate by day (in case there are multiple entries for different reasons on the same date)
  const byDay = new Map<string, { date: string; sold: number; added: number }>();
  for (const item of data) {
    const existing = byDay.get(item.movement_date) ?? {
      date: item.movement_date,
      sold: 0,
      added: 0,
    };
    existing.sold += item.units_sold_or_removed;
    existing.added += item.units_added;
    byDay.set(item.movement_date, existing);
  }

  const entries = Array.from(byDay.values()).slice(-days);
  const maxUnits = Math.max(1, ...entries.map((e) => Math.max(e.sold, e.added)));

  return (
    <View
      style={{
        backgroundColor: colors.surfaceCharcoal,
        borderRadius: radii.card,
        borderWidth: 1,
        borderColor: colors.borderHairline,
        padding: spacing.gutter,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Text
          style={{
            color: colors.textPureWhite,
            fontSize: typography.body,
            fontWeight: '600',
          }}
        >
          Daily Activity
        </Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: colors.electricLime,
              }}
            />
            <Text style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}>
              Added
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: '#f87171',
              }}
            />
            <Text style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}>
              Sold
            </Text>
          </View>
        </View>
      </View>

      {/* Chart container */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          height: 120,
          paddingTop: 10,
        }}
      >
        {entries.map((entry) => {
          const addedHeight = Math.max(4, (entry.added / maxUnits) * 90);
          const soldHeight = Math.max(4, (entry.sold / maxUnits) * 90);
          const dayLabel = entry.date.slice(8); // 'DD'

          return (
            <View
              key={entry.date}
              style={{
                alignItems: 'center',
                flex: 1,
                justifyContent: 'flex-end',
              }}
            >
              <View style={{ flexDirection: 'row', gap: 3, alignItems: 'flex-end', height: 90 }}>
                {/* Units added bar */}
                <View
                  style={{
                    width: 8,
                    height: entry.added > 0 ? addedHeight : 2,
                    backgroundColor: entry.added > 0 ? colors.electricLime : colors.borderHairline,
                    borderRadius: 4,
                  }}
                />
                {/* Units sold bar */}
                <View
                  style={{
                    width: 8,
                    height: entry.sold > 0 ? soldHeight : 2,
                    backgroundColor: entry.sold > 0 ? '#f87171' : colors.borderHairline,
                    borderRadius: 4,
                  }}
                />
              </View>
              <Text
                style={{
                  color: colors.textMutedSage,
                  fontSize: 10,
                  marginTop: 6,
                }}
              >
                {dayLabel}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
