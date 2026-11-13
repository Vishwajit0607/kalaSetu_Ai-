import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AuthError, changePassword } from '../services/auth.service.js';
import { eventContext, listAuthEvents, recordAuthEvent } from '../services/audit.service.js';
import { bearerToken, requestLanguage } from '../plugins/auth.js';
import { spokenFor } from '../i18n.js';
import { sendAuthError } from './auth.routes.js';

/**
 * `/v1/me/*` account actions beyond the profile itself: change password, the
 * activity trail, and the data export.
 *
 * Registered inside the authenticated scope, so `request.artisanId` is the
 * verified caller. Nothing here reads an artisan id from the request.
 */

/** Guessing a current password is the one thing this endpoint must not allow. */
const passwordLimit = { rateLimit: { max: 5, timeWindow: '1 minute' } } as const;

export const accountRoutes: FastifyPluginAsync = async (fastify) => {
  /** POST /v1/me/password - change the signed-in artisan's password. */
  fastify.post('/password', { config: passwordLimit }, async (request, reply) => {
    const body = z
      .object({
        current_password: z.string().min(1).max(72),
        new_password: z.string().min(1).max(72),
      })
      .parse(request.body);

    try {
      await changePassword({
        artisanId: request.artisanId as string,
        currentPassword: body.current_password,
        newPassword: body.new_password,
        accessToken: bearerToken(request) as string,
      });
    } catch (error) {
      if (error instanceof AuthError) return sendAuthError(request, reply, error);
      throw error;
    }

    void recordAuthEvent(request.artisanId as string, 'password_changed', eventContext(request));
    return reply.send({
      changed: true,
      spoken_hi: spokenFor(requestLanguage(request))('auth.passwordChanged'),
    });
  });

  /**
   * GET /v1/me/activity - the artisan's own security trail, newest first.
   * Paged with `before` (the previous page's `next_before`).
   */
  fastify.get<{ Querystring: unknown }>('/activity', async (request, reply) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).default(20),
        before: z.string().datetime({ offset: true }).optional(),
      })
      .parse(request.query);

    return reply.send(await listAuthEvents(request.artisanId as string, query));
  });
};
