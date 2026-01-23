import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../server/app';
import {
  conversations,
  messages,
  metaPages,
  syncStates,
} from '../server/db/schema';
import { encryptString } from '../server/security/encryption';
import { runMessengerSync } from '../server/meta/sync';
import * as metaClient from '../server/meta/client';

vi.mock('../server/meta/client', () => ({
  fetchConversations: vi.fn(),
  fetchConversationMessages: vi.fn(),
  fetchPageName: vi.fn(),
}));

function setupApp() {
  process.env.META_APP_ID = 'test';
  process.env.META_APP_SECRET = 'test';
  process.env.META_REDIRECT_URI = 'http://localhost:3000/auth/meta/callback';
  process.env.APP_ENCRYPTION_KEY = 'test-key';
  process.env.DATABASE_PATH = `/tmp/msgstats-test-${randomUUID()}.sqlite`;

  return createApp();
}

describe('runMessengerSync', () => {
  it('counts sender types and stores conversations/messages', async () => {
    const { db, config } = setupApp();
    const pageId = 'page-1';
    const encrypted = encryptString('page-token', config.appEncryptionKey);
    db.insert(metaPages)
      .values({
        id: pageId,
        name: 'Test Page',
        encryptedAccessToken: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        updatedAt: new Date().toISOString(),
      })
      .run();

    const fetchConversationsMock = vi.mocked(metaClient.fetchConversations);
    const fetchMessagesMock = vi.mocked(metaClient.fetchConversationMessages);

    fetchConversationsMock.mockResolvedValue([
      { id: 'convo-1', updated_time: '2024-05-01T00:10:00Z' },
    ]);
    fetchMessagesMock.mockResolvedValue([
      {
        id: 'm1',
        from: { id: pageId },
        created_time: '2024-05-01T00:00:00Z',
        message: 'Hello $50',
      },
      {
        id: 'm2',
        from: { id: 'user-1' },
        created_time: '2024-05-01T00:01:00Z',
        message: 'Hi there',
      },
      {
        id: 'm3',
        from: { id: pageId },
        created_time: '2024-05-01T00:02:00Z',
        message: 'Follow up',
      },
      {
        id: 'm4',
        from: { id: 'user-2' },
        created_time: '2024-05-01T00:03:00Z',
        message: 'Thanks',
      },
    ]);

    await runMessengerSync({ db, config, pageId });

    const convo = db
      .select()
      .from(conversations)
      .where(eq(conversations.id, 'convo-1'))
      .get();
    expect(convo).toBeTruthy();
    expect(convo?.customerCount).toBe(2);
    expect(convo?.businessCount).toBe(2);
    expect(convo?.startedTime).toBe('2024-05-01T00:00:00Z');
    expect(convo?.lastMessageAt).toBe('2024-05-01T00:03:00Z');

    const storedMessages = db.select().from(messages).all();
    const businessMessages = storedMessages.filter(
      (message) => message.senderType === 'business',
    );
    const customerMessages = storedMessages.filter(
      (message) => message.senderType === 'customer',
    );
    expect(businessMessages).toHaveLength(2);
    expect(customerMessages).toHaveLength(2);
    expect(storedMessages.find((row) => row.id === 'm1')?.body).toBe(
      'Hello $50',
    );

    const state = db
      .select()
      .from(syncStates)
      .where(eq(syncStates.pageId, pageId))
      .get();
    expect(state?.lastSyncedAt).toBe('2024-05-01T00:10:00Z');
  });
});
