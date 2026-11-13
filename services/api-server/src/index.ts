import Fastify from 'fastify';
import { pathToFileURL } from 'node:url';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { loadEnv } from './config/env.js';
import errorHandler from './plugins/error-handler.js';
import authPlugin from './plugins/auth.js';
import { authRoutes, meRoutes } from './routes/auth.routes.js';
import { accountRoutes } from './routes/account.routes.js';
import { visionRoutes } from './routes/vision.routes.js';
import { speechRoutes } from './routes/speech.routes.js';
import { catalogRoutes } from './routes/catalog.routes.js';
import { inventoryRoutes } from './routes/inventory.routes.js';
import { marketplaceRoutes } from './routes/marketplace.routes.js';

export async function buildServer() {
  const env = loadEnv();

  const fastify = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : env.NODE_ENV === 'test' ? 'silent' : 'debug',
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
    // Studio captures from a 48MP handset camera are large.
    bodyLimit: 25 * 1024 * 1024,
    // See TRUST_PROXY in config/env.ts: needed for a real client address behind Render.
    trustProxy: env.TRUST_PROXY,
  });

  await fastify.register(sensible);
  await fastify.register(cors, { origin: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
  await fastify.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 4 },
  });
  await fastify.register(authPlugin);
  await fastify.register(rateLimit, {
    max: 240,
    timeWindow: '1 minute',
    // Runs after the auth hooks so the key is the *verified* artisan, falling
    // back to the IP for anonymous callers. It used to read `artisan_id` out of
    // the query string or body - i.e. from the caller - so a client could dodge
    // the limit by changing one field.
    hook: 'preHandler',
    keyGenerator: (request) => request.artisanId ?? request.ip,
  });
  await fastify.register(errorHandler);

  fastify.get('/health', async () => ({
    status: 'ok',
    service: 'kalasetu-api',
    version: '1.0.0',
    uptime_seconds: Math.round(process.uptime()),
  }));

  /* Public: credentials in, session out. */
  await fastify.register(authRoutes, { prefix: '/v1/auth' });

  /*
   * Optional auth: the onboarding screens speak and transcribe before an
   * account exists, so these cannot require a token - but a signed-in caller
   * is recognised (higher rate limit, voice notes stored against them).
   */
  await fastify.register(async (scope) => {
    scope.addHook('onRequest', scope.authenticateOptional);
    await scope.register(speechRoutes, { prefix: '/v1/speech' });
  });

  /* Everything else needs a valid token. Identity comes only from it. */
  await fastify.register(async (scope) => {
    scope.addHook('onRequest', scope.authenticate);
    await scope.register(meRoutes, { prefix: '/v1/me' });
    await scope.register(accountRoutes, { prefix: '/v1/me' });
    await scope.register(visionRoutes, { prefix: '/v1/vision' });
    await scope.register(catalogRoutes, { prefix: '/v1/catalog' });
    await scope.register(inventoryRoutes, { prefix: '/v1/inventory' });
    await scope.register(marketplaceRoutes, { prefix: '/v1/marketplace' });
  });

  return fastify;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const fastify = await buildServer();

  const shutdown = async (signal: string): Promise<void> => {
    fastify.log.info({ signal }, 'shutting down');
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await fastify.listen({ port: env.PORT, host: env.HOST });
  } catch (error) {
    fastify.log.error({ err: error }, 'failed to start');
    process.exit(1);
  }
}

// Only boot when executed directly, so tests can import buildServer freely.
const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entrypoint) {
  void main();
}
