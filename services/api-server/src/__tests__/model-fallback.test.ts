import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isModelUnavailableError } from '../services/gemini.service.js';
import { UpstreamError } from '../services/http.js';
import { isBharatCodeConfigured } from '../services/bharatcode.service.js';
import { resetEnvCache } from '../config/env.js';

/**
 * isModelUnavailableError decides whether the Gemini chain tries the next
 * model id or gives up immediately. Getting this wrong in either direction is
 * expensive: too strict and a genuine outage looks like our own bug; too loose
 * and a real bug (bad schema, bad key) gets silently retried across every
 * model in the chain before finally surfacing.
 */
describe('isModelUnavailableError', () => {
  it('treats a 404 (retired/unknown model id) as unavailable', () => {
    expect(isModelUnavailableError({ status: 404 })).toBe(true);
  });

  it('treats a 503 (capacity-shedding) as unavailable', () => {
    expect(isModelUnavailableError({ status: 503 })).toBe(true);
  });

  it('treats a 429 (quota exhausted) as unavailable', () => {
    expect(isModelUnavailableError({ status: 429 })).toBe(true);
  });

  it('does not treat a 400 (bad request/schema) as unavailable', () => {
    expect(isModelUnavailableError({ status: 400 })).toBe(false);
  });

  it('does not treat a 401 (bad API key) as unavailable', () => {
    expect(isModelUnavailableError({ status: 401 })).toBe(false);
  });

  it('falls back to message sniffing when there is no status field', () => {
    expect(
      isModelUnavailableError(
        new Error('models/gemini-2.5-flash is no longer available to new users'),
      ),
    ).toBe(true);
    expect(isModelUnavailableError(new Error('UNAVAILABLE: high demand'))).toBe(true);
    expect(isModelUnavailableError(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
  });

  it('does not match an unrelated error message', () => {
    expect(isModelUnavailableError(new Error('Unexpected token in JSON'))).toBe(false);
  });

  it('matches our own UpstreamError by its status field', () => {
    expect(isModelUnavailableError(new UpstreamError('gemini', 503, 'busy'))).toBe(true);
    expect(isModelUnavailableError(new UpstreamError('gemini', 401, 'bad key'))).toBe(false);
  });
});

describe('isBharatCodeConfigured', () => {
  beforeEach(() => {
    resetEnvCache();
  });

  afterEach(() => {
    delete process.env.BHARATCODE_API_KEY;
    resetEnvCache();
  });

  it('is false when BHARATCODE_API_KEY is unset - Gemini-only mode', () => {
    delete process.env.BHARATCODE_API_KEY;
    expect(isBharatCodeConfigured()).toBe(false);
  });

  it('is true once BHARATCODE_API_KEY is set', () => {
    process.env.BHARATCODE_API_KEY = 'bc_live_test_key_0123456789';
    expect(isBharatCodeConfigured()).toBe(true);
  });
});

describe('generateCatalogViaBharatCode guard', () => {
  beforeEach(() => {
    resetEnvCache();
    delete process.env.BHARATCODE_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refuses to call the network when unconfigured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { generateCatalogViaBharatCode } = await import('../services/bharatcode.service.js');

    await expect(
      generateCatalogViaBharatCode({
        imageBase64: 'AAAA',
        nativeTranscript: 'test',
        materialCostInr: 100,
        laborHours: 1,
        dimensionsCm: { length: 10, width: 10, height: 1 },
      }),
    ).rejects.toThrow(/not configured/);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
