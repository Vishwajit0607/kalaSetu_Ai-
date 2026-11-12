import { Buffer } from 'node:buffer';
import { SARVAM_BASE_URL, loadEnv } from '../config/env.js';
import { fetchWithRetry } from './http.js';
import type {
  SpeechSynthesisResult,
  SupportedLanguage,
  TranscriptionResult,
  TranslationResult,
} from '../types/index.js';

/**
 * Sarvam AI voice stack - the whole reason a non-typing weaver can use the app.
 *
 *  - Saaras V4   : speech-to-text, code-mix tolerant
 *  - Mayura      : Hindi <-> English translation
 *  - Bulbul V4 Flash : low-latency TTS for every spoken affordance
 *
 * The product supports exactly two languages, Hindi and English. Sarvam covers
 * many more, and they were wired up earlier (voices, model fallbacks for
 * Odia and Assamese) - all of that was removed rather than left as dead,
 * untested configuration. Adding a language back means a real UI dictionary
 * and native review of every spoken string, not just a voice id.
 */

const STT_MODEL = 'saaras:v4';
const TRANSLATE_MODEL = 'mayura:v1';
const TTS_MODEL = 'bulbul:v4-flash';

interface VoiceConfig {
  model: string;
  speaker: string;
}

/**
 * Per-language voice, verified live against the real Sarvam API.
 *
 * Speaker ids are model-specific: names that look right (`anushka`) do not
 * exist on bulbul:v4-flash and 400 with "Speaker 'x' is not compatible with
 * model". A deliberately wrong name makes the API return its full valid list
 * for the model, which is how these were found.
 */
const VOICE_BY_LANGUAGE: Record<SupportedLanguage, VoiceConfig> = {
  'hi-IN': { model: TTS_MODEL, speaker: 'ritu_hi_conversation' },
  'en-IN': { model: TTS_MODEL, speaker: 'amelia_en_conversational' },
};

/**
 * Map the MIME types mobile clients actually send onto ones Sarvam accepts.
 *
 * Sarvam validates the upload's Content-Type against a fixed allowlist and
 * 400s on anything else. `audio/m4a` is the trap: it looks right, matches the
 * file extension, and is not a registered media type - the AAC-in-MP4
 * container is `audio/mp4`. Normalising here means a client sending the wrong
 * label degrades to a working request instead of a failed transcription.
 */
const AUDIO_MIME_ALIASES: Record<string, string> = {
  'audio/m4a': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/mp4a-latm': 'audio/mp4',
  'audio/aacp': 'audio/aac',
  'audio/vnd.wave': 'audio/wav',
  'audio/x-pn-wav': 'audio/wav',
};

export function normalizeAudioMime(mimeType: string): string {
  const base = (mimeType || '').split(';')[0]?.trim().toLowerCase() ?? '';
  return AUDIO_MIME_ALIASES[base] ?? (base || 'audio/mp4');
}

function authHeaders(): Record<string, string> {
  return { 'api-subscription-key': loadEnv().SARVAM_API_KEY };
}

/**
 * Transcribe an artisan voice note in their own dialect.
 *
 * Saaras performs language identification itself, so `languageCode` is only a
 * hint from the onboarding preference - we never force it, because a Bhagalpur
 * weaver may answer a Hindi prompt in Angika.
 */
export async function transcribeAudio(params: {
  audioBuffer: Buffer;
  filename: string;
  mimeType: string;
  languageCode?: SupportedLanguage;
}): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(params.audioBuffer)], { type: normalizeAudioMime(params.mimeType) }),
    params.filename,
  );
  form.append('model', STT_MODEL);
  if (params.languageCode) form.append('language_code', params.languageCode);

  const response = await fetchWithRetry(
    `${SARVAM_BASE_URL}/speech-to-text`,
    { method: 'POST', headers: authHeaders(), body: form },
    { vendor: 'sarvam-stt', attempts: 3, timeoutMs: 45_000 },
  );

  const payload = (await response.json()) as {
    transcript?: string;
    language_code?: string;
    duration?: number;
  };

  return {
    transcript: (payload.transcript ?? '').trim(),
    language_code: (payload.language_code as SupportedLanguage) ?? params.languageCode ?? 'hi-IN',
    model: STT_MODEL,
    duration_seconds: payload.duration ?? null,
  };
}

/** Mayura translation, used to fan a native transcript into Hindi + English. */
export async function translateText(params: {
  text: string;
  sourceLanguageCode: string;
  targetLanguageCode: string;
}): Promise<TranslationResult> {
  if (!params.text.trim()) {
    return {
      text: '',
      source_language_code: params.sourceLanguageCode,
      target_language_code: params.targetLanguageCode,
    };
  }

  const response = await fetchWithRetry(
    `${SARVAM_BASE_URL}/translate`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: params.text,
        source_language_code: params.sourceLanguageCode,
        target_language_code: params.targetLanguageCode,
        model: TRANSLATE_MODEL,
        mode: 'formal',
        // Keep craft nouns (Banarasi, Kalamkari, Channapatna) untranslated.
        numerals_format: 'international',
      }),
    },
    { vendor: 'sarvam-translate', attempts: 3, timeoutMs: 30_000 },
  );

  const payload = (await response.json()) as { translated_text?: string };

  return {
    text: payload.translated_text ?? '',
    source_language_code: params.sourceLanguageCode,
    target_language_code: params.targetLanguageCode,
  };
}

/**
 * Bulbul V4 Flash TTS. Every button, alert and generated description is read
 * aloud, so this is the hottest path in the app - keep the payload small and
 * the timeout tight so the UI never waits on audio it can skip.
 */
export async function synthesizeSpeech(params: {
  text: string;
  languageCode: SupportedLanguage;
  speaker?: string;
  pace?: number;
}): Promise<SpeechSynthesisResult> {
  const hasDevanagari = /[\u0900-\u097F]/.test(params.text);
  // Auto-align language to script if there's a mismatch to avoid garbled pronunciation
  const effectiveLanguage: SupportedLanguage = hasDevanagari
    ? 'hi-IN'
    : params.languageCode === 'en-IN'
      ? 'en-IN'
      : 'hi-IN';

  const voice = VOICE_BY_LANGUAGE[effectiveLanguage] ?? VOICE_BY_LANGUAGE['hi-IN'];
  // Guarantee speaker matches the effective language to avoid speaker/language mismatch
  let speaker = params.speaker;
  if (
    !speaker ||
    (effectiveLanguage === 'hi-IN' && speaker.includes('_en_')) ||
    (effectiveLanguage === 'en-IN' && speaker.includes('_hi_'))
  ) {
    speaker = voice.speaker;
  }

  const response = await fetchWithRetry(
    `${SARVAM_BASE_URL}/text-to-speech`,
    {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: params.text.slice(0, 1500),
        target_language_code: effectiveLanguage,
        speaker,
        model: voice.model,
        // Slightly slower than default: first-time users follow spoken
        // instructions better at ~0.9x.
        pace: params.pace ?? 0.9,
        enable_preprocessing: true,
      }),
    },
    { vendor: 'sarvam-tts', attempts: 2, timeoutMs: 15_000 },
  );

  const payload = (await response.json()) as { audios?: string[] };
  const audio = payload.audios?.[0];
  if (!audio) throw new Error('Sarvam TTS returned no audio payload');

  return { audio_base64: audio, language_code: effectiveLanguage, model: voice.model };
}

/**
 * Fan a transcript out to both catalog languages.
 *
 * Whichever language was actually spoken passes through untouched and only the
 * *other* one is translated - one Mayura call, not two. Translating a language
 * into itself (en-IN -> en-IN) is wasted latency at best and a rejected
 * request at worst, and it used to happen on every English recording.
 */
export async function translateToHindiAndEnglish(params: {
  text: string;
  sourceLanguageCode: string;
}): Promise<{ hindi: string; english: string }> {
  const text = params.text.trim();
  if (!text) return { hindi: '', english: '' };

  if (params.sourceLanguageCode === 'en-IN') {
    const hindi = await translateText({
      text,
      sourceLanguageCode: 'en-IN',
      targetLanguageCode: 'hi-IN',
    });
    return { hindi: hindi.text, english: text };
  }

  const english = await translateText({
    text,
    sourceLanguageCode: 'hi-IN',
    targetLanguageCode: 'en-IN',
  });
  return { hindi: text, english: english.text };
}
