import type { ProductRow } from './apiClient';

/**
 * Local edits to the cached inventory list, so a product that was just deleted, brought
 * back or changed shows correctly straight away instead of after the next refetch.
 *
 * Pure: they return a new object (or the same one when there is nothing to change, so
 * React Query does not re-render for nothing) and keep the summary figures in step with
 * the list, using the same arithmetic as the server (stock value = stock x wholesale).
 */

export interface InventoryData {
  products: ProductRow[];
  low_stock: ProductRow[];
  total_skus: number;
  stock_value_inr: number;
}

const stockValue = (product: ProductRow) => product.stock_quantity * Number(product.recommended_wholesale_inr);

/** The inventory without one product (deleted). Unchanged when it is not in the list. */
export function withoutProduct(data: InventoryData, productId: string): InventoryData {
  const removed = data.products.find((product) => product.id === productId);
  if (!removed) return data;
  return {
    products: data.products.filter((product) => product.id !== productId),
    low_stock: data.low_stock.filter((product) => product.id !== productId),
    total_skus: data.total_skus - 1,
    stock_value_inr: data.stock_value_inr - stockValue(removed),
  };
}

/**
 * The inventory with one product replaced by its saved version, in the same place in
 * the list. Unchanged when the product is not in the list.
 */
export function withProduct(data: InventoryData, saved: ProductRow): InventoryData {
  const old = data.products.find((product) => product.id === saved.id);
  if (!old) return data;
  const swap = (list: ProductRow[]) => list.map((product) => (product.id === saved.id ? saved : product));
  return {
    products: swap(data.products),
    low_stock: swap(data.low_stock),
    total_skus: data.total_skus,
    stock_value_inr: data.stock_value_inr - stockValue(old) + stockValue(saved),
  };
}
