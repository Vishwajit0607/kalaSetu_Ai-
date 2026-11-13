/**
 * PostgreSQL error classification and domain error mappings.
 *
 * Translates PostgreSQL error codes and stored-procedure exceptions into
 * strongly-typed domain errors with appropriate HTTP status codes and bilingual
 * error messages.
 */

export class StockLedgerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'StockLedgerError';
  }
}

export class InsufficientStockError extends StockLedgerError {
  constructor(message = 'Insufficient stock for this adjustment') {
    super(message, 'INSUFFICIENT_STOCK', 409);
    this.name = 'InsufficientStockError';
  }
}

export class ProductNotFoundError extends StockLedgerError {
  constructor(productId: string) {
    super(`Product ${productId} not found or not owned by artisan`, 'PRODUCT_NOT_FOUND', 404);
    this.name = 'ProductNotFoundError';
  }
}

export class InvalidLedgerReasonError extends StockLedgerError {
  constructor(reason: string) {
    super(`Invalid stock adjustment reason: ${reason}`, 'INVALID_REASON', 400);
    this.name = 'InvalidLedgerReasonError';
  }
}

/**
 * Parses Postgres / Supabase error objects and converts known errors
 * into typed domain exceptions.
 */
export function classifyPgError(error: unknown, productId?: string): Error {
  if (error instanceof StockLedgerError) {
    return error;
  }

  const errObj = error as { code?: string; message?: string; details?: string };
  const message = errObj?.message || String(error);

  if (message.includes('INSUFFICIENT_STOCK') || message.includes('below zero')) {
    return new InsufficientStockError(message);
  }

  if (message.includes('PRODUCT_NOT_FOUND')) {
    return new ProductNotFoundError(productId ?? 'unknown');
  }

  if (message.includes('INVALID_REASON')) {
    return new InvalidLedgerReasonError(message);
  }

  if (errObj?.code === '23514' && message.includes('stock_movements_reason_check')) {
    return new InvalidLedgerReasonError('Stock movement reason must be voice, manual, order, or sync');
  }

  return error instanceof Error ? error : new Error(message);
}
