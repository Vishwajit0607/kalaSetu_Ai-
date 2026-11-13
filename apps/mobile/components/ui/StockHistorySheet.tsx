import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { api, type StockMovement } from '@/services/apiClient';

/**
 * A bottom-sheet-style modal showing paginated stock movements for a product.
 * Opens when the artisan long-presses a product row in the inventory tab.
 */

interface StockHistorySheetProps {
  productId: string | null;
  productTitle: string;
  onClose: () => void;
}

const PAGE_SIZE = 20;

const REASON_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  voice: 'mic-outline',
  manual: 'create-outline',
  order: 'cart-outline',
  sync: 'sync-outline',
};

const REASON_COLORS: Record<string, string> = {
  voice: '#A8EB34',
  manual: '#78C214',
  order: '#4A6B1D',
  sync: '#9BA394',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function StockHistorySheet({
  productId,
  productTitle,
  onClose,
}: StockHistorySheetProps) {
  const [offset, setOffset] = useState(0);

  const movementsQuery = useQuery({
    queryKey: ['stockMovements', productId, offset],
    queryFn: () => api.stockMovements(productId!, { limit: PAGE_SIZE, offset }),
    enabled: Boolean(productId),
  });

  const movements = movementsQuery.data?.movements ?? [];
  const total = movementsQuery.data?.total ?? 0;

  const loadMore = useCallback(() => {
    if (offset + PAGE_SIZE < total) {
      setOffset((prev) => prev + PAGE_SIZE);
    }
  }, [offset, total]);

  const renderMovement = useCallback(
    ({ item }: { item: StockMovement }) => {
      const isPositive = item.delta >= 0;
      const icon = REASON_ICONS[item.reason] ?? 'ellipsis-horizontal-outline';
      const color = REASON_COLORS[item.reason] ?? colors.textMutedSage;

      return (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 10,
            paddingHorizontal: spacing.gutter,
            borderBottomWidth: 0.5,
            borderBottomColor: colors.borderHairline,
          }}
        >
          <Ionicons name={icon} size={20} color={color} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text
              style={{
                color: colors.textPureWhite,
                fontSize: typography.body,
                fontWeight: '500',
              }}
            >
              {isPositive ? '+' : ''}
              {item.delta} → {item.resulting_quantity} units
            </Text>
            <Text
              style={{
                color: colors.textMutedSage,
                fontSize: typography.label,
                marginTop: 2,
              }}
            >
              {item.reason} • {formatDate(item.created_at)}
            </Text>
            {item.voice_transcript ? (
              <Text
                style={{
                  color: colors.textMutedSage,
                  fontSize: typography.label,
                  fontStyle: 'italic',
                  marginTop: 2,
                }}
                numberOfLines={1}
              >
                "{item.voice_transcript}"
              </Text>
            ) : null}
          </View>
          <Text
            style={{
              color: isPositive ? '#4ade80' : '#f87171',
              fontSize: typography.body,
              fontWeight: '700',
              minWidth: 44,
              textAlign: 'right',
            }}
          >
            {isPositive ? '+' : ''}
            {item.delta}
          </Text>
        </View>
      );
    },
    [],
  );

  if (!productId) return null;

  return (
    <Modal
      visible={Boolean(productId)}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* Backdrop */}
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
          onPress={onClose}
        />

        {/* Sheet */}
        <View
          style={{
            backgroundColor: colors.surfaceElevated,
            borderTopLeftRadius: radii.bento,
            borderTopRightRadius: radii.bento,
            maxHeight: '70%',
            paddingBottom: spacing.sectionGap,
          }}
        >
          {/* Handle bar */}
          <View style={{ alignItems: 'center', paddingVertical: 10 }}>
            <View
              style={{
                width: 40,
                height: 4,
                backgroundColor: colors.borderHairline,
                borderRadius: 2,
              }}
            />
          </View>

          {/* Header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: spacing.gutter,
              paddingBottom: 10,
              borderBottomWidth: 0.5,
              borderBottomColor: colors.borderHairline,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: colors.textPureWhite,
                  fontSize: typography.heading,
                  fontWeight: '700',
                }}
              >
                Stock History
              </Text>
              <Text
                style={{
                  color: colors.textMutedSage,
                  fontSize: typography.label,
                  marginTop: 2,
                }}
                numberOfLines={1}
              >
                {productTitle} • {total} movements
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.textMutedSage} />
            </Pressable>
          </View>

          {/* Movement list */}
          {movementsQuery.isLoading ? (
            <ActivityIndicator
              color={colors.electricLime}
              style={{ marginTop: spacing.sectionGap }}
            />
          ) : movements.length === 0 ? (
            <Text
              style={{
                color: colors.textMutedSage,
                textAlign: 'center',
                marginTop: spacing.sectionGap,
                fontSize: typography.body,
              }}
            >
              No stock movements yet
            </Text>
          ) : (
            <FlatList
              data={movements}
              keyExtractor={(item) => item.id}
              renderItem={renderMovement}
              onEndReached={loadMore}
              onEndReachedThreshold={0.3}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}
