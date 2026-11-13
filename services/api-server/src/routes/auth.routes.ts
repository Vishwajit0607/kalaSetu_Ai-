import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  AuthError,
  deleteAccount,
  getArtisan,
  refreshSession,
  signIn,
  signUp,
} from '../services/auth.service.js';
import { supabase } from '../services/supabase.service.js';
import { eventContext, noteFailedLogin, recordAuthEvent } from '../services/audit.service.js';
import { requestLanguage } from '../plugins/auth.js';
import { spokenFor, type SpokenKey } from '../i18n.js';

/**
 * Public account endpoints: sign up, log in, refresh.
 *
 * These are the only routes that take credentials, so they get a much tighter
 * rate limit than the rest of the API - 10 attempts a minute per client is
 * plenty for a person typing a password and far too few for guessing one.
 */

const credentialLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } } as const;

const languageSchema = z.enum(['hi-IN', 'en-IN']);

const signupSchema = z.object({
  phone: z.string().min(10).max(20),
  password: z.string().min(6).max(72),
  full_name: z.string().trim().min(1).max(120),
  craft_category: z.string().trim().min(1).max(80),
  cluster_location: z.string().trim().max(120).nullable().optional(),
  preferred_language: languageSchema.default('hi-IN'),
});

const loginSchema = z.object({
  phone: z.string().min(1).max(20),
  password: z.string().min(1).max(72),
});

const AUTH_SPOKEN: Record<AuthError['code'], SpokenKey> = {
  invalid_credentials: 'auth.invalidCredentials',
  phone_taken: 'auth.phoneTaken',
  invalid_phone: 'auth.invalidPhone',
  weak_password: 'auth.weakPassword',
  invalid_token: 'auth.sessionExpired',
  upstream: 'err.upstreamDown',
};

/** Turn an AuthError into the same envelope every other error uses. */
function sendAuthError(
  request: Parameters<typeof requestLanguage>[0],
  reply: FastifyReply,
  error: AuthError,
) {
  return reply.status(error.status).send({
    error: error.code,
    message: error.message,
    spoken_hi: spokenFor(requestLanguage(request))(AUTH_SPOKEN[error.code]),
  });
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/signup', { config: credentialLimit }, async (request, reply) => {
    const body = signupSchema.parse(request.body);
    try {
      const result = await signUp({
        phone: body.phone,
        password: body.password,
        fullName: body.full_name,
        craftCategory: body.craft_category,
        clusterLocation: body.cluster_location ?? null,
        preferredLanguage: body.preferred_language,
      });
      // Not awaited: the audit trail must never slow down or break the signup.
      void recordAuthEvent(result.artisan.id, 'signup', eventContext(request));
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof AuthError) return sendAuthError(request, reply, error);
      throw error;
    }
  });

  fastify.post('/login', { config: credentialLimit }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    try {
      const result = await signIn(body);
      void recordAuthEvent(result.artisan.id, 'login', eventContext(request));
      return reply.send(result);
    } catch (error) {
      if (error instanceof AuthError) {
        // Not awaited, on purpose: see noteFailedLogin.
        if (error.code === 'invalid_credentials') void noteFailedLogin(body.phone, eventContext(request));
        return sendAuthError(request, reply, error);
      }
      throw error;
    }
  });

  fastify.post('/refresh', { config: credentialLimit }, async (request, reply) => {
    const body = z.object({ refresh_token: z.string().min(10) }).parse(request.body);
    try {
      return reply.send({ session: await refreshSession(body.refresh_token) });
    } catch (error) {
      if (error instanceof AuthError) return sendAuthError(request, reply, error);
      throw error;
    }
  });
};

/**
 * `/v1/me` - the signed-in artisan's own profile.
 * Registered inside the authenticated scope, so `request.artisanId` is set.
 */
export const meRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    const artisan = await getArtisan(request.artisanId as string);
    if (!artisan) return reply.notFound('account not found');
    return reply.send({ artisan });
  });

  fastify.patch('/', async (request, reply) => {
    const body = z
      .object({
        full_name: z.string().trim().min(1).max(120).optional(),
        craft_category: z.string().trim().min(1).max(80).optional(),
        cluster_location: z.string().trim().max(120).nullable().optional(),
        preferred_language: languageSchema.optional(),
      })
      .parse(request.body);

    const { data, error } = await supabase()
      .from('artisans')
      .update(body)
      .eq('id', request.artisanId as string)
      .select()
      .single();

    if (error || !data) return reply.notFound('account not found');
    return reply.send({ artisan: data });
  });

  /**
   * Permanent deletion. Required in-app by Google Play for any app that lets
   * people create accounts. Irreversible: removes the login, the profile, every
   * product and every stored photo and voice note.
   */
  fastify.delete('/', async (request, reply) => {
    try {
      await deleteAccount(request.artisanId as string);
    } catch (error) {
      if (error instanceof AuthError) return sendAuthError(request, reply, error);
      throw error;
    }
    return reply.code(204).send();
  });
};
