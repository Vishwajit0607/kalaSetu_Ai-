/**
 * The API client's auth behaviour. These are the cases where a mistake means
 * either a user being logged out for no reason, or a request storm.
 */

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => void mockStore.set(key, value)),
  deleteItemAsync: jest.fn(async (key: string) => void mockStore.delete(key)),
}));

type Json = Record<string, unknown>;
const respond = (status: number, body: Json | null = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

let fetchMock: jest.Mock;
let apiClient: typeof import('../services/apiClient');
let session: typeof import('../services/session');

const NOW = () => Math.floor(Date.now() / 1000);
const freshSession = (over: Partial<import('../services/session').Session> = {}) => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: NOW() + 3600,
  ...over,
});

beforeEach(async () => {
  jest.resetModules();
  mockStore.clear();
  process.env.EXPO_PUBLIC_API_BASE_URL = 'http://api.test';
  fetchMock = jest.fn();
  (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  apiClient = require('../services/apiClient');
  session = require('../services/session');
});

const urlOf = (call: unknown[]) => String(call[0]);
const headersOf = (call: unknown[]) => (call[1] as { headers: Record<string, string> }).headers;

describe('request headers', () => {
  it('sends the bearer token and the language on authenticated calls', async () => {
    await session.saveSession(freshSession());
    session.setLanguage('en-IN');
    fetchMock.mockResolvedValue(respond(200, { products: [] }));

    await apiClient.api.inventory();

    const headers = headersOf(fetchMock.mock.calls[0]!);
    expect(headers.Authorization).toBe('Bearer access-1');
    expect(headers['X-Lang']).toBe('en-IN');
  });

  it('sends no token on the login call', async () => {
    await session.saveSession(freshSession());
    fetchMock.mockResolvedValue(respond(200, { session: {}, artisan: {} }));

    await apiClient.api.login({ phone: '9876543210', password: 'pw123456' });

    expect(headersOf(fetchMock.mock.calls[0]!).Authorization).toBeUndefined();
  });
});

describe('token refresh', () => {
  it('refreshes proactively when the token is about to expire', async () => {
    await session.saveSession(freshSession({ expiresAt: NOW() + 10 }));
    fetchMock
      .mockResolvedValueOnce(
        respond(200, { session: { access_token: 'access-2', refresh_token: 'refresh-2', expires_at: NOW() + 3600 } }),
      )
      .mockResolvedValueOnce(respond(200, { products: [] }));

    await apiClient.api.inventory();

    expect(urlOf(fetchMock.mock.calls[0]!)).toContain('/v1/auth/refresh');
    // ...and the real request went out with the NEW token.
    expect(headersOf(fetchMock.mock.calls[1]!).Authorization).toBe('Bearer access-2');
  });

  it('shares ONE refresh between concurrent requests', async () => {
    await session.saveSession(freshSession({ expiresAt: NOW() + 10 }));
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/refresh')
        ? respond(200, { session: { access_token: 'access-2', refresh_token: 'refresh-2', expires_at: NOW() + 3600 } })
        : respond(200, { products: [] }),
    );

    await Promise.all([apiClient.api.inventory(), apiClient.api.inventory(), apiClient.api.inventory()]);

    const refreshes = fetchMock.mock.calls.filter((c) => urlOf(c).includes('/refresh'));
    // Refresh tokens are single-use: three parallel refreshes would burn the
    // token on the first and fail the other two, logging the user out.
    expect(refreshes).toHaveLength(1);
  });

  it('retries once with a fresh token after a 401', async () => {
    await session.saveSession(freshSession());
    fetchMock
      .mockResolvedValueOnce(respond(401, { error: 'unauthorized' }))
      .mockResolvedValueOnce(
        respond(200, { session: { access_token: 'access-2', refresh_token: 'refresh-2', expires_at: NOW() + 3600 } }),
      )
      .mockResolvedValueOnce(respond(200, { products: ['ok'] }));

    const result = await apiClient.api.inventory();

    expect(result).toEqual({ products: ['ok'] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('ends the session when the server says the refresh token is dead', async () => {
    const expired = jest.fn();
    session.setSessionExpiredHandler(expired);
    await session.saveSession(freshSession());
    fetchMock
      .mockResolvedValueOnce(respond(401, { error: 'unauthorized' }))
      .mockResolvedValueOnce(respond(401, { error: 'invalid_token' }));

    await expect(apiClient.api.inventory()).rejects.toMatchObject({ status: 401 });

    expect(expired).toHaveBeenCalledTimes(1);
    expect(session.getSession()).toBeNull();
  });

  it('does NOT log the user out just because the phone is offline during a refresh', async () => {
    const expired = jest.fn();
    session.setSessionExpiredHandler(expired);
    await session.saveSession(freshSession({ expiresAt: NOW() + 10 }));
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    await expect(apiClient.api.inventory()).rejects.toMatchObject({ code: 'offline' });

    expect(expired).not.toHaveBeenCalled();
    expect(session.getSession()).not.toBeNull();
  });

  it('does NOT log the user out on a 503 from the refresh endpoint', async () => {
    const expired = jest.fn();
    session.setSessionExpiredHandler(expired);
    await session.saveSession(freshSession());
    fetchMock
      .mockResolvedValueOnce(respond(401, { error: 'unauthorized' }))
      .mockResolvedValueOnce(respond(503, { error: 'upstream' }));

    await expect(apiClient.api.inventory()).rejects.toMatchObject({ status: 401 });

    expect(expired).not.toHaveBeenCalled();
    expect(session.getSession()).not.toBeNull();
  });
});

describe('truthful errors', () => {
  it('reports a dead connection as offline, in the artisan\'s language', async () => {
    session.setLanguage('en-IN');
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    const error = await apiClient.api.health().catch((e) => e);

    expect(error.code).toBe('offline');
    expect(error.spokenHi).toBe('No internet connection. Please connect and try again.');
  });

  it('reports a timeout as a timeout - not offline, and not "saved on the phone"', async () => {
    session.setLanguage('en-IN');
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    const error = await apiClient.api.health().catch((e) => e);

    expect(error.code).toBe('timeout');
    expect(error.spokenHi).toMatch(/too long/);
    expect(error.spokenHi).not.toMatch(/saved/i);
  });

  it('passes the server\'s own spoken message through', async () => {
    fetchMock.mockResolvedValue(
      respond(401, { error: 'invalid_credentials', message: 'x', spoken_hi: 'Wrong phone number or password.' }),
    );

    const error = await apiClient.api.login({ phone: '1', password: 'x' }).catch((e) => e);

    expect(error.status).toBe(401);
    expect(error.spokenHi).toBe('Wrong phone number or password.');
  });

  it('returns undefined for a 204 instead of throwing on an empty body', async () => {
    await session.saveSession(freshSession());
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('no body'); } });

    await expect(apiClient.api.deleteAccount()).resolves.toBeUndefined();
  });
});

describe('studio edit request', () => {
  it('re-edits from the stored URL without re-uploading the photo', async () => {
    await session.saveSession(freshSession());
    fetchMock.mockResolvedValue(respond(200, { enhanced_image_url: 'e', raw_image_url: 'r' }));

    await apiClient.api.editPhoto({
      rawImageUrl: 'https://x/raw.jpg',
      previousEnhancedUrl: 'https://x/old.png',
      backdrop: 'warm-sandstone',
      relight: false,
      shadow: true,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('raw_image_url=https%3A%2F%2Fx%2Fraw.jpg');
    expect(String(url)).toContain('previous_enhanced_url=');
    expect(String(url)).toContain('relight=false');
    expect((init as { body?: unknown }).body).toBeUndefined();
  });
});

describe('bazaar requests', () => {
  const lastUrl = () => new URL(urlOf(fetchMock.mock.calls.at(-1)!));

  beforeEach(async () => {
    await session.saveSession(freshSession());
    fetchMock.mockResolvedValue(respond(200, { listings: [], total: 0, offset: 0, has_more: false }));
  });

  it('asks for a page of 20 from the start by default, with no filters', async () => {
    await apiClient.api.listings();

    const url = lastUrl();
    expect(url.pathname).toBe('/v1/marketplace/listings');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('offset')).toBe('0');
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('craft')).toBe(false);
  });

  it('trims the search and drops it when blank', async () => {
    await apiClient.api.listings({ q: '  silk saree ' });
    expect(lastUrl().searchParams.get('q')).toBe('silk saree');

    await apiClient.api.listings({ q: '   ' });
    expect(lastUrl().searchParams.has('q')).toBe(false);
  });

  it('URL-encodes a craft or search that contains reserved characters and Devanagari', async () => {
    await apiClient.api.listings({ craft: 'Zari & gota', q: 'बनारसी साड़ी' });

    const url = lastUrl();
    expect(url.searchParams.get('craft')).toBe('Zari & gota');
    expect(url.searchParams.get('q')).toBe('बनारसी साड़ी');
    // The raw & must not have split the craft into a second parameter.
    expect([...url.searchParams.keys()].sort()).toEqual(['craft', 'limit', 'offset', 'q']);
  });

  it('passes the offset through for the next page', async () => {
    await apiClient.api.listings({ offset: 40 });
    expect(lastUrl().searchParams.get('offset')).toBe('40');
  });

  it('does not let an id break out of the detail path', async () => {
    fetchMock.mockResolvedValue(respond(200, { listing: {} }));
    await apiClient.api.listing('abc/../../me');
    expect(lastUrl().pathname).toBe('/v1/marketplace/listings/abc%2F..%2F..%2Fme');
  });
});
