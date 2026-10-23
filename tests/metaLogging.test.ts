import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  debugToken,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchBusinessPages,
  fetchPermissions,
  type MetaEnv,
} from '../workers/api/meta';

// Synthetic fixtures only. Every network call is intercepted by fetchMock.
const credentials = {
  appSecret: 'test-app-secret/+?&=% snow\u2603',
  code: 'test-login-code/+?&=% snow\u2603',
  accessToken: 'test-access-token/+?&=% snow\u2603',
  inputToken: 'test-input-token/+?&=% snow\u2603',
  appToken: 'test-app-id|test-app-secret/+?&=% snow\u2603',
  returnedToken: 'test-returned-token/+?&=% snow\u2603',
};
const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
const writeDataPoint = vi.fn();
const env = {
  DB: {},
  AE_META_CALLS: { writeDataPoint },
} as unknown as MetaEnv;
const common = { env, appId: 'test-app-id', version: 'v19.0' };
const exchangeCode = () =>
  exchangeCodeForToken({
    ...common,
    appSecret: credentials.appSecret,
    code: credentials.code,
    redirectUri: 'https://app.example/api/auth/callback',
  });
const exchangeLongLived = () =>
  exchangeForLongLivedToken({
    ...common,
    appSecret: credentials.appSecret,
    accessToken: credentials.accessToken,
  });
const validateToken = () =>
  debugToken({
    env,
    version: common.version,
    inputToken: credentials.inputToken,
    appToken: credentials.appToken,
  });
const tokenResponse = () =>
  Response.json({
    access_token: credentials.returnedToken,
    token_type: 'bearer',
    expires_in: 3600,
  });

function expectNoCredentials(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const secret of Object.values(credentials)) {
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(encodeURIComponent(secret));
    expect(serialized).not.toContain(
      new URLSearchParams({ s: secret }).get('s'),
    );
    expect(serialized).not.toContain(
      new URLSearchParams({ s: secret }).toString().slice(2),
    );
  }
}

function expectSafeError(error: unknown, message: string) {
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(message);
  expect(error).not.toHaveProperty('cause');
  expectNoCredentials(
    Object.fromEntries(
      Object.getOwnPropertyNames(error).map((key) => [
        key,
        (error as unknown as Record<string, unknown>)[key],
      ]),
    ),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  writeDataPoint.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  try {
    expectNoCredentials([
      vi.mocked(console.info).mock.calls,
      vi.mocked(console.warn).mock.calls,
      vi.mocked(console.error).mock.calls,
      writeDataPoint.mock.calls,
    ]);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

describe('Meta credential-safe logging', () => {
  it.each([
    ['authorization code', exchangeCode, 'meta.oauth_exchange'],
    ['long-lived token', exchangeLongLived, 'meta.oauth_long_lived'],
  ] as const)(
    'keeps %s exchange behavior without logging queries',
    async (_, exchange, op) => {
      fetchMock.mockImplementation(async () => tokenResponse());

      await expect(exchange()).resolves.toEqual({
        accessToken: credentials.returnedToken,
        tokenType: 'bearer',
        expiresIn: 3600,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
      expect(url.origin + url.pathname).toBe(
        'https://graph.facebook.com/v19.0/oauth/access_token',
      );
      expect(url.searchParams.get('client_id')).toBe(common.appId);
      expect(url.searchParams.get('client_secret')).toBe(credentials.appSecret);
      if (op === 'meta.oauth_exchange') {
        expect(url.searchParams.get('code')).toBe(credentials.code);
        expect(url.searchParams.get('redirect_uri')).toBe(
          'https://app.example/api/auth/callback',
        );
      } else {
        expect(url.searchParams.get('fb_exchange_token')).toBe(
          credentials.accessToken,
        );
        expect(url.searchParams.get('grant_type')).toBe('fb_exchange_token');
      }
      expect(console.info).toHaveBeenCalledWith('Meta fetch request', {
        op,
        route: '/oauth/access_token',
        method: 'GET',
      });
    },
  );

  it('preserves both debug-token credentials in the request, not telemetry', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ data: { user_id: 'test-user', is_valid: true } }),
    );

    await expect(validateToken()).resolves.toEqual({
      user_id: 'test-user',
      is_valid: true,
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get('input_token')).toBe(credentials.inputToken);
    expect(url.searchParams.get('access_token')).toBe(credentials.appToken);
  });

  it.each(['Error', 'string', 'object'])(
    'does not log or rethrow a credential-bearing %s rejection',
    async (kind) => {
      fetchMock.mockImplementation(async (url) => {
        const message = `Failed ${url}; ${credentials.appSecret}`;
        if (kind === 'Error') {
          const error = new Error(message, { cause: credentials.code });
          error.name = credentials.appSecret;
          throw error;
        }
        if (kind === 'object') {
          throw { url, token: credentials.accessToken };
        }
        throw message;
      });

      // Attach rejection handling before advancing timers.
      const result = exchangeCode().catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expectSafeError(await result, 'Meta API network request failed');
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(console.error).toHaveBeenCalledTimes(5);
      expect(console.error).toHaveBeenLastCalledWith(
        'Meta API request failed',
        {
          op: 'meta.oauth_exchange',
          route: '/oauth/access_token',
          method: 'GET',
          status: undefined,
          attempt: 5,
          maxAttempts: 5,
        },
      );
    },
  );

  it.each([429, 503])(
    'retries HTTP %s without logging the request or response body',
    async (status) => {
      fetchMock.mockImplementation(async () =>
        Response.json(
          { error: { message: credentials.accessToken } },
          { status },
        ),
      );
      const result = exchangeLongLived().catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expectSafeError(await result, `Transient error: ${status}`);
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(console.error).toHaveBeenLastCalledWith(
        'Meta API request failed',
        {
          op: 'meta.oauth_long_lived',
          route: '/oauth/access_token',
          method: 'GET',
          status,
          attempt: 5,
          maxAttempts: 5,
        },
      );
    },
  );

  it('preserves exponential retry timing and recovers without changing credentials', async () => {
    const times: number[] = [];
    fetchMock.mockImplementation(async () => {
      times.push(Date.now());
      return times.length < 5
        ? new Response(null, { status: 503 })
        : tokenResponse();
    });
    const started = Date.now();
    const result = exchangeCode();
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({
      accessToken: credentials.returnedToken,
    });
    expect(times.map((time) => time - started)).toEqual([
      0, 400, 1200, 2800, 6000,
    ]);
    expect(new Set(fetchMock.mock.calls.map(([url]) => url)).size).toBe(1);
  });

  it.each([
    [exchangeCode, 'OAuth token request failed'],
    [exchangeLongLived, 'Long-lived token request failed'],
  ] as const)(
    'does not retry a non-transient OAuth failure',
    async (exchange, message) => {
      fetchMock.mockResolvedValue(
        Response.json(
          { error: { message: credentials.code } },
          { status: 400 },
        ),
      );
      const error = await exchange().catch((error: unknown) => error);
      expectSafeError(error, message);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([exchangeCode, exchangeLongLived])(
    'hides token-bearing JSON parse errors',
    async (exchange) => {
      fetchMock.mockResolvedValue(new Response(credentials.returnedToken));
      const error = await exchange().catch((error: unknown) => error);
      expectSafeError(error, 'Invalid Meta OAuth token response');
    },
  );

  it.each(['network', 'graph', 'raw'])(
    'hides credential-bearing debug-token %s failures',
    async (kind) => {
      fetchMock.mockImplementation(async (url) => {
        if (kind === 'network') throw new Error(`Cannot fetch ${url}`);
        if (kind === 'raw') {
          return new Response(credentials.inputToken, { status: 400 });
        }
        return Response.json(
          { error: { message: credentials.appToken, code: 190 } },
          { status: 400 },
        );
      });
      const result = validateToken().catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expectSafeError(await result, 'Meta token validation failed');
      expect(fetchMock).toHaveBeenCalledTimes(kind === 'network' ? 5 : 1);
    },
  );

  it('hides response stream errors before they can reach caller logs', async () => {
    fetchMock.mockImplementation(async () => {
      const response = Response.json({ data: [] });
      vi.spyOn(response, 'text').mockRejectedValue(
        new Error(credentials.accessToken),
      );
      return response;
    });
    const result = fetchPermissions({
      env,
      version: common.version,
      accessToken: credentials.accessToken,
    }).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expectSafeError(await result, 'Meta API response read failed');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('keeps telemetry-write failures credential-free and non-fatal', async () => {
    writeDataPoint.mockImplementation(() => {
      throw new Error(credentials.appSecret);
    });
    fetchMock.mockResolvedValue(tokenResponse());
    await expect(exchangeCode()).resolves.toMatchObject({
      accessToken: credentials.returnedToken,
    });
    expect(console.warn).toHaveBeenCalledWith(
      'Failed to write meta telemetry',
      {
        op: 'meta.oauth_exchange',
        route: '/oauth/access_token',
      },
    );
  });

  it('omits untrusted errors when falling back from owned pages to client pages', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: credentials.accessToken } },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: 'page', name: 'Page' }] }),
      );
    await expect(
      fetchBusinessPages({
        env,
        version: common.version,
        businessId: 'test-business',
        accessToken: credentials.accessToken,
      }),
    ).resolves.toEqual({
      source: 'client_pages',
      pages: [{ id: 'page', name: 'Page' }],
    });
    expect(console.warn).toHaveBeenCalledWith('Failed to fetch owned pages', {
      businessId: 'test-business',
      status: 400,
    });
  });
});
