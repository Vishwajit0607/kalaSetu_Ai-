import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getInventorySummary,
  getStockTrend,
} from '../services/analytics.service.js';

export const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/analytics/summary
   *
   * Real-time inventory rollups: total active products, units in stock,
   * retail value, wholesale value, and low/out-of-stock counts.
   * Scoped to the verified artisan in the token.
   */
  fastify.get('/summary', async (request, reply) => {
    try {
      const summary = await getInventorySummary(request.artisanId as string);
      return reply.send({ summary });
    } catch (err) {
      return reply.internalServerError(
        err instanceof Error ? err.message : 'Failed to retrieve inventory summary',
      );
    }
  });

  /**
   * GET /v1/analytics/stock-trend?days=7
   *
   * Daily stock movements (additions vs orders/sales) grouped by Indian calendar day.
   */
  fastify.get<{ Querystring: unknown }>(
    '/stock-trend',
    async (request, reply) => {
      const query = z
        .object({
          days: z.coerce.number().int().min(1).max(90).default(7),
        })
        .parse(request.query);

      try {
        const trend = await getStockTrend(request.artisanId as string, query.days);
        return reply.send({
          days: query.days,
          trend,
        });
      } catch (err) {
        return reply.internalServerError(
          err instanceof Error ? err.message : 'Failed to retrieve stock trend',
        );
      }
    },
  );
};

