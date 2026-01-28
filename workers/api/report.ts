type ConversationRow = {
  id: string;
  pageId: string;
  platform: string;
  updatedTime: string;
  startedTime: string | null;
  customerCount: number;
  businessCount: number;
  priceGiven: number;
};

type ReportRow = {
  periodStart: string;
  total: number;
  productive: number;
  highly_productive: number;
  price_given: number;
  qualified_rate: number;
};

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
  return utc.toISOString();
}

export function getMonthStartUtc(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
  ).toISOString();
}

export function classifyTier(customer: number, business: number) {
  const productive = customer >= 3 && business >= 3;
  const highly = customer >= 5 && business >= 5;
  return { productive, highly };
}

export function buildReportRows(
  rows: ConversationRow[],
  interval: 'weekly' | 'monthly',
): ReportRow[] {
  const buckets = new Map<
    string,
    { total: number; productive: number; highly: number; priceGiven: number }
  >();
  for (const row of rows) {
    const timestamp = row.startedTime ?? row.updatedTime;
    const date = parseDate(timestamp);
    if (!date) {
      continue;
    }
    const key =
      interval === 'weekly' ? getWeekStartUtc(date) : getMonthStartUtc(date);
    const bucket = buckets.get(key) ?? {
      total: 0,
      productive: 0,
      highly: 0,
      priceGiven: 0,
    };
    bucket.total += 1;
    const tier = classifyTier(row.customerCount, row.businessCount);
    if (tier.productive) {
      bucket.productive += 1;
    }
    if (tier.highly) {
      bucket.highly += 1;
    }
    if (row.priceGiven) {
      bucket.priceGiven += 1;
    }
    buckets.set(key, bucket);
  }
  const sorted = [...buckets.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  return sorted.map(([periodStart, stats]) => ({
    periodStart,
    total: stats.total,
    productive: stats.productive,
    highly_productive: stats.highly,
    price_given: stats.priceGiven,
    qualified_rate: stats.total
      ? (stats.productive + stats.highly) / stats.total
      : 0,
  }));
}

export async function buildReportFromDb(options: {
  db: D1Database;
  userId: string;
  interval: 'weekly' | 'monthly';
  pageId?: string | null;
  platform?: string | null;
}) {
  let query = `SELECT id, page_id as pageId, platform, updated_time as updatedTime,
                     started_time as startedTime, customer_count as customerCount,
                     business_count as businessCount, price_given as priceGiven
              FROM conversations
              WHERE user_id = ?`;
  const bindings: unknown[] = [options.userId];
  if (options.pageId) {
    query += ' AND page_id = ?';
    bindings.push(options.pageId);
  }
  if (options.platform) {
    query += ' AND platform = ?';
    bindings.push(options.platform);
  }
  const rows = await options.db
    .prepare(query)
    .bind(...bindings)
    .all<ConversationRow>();
  return buildReportRows(rows.results ?? [], options.interval);
}

export type { ConversationRow, ReportRow };
