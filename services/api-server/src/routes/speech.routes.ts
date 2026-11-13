import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  normalizeAudioMime,
  synthesizeSpeech,
  transcribeAudio,
  translateText,
  translateToHindiAndEnglish,
} from '../services/sarvam.service.js';
import { uploadMedia } from '../services/supabase.service.js';
import type { SupportedLanguage } from '../types/index.js';

/** Sarvam STT / TTS / Translate proxy. */

const languageSchema = z.enum(['hi-IN', 'en-IN']);

/**
 * These routes are reachable before an account exists - the onboarding screens
 * speak a greeting and transcribe the artisan's name before they have signed
 * up - and every call spends Sarvam credits. So anonymous callers get a hard
 * per-IP ceiling, while signed-in artisans keep the normal limit.
 */
const speechLimit = {
  rateLimit: {
    max: (request: { artisanId: string | null }) => (request.artisanId ? 240 : 40),
    timeWindow: '1 minute',
  },
} as const;

export const speechRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/languages', async () => ({
    languages: [
      { code: 'hi-IN', native: 'हिन्दी', english: 'Hindi' },
      { code: 'en-IN', native: 'English', english: 'English' },
    ],
  }));

  /**
   * POST /v1/speech/transcribe (multipart: file) - Saaras V4
   *
   * With `?store=true` and a signed-in caller, the recording is also kept and
   * its URL returned as `voice_note_url`, so the product can carry the
   * artisan's own voice description. Storing is best-effort: a storage hiccup
   * must never cost the artisan the transcription they just waited for.
   */
  fastify.post('/transcribe', { config: speechLimit }, async (request, reply) => {
    const query = z
      .object({
        language_code: languageSchema.optional(),
        store: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
      })
      .parse(request.query);

    const file = await request.file({ limits: { fileSize: 25 * 1024 * 1024 } });
    if (!file) return reply.badRequest('multipart field "file" is required');

    const buffer = await file.toBuffer();
    const mimeType = normalizeAudioMime(file.mimetype || 'audio/wav');
    const artisanId = request.artisanId;

    const [result, voiceNoteUrl] = await Promise.all([
      transcribeAudio({
        audioBuffer: buffer,
        filename: file.filename || 'voice.m4a',
        mimeType,
        ...(query.language_code ? { languageCode: query.language_code } : {}),
      }),
      query.store && artisanId
        ? uploadMedia({
            artisanId,
            kind: 'voice',
            buffer,
            contentType: mimeType,
            extension: mimeType.includes('wav') ? 'wav' : 'm4a',
          })
            .then((stored) => stored.publicUrl)
            .catch((err: unknown) => {
              request.log.warn({ err }, 'could not store the voice note');
              return null;
            })
        : Promise.resolve<string | null>(null),
    ]);

    return reply.send({ ...result, voice_note_url: voiceNoteUrl });
  });

  /** POST /v1/speech/translate - Mayura */
  fastify.post('/translate', { config: speechLimit }, async (request, reply) => {
    const body = z
      .object({
        text: z.string().min(1).max(4000),
        source_language_code: z.string().default('auto'),
        target_language_code: z.string(),
      })
      .parse(request.body);

    const result = await translateText({
      text: body.text,
      sourceLanguageCode: body.source_language_code,
      targetLanguageCode: body.target_language_code,
    });

    return reply.send(result);
  });

  /** POST /v1/speech/bilingual - one call, Hindi + English (timeline node 2) */
  fastify.post('/bilingual', { config: speechLimit }, async (request, reply) => {
    const body = z
      .object({
        text: z.string().min(1).max(4000),
        source_language_code: languageSchema.default('hi-IN'),
      })
      .parse(request.body);

    const result = await translateToHindiAndEnglish({
      text: body.text,
      sourceLanguageCode: body.source_language_code,
    });

    return reply.send(result);
  });

  /**
   * POST /v1/speech/speak - Bulbul V4 Flash.
   *
   * Called for every spoken affordance, so it is cached aggressively on the
   * client by (text, language) hash - the onboarding prompts never change.
   */
  fastify.post('/speak', { config: speechLimit }, async (request, reply) => {
    const body = z
      .object({
        text: z.string().min(1).max(1500),
        language_code: languageSchema.default('hi-IN'),
        speaker: z.string().optional(),
        pace: z.number().min(0.5).max(2).optional(),
      })
      .parse(request.body);

    const result = await synthesizeSpeech({
      text: body.text,
      languageCode: body.language_code as SupportedLanguage,
      ...(body.speaker ? { speaker: body.speaker } : {}),
      ...(body.pace ? { pace: body.pace } : {}),
    });

    return reply.header('Cache-Control', 'public, max-age=604800').send(result);
  });
};
