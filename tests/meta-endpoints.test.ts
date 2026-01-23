import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { createMocks } from 'node-mocks-http';
import { createApp } from '../server/app';
import { metaTokens } from '../server/db/schema';
import { encryptString } from '../server/security/encryption';
import * as metaClient from '../server/meta/client';

vi.mock('../server/meta/client', () => ({
  fetchBusinessPages: vi.fn(),
  fetchBusinesses: vi.fn(),
  fetchPageToken: vi.fn(),
  fetchPermissions: vi.fn(),
  exchangeCodeForToken: vi.fn(),
}));

function setupApp() {
  process.env.META_APP_ID = 'test';
  process.env.META_APP_SECRET = 'test';
  process.env.META_REDIRECT_URI = 'http://localhost:3000/auth/meta/callback';
  process.env.APP_ENCRYPTION_KEY = 'test-key';
  process.env.DATABASE_PATH = `/tmp/msgstats-test-${randomUUID()}.sqlite`;

  return createApp();
}

async function requestJson(
  app: ReturnType<typeof createApp>['app'],
  url: string,
) {
  const { req, res } = createMocks({ method: 'GET', url });
  const handler = app as unknown as (req: unknown, res: unknown) => void;
  handler(req, res);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const data = res._getData();
  return {
    status: res._getStatusCode(),
    body: typeof data === 'string' ? JSON.parse(data) : data,
  };
}

describe('meta page discovery endpoint', () => {
  it('returns pages discovered via client_pages fallback', async () => {
    const { app, db, config } = setupApp();
    const encrypted = encryptString('user-token', config.appEncryptionKey);
    db.insert(metaTokens)
      .values({
        encryptedValue: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        tokenType: 'bearer',
        expiresAt: null,
        createdAt: new Date().toISOString(),
      })
      .run();

    const fetchBusinessPagesMock = vi.mocked(metaClient.fetchBusinessPages);
    fetchBusinessPagesMock.mockResolvedValue({
      pages: [{ id: 'p1', name: 'From Trees' }],
      source: 'client_pages',
    });

    const response = await requestJson(app, '/api/meta/businesses/biz1/pages');
    expect(response.status).toBe(200);
    expect(response.body[0].source).toBe('client_pages');
  });
});
