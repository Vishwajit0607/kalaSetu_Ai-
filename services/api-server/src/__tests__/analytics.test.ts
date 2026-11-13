import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getInventorySummary,
  getStockTrend,
} from '../services/analytics.service.js';

const db = vi.hoisted(() => ({
  results: [] as Array<{ data: unknown; error: unknown }>,
  calls: [] as Array<[string, unknown[]]>,
}));

vi.mock('../services/supabase.service.js', () => {
  const queryBuilder: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (value: unknown) => unknown) => {
            const next = db.results.shift() ?? { data: null, error: null };
            return Promise.resolve(next).then(resolve);
          };
        }
        return (...args: unknown[]) => {
          db.calls.push([String(prop), args]);
          return queryBuilder;
        };
      },
    },
  );

  return {
    supabase: () => ({
      from: (table: string) => {
        db.calls.push(['from', [table]]);
        return queryBuilder;
      },
    }),
  };
});

describe('Analytics Service', () => {
  const artisanId = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
    db.calls = [];
    db.results = [];
  });

  describe('getInventorySummary', () => {
    it('uses PostgreSQL view v_artisan_inventory_summary when available', async () => {
      db.results.push({
        data: {
          artisan_id: artisanId,
          total_products: '5',
          total_stock_units: '25',
          total_inventory_value_retail: '15000.00',
          total_inventory_value_wholesale: '9500.00',
          low_stock_count: '2',
          out_of_stock_count: '0',
        },
        error: null,
      });

      const summary = await getInventorySummary(artisanId);
      expect(summary.total_products).toBe(5);
      expect(summary.total_stock_units).toBe(25);
      expect(summary.total_inventory_value_retail).toBe(15000);
      expect(db.calls[0]).toEqual(['from', ['v_artisan_inventory_summary']]);
    });

    it('falls back to products table calculation when view does not exist', async () => {
      // 1st call for view returns 42P01
      // 2nd call queries products
      db.results.push(
        { data: null, error: { code: '42P01', message: 'relation does not exist' } },
        {
          data: [
            { id: 'p1', stock_quantity: 10, recommended_retail_inr: 500, recommended_wholesale_inr: 300 },
            { id: 'p2', stock_quantity: 2, recommended_retail_inr: 1000, recommended_wholesale_inr: 600 },
            { id: 'p3', stock_quantity: 0, recommended_retail_inr: 800, recommended_wholesale_inr: 450 },
          ],
          error: null,
        },
      );

      const summary = await getInventorySummary(artisanId);
      expect(summary.total_products).toBe(3);
      expect(summary.total_stock_units).toBe(12);
      expect(summary.total_inventory_value_retail).toBe(10 * 500 + 2 * 1000);
      expect(summary.low_stock_count).toBe(2); // p2 (2) and p3 (0)
      expect(summary.out_of_stock_count).toBe(1); // p3 (0)
    });
  });

  describe('getStockTrend', () => {
    it('uses v_daily_stock_movements view when available', async () => {
      db.results.push({
        data: [
          {
            artisan_id: artisanId,
            movement_date: '2026-11-12',
            reason: 'order',
            movement_count: '3',
            total_delta: '-5',
            units_added: '0',
            units_sold_or_removed: '5',
          },
        ],
        error: null,
      });

      const trend = await getStockTrend(artisanId, 7);
      expect(trend.length).toBe(1);
      expect(trend[0]!.movement_date).toBe('2026-11-12');
      expect(trend[0]!.units_sold_or_removed).toBe(5);
      expect(db.calls[0]).toEqual(['from', ['v_daily_stock_movements']]);
    });

    it('falls back to aggregating stock_movements table when view is not present', async () => {
      db.results.push(
        { data: null, error: { code: '42P01', message: 'view missing' } },
        {
          data: [
            {
              id: 'm1',
              artisan_id: artisanId,
              delta: 10,
              reason: 'manual',
              created_at: '2026-11-12T10:00:00.000Z',
            },
            {
              id: 'm2',
              artisan_id: artisanId,
              delta: -3,
              reason: 'voice',
              created_at: '2026-11-12T12:00:00.000Z',
            },
          ],
          error: null,
        },
      );

      const trend = await getStockTrend(artisanId, 7);
      expect(trend.length).toBe(2); // 1 manual, 1 voice on that date
      const voiceEntry = trend.find((t) => t.reason === 'voice');
      expect(voiceEntry?.units_sold_or_removed).toBe(3);
    });
  });
});

