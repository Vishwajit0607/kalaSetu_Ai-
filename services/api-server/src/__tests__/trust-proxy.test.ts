import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from '../config/env.js';
import { buildServer } from '../index.js';

/**
 * Behind a proxy (Render) the socket address is the proxy's. TRUST_PROXY makes the
 * server read the real client from the forwarded header - and must be OFF by default,
 * because trusting that header when the server is directly reachable lets any caller
 * claim any address (to dodge the rate limit, or to frame someone in the audit trail).
 */

afterEach(() => {
  delete process.env.TRUST_PROXY;
  resetEnvCache();
});

/** The address the server believes the caller has. */
async function addressSeenFor(forwarded: string | undefined) {
  const app = await buildServer();
  app.get('/__ip', async (request) => ({ ip: request.ip }));
  const res = await app.inject({
    method: 'GET',
    url: '/__ip',
    remoteAddress: '10.0.0.1', // the proxy
    headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
  });
  await app.close();
  return res.json().ip as string;
}

describe('TRUST_PROXY', () => {
  it('is off by default', () => {
    delete process.env.TRUST_PROXY;
    resetEnvCache();
    expect(loadEnv().TRUST_PROXY).toBe(false);
  });

  it('reads "true" and "false" as booleans (and "false" really is false)', () => {
    process.env.TRUST_PROXY = 'true';
    resetEnvCache();
    expect(loadEnv().TRUST_PROXY).toBe(true);

    process.env.TRUST_PROXY = 'false';
    resetEnvCache();
    expect(loadEnv().TRUST_PROXY).toBe(false);
  });

  it('rejects a value that is neither, instead of guessing', () => {
    process.env.TRUST_PROXY = 'yes';
    resetEnvCache();
    expect(() => loadEnv()).toThrow(/TRUST_PROXY/);
  });

  it('when off, ignores a forwarded header: a caller cannot choose their own address', async () => {
    resetEnvCache();
    expect(await addressSeenFor('203.0.113.7')).toBe('10.0.0.1');
  });

  it('when on, uses the real client address from the forwarded header', async () => {
    process.env.TRUST_PROXY = 'true';
    resetEnvCache();
    expect(await addressSeenFor('203.0.113.7')).toBe('203.0.113.7');
  });

  it('when on but no header is sent, falls back to the connection address', async () => {
    process.env.TRUST_PROXY = 'true';
    resetEnvCache();
    expect(await addressSeenFor(undefined)).toBe('10.0.0.1');
  });
});
