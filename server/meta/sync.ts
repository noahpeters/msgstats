import { randomUUID } from 'crypto';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { desc, eq } from 'drizzle-orm';
import { encryptString, decryptString } from '../security/encryption';
import {
  conversations,
  messages,
  metaPages,
  metaTokens,
  syncRuns,
  igAssets,
} from '../db/schema';
import {
  fetchPages,
  fetchConversations,
  fetchMessages,
  fetchInstagramAssets,
} from './client';
import type { AppConfig } from '../config';

export type SyncProgress = {
  pages: number;
  conversations: number;
  messages: number;
};

export async function startMetaSync(options: {
  db: BetterSQLite3Database;
  config: AppConfig;
}): Promise<string> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  options.db
    .insert(syncRuns)
    .values({
      id: runId,
      status: 'running',
      startedAt,
      finishedAt: null,
      lastError: null,
      pages: 0,
      conversations: 0,
      messages: 0,
    })
    .run();

  void performMetaSync({ ...options, runId }).catch((error) => {
    const message =
      error instanceof Error ? error.message : 'Unknown sync error';
    options.db
      .update(syncRuns)
      .set({
        status: 'error',
        finishedAt: new Date().toISOString(),
        lastError: message,
      })
      .where(eq(syncRuns.id, runId))
      .run();
  });

  return runId;
}

async function performMetaSync(options: {
  db: BetterSQLite3Database;
  config: AppConfig;
  runId: string;
}): Promise<void> {
  const tokenRow = options.db
    .select()
    .from(metaTokens)
    .orderBy(desc(metaTokens.createdAt))
    .get();

  if (!tokenRow) {
    throw new Error('No Meta token found. Connect Meta first.');
  }

  const userToken = decryptString(
    {
      ciphertext: tokenRow.encryptedValue,
      iv: tokenRow.iv,
      tag: tokenRow.tag,
    },
    options.config.appEncryptionKey,
  );

  const pages =
    options.config.metaPageId && options.config.metaPageAccessToken
      ? [
          {
            id: options.config.metaPageId,
            name: 'Page',
            access_token: options.config.metaPageAccessToken,
          },
        ]
      : await fetchPages({
          accessToken: userToken,
          version: options.config.metaApiVersion,
        });

  let pageCount = 0;
  let conversationCount = 0;
  let messageCount = 0;

  for (const page of pages) {
    if (!page.access_token) {
      throw new Error(
        `Missing page access token for page ${page.id}. Check Meta scopes and re-connect.`,
      );
    }
    pageCount += 1;
    const pageToken = encryptString(
      page.access_token,
      options.config.appEncryptionKey,
    );
    options.db
      .insert(metaPages)
      .values({
        id: page.id,
        name: page.name,
        encryptedAccessToken: pageToken.ciphertext,
        iv: pageToken.iv,
        tag: pageToken.tag,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: metaPages.id,
        set: {
          name: page.name,
          encryptedAccessToken: pageToken.ciphertext,
          iv: pageToken.iv,
          tag: pageToken.tag,
          updatedAt: new Date().toISOString(),
        },
      })
      .run();

    const conversationsList = await fetchConversations({
      pageId: page.id,
      accessToken: page.access_token,
      version: options.config.metaApiVersion,
    });

    for (const convo of conversationsList) {
      conversationCount += 1;
      const convoMessages = await fetchMessages({
        conversationId: convo.id,
        accessToken: page.access_token,
        version: options.config.metaApiVersion,
      });

      let customerCount = 0;
      let businessCount = 0;
      let priceGiven = 0;
      let startedTime: string | null = null;
      for (const msg of convoMessages) {
        messageCount += 1;
        const senderType = msg.from?.id === page.id ? 'business' : 'customer';
        if (!startedTime || msg.created_time < startedTime) {
          startedTime = msg.created_time;
        }
        if (senderType === 'business') {
          businessCount += 1;
          if (priceGiven === 0 && msg.message?.includes('$')) {
            priceGiven = 1;
          }
        } else {
          customerCount += 1;
        }
        options.db
          .insert(messages)
          .values({
            id: msg.id,
            conversationId: convo.id,
            pageId: page.id,
            senderType,
            body: msg.message ?? null,
            createdTime: msg.created_time,
          })
          .onConflictDoNothing()
          .run();
      }

      options.db
        .insert(conversations)
        .values({
          id: convo.id,
          platform: 'facebook',
          pageId: page.id,
          igBusinessId: null,
          updatedTime: convo.updated_time,
          startedTime: startedTime ?? convo.updated_time,
          customerCount,
          businessCount,
          priceGiven,
        })
        .onConflictDoUpdate({
          target: conversations.id,
          set: {
            updatedTime: convo.updated_time,
            startedTime: startedTime ?? convo.updated_time,
            customerCount,
            businessCount,
            priceGiven,
          },
        })
        .run();

      options.db
        .update(syncRuns)
        .set({
          pages: pageCount,
          conversations: conversationCount,
          messages: messageCount,
        })
        .where(eq(syncRuns.id, options.runId))
        .run();
    }

    options.db
      .update(syncRuns)
      .set({
        pages: pageCount,
        conversations: conversationCount,
        messages: messageCount,
      })
      .where(eq(syncRuns.id, options.runId))
      .run();

    if (options.config.igEnabled) {
      const igList = await fetchInstagramAssets({
        pageId: page.id,
        accessToken: page.access_token,
        version: options.config.metaApiVersion,
      });
      for (const asset of igList) {
        options.db
          .insert(igAssets)
          .values({
            id: asset.id,
            name: asset.name ?? 'Instagram Business',
            pageId: page.id,
            updatedAt: new Date().toISOString(),
          })
          .onConflictDoUpdate({
            target: igAssets.id,
            set: {
              name: asset.name ?? 'Instagram Business',
              pageId: page.id,
              updatedAt: new Date().toISOString(),
            },
          })
          .run();
      }
    }
  }

  options.db
    .update(syncRuns)
    .set({
      status: 'completed',
      finishedAt: new Date().toISOString(),
      pages: pageCount,
      conversations: conversationCount,
      messages: messageCount,
    })
    .where(eq(syncRuns.id, options.runId))
    .run();
}
