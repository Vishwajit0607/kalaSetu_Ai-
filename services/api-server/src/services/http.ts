/**
 * Shared fetch helper for every upstream AI vendor.
 *
 * Rural artisans sit on flaky 2G/3G backhaul, so each call gets a bounded
 * retry with exponential backoff + jitter on transport errors and on 429/5xx.
 * 4xx responses are surfaced immediately - retrying a bad API key only burns
 * the artisan's battery.
 */

export class UpstreamError extends Error {
  readonly status: number;
  readonly vendor: string;
  readonly body: string;

  constructor(vendor: string, status: number, body: string) {
    super(`${vendor} request failed with ${status}: ${body.slice(0, 400)}`);
    this.name = 'UpstreamError';
    this.vendor = vendor;
    this.status = status;
    this.body = body;
  }
}

export interface RetryOptions {
  vendor: string;
  attempts?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions,
): Promise<Response> {
  const attempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const baseDelayMs = options.baseDelayMs ?? 400;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.ok) return response;

      const body = await response.text();
      if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts) {
        throw new UpstreamError(options.vendor, response.status, body);
      }
      lastError = new UpstreamError(options.vendor, response.status, body);
    } catch (error) {
      if (error instanceof UpstreamError && !RETRYABLE_STATUS.has(error.status)) {
        throw error;
      }
      lastError = error;
      if (attempt === attempts) break;
    } finally {
      clearTimeout(timer);
    }

    const jitter = Math.random() * baseDelayMs;
    await sleep(baseDelayMs * 2 ** (attempt - 1) + jitter);
  }

  if (lastError instanceof UpstreamError) throw lastError;
  throw new UpstreamError(
    options.vendor,
    503,
    lastError instanceof Error ? lastError.message : 'unknown transport failure',
  );
}
