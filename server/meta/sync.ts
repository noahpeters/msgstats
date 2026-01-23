import { randomUUID } from 'crypto';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, desc, eq } from 'drizzle-orm';
import { decryptString } from '../security/encryption';
import {
  conversations,
  messages,
  metaPages,
  metaTokens,
  syncStates,
} from '../db/schema';
import {
  fetchConversationMessages,
  fetchConversations,
  fetchPageName,
} from './client';
import type { MetaConversation } from './client';
import type { AppConfig } from '../config';

export type SyncStatus = {
  running: boolean;
  pageId?: string;
  platform?: string;
  conversationsProcessed: number;
  conversationsTotalEstimate?: number;
  messagesProcessed: number;
  startedAt?: string;
  lastUpdatedAt?: string;
  error?: string;
};

const syncStatus: SyncStatus = {
  running: false,
  conversationsProcessed: 0,
  messagesProcessed: 0,
};

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: limit }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (!next) {
        return;
      }
      await worker(next);
    }
  });
  await Promise.all(runners);
}

export function getSyncStatus(): SyncStatus {
  return syncStatus;
}

export async function runMessengerSync(options: {
  db: BetterSQLite3Database;
  config: AppConfig;
  pageId: string;
}): Promise<void> {
  const { db, config, pageId } = options;
  const pageRow = db
    .select()
    .from(metaPages)
    .where(eq(metaPages.id, pageId))
    .get();

  if (!pageRow) {
    throw new Error('Page token not found. Enable page first.');
  }

  const pageToken = decryptString(
    {
      ciphertext: pageRow.encryptedAccessToken,
      iv: pageRow.iv,
      tag: pageRow.tag,
    },
    config.appEncryptionKey,
  );
  const normalizedName = pageRow.name?.trim().toLowerCase();
  if (!pageRow.name || !pageRow.name.trim() || normalizedName === 'page') {
    let resolvedName: string | null = null;
    try {
      const fresh = await fetchPageName({
        pageId,
        accessToken: pageToken,
        version: config.metaApiVersion,
      });
      resolvedName = fresh.name;
    } catch {
      // ignore page-token name errors
    }

    if (!resolvedName) {
      const userTokenRow = db
        .select()
        .from(metaTokens)
        .orderBy(desc(metaTokens.createdAt))
        .get();
      if (userTokenRow) {
        const userToken = decryptString(
          {
            ciphertext: userTokenRow.encryptedValue,
            iv: userTokenRow.iv,
            tag: userTokenRow.tag,
          },
          config.appEncryptionKey,
        );
        try {
          const fresh = await fetchPageName({
            pageId,
            accessToken: userToken,
            version: config.metaApiVersion,
          });
          resolvedName = fresh.name;
        } catch {
          // ignore user-token name errors
        }
      }
    }

    if (resolvedName && resolvedName.trim()) {
      db.update(metaPages)
        .set({ name: resolvedName.trim(), updatedAt: new Date().toISOString() })
        .where(eq(metaPages.id, pageId))
        .run();
    }
  }

  const syncState = db
    .select()
    .from(syncStates)
    .where(
      and(eq(syncStates.pageId, pageId), eq(syncStates.platform, 'messenger')),
    )
    .orderBy(desc(syncStates.updatedAt))
    .get();

  const safetyWindowMs = 5 * 60 * 1000;
  const sinceTime = syncState?.lastSyncedAt
    ? new Date(new Date(syncState.lastSyncedAt).getTime() - safetyWindowMs)
    : null;
  const sinceUnix = sinceTime
    ? Math.floor(sinceTime.getTime() / 1000).toString()
    : undefined;

  const conversationsList = await fetchConversations({
    pageId,
    accessToken: pageToken,
    version: config.metaApiVersion,
    since: sinceUnix,
  });

  const filteredConversations = sinceTime
    ? conversationsList.filter(
        (item) => new Date(item.updated_time) >= sinceTime,
      )
    : conversationsList;

  syncStatus.conversationsTotalEstimate = filteredConversations.length;

  let messagesProcessed = 0;
  let conversationsProcessed = 0;
  let latestUpdatedTime: string | null = null;

  const processConversation = async (convo: MetaConversation) => {
    const convoMessages = await fetchConversationMessages({
      conversationId: convo.id,
      accessToken: pageToken,
      version: config.metaApiVersion,
    });

    let customerCount = 0;
    let businessCount = 0;
    let startedTime: string | null = null;
    let lastMessageAt: string | null = null;

    for (const msg of convoMessages) {
      messagesProcessed += 1;
      const senderType = msg.from?.id === pageId ? 'business' : 'customer';
      if (senderType === 'business') {
        businessCount += 1;
      } else {
        customerCount += 1;
      }
      if (!startedTime || msg.created_time < startedTime) {
        startedTime = msg.created_time;
      }
      if (!lastMessageAt || msg.created_time > lastMessageAt) {
        lastMessageAt = msg.created_time;
      }
      db.insert(messages)
        .values({
          id: msg.id,
          conversationId: convo.id,
          pageId,
          senderType,
          body: msg.message ?? null,
          createdTime: msg.created_time,
        })
        .onConflictDoNothing()
        .run();
    }

    db.insert(conversations)
      .values({
        id: convo.id,
        platform: 'messenger',
        pageId,
        igBusinessId: null,
        updatedTime: convo.updated_time,
        startedTime: startedTime ?? convo.updated_time,
        lastMessageAt: lastMessageAt ?? convo.updated_time,
        customerCount,
        businessCount,
        priceGiven: 0,
      })
      .onConflictDoUpdate({
        target: conversations.id,
        set: {
          updatedTime: convo.updated_time,
          startedTime: startedTime ?? convo.updated_time,
          lastMessageAt: lastMessageAt ?? convo.updated_time,
          customerCount,
          businessCount,
        },
      })
      .run();

    conversationsProcessed += 1;
    syncStatus.conversationsProcessed = conversationsProcessed;
    syncStatus.messagesProcessed = messagesProcessed;
    syncStatus.lastUpdatedAt = new Date().toISOString();

    if (!latestUpdatedTime || convo.updated_time > latestUpdatedTime) {
      latestUpdatedTime = convo.updated_time;
    }
  };

  const concurrencyLimit = 3;
  await mapWithConcurrency(
    filteredConversations,
    concurrencyLimit,
    processConversation,
  );

  const syncTime = latestUpdatedTime ?? new Date().toISOString();
  db.insert(syncStates)
    .values({
      pageId,
      platform: 'messenger',
      lastSyncedAt: syncTime,
      updatedAt: new Date().toISOString(),
    })
    .run();
}

export function startMessengerSync(options: {
  db: BetterSQLite3Database;
  config: AppConfig;
  pageId: string;
}): string {
  if (syncStatus.running) {
    return syncStatus.pageId ?? 'busy';
  }

  const runId = randomUUID();
  syncStatus.running = true;
  syncStatus.pageId = options.pageId;
  syncStatus.platform = 'messenger';
  syncStatus.conversationsProcessed = 0;
  syncStatus.messagesProcessed = 0;
  syncStatus.startedAt = new Date().toISOString();
  syncStatus.lastUpdatedAt = syncStatus.startedAt;
  syncStatus.error = undefined;

  void runMessengerSync(options)
    .catch((error) => {
      syncStatus.error =
        error instanceof Error ? error.message : 'Unknown sync error';
    })
    .finally(() => {
      syncStatus.running = false;
      syncStatus.lastUpdatedAt = new Date().toISOString();
    });

  return runId;
}
