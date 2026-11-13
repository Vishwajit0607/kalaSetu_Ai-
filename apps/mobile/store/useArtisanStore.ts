import { create } from 'zustand';
import * as FileSystem from 'expo-file-system';
import { setSpeechMuted, stopSpeaking } from '@/services/speech';
import { queryClient } from '@/lib/queryClient';
import { useCatalogDraftStore } from '@/store/useCatalogDraftStore';
import type { ArtisanRow } from '@/services/apiClient';
import {
  loadSession,
  saveSession,
  setLanguage as setSessionLanguage,
  setSessionExpiredHandler,
  type Session,
} from '@/services/session';

/**
 * Who is signed in, and the app's language.
 *
 * Two kinds of state, stored differently on purpose:
 *  - the session (tokens) is a credential, so it lives in the platform
 *    keystore via services/session.ts;
 *  - the profile and preferences are not secret, and are a plain JSON file.
 *
 * `uiLanguage` is the one source of truth for language. `profile.preferred
 * Language` mirrors it so it survives a reinstall (it is saved server-side),
 * but screens read `uiLanguage` - it also has a value before anyone has
 * signed in, which the onboarding screens need.
 */

const PROFILE_PATH = `${FileSystem.documentDirectory}artisan-profile.json`;

export type AppLanguage = 'hi-IN' | 'en-IN';

export interface ArtisanProfile {
  serverId: string;
  phoneNumber: string;
  fullName: string;
  preferredLanguage: AppLanguage;
  craftCategory: string;
  clusterLocation: string | null;
  giTagCertified: boolean;
}

export function profileFromArtisan(row: ArtisanRow): ArtisanProfile {
  return {
    serverId: row.id,
    phoneNumber: row.phone_number,
    fullName: row.full_name,
    preferredLanguage: row.preferred_language === 'en-IN' ? 'en-IN' : 'hi-IN',
    craftCategory: row.craft_category,
    clusterLocation: row.cluster_location,
    giTagCertified: row.gi_tag_certified,
  };
}

/**
 * Everything that belongs to the person who just left.
 *
 * Several people can use one phone, so signing out has to leave nothing
 * behind: the cached inventory (otherwise the next user briefly sees the last
 * user's stock), the half-finished product draft, and any audio still playing.
 */
function wipeUserState(): void {
  void stopSpeaking();
  useCatalogDraftStore.getState().reset();
  queryClient.clear();
}

interface ArtisanState {
  profile: ArtisanProfile | null;
  session: Session | null;
  hydrated: boolean;
  uiLanguage: AppLanguage;
  /** Audio guidance on/off. Defaults on - the app is voice-first. */
  voiceGuidanceEnabled: boolean;
  /** True while the device has no usable link; drives the offline banner. */
  offline: boolean;
  pendingSyncCount: number;

  hydrate: () => Promise<void>;
  signIn: (params: { session: Session; artisan: ArtisanRow }) => Promise<void>;
  /** Clears credentials and profile. Prefer `logout()` in services/auth.ts. */
  clearAccount: () => Promise<void>;
  setProfile: (profile: ArtisanProfile) => Promise<void>;
  setUiLanguage: (language: AppLanguage) => Promise<void>;
  toggleVoiceGuidance: () => void;
  setOffline: (offline: boolean) => void;
  setPendingSyncCount: (count: number) => void;
}

interface Persisted {
  profile: ArtisanProfile | null;
  voiceGuidanceEnabled: boolean;
  uiLanguage: AppLanguage;
}

export const useArtisanStore = create<ArtisanState>((set, get) => ({
  profile: null,
  session: null,
  hydrated: false,
  uiLanguage: 'hi-IN',
  voiceGuidanceEnabled: true,
  offline: false,
  pendingSyncCount: 0,

  hydrate: async () => {
    // A dead refresh token anywhere in the app lands here, so the route guard
    // sends the user to login instead of leaving them on screens that 401.
    setSessionExpiredHandler(() => {
      wipeUserState();
      set({ session: null, profile: null });
      void persist({ profile: null, voiceGuidanceEnabled: get().voiceGuidanceEnabled, uiLanguage: get().uiLanguage });
    });

    try {
      const session = await loadSession();
      const info = await FileSystem.getInfoAsync(PROFILE_PATH);
      const saved: Partial<Persisted> = info.exists
        ? (JSON.parse(await FileSystem.readAsStringAsync(PROFILE_PATH)) as Partial<Persisted>)
        : {};

      const uiLanguage: AppLanguage = saved.uiLanguage === 'en-IN' ? 'en-IN' : 'hi-IN';
      const voice = saved.voiceGuidanceEnabled ?? true;

      setSessionLanguage(uiLanguage);
      setSpeechMuted(!voice);
      set({
        // A profile without a session is stale (signed out / token wiped):
        // drop it rather than show a half-signed-in app.
        profile: session ? (saved.profile ?? null) : null,
        session,
        uiLanguage,
        voiceGuidanceEnabled: voice,
        hydrated: true,
      });
    } catch {
      // A corrupt profile file must not brick the app - fall back to login.
      set({ profile: null, session: null, hydrated: true });
    }
  },

  signIn: async ({ session, artisan }) => {
    const profile = profileFromArtisan(artisan);
    await saveSession(session);
    setSessionLanguage(profile.preferredLanguage);
    set({ session, profile, uiLanguage: profile.preferredLanguage });
    await persist({
      profile,
      voiceGuidanceEnabled: get().voiceGuidanceEnabled,
      uiLanguage: profile.preferredLanguage,
    });
  },

  clearAccount: async () => {
    wipeUserState();
    await saveSession(null);
    set({ session: null, profile: null });
    await persist({
      profile: null,
      voiceGuidanceEnabled: get().voiceGuidanceEnabled,
      uiLanguage: get().uiLanguage,
    });
  },

  setProfile: async (profile) => {
    set({ profile });
    await persist({
      profile,
      voiceGuidanceEnabled: get().voiceGuidanceEnabled,
      uiLanguage: get().uiLanguage,
    });
  },

  setUiLanguage: async (language) => {
    setSessionLanguage(language);
    const profile = get().profile;
    const nextProfile = profile ? { ...profile, preferredLanguage: language } : null;
    set({ uiLanguage: language, profile: nextProfile });
    await persist({
      profile: nextProfile,
      voiceGuidanceEnabled: get().voiceGuidanceEnabled,
      uiLanguage: language,
    });
  },

  toggleVoiceGuidance: () => {
    const next = !get().voiceGuidanceEnabled;
    set({ voiceGuidanceEnabled: next });
    setSpeechMuted(!next);
    void persist({ profile: get().profile, voiceGuidanceEnabled: next, uiLanguage: get().uiLanguage });
  },

  setOffline: (offline) => set({ offline }),
  setPendingSyncCount: (count) => set({ pendingSyncCount: count }),
}));

async function persist(value: Persisted): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(PROFILE_PATH, JSON.stringify(value));
  } catch {
    // Preferences are a convenience; failing to save them is not worth a crash.
  }
}

/** The signed-in artisan's server id, or null. Used to partition cached queries per user. */
export function useArtisanId(): string | null {
  return useArtisanStore((state) => state.profile?.serverId ?? null);
}

/** Convenience selector - most screens only need the language code. */
export function useLanguage(): string {
  return useArtisanStore((state) => state.uiLanguage);
}
