import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { SplitHeading } from '@/components/ui/SplitHeading';
import { FormField } from '@/components/ui/FormField';
import { colors, radii, typography } from '@/theme/tokens';
import { api, ApiError } from '@/services/apiClient';
import { changedFields, validateProfile } from '@/services/profileForm';
import { speak } from '@/services/speech';
import { profileFromArtisan, useArtisanStore } from '@/store/useArtisanStore';
import { useT } from '@/i18n';

/**
 * Edit profile: name, craft and village. The mobile number is shown but cannot be
 * changed here - it is the artisan's login, and changing it needs a verified phone,
 * which the app does not have yet - so the screen says so instead of hiding it.
 *
 * Only fields that changed are sent, and the phone's saved copy is updated from the
 * server's reply, so every screen shows the new name straight away.
 */
export default function EditProfileScreen() {
  const router = useRouter();
  const { t, lang } = useT();
  const profile = useArtisanStore((state) => state.profile);
  const setProfile = useArtisanStore((state) => state.setProfile);

  const [fullName, setFullName] = useState(profile?.fullName ?? '');
  const [craft, setCraft] = useState(profile?.craftCategory ?? '');
  const [village, setVillage] = useState(profile?.clusterLocation ?? '');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<'fullName' | 'craftCategory' | 'clusterLocation', string>>>({});
  const [banner, setBanner] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    if (busy || !profile) return;
    setBanner(null);

    const check = validateProfile({ fullName, craftCategory: craft, clusterLocation: village });
    if (!check.ok) {
      setErrors(Object.fromEntries(Object.entries(check.errors).map(([field, key]) => [field, t(key)])));
      return;
    }
    setErrors({});

    const patch = changedFields(profile, check.values);
    if (Object.keys(patch).length === 0) {
      setBanner(t('editProfile.nothingChanged'));
      return;
    }

    setBusy(true);
    try {
      const { artisan } = await api.updateMe(patch);
      await setProfile(profileFromArtisan(artisan));
      void speak(t('editProfile.saved'), lang);
      router.back();
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.spokenHi : t('editProfile.failed');
      setBanner(message);
      void speak(message, lang);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell bottomInset={40}>
      <View className="mt-2 flex-row items-center">
        <Pressable accessibilityRole="button" accessibilityLabel={t('account.back')} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.textPureWhite} />
        </Pressable>
      </View>

      <View style={{ marginTop: 8 }}>
        <SplitHeading
          subject={t('editProfile.title.subject')}
          action={t('editProfile.title.action')}
          size="title"
          subtitle={t('editProfile.subtitle')}
        />
      </View>

      <View className="mt-6" style={{ gap: 14 }}>
        <FormField label={t('profile.field.name')} value={fullName} onChangeText={setFullName} error={errors.fullName} autoCapitalize="words" />
        <FormField label={t('profile.field.craft')} value={craft} onChangeText={setCraft} error={errors.craftCategory} />
        <FormField label={t('profile.field.village')} value={village} onChangeText={setVillage} error={errors.clusterLocation} />

        <View>
          <FormField label={t('profile.field.phone')} value={profile?.phoneNumber ?? ''} editable={false} />
          <Text className="mt-1 font-body" style={{ color: colors.textMutedSage, fontSize: typography.label - 1 }}>
            {t('editProfile.phoneFixed')}
          </Text>
        </View>
      </View>

      {banner ? (
        <Text accessibilityRole="alert" className="mt-4 font-body" style={{ color: '#E4A72E', fontSize: typography.label + 1, lineHeight: 20 }}>
          {banner}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('editProfile.save')}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => void save()}
        className="mt-7 items-center justify-center"
        style={{ minHeight: 56, borderRadius: radii.pill, backgroundColor: colors.electricLime, opacity: busy ? 0.7 : 1 }}
      >
        {busy ? (
          <ActivityIndicator color={colors.textInverseDark} />
        ) : (
          <Text className="font-heading" style={{ color: colors.textInverseDark, fontSize: typography.body }}>
            {t('editProfile.save')}
          </Text>
        )}
      </Pressable>
    </ScreenShell>
  );
}
