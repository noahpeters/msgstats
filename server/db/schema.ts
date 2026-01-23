import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const metaTokens = sqliteTable('meta_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  encryptedValue: text('encrypted_value').notNull(),
  iv: text('iv').notNull(),
  tag: text('tag').notNull(),
  tokenType: text('token_type').notNull(),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').notNull(),
});

export const metaOauthStates = sqliteTable('meta_oauth_states', {
  state: text('state').primaryKey(),
  createdAt: text('created_at').notNull(),
});

export const metaPages = sqliteTable('meta_pages', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  encryptedAccessToken: text('encrypted_access_token').notNull(),
  iv: text('iv').notNull(),
  tag: text('tag').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const igAssets = sqliteTable('ig_assets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  pageId: text('page_id').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    platform: text('platform').notNull(),
    pageId: text('page_id').notNull(),
    igBusinessId: text('ig_business_id'),
    updatedTime: text('updated_time').notNull(),
    startedTime: text('started_time'),
    customerCount: integer('customer_count').notNull(),
    businessCount: integer('business_count').notNull(),
    priceGiven: integer('price_given').notNull().default(0),
  },
  (table) => ({
    pageIdx: index('conversations_page_idx').on(table.pageId),
  }),
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    pageId: text('page_id').notNull(),
    senderType: text('sender_type').notNull(),
    body: text('body'),
    createdTime: text('created_time').notNull(),
  },
  (table) => ({
    convoIdx: index('messages_conversation_idx').on(table.conversationId),
  }),
);

export const syncRuns = sqliteTable('sync_runs', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  lastError: text('last_error'),
  pages: integer('pages').notNull(),
  conversations: integer('conversations').notNull(),
  messages: integer('messages').notNull(),
});
