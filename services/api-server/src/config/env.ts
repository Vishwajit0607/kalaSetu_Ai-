import { z } from 'zod';

/**
 * Strict environment contract. The server refuses to boot with a partial
 * AI credential set, because a half-configured pipeline fails deep inside a
 * BullMQ worker where an artisan only ever sees a spinning timeline node.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),

  PHOTOROOM_API_KEY: z.string().min(8, 'PHOTOROOM_API_KEY is required'),
  SARVAM_API_KEY: z.string().min(8, 'SARVAM_API_KEY is required'),
  GEMINI_API_KEY: z.string().min(8, 'GEMINI_API_KEY is required'),
  /**
   * Primary Gemini model. Overridable because Google retires model ids out
   * from under deployed code - `gemini-2.5-flash` now 404s for new keys with
   * "no longer available to new users". See GEMINI_MODEL_CHAIN in
   * services/gemini.service.ts for the fallback order.
   */
  GEMINI_MODEL: z.string().default('gemini-3.1-flash-lite'),

  /**
   * Optional second-opinion LLM (see services/bharatcode.service.ts).
   * Left unset, catalog generation is Gemini-only, matching the original
   * spec. Set BHARATCODE_API_KEY to add a fallback in a different vendor's
   * failure domain for when Gemini's entire model chain is down.
   */
  BHARATCODE_API_KEY: z.string().min(8).optional(),
  BHARATCODE_BASE_URL: z.string().url().default('https://bharatcode.ai/api/model/v1'),
  BHARATCODE_MODEL: z.string().default('qwen-3.8-27b'),

  /**
   * Which engine makes the studio photos. `auto` uses Photoroom and falls back
   * to the free in-process engine when Photoroom is out of credits or down;
   * `local` never calls Photoroom; `photoroom` never falls back.
   */
  STUDIO_ENGINE: z.enum(['auto', 'photoroom', 'local']).default('auto'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(16),
  SUPABASE_STORAGE_BUCKET: z.string().default('kalasetu-media'),
  /**
   * Publishable (anon) key, used for the password-grant and refresh calls so
   * they run with the least-privileged key. Optional: falls back to the secret
   * key, which also works server-side but is more power than a sign-in needs.
   */
  SUPABASE_PUBLISHABLE_KEY: z.string().min(16).optional(),


  SKILL_RATE_INR_PER_HOUR: z.coerce.number().positive().default(95),
  PACKAGING_COST_INR: z.coerce.number().nonnegative().default(45),
  WHOLESALE_MARGIN: z.coerce.number().min(0).max(5).default(0.28),
  RETAIL_MARGIN: z.coerce.number().min(0).max(5).default(0.95),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: drop the memoised env so a suite can swap credentials. */
export function resetEnvCache(): void {
  cached = null;
}

export const PHOTOROOM_EDIT_URL = 'https://image-api.photoroom.com/v2/edit';
export const SARVAM_BASE_URL = 'https://api.sarvam.ai';
