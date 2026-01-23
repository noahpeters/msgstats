import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { conversations, messages } from './schema';

export async function recomputeConversationStats(
  db: BetterSQLite3Database,
): Promise<{ updated: number }> {
  const convoRows = db
    .select({ id: conversations.id })
    .from(conversations)
    .all();

  const messageRows = db
    .select({
      conversationId: messages.conversationId,
      senderType: messages.senderType,
      body: messages.body,
      createdTime: messages.createdTime,
    })
    .from(messages)
    .all();

  const stats = new Map<
    string,
    {
      customerCount: number;
      businessCount: number;
      priceGiven: number;
      startedTime: string | null;
    }
  >();

  for (const row of messageRows) {
    const entry = stats.get(row.conversationId) ?? {
      customerCount: 0,
      businessCount: 0,
      priceGiven: 0,
      startedTime: null,
    };
    if (row.senderType === 'business') {
      entry.businessCount += 1;
      if (entry.priceGiven === 0 && row.body?.includes('$')) {
        entry.priceGiven = 1;
      }
    } else {
      entry.customerCount += 1;
    }
    if (!entry.startedTime || row.createdTime < entry.startedTime) {
      entry.startedTime = row.createdTime;
    }
    stats.set(row.conversationId, entry);
  }

  let updated = 0;
  for (const convo of convoRows) {
    const entry = stats.get(convo.id) ?? {
      customerCount: 0,
      businessCount: 0,
      priceGiven: 0,
      startedTime: null,
    };
    db.update(conversations)
      .set({
        customerCount: entry.customerCount,
        businessCount: entry.businessCount,
        priceGiven: entry.priceGiven,
        startedTime: entry.startedTime,
      })
      .where(eq(conversations.id, convo.id))
      .run();
    updated += 1;
  }

  return { updated };
}
