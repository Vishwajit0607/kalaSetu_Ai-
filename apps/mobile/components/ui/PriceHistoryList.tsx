import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { colors, typography } from '@/theme/tokens';
import type { StringKey, Translator } from '@/i18n';
import type { UiLanguage } from '@/i18n/strings';
import type { PriceHistoryEntry } from '@/services/apiClient';
import { formatEventTime } from '@/services/activityFormat';
import { describeChange, formatRupees, sourceLabel } from '@/services/priceHistory';

/**
 * The prices a product has had, newest first, each with how far it moved. Shows the three
 * newest and offers the rest on request, so a long history does not push the page's other
 * sections out of sight.
 */

const COLLAPSED_ROWS = 3;
const WARN = '#E4A72E';

export interface PriceHistoryListProps {
  status: 'loading' | 'error' | 'ready';
  entries: PriceHistoryEntry[];
  expanded: boolean;
  onToggle: () => void;
  t: Translator;
  language: UiLanguage;
  now?: Date;
}

function Change({ value }: { value: number | null }) {
  const label = describeChange(value);
  if (!label.text) return null;
  return (
    <Text className="font-body" style={{ color: label.kind === 'up' ? colors.electricLime : WARN, fontSize: typography.label }}>
      {' '}
      {label.text}
    </Text>
  );
}

export function PriceHistoryList({ status, entries, expanded, onToggle, t, language, now = new Date() }: PriceHistoryListProps) {
  const shown = expanded ? entries : entries.slice(0, COLLAPSED_ROWS);

  return (
    <View
      className="mt-5 rounded-bento p-5"
      style={{ backgroundColor: colors.surfaceCharcoal, borderWidth: 1, borderColor: colors.borderHairline }}
    >
      <Text className="font-heading" style={{ color: colors.textPureWhite, fontSize: typography.body }}>
        {t('priceHistory.title')}
      </Text>

      {status === 'loading' ? <ActivityIndicator style={{ marginTop: 12 }} color={colors.electricLime} /> : null}

      {status === 'error' ? (
        <Text accessibilityRole="alert" className="mt-3 font-body" style={{ color: colors.textMutedSage, fontSize: typography.label }}>
          {t('priceHistory.failed')}
        </Text>
      ) : null}

      {status === 'ready' && entries.length === 0 ? (
        <Text className="mt-3 font-body" style={{ color: colors.textMutedSage, fontSize: typography.label }}>
          {t('priceHistory.empty')}
        </Text>
      ) : null}

      {status === 'ready'
        ? shown.map((entry, index) => {
            const when = formatEventTime(entry.changed_at, now, language);
            return (
              <View
                key={entry.id}
                className="mt-3 flex-row justify-between"
                style={index > 0 ? { borderTopWidth: 1, borderTopColor: colors.borderHairline, paddingTop: 12 } : undefined}
              >
                <View>
                  <Text className="font-heading" style={{ color: colors.textPureWhite, fontSize: typography.label + 1 }}>
                    {when.relative ? t(`activity.${when.relative}` as StringKey) : when.date}
                  </Text>
                  <Text className="font-body" style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}>
                    {when.time} · {t(sourceLabel(entry.source))}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <View className="flex-row">
                    <Text className="font-body" style={{ color: colors.textPureWhite, fontSize: typography.label }}>
                      {t('priceHistory.retail')} {formatRupees(entry.retail_inr)}
                    </Text>
                    <Change value={entry.retail_change} />
                  </View>
                  <View className="flex-row">
                    <Text className="font-body" style={{ color: colors.textMutedSage, fontSize: typography.label }}>
                      {t('priceHistory.wholesale')} {formatRupees(entry.wholesale_inr)}
                    </Text>
                    <Change value={entry.wholesale_change} />
                  </View>
                </View>
              </View>
            );
          })
        : null}

      {status === 'ready' && entries.length > COLLAPSED_ROWS ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(expanded ? 'priceHistory.showLess' : 'priceHistory.showAll')}
          onPress={onToggle}
          hitSlop={8}
          style={{ marginTop: 14, minHeight: 36, justifyContent: 'center' }}
        >
          <Text className="font-heading" style={{ color: colors.electricLime, fontSize: typography.label + 1 }}>
            {t(expanded ? 'priceHistory.showLess' : 'priceHistory.showAll')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
