import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, verifyAccessToken } from '../services/auth.service.js';
import { spokenFor } from '../i18n.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The authenticated artisan's id, taken from the verified token.
     *
     * This is the only source of identity in the API. Routes used to read
     * `artisan_id` from the query string or body - i.e. from the caller - which
     * meant anyone could read or change anyone's catalog by sending a
     * different UUID. Nothing should read an artisan id from user input.
     */
    artisanId: string | null;
  }
  interface FastifyInstance {
    /** Reject the request unless it carries a valid access token. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Identify the caller if a valid token is present; never reject. */
    authenticateOptional: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** The token from `Authorization: Bearer <token>`, or null. */
export function bearerToken(request: Pick<FastifyRequest, 'headers'>): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/** The artisan's language, from the header the mobile client sends on every call. */
export function requestLanguage(request: FastifyRequest): string | undefined {
  const header = request.headers['x-lang'];
  return Array.isArray(header) ? header[0] : header;
}

export default fp(async (fastify) => {
  fastify.decorateRequest('artisanId', null);

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(request);
    if (!token) {
      return reply.status(401).send({
        error: 'unauthorized',
        message: 'Missing access token',
        spoken_hi: spokenFor(requestLanguage(request))('err.unauthorized'),
      });
    }

    try {
      request.artisanId = await verifyAccessToken(token);
    } catch (error) {
      const message = error instanceof AuthError ? error.message : 'Invalid session';
      return reply.status(401).send({
        error: 'unauthorized',
        message,
        spoken_hi: spokenFor(requestLanguage(request))('err.unauthorized'),
      });
    }
  });

  fastify.decorate('authenticateOptional', async (request: FastifyRequest) => {
    const token = bearerToken(request);
    if (!token) return;
    try {
      request.artisanId = await verifyAccessToken(token);
    } catch {
      // A bad token on an optional route is treated as anonymous, not an error:
      // the onboarding screens speak and transcribe before an account exists.
    }
  });
});
