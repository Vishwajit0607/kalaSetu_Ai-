import { withProduct, withoutProduct, type InventoryData } from '../services/inventoryCache';
import { describeChange, formatRupees, sourceLabel } from '../services/priceHistory';
import type { ProductRow } from '../services/apiClient';

const row = (id: string, stock: number, wholesale: number, over: Partial<ProductRow> = {}) =>
  ({
    id,
    stock_quantity: stock,
    recommended_wholesale_inr: wholesale,
    recommended_retail_inr: wholesale * 2,
    title_en: id,
    ...over,
  }) as unknown as ProductRow;

const inventory = (): InventoryData => {
  const products = [row('a', 10, 100), row('b', 2, 500), row('c', 0, 50)];
  return {
    products,
    low_stock: [products[1]!, products[2]!],
    total_skus: 3,
    stock_value_inr: 10 * 100 + 2 * 500 + 0,
  };
};

describe('withoutProduct', () => {
  it('removes the product from the list and the low-stock list, and keeps the figures in step', () => {
    const next = withoutProduct(inventory(), 'b');
    expect(next.products.map((p) => p.id)).toEqual(['a', 'c']);
    expect(next.low_stock.map((p) => p.id)).toEqual(['c']);
    expect(next.total_skus).toBe(2);
    expect(next.stock_value_inr).toBe(1000);
  });

  it('does not mutate what it was given', () => {
    const before = inventory();
    withoutProduct(before, 'a');
    expect(before.products).toHaveLength(3);
    expect(before.total_skus).toBe(3);
  });

  it('returns the very same object when the product is not there, so nothing re-renders', () => {
    const before = inventory();
    expect(withoutProduct(before, 'zzz')).toBe(before);
  });

  it('leaves the other products exactly as they were', () => {
    const before = inventory();
    const next = withoutProduct(before, 'a');
    expect(next.products[0]).toBe(before.products[1]);
  });
});

describe('withProduct', () => {
  it('swaps the saved version in at the same position, in both lists', () => {
    const before = inventory();
    const saved = row('b', 2, 600, { title_en: 'renamed' });
    const next = withProduct(before, saved);
    expect(next.products.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(next.products[1]).toBe(saved);
    expect(next.low_stock[0]).toBe(saved);
  });

  it('adjusts the stock value when the wholesale price changed', () => {
    const next = withProduct(inventory(), row('b', 2, 600));
    expect(next.stock_value_inr).toBe(1000 + 2 * 600);
  });

  it('leaves the figures alone when only text changed', () => {
    const next = withProduct(inventory(), row('a', 10, 100, { title_en: 'new' }));
    expect(next.stock_value_inr).toBe(2000);
    expect(next.total_skus).toBe(3);
  });

  it('reads a wholesale price the database sent as text', () => {
    const before = inventory();
    const next = withProduct(before, row('a', 10, '120.00' as unknown as number));
    expect(next.stock_value_inr).toBe(2000 + 10 * 20);
  });

  it('returns the same object when the product is not in the list', () => {
    const before = inventory();
    expect(withProduct(before, row('zzz', 1, 1))).toBe(before);
  });
});

describe('formatRupees', () => {
  it.each([
    [1200, '₹1,200'],
    [120000, '₹1,20,000'],
    [1200.5, '₹1,200.50'],
    [0.99, '₹0.99'],
    [100.004, '₹100'],
    [100.005, '₹100.01'],
  ])('writes %p as %p', (amount, expected) => {
    expect(formatRupees(amount)).toBe(expected);
  });
});

describe('describeChange', () => {
  it('says nothing about the first price', () => {
    expect(describeChange(null)).toEqual({ kind: 'first', text: '' });
  });

  it('shows a rise with a plus and a fall with a minus', () => {
    expect(describeChange(150)).toEqual({ kind: 'up', text: '+₹150' });
    expect(describeChange(-49.5)).toEqual({ kind: 'down', text: '-₹49.50' });
  });

  it('treats zero, and dust smaller than a paisa, as no change', () => {
    expect(describeChange(0)).toEqual({ kind: 'same', text: '' });
    expect(describeChange(0.004)).toEqual({ kind: 'same', text: '' });
    expect(describeChange(-0.004)).toEqual({ kind: 'same', text: '' });
  });

  it('keeps a one-paisa move', () => {
    expect(describeChange(0.01)).toEqual({ kind: 'up', text: '+₹0.01' });
  });
});

describe('sourceLabel', () => {
  it('names each origin, and treats an unknown one as an ordinary change', () => {
    expect(sourceLabel('create')).toBe('priceHistory.source.create');
    expect(sourceLabel('system')).toBe('priceHistory.source.system');
    expect(sourceLabel('edit')).toBe('priceHistory.source.edit');
    expect(sourceLabel('import')).toBe('priceHistory.source.edit');
  });
});
