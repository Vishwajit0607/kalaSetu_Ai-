import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpstreamError } from '../services/http.js';
import type { CatalogGeneration } from '../types/index.js';

/**
 * The orchestrator is the one place that decides whether BharatCode ever
 * runs, so its branching is tested against mocked providers rather than live
 * network calls: Gemini-succeeds (BharatCode never touched), Gemini-fails
 * with BharatCode unconfigured (original error surfaces unchanged), and
 * both-fail (a single UpstreamError the route's offline-draft fallback can
 * still catch).
 */

const sampleCatalog: CatalogGeneration = {
  title_en: 'Handwoven Saree',
  title_hi: 'हाथ से बुनी साड़ी',
  description_en: 'desc',
  description_hi: 'विवरण',
  seo_tags: ['handloom'],
  hsn_code: '5007',
  craft_complexity_score: 7,
  recommended_retail_inr: 5000,
  recommended_wholesale_inr: 3500,
  pricing_rationale: 'rationale',
};

const sampleParams = {
  imageBase64: 'AAAA',
  nativeTranscript: 'यह साड़ी है',
  materialCostInr: 400,
  laborHours: 10,
  dimensionsCm: { length: 10, width: 10, height: 1 },
};

describe('catalogOrchestrator.generateCatalogAndPricing', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('./gemini.service.js');
    vi.doUnmock('./bharatcode.service.js');
    vi.restoreAllMocks();
  });

  it('returns the Gemini result directly and never touches BharatCode', async () => {
    const generateCatalogViaGemini = vi.fn().mockResolvedValue(sampleCatalog);
    const generateCatalogViaBharatCode = vi.fn();
    const isBharatCodeConfigured = vi.fn().mockReturnValue(true);

    vi.doMock('../services/gemini.service.js', () => ({
      generateCatalogAndPricing: generateCatalogViaGemini,
      geminiModelChain: () => ['gemini-3.1-flash-lite'],
    }));
    vi.doMock('../services/bharatcode.service.js', () => ({
      generateCatalogViaBharatCode,
      isBharatCodeConfigured,
    }));

    const { generateCatalogAndPricing } = await import('../services/catalogOrchestrator.service.js');
    const result = await generateCatalogAndPricing(sampleParams);

    expect(result).toEqual(sampleCatalog);
    expect(generateCatalogViaGemini).toHaveBeenCalledTimes(1);
    expect(generateCatalogViaBharatCode).not.toHaveBeenCalled();
  });

  it('rethrows the original Gemini error when BharatCode is not configured', async () => {
    const geminiError = new UpstreamError('gemini', 503, 'every model unavailable');
    const generateCatalogViaBharatCode = vi.fn();

    vi.doMock('../services/gemini.service.js', () => ({
      generateCatalogAndPricing: vi.fn().mockRejectedValue(geminiError),
      geminiModelChain: () => ['gemini-3.1-flash-lite'],
    }));
    vi.doMock('../services/bharatcode.service.js', () => ({
      generateCatalogViaBharatCode,
      isBharatCodeConfigured: () => false,
    }));

    const { generateCatalogAndPricing } = await import('../services/catalogOrchestrator.service.js');

    await expect(generateCatalogAndPricing(sampleParams)).rejects.toBe(geminiError);
    expect(generateCatalogViaBharatCode).not.toHaveBeenCalled();
  });

  it('falls back to BharatCode when Gemini fails and BharatCode is configured', async () => {
    const geminiError = new UpstreamError('gemini', 503, 'every model unavailable');

    vi.doMock('../services/gemini.service.js', () => ({
      generateCatalogAndPricing: vi.fn().mockRejectedValue(geminiError),
      geminiModelChain: () => ['gemini-3.1-flash-lite'],
    }));
    vi.doMock('../services/bharatcode.service.js', () => ({
      generateCatalogViaBharatCode: vi.fn().mockResolvedValue(sampleCatalog),
      isBharatCodeConfigured: () => true,
    }));

    const { generateCatalogAndPricing } = await import('../services/catalogOrchestrator.service.js');
    const result = await generateCatalogAndPricing(sampleParams);

    expect(result).toEqual(sampleCatalog);
  });

  it('throws one UpstreamError carrying both messages when every provider fails', async () => {
    vi.doMock('../services/gemini.service.js', () => ({
      generateCatalogAndPricing: vi.fn().mockRejectedValue(new Error('gemini chain exhausted')),
      geminiModelChain: () => ['gemini-3.1-flash-lite'],
    }));
    vi.doMock('../services/bharatcode.service.js', () => ({
      generateCatalogViaBharatCode: vi.fn().mockRejectedValue(new Error('bharatcode 503')),
      isBharatCodeConfigured: () => true,
    }));

    const { generateCatalogAndPricing } = await import('../services/catalogOrchestrator.service.js');

    await expect(generateCatalogAndPricing(sampleParams)).rejects.toMatchObject({
      vendor: 'ai-catalog',
      status: 503,
    });

    // The combined error names both failures, so an on-call engineer does not
    // have to guess which vendor actually broke.
    await expect(generateCatalogAndPricing(sampleParams)).rejects.toThrow(
      /gemini chain exhausted.*bharatcode 503/s,
    );
  });
});
