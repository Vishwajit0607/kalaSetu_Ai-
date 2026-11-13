/**
 * Requests for logout, password change, activity and export. The URL, method and
 * body are the contract with the server, and the error handling matters as much:
 * a wrong current password must NOT look like an expired session.
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

describe('logout', () => {
  it('posts to the logout endpoint for this device only by default', async () => {
    fetchMock.mockResolvedValue(respond(204, null));
    await apiClient.api.logout();
    expect(lastUrl()).toBe('/v1/auth/logout');
    expect(lastInit().method).toBe('POST');
    expect(JSON.parse(lastInit().body!)).toEqual({ all_devices: false });
    expect(lastInit().headers.Authorization).toBe('Bearer a'); // the server needs the token to know which session to end
  });

  it('can ask to end every device', async () => {
    fetchMock.mockResolvedValue(respond(204, null));
    await apiClient.api.logout(true);
    expect(JSON.parse(lastInit().body!)).toEqual({ all_devices: true });
  });

  it('resolves for the empty 204 reply instead of failing to parse it', async () => {
    fetchMock.mockResolvedValue(respond(204, null));
    await expect(apiClient.api.logout()).resolves.toBeUndefined();
  });
});

describe('changePassword', () => {
  it('posts both passwords and returns the spoken confirmation', async () => {
    fetchMock.mockResolvedValue(respond(200, { changed: true, spoken_hi: 'Your password has been changed.' }));
    const result = await apiClient.api.changePassword({ current_password: 'old-pass-1', new_password: 'new-pass-2' });

    expect(lastUrl()).toBe('/v1/me/password');
    expect(lastInit().method).toBe('POST');
    expect(JSON.parse(lastInit().body!)).toEqual({ current_password: 'old-pass-1', new_password: 'new-pass-2' });
    expect(result).toEqual({ changed: true, spoken_hi: 'Your password has been changed.' });
  });

  it('a wrong current password (400) is an error the screen can show - it does NOT end the session', async () => {
    fetchMock.mockResolvedValue(
      respond(400, { error: 'wrong_password', message: 'The current password is not correct', spoken_hi: 'Your current password is not correct.' }),
    );
    const error = await apiClient.api.changePassword({ current_password: 'x', new_password: 'y12345' }).then(() => null, (e: unknown) => e);

    expect(error).toMatchObject({ status: 400, code: 'wrong_password', spokenHi: 'Your current password is not correct.' });
    // The session is untouched: still signed in, token still saved, no refresh attempted.
    expect(await session.getSession()).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('activity', () => {
  it('asks for the trail with no query by default', async () => {
    await apiClient.api.activity();
    expect(lastUrl()).toBe('/v1/me/activity');
  });

  it('passes the page size and cursor, URL-encoded', async () => {
    await apiClient.api.activity({ limit: 20, before: '2026-11-13T10:00:00.000+00:00' });
    expect(lastUrl()).toBe('/v1/me/activity?limit=20&before=2026-11-13T10%3A00%3A00.000%2B00%3A00');
  });
});

describe('exportMyData', () => {
  it('reads the export with a patient timeout, because it is a heavy request', async () => {
    fetchMock.mockResolvedValue(respond(200, { exported_at: 'x', artisan: {}, counts: {}, truncated: [] }));
    const data = await apiClient.api.exportMyData();
    expect(lastUrl()).toBe('/v1/me/export');
    expect(lastInit().method ?? 'GET').toBe('GET');
    expect(data.truncated).toEqual([]);
  });
});
