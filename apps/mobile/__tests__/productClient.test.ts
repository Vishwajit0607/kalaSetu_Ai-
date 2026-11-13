/**
 * Requests for the product lifecycle: the URL, method and body are the contract with the
 * server. The one that matters most for safety is that nothing in any request can name an
 * owner - the server reads who is asking from the token alone.
 */
export {}; // a module, so top-level names do not clash with other test files

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => void mockStore.set(key, value)),
  deleteItemAsync: jest.fn(async (key: string) => void mockStore.delete(key)),
}));

const respond = (status: number, body: unknown = {}) => ({ ok: status < 300, status, json: async () => body });

let fetchMock: jest.Mock;
let apiClient: typeof import('../services/apiClient');
let session: typeof import('../services/session');

beforeEach(async () => {
  jest.resetModules();
  mockStore.clear();
  fetchMock = jest.fn().mockResolvedValue(respond(200, {}));
  (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  apiClient = require('../services/apiClient');
  session = require('../services/session');
  await session.saveSession({ accessToken: 'a', refreshToken: 'r', expiresAt: Math.floor(Date.now() / 1000) + 3600 });
});

const lastUrl = () => String(fetchMock.mock.calls.at(-1)![0]).replace(apiClient.BASE_URL, '');
const lastInit = () => fetchMock.mock.calls.at(-1)![1] as { method?: string; body?: string; headers: Record<string, string> };
const ID = '11111111-0000-0000-0000-000000000001';

describe('getProduct', () => {
  it('GETs the product by id, with the token', async () => {
    fetchMock.mockResolvedValue(respond(200, { product: { id: ID } }));
    const result = await apiClient.api.getProduct(ID);
    expect(lastUrl()).toBe(`/v1/catalog/products/${ID}`);
    expect(lastInit().method ?? 'GET').toBe('GET');
    expect(lastInit().headers.Authorization).toBe('Bearer a');
    expect(result.product.id).toBe(ID);
  });

  it('a product that is not the artisan\'s is a 404 the screen can handle - it does not end the session', async () => {
    fetchMock.mockResolvedValue(respond(404, { error: 'not_found', message: 'no such product', spoken_hi: 'Not found.' }));
    await expect(apiClient.api.getProduct(ID)).rejects.toMatchObject({ status: 404, code: 'not_found' });
    expect(session.getSession()).not.toBeNull();
  });
});

describe('updateProduct', () => {
  it('PATCHes only the fields it is given', async () => {
    fetchMock.mockResolvedValue(respond(200, { product: { id: ID } }));
    await apiClient.api.updateProduct(ID, { title_en: 'New title', recommended_retail_inr: 1200 });
    expect(lastUrl()).toBe(`/v1/catalog/products/${ID}`);
    expect(lastInit().method).toBe('PATCH');
    expect(JSON.parse(lastInit().body!)).toEqual({ title_en: 'New title', recommended_retail_inr: 1200 });
  });

  it('can make a photo the cover', async () => {
    fetchMock.mockResolvedValue(respond(200, { product: { id: ID } }));
    await apiClient.api.updateProduct(ID, { cover_image_url: 'https://cdn.example/b.jpg' });
    expect(JSON.parse(lastInit().body!)).toEqual({ cover_image_url: 'https://cdn.example/b.jpg' });
  });

  it('a validation failure (400) reaches the caller as an ApiError with the server\'s sentence', async () => {
    fetchMock.mockResolvedValue(respond(400, { error: 'invalid', message: 'retail must exceed wholesale', spoken_hi: 'Retail must be higher.' }));
    await expect(apiClient.api.updateProduct(ID, { recommended_retail_inr: 1 })).rejects.toMatchObject({
      status: 400,
      spokenHi: 'Retail must be higher.',
    });
  });
});

describe('an id with odd characters', () => {
  it.each([
    ['getProduct', (api: any) => api.getProduct('a/b?c'), '/v1/catalog/products/a%2Fb%3Fc'],
    ['updateProduct', (api: any) => api.updateProduct('a/b?c', { title_en: 'x' }), '/v1/catalog/products/a%2Fb%3Fc'],
    ['deleteProduct', (api: any) => api.deleteProduct('a/b?c'), '/v1/catalog/products/a%2Fb%3Fc'],
    ['restoreProduct', (api: any) => api.restoreProduct('a/b?c'), '/v1/catalog/products/a%2Fb%3Fc/restore'],
    ['priceHistory', (api: any) => api.priceHistory('a/b?c'), '/v1/catalog/products/a%2Fb%3Fc/price-history'],
    ['retranslateProduct', (api: any) => api.retranslateProduct('a/b?c', { from: 'en-IN' }), '/v1/catalog/products/a%2Fb%3Fc/retranslate'],
  ])('%s keeps it inside one path segment', async (_name, callIt, expected) => {
    fetchMock.mockResolvedValue(respond(200, { product: {}, history: [], next_before: null, translations: {} }));
    await callIt(apiClient.api);
    expect(lastUrl()).toBe(expected);
  });
});

describe('deleteProduct and restoreProduct', () => {
  it('DELETEs, and gets back what an undo needs', async () => {
    fetchMock.mockResolvedValue(respond(200, { deleted: true, id: ID, deleted_at: '2026-11-13T10:00:00Z', restorable: true }));
    const result = await apiClient.api.deleteProduct(ID);
    expect(lastUrl()).toBe(`/v1/catalog/products/${ID}`);
    expect(lastInit().method).toBe('DELETE');
    expect(lastInit().body).toBeUndefined();
    expect(result).toMatchObject({ deleted: true, id: ID, restorable: true });
  });

  it('restores with a POST and no body', async () => {
    fetchMock.mockResolvedValue(respond(200, { product: { id: ID } }));
    await apiClient.api.restoreProduct(ID);
    expect(lastUrl()).toBe(`/v1/catalog/products/${ID}/restore`);
    expect(lastInit().method).toBe('POST');
    expect(lastInit().body).toBeUndefined();
  });
});

describe('priceHistory', () => {
  it('asks for the history with no query when none is given', async () => {
    fetchMock.mockResolvedValue(respond(200, { history: [], next_before: null }));
    await apiClient.api.priceHistory(ID);
    expect(lastUrl()).toBe(`/v1/catalog/products/${ID}/price-history`);
  });

  it('passes the page size and the cursor, encoded', async () => {
    fetchMock.mockResolvedValue(respond(200, { history: [], next_before: null }));
    await apiClient.api.priceHistory(ID, { limit: 10, before: '2026-11-13T10:00:00+00:00' });
    expect(lastUrl()).toBe(`/v1/catalog/products/${ID}/price-history?limit=10&before=2026-11-13T10%3A00%3A00%2B00%3A00`);
  });
});

describe('retranslateProduct', () => {
  it('previews unless told to apply', async () => {
    fetchMock.mockResolvedValue(respond(200, { applied: false, product: null, translations: {} }));
    await apiClient.api.retranslateProduct(ID, { from: 'en-IN' });
    expect(lastUrl()).toBe(`/v1/catalog/products/${ID}/retranslate`);
    expect(lastInit().method).toBe('POST');
    expect(JSON.parse(lastInit().body!)).toEqual({ from: 'en-IN' });
  });

  it('sends apply when asked', async () => {
    fetchMock.mockResolvedValue(respond(200, { applied: true, product: { id: ID }, translations: {} }));
    await apiClient.api.retranslateProduct(ID, { from: 'hi-IN', apply: true });
    expect(JSON.parse(lastInit().body!)).toEqual({ from: 'hi-IN', apply: true });
  });
});

describe('no request can name an owner', () => {
  it('sends no artisan id in any URL or body', async () => {
    fetchMock.mockResolvedValue(respond(200, { product: {}, history: [], next_before: null, translations: {} }));
    await apiClient.api.getProduct(ID);
    await apiClient.api.updateProduct(ID, { title_en: 'x' });
    await apiClient.api.deleteProduct(ID);
    await apiClient.api.restoreProduct(ID);
    await apiClient.api.priceHistory(ID, { limit: 5 });
    await apiClient.api.retranslateProduct(ID, { from: 'en-IN' });
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).not.toMatch(/artisan/i);
      expect(String(init?.body ?? '')).not.toMatch(/artisan/i);
    }
  });
});
