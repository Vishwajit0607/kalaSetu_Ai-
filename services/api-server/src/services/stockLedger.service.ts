/**
 * stockLedger.service.ts
 *
 * Implements atomic stock adjustments backed by the PostgreSQL adjust_stock function.
 * Includes a graceful fallback if migration 030 has not been applied yet.
 */

import { supabase } from './supabase.service.js';
import {
  classifyPgError,
  InsufficientStockError,
  ProductNotFoundError,
  InvalidLedgerReasonError,
} from './pgErrors.js';
import type { StockMovement, StockMovementReason } from '../types/index.js';

export interface AdjustStockParams {
  productId: string;
  artisanId: string;
  delta?: number;
  setQuantity?: number;
  reason?: StockMovementReason;
  voiceTranscript?: string | null;
}

export interface AdjustStockResult {
  productId: string;
  artisanId: string;
  previousQuantity: number;
  resultingQuantity: number;
  delta: number;
  movementId: string;
}

export interface GetMovementsOptions {
  limit?: number;
  offset?: number;
}

/**
 * Adjusts product stock atomically and records an audit row in stock_movements.
 * Never allows resulting stock to drop below zero.
 */
export async function adjustStock(params: AdjustStockParams): Promise<AdjustStockResult> {
  const {
    productId,
    artisanId,
    delta,
    setQuantity,
    reason = 'manual',
    voiceTranscript = null,
  } = params;

  if (delta === undefined && setQuantity === undefined) {
    throw new Error('Either delta or setQuantity must be provided');
  }

  const validReasons: StockMovementReason[] = ['voice', 'manual', 'order', 'sync'];
  if (!validReasons.includes(reason)) {
    throw new InvalidLedgerReasonError(reason);
  }

  try {
    // 1. Attempt using the atomic stored procedure adjust_stock
    const { data, error } = await supabase().rpc('adjust_stock', {
      p_product_id: productId,
      p_artisan_id: artisanId,
      p_delta: delta ?? null,
      p_set_quantity: setQuantity ?? null,
      p_reason: reason,
      p_voice_transcript: voiceTranscript,
    });

    if (!error && data && data.length > 0) {
      const row = data[0];
      return {
        productId: row.product_id,
        artisanId: row.artisan_id,
        previousQuantity: row.previous_quantity,
        resultingQuantity: row.resulting_quantity,
        delta: row.delta,
        movementId: row.movement_id,
      };
    }

    // If error indicates the procedure does not exist (pre-migration degradation)
    if (error && (error.code === '42883' || error.message.includes('does not exist'))) {
      return await adjustStockFallback(params);
    }

    if (error) {
      throw classifyPgError(error, productId);
    }

    throw new Error('Unexpected empty result from adjust_stock');
  } catch (err) {
    throw classifyPgError(err, productId);
  }
}

/**
 * Fallback implementation used when migration 030 has not been applied yet.
 */
async function adjustStockFallback(params: AdjustStockParams): Promise<AdjustStockResult> {
  const {
    productId,
    artisanId,
    delta,
    setQuantity,
    reason = 'manual',
    voiceTranscript = null,
  } = params;

  const { data: product, error: fetchErr } = await supabase()
    .from('products')
    .select('id, stock_quantity')
    .eq('id', productId)
    .eq('artisan_id', artisanId)
    .is('deleted_at', null)
    .maybeSingle();

  if (fetchErr) throw classifyPgError(fetchErr, productId);
  if (!product) throw new ProductNotFoundError(productId);

  const currentQty = product.stock_quantity;
  let newQty: number;
  let computedDelta: number;

  if (setQuantity !== undefined) {
    if (setQuantity < 0) {
      throw new InsufficientStockError(`Stock cannot be set to a negative value (${setQuantity})`);
    }
    newQty = setQuantity;
    computedDelta = newQty - currentQty;
  } else {
    computedDelta = delta!;
    newQty = currentQty + computedDelta;
    if (newQty < 0) {
      throw new InsufficientStockError(
        `Adjustment by ${computedDelta} would reduce stock (${currentQty}) below zero`,
      );
    }
  }

  const { error: updateErr } = await supabase()
    .from('products')
    .update({ stock_quantity: newQty, updated_at: new Date().toISOString() })
    .eq('id', productId)
    .eq('artisan_id', artisanId);

  if (updateErr) throw classifyPgError(updateErr, productId);

  const { data: movement, error: insertErr } = await supabase()
    .from('stock_movements')
    .insert({
      product_id: productId,
      artisan_id: artisanId,
      delta: computedDelta,
      resulting_quantity: newQty,
      reason,
      voice_transcript: voiceTranscript,
    })
    .select('id')
    .single();

  if (insertErr) throw classifyPgError(insertErr, productId);

  return {
    productId,
    artisanId,
    previousQuantity: currentQty,
    resultingQuantity: newQty,
    delta: computedDelta,
    movementId: movement?.id ?? 'fallback',
  };
}

/**
 * Fetches the paginated history of stock movements for a specific product.
 */
export async function getStockMovements(
  productId: string,
  artisanId: string,
  options: GetMovementsOptions = {},
): Promise<{ movements: StockMovement[]; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  // Check product existence and ownership first
  const { data: product, error: prodErr } = await supabase()
    .from('products')
    .select('id')
    .eq('id', productId)
    .eq('artisan_id', artisanId)
    .maybeSingle();

  if (prodErr) throw classifyPgError(prodErr, productId);
  if (!product) throw new ProductNotFoundError(productId);

  const { data, error, count } = await supabase()
    .from('stock_movements')
    .select('*', { count: 'exact' })
    .eq('product_id', productId)
    .eq('artisan_id', artisanId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw classifyPgError(error, productId);

  return {
    movements: (data ?? []) as StockMovement[],
    total: count ?? data?.length ?? 0,
  };
}
