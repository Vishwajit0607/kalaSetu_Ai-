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

describe('Analytics Routes', () => {
  describe('GET /v1/analytics/summary', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await call('GET', '/v1/analytics/summary', { as: null });
      expect(res.statusCode).toBe(401);
    });

    it('returns inventory summary for the verified artisan', async () => {
      db.answer({
        data: {
          artisan_id: ME,
          total_products: 4,
          total_stock_units: 18,
          total_inventory_value_retail: 12000,
          total_inventory_value_wholesale: 7500,
          low_stock_count: 1,
          out_of_stock_count: 0,
        },
      });

      const res = await call('GET', '/v1/analytics/summary', { as: ME });
      expect(res.statusCode).toBe(200);
      expect(res.json().summary).toEqual({
        artisan_id: ME,
        total_products: 4,
        total_stock_units: 18,
        total_inventory_value_retail: 12000,
        total_inventory_value_wholesale: 7500,
        low_stock_count: 1,
        out_of_stock_count: 0,
      });

      // Verify DB query was scoped to ME
      expect(db.allOf('eq')).toContainEqual(['artisan_id', ME]);
    });
  });

  describe('GET /v1/analytics/stock-trend', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await call('GET', '/v1/analytics/stock-trend', { as: null });
      expect(res.statusCode).toBe(401);
    });

    it('returns stock trend for the specified number of days', async () => {
      db.answer({
        data: [
          {
            artisan_id: ME,
            movement_date: '2026-11-12',
            reason: 'order',
            movement_count: 2,
            total_delta: -4,
            units_added: 0,
            units_sold_or_removed: 4,
          },
        ],
      });

      const res = await call('GET', '/v1/analytics/stock-trend?days=14', { as: ME });
      expect(res.statusCode).toBe(200);
      expect(res.json().days).toBe(14);
      expect(res.json().trend).toHaveLength(1);
      expect(res.json().trend[0].units_sold_or_removed).toBe(4);
      expect(db.allOf('eq')).toContainEqual(['artisan_id', ME]);
    });
  });
});

