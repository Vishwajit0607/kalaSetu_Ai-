import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adjustStock,
  getStockMovements,
} from '../services/stockLedger.service.js';
import {
  InsufficientStockError,
  ProductNotFoundError,
  InvalidLedgerReasonError,
  classifyPgError,
} from '../services/pgErrors.js';

const db = vi.hoisted(() => ({
  rpcResult: { data: null as unknown, error: null as unknown },
  tableResults: [] as Array<{ data: unknown; error: unknown; count?: number | null }>,
  calls: [] as Array<[string, unknown[]]>,
}));

vi.mock('../services/supabase.service.js', () => {
  const queryBuilder: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (value: unknown) => unknown) => {
            const next = db.tableResults.shift() ?? { data: null, error: null, count: null };
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
      rpc: (fn: string, args: unknown) => {
        db.calls.push(['rpc', [fn, args]]);
        return Promise.resolve(db.rpcResult);
      },
      from: (table: string) => {
        db.calls.push(['from', [table]]);
        return queryBuilder;
      },
    }),
  };
});

describe('Stock Ledger Service', () => {
  const productId = '11111111-1111-1111-1111-111111111111';
  const artisanId = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    db.calls = [];
    db.rpcResult = { data: null, error: null };
    db.tableResults = [];
  });

  describe('adjustStock (RPC Path)', () => {
    it('successfully calls adjust_stock stored procedure for delta adjustment', async () => {
      db.rpcResult = {
        data: [
          {
            product_id: productId,
            artisan_id: artisanId,
            previous_quantity: 10,
            resulting_quantity: 8,
            delta: -2,
            movement_id: 'mov-123',
          },
        ],
        error: null,
      };

      const result = await adjustStock({
        productId,
        artisanId,
        delta: -2,
        reason: 'order',
      });

      expect(result).toEqual({
        productId,
        artisanId,
        previousQuantity: 10,
        resultingQuantity: 8,
        delta: -2,
        movementId: 'mov-123',
      });

      expect(db.calls[0]).toEqual([
        'rpc',
        [
          'adjust_stock',
          {
            p_product_id: productId,
            p_artisan_id: artisanId,
            p_delta: -2,
            p_set_quantity: null,
            p_reason: 'order',
            p_voice_transcript: null,
          },
        ],
      ]);
    });

    it('rejects invalid reason before making database call', async () => {
      await expect(
        adjustStock({
          productId,
          artisanId,
          delta: 1,
          reason: 'invalid_reason' as any,
        }),
      ).rejects.toThrow(InvalidLedgerReasonError);

      expect(db.calls.length).toBe(0);
    });

    it('translates stored-procedure INSUFFICIENT_STOCK error to typed domain exception', async () => {
      db.rpcResult = {
        data: null,
        error: { message: 'INSUFFICIENT_STOCK: Adjustment by -20 would reduce stock below zero' },
      };

      await expect(
        adjustStock({
          productId,
          artisanId,
          delta: -20,
        }),
      ).rejects.toThrow(InsufficientStockError);
    });
  });

  describe('adjustStock (Fallback Path)', () => {
    it('falls back to manual table queries if adjust_stock RPC is not yet installed in Supabase', async () => {
      // Stored proc returns 42883 (undefined function)
      db.rpcResult = {
        data: null,
        error: { code: '42883', message: 'function adjust_stock does not exist' },
      };

      // Mock product fetch, update, insert
      db.tableResults.push(
        { data: { id: productId, stock_quantity: 5 }, error: null },
        { data: null, error: null },
        { data: { id: 'mov-fb-1' }, error: null },
      );

      const result = await adjustStock({
        productId,
        artisanId,
        delta: -3,
        reason: 'manual',
      });

      expect(result.previousQuantity).toBe(5);
      expect(result.resultingQuantity).toBe(2);
      expect(result.delta).toBe(-3);
    });

    it('fallback prevents negative stock and throws InsufficientStockError', async () => {
      db.rpcResult = {
        data: null,
        error: { code: '42883', message: 'function adjust_stock does not exist' },
      };

      db.tableResults.push({
        data: { id: productId, stock_quantity: 2 },
        error: null,
      });

      await expect(
        adjustStock({
          productId,
          artisanId,
          delta: -5,
          reason: 'manual',
        }),
      ).rejects.toThrow(InsufficientStockError);
    });

    it('throws ProductNotFoundError if product does not exist or artisan does not own it', async () => {
      db.rpcResult = {
        data: null,
        error: { code: '42883', message: 'function adjust_stock does not exist' },
      };

      db.tableResults.push({
        data: null,
        error: null,
      });

      await expect(
        adjustStock({
          productId: 'non-existent',
          artisanId,
          delta: 1,
        }),
      ).rejects.toThrow(ProductNotFoundError);
    });
  });

  describe('getStockMovements', () => {
    it('returns paged stock movements for an authorized artisan', async () => {
      const mockMovements = [
        {
          id: 'm1',
          product_id: productId,
          artisan_id: artisanId,
          delta: -1,
          resulting_quantity: 9,
          reason: 'order',
          created_at: new Date().toISOString(),
        },
      ];

      // 1st call verifies product, 2nd call returns movements list
      db.tableResults.push(
        { data: { id: productId }, error: null },
        { data: mockMovements, error: null, count: 1 },
      );

      const res = await getStockMovements(productId, artisanId, { limit: 10, offset: 0 });
      expect(res.movements).toEqual(mockMovements);
      expect(res.total).toBe(1);
    });
  });
});
