import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { UpstreamError, fetchWithRetry } from '../services/http.js';
import { passthroughEdit } from '../services/photoroom.service.js';
import { offlineCatalogDraft } from '../services/gemini.service.js';

/**
 * Phase 7 guarantee: no single AI vendor outage can lose an artisan's work.
 */

describe('fetchWithRetry', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries a 503 and succeeds on a later attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithRetry(
      'https://example.test/x',
      { method: 'POST' },
      { vendor: 'test', attempts: 3, baseDelayMs: 1 },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails fast on a 401 instead of burning retries on a bad key', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response('invalid api key', { status: 401 })),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWithRetry(
        'https://example.test/x',
        { method: 'POST' },
        { vendor: 'test', attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toBeInstanceOf(UpstreamError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces an UpstreamError after exhausting attempts on 429', async () => {
    // A fresh Response per call: a single instance's body can only be read
    // once, which would mask the 429 as a body-consumption error.
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response('rate limited', { status: 429 })),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWithRetry(
        'https://example.test/x',
        { method: 'POST' },
        { vendor: 'sarvam-tts', attempts: 2, baseDelayMs: 1 },
      ),
    ).rejects.toMatchObject({ vendor: 'sarvam-tts', status: 429 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('wraps a transport failure as a 503 UpstreamError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENETUNREACH')));

    await expect(
      fetchWithRetry(
        'https://example.test/x',
        { method: 'GET' },
        { vendor: 'photoroom', attempts: 2, baseDelayMs: 1 },
      ),
    ).rejects.toMatchObject({ status: 503, vendor: 'photoroom' });
  });
});

describe('passthroughEdit', () => {
  it('returns the original frame flagged as a fallback', () => {
    const buffer = Buffer.from('fake-jpeg-bytes');
    const result = passthroughEdit(buffer);

    expect(result.image_base64).toBe(buffer.toString('base64'));
    expect(result.applied).toContain('passthrough-fallback');
  });
});

describe('offlineCatalogDraft', () => {
  it('builds a usable draft from the transcript alone', () => {
    const draft = offlineCatalogDraft({
      nativeTranscript: 'यह नीली सूती साड़ी है। इसमें ज़री का काम है।',
      materialCostInr: 400,
      laborHours: 6,
    });

    expect(draft.title_hi).toContain('नीली सूती साड़ी');
    expect(draft.recommended_retail_inr).toBeGreaterThan(draft.recommended_wholesale_inr);
    expect(draft.pricing_rationale.length).toBeGreaterThan(0);
  });

  it('never prices a draft below the artisan cost base', () => {
    const draft = offlineCatalogDraft({
      nativeTranscript: '',
      materialCostInr: 1000,
      laborHours: 10,
    });

    expect(draft.recommended_wholesale_inr).toBeGreaterThan(1000 + 10 * 95);
  });
});
