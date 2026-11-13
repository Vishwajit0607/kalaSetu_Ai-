/**
 * analytics.service.ts
 *
 * Provides inventory rollups and daily sales/movement trends.
 * Implements a view-first strategy (v_artisan_inventory_summary, v_daily_stock_movements)
 * with graceful in-memory fallbacks if migrations have not yet been applied.
 */

import { supabase } from './supabase.service.js';
import type {
  InventoryAnalyticsSummary,
  DailyStockMovementTrend,
  Product,
  StockMovement,
} from '../types/index.js';

const LOW_STOCK_THRESHOLD = 3;

/**
 * Returns inventory health metrics for the authenticated artisan.
 */
export async function getInventorySummary(artisanId: string): Promise<InventoryAnalyticsSummary> {
  // 1. View-first: Try reading from v_artisan_inventory_summary
  const { data, error } = await supabase()
    .from('v_artisan_inventory_summary')
    .select('*')
    .eq('artisan_id', artisanId)
    .maybeSingle();

  if (!error && data) {
    return {
      artisan_id: artisanId,
      total_products: Number(data.total_products),
      total_stock_units: Number(data.total_stock_units),
      total_inventory_value_retail: Number(data.total_inventory_value_retail),
      total_inventory_value_wholesale: Number(data.total_inventory_value_wholesale),
      low_stock_count: Number(data.low_stock_count),
      out_of_stock_count: Number(data.out_of_stock_count),
    };
  }

  // If view is missing (code 42P01) or returns no row (artisan has 0 products), fallback
  if (error && (error.code === '42P01' || error.message.includes('does not exist'))) {
    return await getInventorySummaryFallback(artisanId);
  }

  // If artisan has products table rows but no view row yet, also run fallback calculation
  return await getInventorySummaryFallback(artisanId);
}

/**
 * Fallback computation for inventory summary directly from products table.
 */
async function getInventorySummaryFallback(artisanId: string): Promise<InventoryAnalyticsSummary> {
  const { data, error } = await supabase()
    .from('products')
    .select('id, stock_quantity, recommended_retail_inr, recommended_wholesale_inr')
    .eq('artisan_id', artisanId)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to fetch inventory summary: ${error.message}`);
  }

  const products = (data ?? []) as Product[];

  let totalStockUnits = 0;
  let totalValueRetail = 0;
  let totalValueWholesale = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;

  for (const p of products) {
    const qty = Number(p.stock_quantity);
    const retail = Number(p.recommended_retail_inr);
    const wholesale = Number(p.recommended_wholesale_inr);

    totalStockUnits += qty;
    totalValueRetail += qty * retail;
    totalValueWholesale += qty * wholesale;

    if (qty === 0) {
      outOfStockCount++;
      lowStockCount++;
    } else if (qty <= LOW_STOCK_THRESHOLD) {
      lowStockCount++;
    }
  }

  return {
    artisan_id: artisanId,
    total_products: products.length,
    total_stock_units: totalStockUnits,
    total_inventory_value_retail: Math.round(totalValueRetail * 100) / 100,
    total_inventory_value_wholesale: Math.round(totalValueWholesale * 100) / 100,
    low_stock_count: lowStockCount,
    out_of_stock_count: outOfStockCount,
  };
}

/**
 * Returns daily stock movements (units added vs sold) for the last N days.
 */
export async function getStockTrend(
  artisanId: string,
  days = 7,
): Promise<DailyStockMovementTrend[]> {
  const clampedDays = Math.min(Math.max(days, 1), 90);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - clampedDays);
  const cutoffIso = cutoffDate.toISOString();

  // 1. View-first: Try reading from v_daily_stock_movements
  const { data, error } = await supabase()
    .from('v_daily_stock_movements')
    .select('*')
    .eq('artisan_id', artisanId)
    .gte('movement_date', cutoffIso.slice(0, 10))
    .order('movement_date', { ascending: true });

  if (!error && data) {
    return (data as any[]).map((row) => ({
      artisan_id: row.artisan_id,
      movement_date: row.movement_date,
      reason: row.reason,
      movement_count: Number(row.movement_count),
      total_delta: Number(row.total_delta),
      units_added: Number(row.units_added),
      units_sold_or_removed: Number(row.units_sold_or_removed),
    }));
  }

  // 2. Fallback: Aggregate directly from stock_movements table
  return await getStockTrendFallback(artisanId, cutoffIso);
}

/**
 * Fallback aggregation directly from the stock_movements table.
 */
async function getStockTrendFallback(
  artisanId: string,
  cutoffIso: string,
): Promise<DailyStockMovementTrend[]> {
  const { data, error } = await supabase()
    .from('stock_movements')
    .select('*')
    .eq('artisan_id', artisanId)
    .gte('created_at', cutoffIso)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch stock trend fallback: ${error.message}`);
  }

  const movements = (data ?? []) as StockMovement[];
  const grouped = new Map<string, DailyStockMovementTrend>();

  for (const m of movements) {
    // Convert to Indian Standard Time (UTC+5:30) date string
    const utcDate = new Date(m.created_at);
    const istDate = new Date(utcDate.getTime() + 5.5 * 60 * 60 * 1000);
    const dateStr = istDate.toISOString().slice(0, 10);
    const key = `${dateStr}:${m.reason}`;

    let entry = grouped.get(key);
    if (!entry) {
      entry = {
        artisan_id: artisanId,
        movement_date: dateStr,
        reason: m.reason,
        movement_count: 0,
        total_delta: 0,
        units_added: 0,
        units_sold_or_removed: 0,
      };
      grouped.set(key, entry);
    }

    entry.movement_count++;
    entry.total_delta += m.delta;
    if (m.delta > 0) {
      entry.units_added += m.delta;
    } else {
      entry.units_sold_or_removed += -m.delta;
    }
  }

  return Array.from(grouped.values()).sort((a, b) =>
    a.movement_date.localeCompare(b.movement_date),
  );
}
