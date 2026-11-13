import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, typography } from '@/theme/tokens';
import { LanguageSwitcherPill } from '@/components/voice/LanguageSwitcherPill';
import { api, ApiError } from '@/services/apiClient';
import { speak } from '@/services/speech';
import { exportFilename, serializeExport, wasTruncated } from '@/services/dataExport';
import { useArtisanStore, type AppLanguage } from '@/store/useArtisanStore';
import { useT } from '@/i18n';

/**
 * The signed-in artisan's account: who they are, language, and the two exits
 * - log out, and permanent deletion.
 *
 * Deletion lives in the app, not behind a support email, because Google Play
 * requires an in-app path to delete an account for any app that creates them.
 * It is deliberately a two-step action (a button, then a confirmation that
 * says what is lost) because it is irreversible: it removes the login, every
 * product, and every stored photo and voice note.
 */
export function AccountCard() {
  const router = useRouter();
  const { t, lang } = useT();
  const profile = useArtisanStore((state) => state.profile);
  const voiceOn = useArtisanStore((state) => state.voiceGuidanceEnabled);
  const toggleVoice = useArtisanStore((state) => state.toggleVoiceGuidance);
  const setUiLanguage = useArtisanStore((state) => state.setUiLanguage);
  const clearAccount = useArtisanStore((state) => state.clearAccount);

  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeLanguage = (code: string): void => {
    const next = code as AppLanguage;
    // Apply immediately, then save. The server copy only matters on a fresh
    // install or another phone, so a failed save is not worth blocking on.
    void setUiLanguage(next);
    api.updateMe({ preferred_language: next }).catch(() => undefined);
  };

  /**
   * Log out. The server is told too, so a copy of this session's token stops
   * working - but that is best effort: no signal must ever stop someone logging out
   * of this phone, so a failed or slow call is ignored and the phone logs out anyway.
   */
  const signOut = async (allDevices = false): Promise<void> => {
    // Wait for the server at most 2.5 seconds: on a slow link the artisan should not
    // be left staring at a button. The request carries on in the background.
    await Promise.race([
      api.logout(allDevices).catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 2500)),
    ]);
    await clearAccount();
    // Spoken after the wipe (which stops any audio) so it is actually heard.
    void speak(t('account.signedOut'), lang);
  };

  const confirmSignOutEverywhere = (): void => {
    Alert.alert(t('account.signOutAllTitle'), t('account.signOutAllBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('account.signOutAll'), onPress: () => void signOut(true) },
    ]);
  };

  /** Everything stored about the artisan, written to a file and handed to the share sheet. */
  const downloadData = async (): Promise<void> => {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      const data = await api.exportMyData();
      const uri = `${FileSystem.cacheDirectory}${exportFilename(data.exported_at)}`;
      await FileSystem.writeAsStringAsync(uri, serializeExport(data));

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: t('account.export') });
      }
      void speak(wasTruncated(data) ? t('account.exportTruncated') : t('account.exportReady'), lang);
      // The file holds personal data; do not leave a copy in the cache.
      void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.spokenHi : t('account.exportFailed');
      setError(message);
      void speak(message, lang);
    } finally {
      setExporting(false);
    }
  };

  const confirmDelete = (): void => {
    Alert.alert(t('account.deleteTitle'), t('account.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => void performDelete(),
      },
    ]);
  };

  const performDelete = async (): Promise<void> => {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteAccount();
      await clearAccount();
      void speak(t('account.deleted'), lang);
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.spokenHi : t('account.deleteFailed');
      setError(message);
      void speak(message, lang);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View
      className="mt-8 rounded-bento p-5"
      style={{
        backgroundColor: colors.surfaceCharcoal,
        borderWidth: 1,
        borderColor: colors.borderHairline,
      }}
    >
      <Text
        className="mb-4 font-heading"
        style={{ color: colors.textMutedSage, fontSize: typography.label, letterSpacing: 1.2 }}
      >
        {t('account.title')}
      </Text>

      <Text className="font-display" style={{ color: colors.textPureWhite, fontSize: typography.heading }}>
        {profile?.fullName ?? ''}
      </Text>
      <Text className="mt-1 font-body" style={{ color: colors.textMutedSage, fontSize: typography.label + 1 }}>
        {profile?.phoneNumber ?? ''}
        {profile?.craftCategory ? ` · ${profile.craftCategory}` : ''}
      </Text>

      <View className="mt-5">
        <Text
          className="mb-2 font-heading"
          style={{ color: colors.textMutedSage, fontSize: typography.label - 1, letterSpacing: 0.8 }}
        >
          {t('auth.language')}
        </Text>
        <LanguageSwitcherPill selected={lang} onSelect={changeLanguage} />
      </View>

      <View className="mt-5 flex-row items-center justify-between">
        <Text className="font-body" style={{ color: colors.textPureWhite, fontSize: typography.body - 1 }}>
          {t('account.voiceGuidance')}
        </Text>
        <Switch
          accessibilityLabel={t('account.voiceGuidance')}
          value={voiceOn}
          onValueChange={toggleVoice}
          trackColor={{ false: colors.borderHairline, true: colors.limeGradientEnd }}
          thumbColor={voiceOn ? colors.electricLime : colors.textMutedSage}
        />
      </View>

      <View className="mt-6" style={{ gap: 2 }}>
        <AccountLink icon="create-outline" label={t('account.editProfile')} onPress={() => router.push('/account/edit-profile')} />
        <AccountLink icon="key-outline" label={t('account.changePassword')} onPress={() => router.push('/account/change-password')} />
        <AccountLink icon="shield-checkmark-outline" label={t('account.activity')} onPress={() => router.push('/account/activity')} />
        <AccountLink
          icon="download-outline"
          label={t('account.export')}
          onPress={() => void downloadData()}
          busy={exporting}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('account.signOut')}
        onPress={() => void signOut()}
        className="mt-6 items-center justify-center"
        style={{
          minHeight: 52,
          borderRadius: radii.pill,
          borderWidth: 1.5,
          borderColor: colors.electricLime,
        }}
      >
        <Text className="font-heading" style={{ color: colors.electricLime, fontSize: typography.body }}>
          {t('account.signOut')}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('account.signOutAll')}
        onPress={confirmSignOutEverywhere}
        hitSlop={8}
        className="mt-3 items-center py-2"
      >
        <Text className="font-body" style={{ color: colors.textMutedSage, fontSize: typography.label + 1 }}>
          {t('account.signOutAll')}
        </Text>
      </Pressable>

      {error ? (
        <Text
          accessibilityRole="alert"
          className="mt-4 font-body"
          style={{ color: '#E4A72E', fontSize: typography.label + 1, lineHeight: 20 }}
        >
          {error}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('account.delete')}
        onPress={confirmDelete}
        disabled={deleting}
        hitSlop={8}
        className="mt-4 items-center py-3"
      >
        {deleting ? (
          <ActivityIndicator color="#E4572E" />
        ) : (
          <Text className="font-body" style={{ color: '#E4572E', fontSize: typography.label + 1 }}>
            {t('account.delete')}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function AccountLink({
  icon,
  label,
  onPress,
  busy = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      className="flex-row items-center py-3"
      style={{ borderBottomWidth: 1, borderBottomColor: colors.borderHairline }}
    >
      <Ionicons name={icon} size={20} color={colors.electricLime} />
      <Text className="ml-3 flex-1 font-body" style={{ color: colors.textPureWhite, fontSize: typography.body - 1 }}>
        {label}
      </Text>
      {busy ? (
        <ActivityIndicator color={colors.electricLime} size="small" />
      ) : (
        <Ionicons name="chevron-forward" size={16} color={colors.textMutedSage} />
      )}
    </Pressable>
  );
}
