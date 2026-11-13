import type { PriceHistoryEntry } from './apiClient';
import type { StringKey } from '@/i18n';

/** How the price history is worded. Pure, so the sign and the rounding are unit-tested. */

/** "₹1,200" or "₹1,200.50" - paise only when there are some. */
export function formatRupees(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const hasPaise = Math.round(rounded * 100) % 100 !== 0;
  return `₹${rounded.toLocaleString('en-IN', { minimumFractionDigits: hasPaise ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export type ChangeKind = 'first' | 'same' | 'up' | 'down';

export interface ChangeLabel {
  kind: ChangeKind;
  /** "+₹100", "-₹50", or "" for the first price and for no change. */
  text: string;
}

/**
 * How a price moved from the one before it. `null` means there was nothing earlier to
 * compare with; a change smaller than a paisa is no change at all (the server rounds to
 * paise, so this is only a guard against floating-point dust).
 */
export function describeChange(change: number | null): ChangeLabel {
  if (change === null) return { kind: 'first', text: '' };
  const paise = Math.round(change * 100);
  if (paise === 0) return { kind: 'same', text: '' };
  const sign = paise > 0 ? '+' : '-';
  return { kind: paise > 0 ? 'up' : 'down', text: `${sign}${formatRupees(Math.abs(paise) / 100)}` };
}

const SOURCE_LABEL: Record<PriceHistoryEntry['source'], StringKey> = {
  create: 'priceHistory.source.create',
  edit: 'priceHistory.source.edit',
  system: 'priceHistory.source.system',
};

/** What to call a row's origin; a source a newer server invents reads as an ordinary change. */
export function sourceLabel(source: string): StringKey {
  return SOURCE_LABEL[source as PriceHistoryEntry['source']] ?? 'priceHistory.source.edit';
}
