import './setup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './helpers/fakeDb.js';
import { ME, OTHER, call, setupAuth, teardownAuth } from './helpers/authedApp.js';

vi.mock('../services/supabase.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/supabase.service.js')>();
  const { fakeSupabase } = await import('./helpers/fakeDb.js');
  return { ...original, supabase: fakeSupabase };
});

beforeAll(setupAuth);
afterAll(teardownAuth);
beforeEach(() => db.reset());

describe('Identity Isolation across Inventory & Inquiries', () => {
  const myProductId = '11111111-aaaa-bbbb-cccc-111111111111';
  const otherProductId = '99999999-aaaa-bbbb-cccc-999999999999';

  describe('Inventory Isolation', () => {
    it('GET /v1/inventory scopes queries exclusively to caller regardless of query parameters', async () => {
      db.answer({ data: [] });
      await call('GET', `/v1/inventory?artisan_id=${OTHER}`, { as: ME });

      expect(db.allOf('eq')).toContainEqual(['artisan_id', ME]);
      expect(db.allOf('eq')).not.toContainEqual(['artisan_id', OTHER]);
    });

    it('PATCH /v1/inventory/:productId/stock cannot modify stock of another artisan', async () => {
      // Mock adjustStock RPC rejecting because row is not found for ME
      db.answer({ data: null, error: { message: 'PRODUCT_NOT_FOUND' } });

      const res = await call(
        'PATCH',
        `/v1/inventory/${otherProductId}/stock`,
        { body: { delta: 5 }, as: ME },
      );

      expect(res.statusCode).toBe(404);
    });

    it('GET /v1/inventory/:productId/movements rejects access to another artisan product', async () => {
      // Product check fails because artisan_id does not match ME
      db.answer({ data: null, error: null });

      const res = await call(
        'GET',
        `/v1/inventory/${otherProductId}/movements`,
        { as: ME },
      );

      expect(res.statusCode).toBe(404);
    });
  });

  describe('Analytics Isolation', () => {
    it('GET /v1/analytics/summary binds to caller even if artisan_id is in query string', async () => {
      db.answer({
        data: {
          artisan_id: ME,
          total_products: 1,
          total_stock_units: 5,
          total_inventory_value_retail: 2500,
          total_inventory_value_wholesale: 1500,
          low_stock_count: 0,
          out_of_stock_count: 0,
        },
      });

      await call('GET', `/v1/analytics/summary?artisan_id=${OTHER}`, { as: ME });
      expect(db.allOf('eq')).toContainEqual(['artisan_id', ME]);
      expect(db.allOf('eq')).not.toContainEqual(['artisan_id', OTHER]);
    });

    it('GET /v1/analytics/stock-trend binds to caller identity', async () => {
      db.answer({ data: [] });
      await call('GET', `/v1/analytics/stock-trend?days=7&artisan_id=${OTHER}`, { as: ME });
      expect(db.allOf('eq')).toContainEqual(['artisan_id', ME]);
      expect(db.allOf('eq')).not.toContainEqual(['artisan_id', OTHER]);
    });
  });

  describe('Marketplace Inquiries Isolation', () => {
    it('GET /v1/marketplace/inquiries binds exclusively to caller identity', async () => {
      db.answer({ data: [] });
      await call('GET', `/v1/marketplace/inquiries?artisan_id=${OTHER}`, { as: ME });
      expect(db.allOf('eq')).toContainEqual(['artisan_id', ME]);
      expect(db.allOf('eq')).not.toContainEqual(['artisan_id', OTHER]);
    });

    it('POST /v1/marketplace/inquiries prevents self-inquiry on own product', async () => {
      // Product belongs to ME
      db.answer({
        data: { id: myProductId, artisan_id: ME, title_en: 'Silk Scarf', title_hi: 'रेशमी दुपट्टा' },
      });

      const res = await call(
        'POST',
        '/v1/marketplace/inquiries',
        {
          body: {
            product_id: myProductId,
            message_text: 'Interested in bulk order of this scarf',
          },
          as: ME,
        },
      );

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('cannot send inquiry to yourself');
    });

    it('PATCH /v1/marketplace/inquiries/:id denies 403 when caller is neither buyer nor seller', async () => {
      const thirdPartyId = '77777777-7777-7777-7777-777777777777';
      const inquiryId = '55555555-5555-5555-5555-555555555555';

      // Inquiry is between OTHER and thirdPartyId
      db.answer({
        data: {
          id: inquiryId,
          artisan_id: OTHER,
          buyer_artisan_id: thirdPartyId,
          status: 'new',
        },
      });

      const res = await call(
        'PATCH',
        `/v1/marketplace/inquiries/${inquiryId}`,
        {
          body: { status: 'replied' },
          as: ME, // ME has nothing to do with this inquiry
        },
      );

      expect(res.statusCode).toBe(403);
    });
  });
});
