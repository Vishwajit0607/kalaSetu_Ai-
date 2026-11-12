import { useSyncExternalStore } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { ApiError, api } from './apiClient';

/**
 * Spoken-UI layer (Bulbul V4 Flash).
 *
 * Phase 7 requires every screen action to be readable aloud, which means this
 * module runs constantly. Two decisions keep it cheap:
 *
 *  1. A disk cache keyed by sha-free (text + language) hash. Onboarding
 *     prompts, button labels and error lines never change, so each one is
 *     synthesised exactly once per device, then replays offline forever.
 *  2. A single reusable Audio.Sound, unloaded between plays. Stacking sounds
 *     on a budget Android leaks AudioTrack handles until playback dies.
 */

const CACHE_DIR = `${FileSystem.cacheDirectory}kalasetu-tts/`;

let currentSound: Audio.Sound | null = null;
let mutedByUser = false;
let ensuredDir = false;
let activeSessionId = 0;
let isRecordingState = false;
let isSpeakingState = false;

const speakingListeners = new Set<() => void>();

function setSpeaking(speaking: boolean): void {
  if (isSpeakingState === speaking) return;
  isSpeakingState = speaking;
  for (const listener of speakingListeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

/** Subscribe to speaking state updates (external store). */
export function subscribeSpeaking(callback: () => void): () => void {
  speakingListeners.add(callback);
  return () => {
    speakingListeners.delete(callback);
  };
}

/** React hook returning whether AI speech is actively playing sound. */
export function useIsSpeaking(): boolean {
  return useSyncExternalStore(subscribeSpeaking, isSpeaking, () => false);
}

/** Notify speech engine that microphone recording is active, immediately stopping and blocking audio. */
export function setRecordingActive(active: boolean): void {
  isRecordingState = active;
  if (active) {
    void stopSpeaking();
  }
}

export function isRecordingActive(): boolean {
  return isRecordingState;
}

export function isSpeaking(): boolean {
  return isSpeakingState;
}

/** Ensures language code aligns with text script to prevent voice/language mismatch. */
export function normalizeLanguageForText(text: string, languageCode = 'hi-IN'): string {
  const hasDevanagari = /[\u0900-\u097F]/.test(text);
  if (hasDevanagari) return 'hi-IN';
  if (languageCode === 'en-IN') return 'en-IN';
  return 'hi-IN';
}

/** Stable, filesystem-safe cache key. djb2 - collisions are harmless here. */
function cacheKey(text: string, languageCode: string): string {
  let hash = 5381;
  const input = `${languageCode}:${text}`;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return `${languageCode.replace('-', '_')}_${(hash >>> 0).toString(36)}.wav`;
}

async function ensureCacheDir(): Promise<void> {
  if (ensuredDir) return;
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
  ensuredDir = true;
}

export function setSpeechMuted(muted: boolean): void {
  mutedByUser = muted;
  if (muted) void stopSpeaking();
}

export function isSpeechMuted(): boolean {
  return mutedByUser;
}

/** Stop whatever is currently audible. Does not invalidate pending speak() calls. */
async function haltPlayback(): Promise<void> {
  setSpeaking(false);
  if (!currentSound) return;
  const soundToStop = currentSound;
  currentSound = null;
  try {
    await soundToStop.stopAsync();
  } catch {
    // Already stopped - nothing to do.
  }
  await soundToStop.unloadAsync().catch(() => undefined);
}

/**
 * Silence everything: what is playing now AND every speak() still loading.
 *
 * Bumping the session id is what cancels the in-flight ones - each speak()
 * re-checks it after every await and bails out if it no longer matches.
 */
export async function stopSpeaking(): Promise<void> {
  activeSessionId += 1;
  await haltPlayback();
}

/**
 * Speak `text` in `languageCode`.
 *
 * Never throws: audio guidance is an enhancement, and a TTS outage must not
 * block the artisan from finishing a listing. Returns false when it stayed
 * silent so a caller can fall back to a visual cue.
 */
export async function speak(
  text: string,
  languageCode = 'hi-IN',
  options: { pace?: number } = {},
): Promise<boolean> {
  if (mutedByUser || !text.trim()) return false;
  // Never play background sound while recording the user's voice
  if (isRecordingState) return false;

  // Claim the session FIRST, synchronously, before any await. This used to
  // `await stopSpeaking()` and only then take an id - so a stopSpeaking() issued
  // by the orb, a sign-out or an unmount during that await was overtaken by the
  // id taken just after it, and the sentence played anyway, over whatever had
  // just started (usually the microphone).
  const thisSessionId = ++activeSessionId;
  await haltPlayback();

  try {
    await ensureCacheDir();
    if (thisSessionId !== activeSessionId || isRecordingState) return false;

    const effectiveLanguage = normalizeLanguageForText(text, languageCode);
    const path = `${CACHE_DIR}${cacheKey(text, effectiveLanguage)}`;
    const cached = await FileSystem.getInfoAsync(path);

    if (thisSessionId !== activeSessionId || isRecordingState) return false;

    if (!cached.exists) {
      const result = await api.speak({
        text,
        language_code: effectiveLanguage,
        ...(options.pace ? { pace: options.pace } : {}),
      });

      if (thisSessionId !== activeSessionId || isRecordingState) return false;

      await FileSystem.writeAsStringAsync(path, result.audio_base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }

    if (thisSessionId !== activeSessionId || isRecordingState) return false;

    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });

    if (thisSessionId !== activeSessionId || isRecordingState) return false;

    // A newer line may have started playing while this one loaded.
    await haltPlayback();
    if (thisSessionId !== activeSessionId || isRecordingState) return false;

    // Created PAUSED. `shouldPlay: true` starts audio inside createAsync, before
    // we can check whether this line is still wanted, so a sentence that had
    // already been replaced leaked an audible blip over the new one.
    const { sound } = await Audio.Sound.createAsync({ uri: path }, { shouldPlay: false });

    if (thisSessionId !== activeSessionId || isRecordingState) {
      await sound.unloadAsync().catch(() => undefined);
      return false;
    }

    currentSound = sound;
    sound.setOnPlaybackStatusUpdate((status) => {
      if ('didJustFinish' in status && status.didJustFinish) {
        void sound.unloadAsync().catch(() => undefined);
        if (currentSound === sound) {
          currentSound = null;
          setSpeaking(false);
        }
      }
    });

    await sound.playAsync();

    // Cancelled during playAsync itself.
    if (thisSessionId !== activeSessionId || isRecordingState) {
      if (currentSound === sound) currentSound = null;
      await sound.stopAsync().catch(() => undefined);
      await sound.unloadAsync().catch(() => undefined);
      return false;
    }
    setSpeaking(true);

    return true;
  } catch (error) {
    setSpeaking(false);
    // Offline is the expected case here, not an exception worth surfacing.
    if (!(error instanceof ApiError)) {
      console.warn('[speech] playback failed', error);
    }
    return false;
  }
}

/** Play a base64 WAV the server already returned (inquiry readouts, alerts). */
export async function playBase64Audio(base64: string): Promise<void> {
  if (mutedByUser || !base64 || isRecordingState) return;

  // Same rule as speak(): claim the session synchronously, then halt.
  const thisSessionId = ++activeSessionId;
  await haltPlayback();
  await ensureCacheDir();

  const path = `${CACHE_DIR}inline_${Date.now()}.wav`;
  const stale = () => thisSessionId !== activeSessionId || isRecordingState;
  const cleanup = () => void FileSystem.deleteAsync(path, { idempotent: true });

  try {
    await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
    if (stale()) return cleanup();

    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
    if (stale()) return cleanup();

    await haltPlayback();
    const { sound } = await Audio.Sound.createAsync({ uri: path }, { shouldPlay: false });
    if (stale()) {
      await sound.unloadAsync().catch(() => undefined);
      return cleanup();
    }

    currentSound = sound;
    sound.setOnPlaybackStatusUpdate((status) => {
      if ('didJustFinish' in status && status.didJustFinish) {
        void sound.unloadAsync().catch(() => undefined);
        cleanup();
        if (currentSound === sound) {
          currentSound = null;
          setSpeaking(false);
        }
      }
    });

    await sound.playAsync();
    if (stale()) {
      if (currentSound === sound) currentSound = null;
      await sound.stopAsync().catch(() => undefined);
      await sound.unloadAsync().catch(() => undefined);
      return cleanup();
    }
    setSpeaking(true);
  } catch {
    // Audio is an enhancement; a playback failure must never surface as an error.
    setSpeaking(false);
    cleanup();
  }
}

/** Pre-warm the cache for a screen's prompts so the first tap is instant. */
export async function prefetchSpeech(
  lines: string[],
  languageCode: string,
): Promise<void> {
  await ensureCacheDir();
  for (const line of lines) {
    const path = `${CACHE_DIR}${cacheKey(line, languageCode)}`;
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) continue;
    try {
      const result = await api.speak({ text: line, language_code: languageCode });
      await FileSystem.writeAsStringAsync(path, result.audio_base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch {
      // Prefetch is best-effort; the live call will retry.
      return;
    }
  }
}
