import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { UpstreamError } from '../services/http.js';
import { spokenFor } from '../i18n.js';

/**
 * Error envelope shared by every route.
 *
 * Each error carries `spoken_hi` - a short Hindi sentence the client feeds
 * straight to Bulbul TTS. An artisan who cannot read a stack trace still hears
 * what went wrong and what to do next.
 */
export default fp(async (fastify) => {
  /** The artisan's language rides on every request as the `X-Lang` header. */
  const spokenForRequest = (request: {
    headers?: Record<string, unknown>;
    query?: unknown;
    body?: unknown;
  }) => {
    const header = request.headers?.['x-lang'];
    return spokenFor(
      (typeof header === 'string' ? header : undefined) ??
        (request.query as { language_code?: string } | undefined)?.language_code ??
        (request.body as { language_code?: string } | undefined)?.language_code,
    );
  };

  fastify.setErrorHandler((error, request, reply) => {
    const spoken = spokenForRequest(request);
    if (error instanceof ZodError) {
      request.log.warn({ issues: error.issues }, 'request validation failed');
      return reply.status(400).send({
        error: 'validation_failed',
        message: 'Request body or query failed validation',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        spoken_hi: spoken('err.validation'),
      });
    }

    if (error instanceof UpstreamError) {
      // Log the vendor's own response body, not just the status. Without it a
      // 400 (our bug - bad params) is indistinguishable from a 503 (their
      // outage), and both get read as "slow internet" by the time the
      // artisan hears about it.
      request.log.error(
        { vendor: error.vendor, status: error.status, upstreamBody: error.body?.slice(0, 500) },
        'upstream AI vendor failed',
      );
      // A 4xx from a vendor means we sent something wrong - telling the
      // artisan their connection is slow sends them to go stand near a
      // window, which will never fix it. Only blame the network when the
      // vendor is actually unreachable or overloaded.
      const vendorFault = error.status >= 500 || error.status === 429 || error.status === 0;

      return reply.status(502).send({
        error: vendorFault ? 'upstream_unavailable' : 'upstream_rejected',
        vendor: error.vendor,
        message: error.message,
        spoken_hi: vendorFault ? spoken('err.upstreamDown') : spoken('err.upstreamRejected'),
      });
    }

    const status = error.statusCode ?? 500;
    request.log.error({ err: error }, 'unhandled request error');

    return reply.status(status).send({
      error: status >= 500 ? 'internal_error' : 'request_error',
      message: status >= 500 ? 'Something went wrong on our side' : error.message,
      spoken_hi: status >= 500 ? spoken('err.server') : spoken('err.request'),
    });
  });

  fastify.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: 'not_found',
      message: `No route for ${request.method} ${request.url}`,
      spoken_hi: spokenForRequest(request)('err.notFound'),
    }),
  );
});
