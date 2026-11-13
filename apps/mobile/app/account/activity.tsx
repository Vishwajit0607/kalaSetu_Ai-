import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { colors, radii, typography } from '@/theme/tokens';
import { api, type AuthEvent } from '@/services/apiClient';
import { describeEvent, deviceKey, formatEventTime, recentFailures, WARN_AFTER_FAILURES } from '@/services/activityFormat';
import { useArtisanStore } from '@/store/useArtisanStore';
import { useT } from '@/i18n';

/**
 * Account activity: the security trail the server keeps (sign-ups, sign-ins, wrong
 * passwords, sign-outs, password changes), newest first.
 *
 * It exists so an artisan can answer "was that me?" - and, when wrong-password
 * attempts pile up, be told so and offered the fix, rather than finding out when
 * they are locked out. The server only ever returns the artisan's own events, with
 * the network address already masked.
 */
export default function ActivityScreen() {
  const router = useRouter();
  const { t, isEnglish } = useT();
  const serverId = useArtisanStore((state) => state.profile?.serverId);

  const query = useInfiniteQuery({
    queryKey: ['account', 'activity', serverId],
    queryFn: ({ pageParam }) => api.activity({ limit: 20, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_before ?? undefined,
    enabled: Boolean(serverId),
  });

  const events = query.data?.pages.flatMap((page) => page.events) ?? [];
  const now = new Date();
  const failures = recentFailures(events, now);

  return (
    <ScreenShell bottomInset={40}>
      <View className="mt-2 flex-row items-center">
        <Pressable accessibilityRole="button" accessibilityLabel={t('account.back')} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.textPureWhite} />
        </Pressable>
      </View>

      <View style={{ marginTop: 8 }}>
        <SplitHeading
          subject={t('activity.title.subject')}
          action={t('activity.title.action')}
          size="title"
          subtitle={t('activity.subtitle')}
        />
      </View>

      {failures >= WARN_AFTER_FAILURES ? (
        <View
          accessibilityRole="alert"
          className="mt-5 rounded-bento p-4"
          style={{ backgroundColor: 'rgba(228, 167, 46, 0.12)', borderWidth: 1, borderColor: '#E4A72E' }}
        >
          <Text className="font-body" style={{ color: colors.textPureWhite, fontSize: typography.label + 1, lineHeight: 20 }}>
            {t('activity.warn', { count: failures })}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/account/change-password')}
            className="mt-3 items-center justify-center"
            style={{ minHeight: 44, borderRadius: radii.pill, backgroundColor: '#E4A72E' }}
          >
            <Text className="font-heading" style={{ color: colors.textInverseDark, fontSize: typography.label + 1 }}>
              {t('activity.warnAction')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View className="mt-6" style={{ gap: 10 }}>
        {query.isLoading ? (
          <ActivityIndicator color={colors.electricLime} />
        ) : query.isError ? (
          <View className="items-center" style={{ gap: 12 }}>
            <Text className="font-body" style={{ color: '#E4A72E', fontSize: typography.label + 1 }}>
              {t('activity.failed')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void query.refetch()}
              style={{ paddingVertical: 10, paddingHorizontal: 20, borderRadius: radii.pill, backgroundColor: colors.electricLime }}
            >
              <Text className="font-heading" style={{ color: colors.textInverseDark, fontSize: typography.label }}>
                {t('activity.retry')}
              </Text>
            </Pressable>
          </View>
        ) : events.length === 0 ? (
          <Text className="text-center font-body" style={{ color: colors.textMutedSage, fontSize: typography.label }}>
            {t('activity.empty')}
          </Text>
        ) : (
          events.map((event) => <EventRow key={event.id} event={event} now={now} isEnglish={isEnglish} />)
        )}

        {query.hasNextPage ? (
          <Pressable
            accessibilityRole="button"
            disabled={query.isFetchingNextPage}
            onPress={() => void query.fetchNextPage()}
            className="items-center py-3"
          >
            {query.isFetchingNextPage ? (
              <ActivityIndicator color={colors.electricLime} />
            ) : (
              <Text className="font-heading" style={{ color: colors.electricLime, fontSize: typography.label }}>
                {t('activity.loadMore')}
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </ScreenShell>
  );
}

function EventRow({ event, now, isEnglish }: { event: AuthEvent; now: Date; isEnglish: boolean }) {
  const { t } = useT();
  const style = describeEvent(event.event_type);
  const when = formatEventTime(event.created_at, now, isEnglish ? 'en' : 'hi');
  const warn = style.tone === 'warn';
  const where = [t(deviceKey(event.user_agent)), event.ip].filter(Boolean).join('  ·  ');

  return (
    <View
      className="flex-row items-center rounded-bento p-3"
      style={{
        backgroundColor: colors.surfaceCharcoal,
        borderWidth: 1,
        borderColor: warn ? '#E4A72E' : colors.borderHairline,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: warn ? 'rgba(228, 167, 46, 0.18)' : 'rgba(168, 235, 52, 0.14)',
        }}
      >
        <Ionicons name={style.icon} size={18} color={warn ? '#E4A72E' : colors.electricLime} />
      </View>

      <View className="ml-3 flex-1">
        <Text className="font-heading" style={{ color: colors.textPureWhite, fontSize: typography.label + 1 }}>
          {t(style.label)}
        </Text>
        <Text className="mt-0.5 font-body" numberOfLines={1} style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}>
          {where}
        </Text>
      </View>

      <View className="items-end">
        <Text className="font-body" style={{ color: colors.textPureWhite, fontSize: typography.label - 1 }}>
          {when.relative ? t(when.relative === 'today' ? 'activity.today' : 'activity.yesterday') : when.date}
        </Text>
        <Text className="font-body" style={{ color: colors.textMutedSage, fontSize: typography.label - 2 }}>
          {when.time}
        </Text>
      </View>
    </View>
  );
}
