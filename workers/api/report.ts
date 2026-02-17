type ConversationRow = {
  id: string;
  pageId: string;
  platform: string;
  currentState: string | null;
  updatedTime: string;
  startedTime: string | null;
  lastMessageAt: string | null;
  lowResponseAfterPrice: number;
  customerCount: number;
  businessCount: number;
  priceGiven: number;
  earlyLost: number;
};

type ReportRow = {
  periodStart: string;
  total: number;
  productive: number;
  highly_productive: number;
  price_given: number;
  low_response_after_price: number;
  early_lost: number;
  early_lost_pct: number;
  qualified_rate: number;
  histogram: Record<number, number>;
};

const HISTOGRAM_MAX_BUCKET = 30;

function parseDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function getWeekStartUtc(date: Date) {
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = utc.getUTCDay();
  const diff = (day + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - diff);
  utc.setUTCHours(0, 0, 0, 0);
  return utc.toISOString().split('T')[0] ?? 'unknown';
}

export function getMonthStartUtc(date: Date) {
  return (
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
      .toISOString()
      .split('T')[0] ?? 'unknown'
  );
}

export function classifyTier(customer: number, business: number) {
  const highly = customer >= 5 && business >= 5;
  const productive = !highly && customer >= 3 && business >= 3;
  return { productive, highly };
}

export function buildReportRows(
  rows: ConversationRow[],
  interval: 'weekly' | 'monthly',
  bucket: 'started' | 'last',
): ReportRow[] {
  const emptyHistogram = () => {
    const histogram: Record<number, number> = {};
    for (let i = 1; i <= HISTOGRAM_MAX_BUCKET; i += 1) {
      histogram[i] = 0;
    }
    return histogram;
  };
  const buckets = new Map<
    string,
    {
      total: number;
      productive: number;
      highly: number;
      priceGiven: number;
      lowResponseAfterPrice: number;
      earlyLost: number;
      histogram: Record<number, number>;
    }
  >();
  for (const row of rows) {
    const timestamp =
      bucket === 'started'
        ? row.startedTime ?? row.updatedTime
        : row.lastMessageAt ?? row.updatedTime;
    const date = parseDate(timestamp);
    if (!date) {
      continue;
    }
    const key =
      interval === 'weekly' ? getWeekStartUtc(date) : getMonthStartUtc(date);
    const bucketStats = buckets.get(key) ?? {
      total: 0,
      productive: 0,
      highly: 0,
      priceGiven: 0,
      lowResponseAfterPrice: 0,
      earlyLost: 0,
      histogram: emptyHistogram(),
    };
    bucketStats.total += 1;
    const tier = classifyTier(row.customerCount, row.businessCount);
    if (tier.productive) {
      bucketStats.productive += 1;
    }
    if (tier.highly) {
      bucketStats.highly += 1;
    }
    if (row.priceGiven) {
      bucketStats.priceGiven += 1;
    }
    if (row.lowResponseAfterPrice) {
      bucketStats.lowResponseAfterPrice += 1;
    }
    if (row.earlyLost) {
      bucketStats.earlyLost += 1;
    }
    const messageCount = row.customerCount + row.businessCount;
    if (messageCount > 0) {
      const bucketIndex =
        messageCount >= HISTOGRAM_MAX_BUCKET
          ? HISTOGRAM_MAX_BUCKET
          : messageCount;
      bucketStats.histogram[bucketIndex] += 1;
    }
    buckets.set(key, bucketStats);
  }
  const sorted = [...buckets.entries()].sort((a, b) =>
    b[0].localeCompare(a[0]),
  );
  return sorted.map(([periodStart, stats]) => ({
    periodStart,
    total: stats.total,
    productive: stats.productive,
    highly_productive: stats.highly,
    price_given: stats.priceGiven,
    low_response_after_price: stats.lowResponseAfterPrice,
    early_lost: stats.earlyLost,
    early_lost_pct: stats.total ? stats.earlyLost / stats.total : 0,
    qualified_rate: stats.total
      ? (stats.productive + stats.highly) / stats.total
      : 0,
    histogram: stats.histogram,
  }));
}

export async function buildReportFromDb(options: {
  db: D1Database;
  userId: string;
  interval: 'weekly' | 'monthly';
  bucket: 'started' | 'last';
  pageId?: string | null;
  platform?: string | null;
}) {
  let query = `WITH filtered_conversations AS (
                 SELECT id,
                        page_id as pageId,
                        platform,
                        current_state as currentState,
                        updated_time as updatedTime,
                        started_time as startedTime,
                        last_message_at as lastMessageAt,
                        low_response_after_price as lowResponseAfterPrice,
                        customer_count as customerCount,
                        business_count as businessCount,
                        price_given as priceGiven
                 FROM conversations
                 WHERE conversations.user_id = ?
               ),
               first_lost AS (
                 SELECT events.conversation_id as conversationId,
                        MIN(events.triggered_at) as firstLostAt
                 FROM conversation_state_events events
                 JOIN filtered_conversations filtered
                   ON filtered.id = events.conversation_id
                 WHERE events.user_id = ?
                   AND events.to_state = 'LOST'
                 GROUP BY events.conversation_id
               ),
               lost_marker AS (
                 SELECT filtered.id as conversationId,
                        COALESCE(first_lost.firstLostAt, filtered.startedTime, filtered.updatedTime) as lostAt
                 FROM filtered_conversations filtered
                 LEFT JOIN first_lost
                   ON first_lost.conversationId = filtered.id
                 WHERE filtered.currentState = 'LOST'
               ),
               productive_before_lost AS (
                 SELECT DISTINCT events.conversation_id as conversationId
                 FROM conversation_state_events events
                 JOIN lost_marker
                   ON lost_marker.conversationId = events.conversation_id
                 WHERE events.user_id = ?
                   AND events.to_state IN ('PRODUCTIVE', 'HIGHLY_PRODUCTIVE')
                   AND events.triggered_at < lost_marker.lostAt
               )
               SELECT filtered.id,
                      filtered.pageId,
                      filtered.platform,
                      filtered.currentState,
                      filtered.updatedTime,
                      filtered.startedTime,
                      filtered.lastMessageAt,
                      filtered.lowResponseAfterPrice,
                      filtered.customerCount,
                      filtered.businessCount,
                      filtered.priceGiven,
                      CASE
                        WHEN filtered.currentState = 'LOST'
                         AND productive_before_lost.conversationId IS NULL
                        THEN 1
                        ELSE 0
                      END as earlyLost
               FROM filtered_conversations filtered
               LEFT JOIN productive_before_lost
                 ON productive_before_lost.conversationId = filtered.id
               WHERE 1 = 1`;
  const bindings: unknown[] = [options.userId, options.userId, options.userId];
  if (options.pageId) {
    query += ' AND filtered.pageId = ?';
    bindings.push(options.pageId);
  }
  if (options.platform) {
    query += ' AND filtered.platform = ?';
    bindings.push(options.platform);
  }
  const rows = await options.db
    .prepare(query)
    .bind(...bindings)
    .all<ConversationRow>();
  return buildReportRows(rows.results ?? [], options.interval, options.bucket);
}

export type { ConversationRow, ReportRow };
