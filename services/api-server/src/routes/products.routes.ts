import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  ProductError,
  listPriceHistory,
  productPatchSchema,
  requireOwnedProduct,
  restoreProduct,
  retranslateProduct,
  softDeleteProduct,
  updateProduct,
} from '../services/product.service.js';

/**
 * `/v1/catalog/products/:id` - looking after a product that is already saved.
 *
 * (Creating one is `POST /v1/catalog/products` in catalog.routes.ts, unchanged.)
 *
 * Registered inside the authenticated scope, so `request.artisanId` is the verified
 * caller. Nothing here reads an artisan id from the request: a product that is not the
 * caller's is a plain 404, the same as one that does not exist.
 */

const idParams = z.object({ id: z.string().uuid() });

/** Every translation spends Sarvam credits, so it is limited more tightly than a plain read. */
const translateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } } as const;

/** A ProductError becomes the matching HTTP error; anything else is a real failure. */
function sendProductError(reply: FastifyReply, error: unknown) {
  if (error instanceof ProductError) {
    return error.code === 'not_found' ? reply.notFound(error.message) : reply.badRequest(error.message);
  }
  throw error;
}

export const productsRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /v1/catalog/products/:id - one of the caller's products. */
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    try {
      return reply.send({ product: await requireOwnedProduct(request.artisanId as string, id) });
    } catch (error) {
      return sendProductError(reply, error);
    }
  });

  /**
   * PATCH /v1/catalog/products/:id - change some fields.
   * Send only what changed. Stock cannot be changed here (it belongs to the inventory
   * ledger), and neither can the owner, SKU or deleted flag: the schema is strict.
   */
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const patch = productPatchSchema.parse(request.body);
    try {
      return reply.send({ product: await updateProduct(request.artisanId as string, id, patch) });
    } catch (error) {
      return sendProductError(reply, error);
    }
  });

  /**
   * DELETE /v1/catalog/products/:id - delete a product, reversibly.
   * The product is hidden everywhere but kept, so it can be brought back with
   * POST /:id/restore. Replies with what the app needs to offer an "Undo".
   */
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    try {
      const deleted = await softDeleteProduct(request.artisanId as string, id);
      return reply.send({ deleted: true, id: deleted.id, deleted_at: deleted.deleted_at, restorable: true });
    } catch (error) {
      return sendProductError(reply, error);
    }
  });

  /** POST /v1/catalog/products/:id/restore - undo a delete. */
  fastify.post<{ Params: { id: string } }>('/:id/restore', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    try {
      return reply.send({ product: await restoreProduct(request.artisanId as string, id) });
    } catch (error) {
      return sendProductError(reply, error);
    }
  });

  /**
   * GET /v1/catalog/products/:id/price-history?limit=&before=
   * The prices this product has had, newest first, with the change from the previous
   * one. `limit` 1-50 (default 20); `before` is the previous page's `next_before`.
   */
  fastify.get<{ Params: { id: string }; Querystring: unknown }>('/:id/price-history', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).default(20),
        before: z.string().datetime({ offset: true }).optional(),
      })
      .parse(request.query);
    try {
      return reply.send(await listPriceHistory(request.artisanId as string, id, query));
    } catch (error) {
      return sendProductError(reply, error);
    }
  });

  /**
   * POST /v1/catalog/products/:id/retranslate
   * Body: { from: 'en-IN' | 'hi-IN', apply?: boolean }
   *
   * Translates the title and description of the `from` language into the other one.
   * By default (apply false) it only PREVIEWS, so nothing is overwritten until the
   * artisan has seen the result; apply true saves it.
   */
  fastify.post<{ Params: { id: string } }>('/:id/retranslate', { config: translateLimit }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = z
      .object({ from: z.enum(['en-IN', 'hi-IN']), apply: z.boolean().default(false) })
      .strict()
      .parse(request.body);
    try {
      return reply.send(await retranslateProduct(request.artisanId as string, id, body));
    } catch (error) {
      return sendProductError(reply, error);
    }
  });
};
