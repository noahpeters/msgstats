import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { createMocks } from 'node-mocks-http';
import { createApp } from '../server/app';
import { metaPages, metaTokens } from '../server/db/schema';
import { encryptString } from '../server/security/encryption';
import { runMessengerSync } from '../server/meta/sync';
import * as metaClient from '../server/meta/client';
import { eq } from 'drizzle-orm';

vi.mock('../server/meta/client', () => ({
  fetchPageToken: vi.fn(),
  fetchPageName: vi.fn(),
  fetchConversations: vi.fn(),
  fetchConversationMessages: vi.fn(),
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
  body?: unknown,
) {
  const { req, res } = createMocks({
    method: 'POST',
    url,
    body: body as Record<string, unknown> | undefined,
    headers: { 'Content-Type': 'application/json' },
  });
  const handler = app as unknown as (req: unknown, res: unknown) => void;
  handler(req, res);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const data = res._getData();
  return {
    status: res._getStatusCode(),
    body: typeof data === 'string' ? JSON.parse(data) : data,
  };
}

describe('meta page name storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores the real page name on enable', async () => {
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

    const fetchPageTokenMock = vi.mocked(metaClient.fetchPageToken);
    fetchPageTokenMock.mockResolvedValue({
      id: '123',
      name: 'fromtrees.studio',
      accessToken: 'fake-token',
    });

    const response = await requestJson(app, '/api/meta/pages/123/token', {
      name: 'fromtrees.studio',
    });
    expect(response.status).toBe(200);

    const stored = db
      .select()
      .from(metaPages)
      .where(eq(metaPages.id, '123'))
      .get();
    expect(stored?.name).toBe('fromtrees.studio');
    expect(stored?.name).not.toBe('Page');
  });
});

describe('sync page name refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates a placeholder name during sync', async () => {
    const { db, config } = setupApp();
    const encrypted = encryptString('page-token', config.appEncryptionKey);
    db.insert(metaPages)
      .values({
        id: '123',
        name: 'Page',
        encryptedAccessToken: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        updatedAt: new Date().toISOString(),
      })
      .run();

    const fetchConversationsMock = vi.mocked(metaClient.fetchConversations);
    const fetchMessagesMock = vi.mocked(metaClient.fetchConversationMessages);
    const fetchPageNameMock = vi.mocked(metaClient.fetchPageName);
    fetchConversationsMock.mockResolvedValue([]);
    fetchMessagesMock.mockResolvedValue([]);
    fetchPageNameMock.mockResolvedValue({
      id: '123',
      name: 'fromtrees.studio',
    });

    await runMessengerSync({ db, config, pageId: '123' });

    const stored = db
      .select()
      .from(metaPages)
      .where(eq(metaPages.id, '123'))
      .get();
    expect(stored?.name).toBe('fromtrees.studio');
  });

  it('does not update a correct name during sync', async () => {
    const { db, config } = setupApp();
    const encrypted = encryptString('page-token', config.appEncryptionKey);
    db.insert(metaPages)
      .values({
        id: '123',
        name: 'fromtrees.studio',
        encryptedAccessToken: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        updatedAt: new Date().toISOString(),
      })
      .run();

    const fetchConversationsMock = vi.mocked(metaClient.fetchConversations);
    const fetchMessagesMock = vi.mocked(metaClient.fetchConversationMessages);
    const fetchPageNameMock = vi.mocked(metaClient.fetchPageName);
    fetchConversationsMock.mockResolvedValue([]);
    fetchMessagesMock.mockResolvedValue([]);

    await runMessengerSync({ db, config, pageId: '123' });

    expect(fetchPageNameMock).not.toHaveBeenCalled();
    const stored = db
      .select()
      .from(metaPages)
      .where(eq(metaPages.id, '123'))
      .get();
    expect(stored?.name).toBe('fromtrees.studio');
  });
});
