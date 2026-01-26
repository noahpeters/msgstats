import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { createMocks } from 'node-mocks-http';
import { createApp } from '../server/app';
import {
  igAssets,
  metaPages,
  metaTokens,
  conversations,
  messages,
  syncStates,
} from '../server/db/schema';
import { encryptString } from '../server/security/encryption';
import { runInstagramSync } from '../server/meta/sync';
import * as metaClient from '../server/meta/client';
import { eq, and } from 'drizzle-orm';

vi.mock('../server/meta/client', () => ({
  fetchIgConversations: vi.fn(),
  fetchIgConversationMessages: vi.fn(),
  fetchPageName: vi.fn(),
  fetchInstagramAssets: vi.fn(),
  fetchPageToken: vi.fn(),
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

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function requestJson(
  app: ReturnType<typeof createApp>['app'],
  method: HttpMethod,
  url: string,
  body?: unknown,
) {
  const { req, res } = createMocks({
    method,
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

describe('instagram sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts conversations and messages for instagram', async () => {
    const { db, config } = setupApp();
    const pageId = 'page-1';
    const igId = 'ig-1';
    const encrypted = encryptString('page-token', config.appEncryptionKey);
    db.insert(metaPages)
      .values({
        id: pageId,
        name: 'Page',
        encryptedAccessToken: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        updatedAt: new Date().toISOString(),
      })
      .run();
    db.insert(igAssets)
      .values({
        id: igId,
        name: 'IG Account',
        pageId,
        updatedAt: new Date().toISOString(),
      })
      .run();

    const fetchConvos = vi.mocked(metaClient.fetchIgConversations);
    const fetchMessages = vi.mocked(metaClient.fetchIgConversationMessages);
    fetchConvos.mockResolvedValue([
      { id: 'c1', updated_time: '2024-06-01T00:10:00Z' },
      { id: 'c2', updated_time: '2024-06-01T01:10:00Z' },
    ]);
    fetchMessages
      .mockResolvedValueOnce([
        {
          id: 'm1',
          from: { id: igId },
          created_time: '2024-06-01T00:00:00Z',
          message: 'Hi',
        },
        {
          id: 'm2',
          from: { id: 'user-1' },
          created_time: '2024-06-01T00:01:00Z',
          message: 'Hello',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'm3',
          from: { id: 'user-2' },
          created_time: '2024-06-01T01:00:00Z',
          message: 'Need help',
        },
      ]);

    await runInstagramSync({ db, config, pageId, igId });

    const convoRows = db
      .select()
      .from(conversations)
      .where(eq(conversations.platform, 'instagram'))
      .all();
    expect(convoRows).toHaveLength(2);
    expect(convoRows[0]?.igBusinessId).toBe(igId);

    const msgRows = db.select().from(messages).all();
    expect(msgRows).toHaveLength(3);
    expect(msgRows.filter((row) => row.senderType === 'business')).toHaveLength(
      1,
    );

    const syncRow = db
      .select()
      .from(syncStates)
      .where(
        and(
          eq(syncStates.pageId, pageId),
          eq(syncStates.platform, 'instagram'),
        ),
      )
      .get();
    expect(syncRow).toBeTruthy();
  });

  it('updates placeholder page name during instagram sync', async () => {
    const { db, config } = setupApp();
    const pageId = 'page-1';
    const igId = 'ig-1';
    const encrypted = encryptString('page-token', config.appEncryptionKey);
    db.insert(metaPages)
      .values({
        id: pageId,
        name: 'Page',
        encryptedAccessToken: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        updatedAt: new Date().toISOString(),
      })
      .run();
    db.insert(igAssets)
      .values({
        id: igId,
        name: 'IG Account',
        pageId,
        updatedAt: new Date().toISOString(),
      })
      .run();

    vi.mocked(metaClient.fetchIgConversations).mockResolvedValue([]);
    vi.mocked(metaClient.fetchIgConversationMessages).mockResolvedValue([]);
    vi.mocked(metaClient.fetchPageName).mockResolvedValue({
      id: pageId,
      name: 'fromtrees.studio',
    });

    await runInstagramSync({ db, config, pageId, igId });

    const stored = db
      .select()
      .from(metaPages)
      .where(eq(metaPages.id, pageId))
      .get();
    expect(stored?.name).toBe('fromtrees.studio');
  });

  it('does not update correct name during instagram sync', async () => {
    const { db, config } = setupApp();
    const pageId = 'page-1';
    const igId = 'ig-1';
    const encrypted = encryptString('page-token', config.appEncryptionKey);
    db.insert(metaPages)
      .values({
        id: pageId,
        name: 'fromtrees.studio',
        encryptedAccessToken: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        updatedAt: new Date().toISOString(),
      })
      .run();
    db.insert(igAssets)
      .values({
        id: igId,
        name: 'IG Account',
        pageId,
        updatedAt: new Date().toISOString(),
      })
      .run();

    vi.mocked(metaClient.fetchIgConversations).mockResolvedValue([]);
    vi.mocked(metaClient.fetchIgConversationMessages).mockResolvedValue([]);
    const fetchName = vi.mocked(metaClient.fetchPageName);

    await runInstagramSync({ db, config, pageId, igId });

    expect(fetchName).not.toHaveBeenCalled();
  });
});

describe('instagram endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads ig assets for a page', async () => {
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

    vi.mocked(metaClient.fetchInstagramAssets).mockResolvedValue([
      { id: 'ig-1', name: 'IG One' },
    ]);

    const response = await requestJson(
      app,
      'GET',
      '/api/meta/pages/page-1/ig-assets',
    );
    expect(response.status).toBe(200);
    expect(response.body.igAssets).toHaveLength(1);

    const stored = db
      .select()
      .from(igAssets)
      .where(eq(igAssets.id, 'ig-1'))
      .get();
    expect(stored?.pageId).toBe('page-1');
  });

  it('starts instagram sync from endpoint', async () => {
    const { app, db, config } = setupApp();
    const pageId = 'page-1';
    const igId = 'ig-1';
    const encrypted = encryptString('page-token', config.appEncryptionKey);
    db.insert(metaPages)
      .values({
        id: pageId,
        name: 'Page',
        encryptedAccessToken: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        updatedAt: new Date().toISOString(),
      })
      .run();
    db.insert(igAssets)
      .values({
        id: igId,
        name: 'IG Account',
        pageId,
        updatedAt: new Date().toISOString(),
      })
      .run();

    vi.mocked(metaClient.fetchIgConversations).mockResolvedValue([]);
    vi.mocked(metaClient.fetchIgConversationMessages).mockResolvedValue([]);

    const response = await requestJson(
      app,
      'POST',
      `/api/sync/pages/${pageId}/instagram/${igId}`,
    );
    expect(response.status).toBe(200);
  });
});
