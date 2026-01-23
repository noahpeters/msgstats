import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { conversations } from '../db/schema';
import { getProductiveTier } from '../../src/shared/tiers';
import {
  formatDateKey,
  startOfMonthUTC,
  startOfWeekUTC,
} from '../../src/shared/time';
import { eq } from 'drizzle-orm';

export type ReportRow = {
  period: string;
  total: number;
  productive: number;
  highlyProductive: number;
  qualifiedRate: number;
};

function rollup(
  rows: {
    updatedTime: string;
    customerCount: number;
    businessCount: number;
  }[],
  mode: 'weekly' | 'monthly',
): ReportRow[] {
  const buckets = new Map<
    string,
    { total: number; productive: number; highly: number }
  >();

  for (const row of rows) {
    const date = new Date(row.updatedTime);
    const periodDate =
      mode === 'weekly' ? startOfWeekUTC(date) : startOfMonthUTC(date);
    const key = formatDateKey(periodDate);
    const tier = getProductiveTier(row.customerCount, row.businessCount);
    const bucket = buckets.get(key) ?? { total: 0, productive: 0, highly: 0 };
    bucket.total += 1;
    if (tier === 'productive') {
      bucket.productive += 1;
    }
    if (tier === 'highly_productive') {
      bucket.highly += 1;
    }
    buckets.set(key, bucket);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([period, bucket]) => {
      const qualifiedCount = bucket.productive + bucket.highly;
      return {
        period,
        total: bucket.total,
        productive: bucket.productive,
        highlyProductive: bucket.highly,
        qualifiedRate: bucket.total === 0 ? 0 : qualifiedCount / bucket.total,
      };
    });
}

export function buildReport(
  db: BetterSQLite3Database,
  mode: 'weekly' | 'monthly',
): ReportRow[] {
  const rows = db
    .select({
      updatedTime: conversations.updatedTime,
      customerCount: conversations.customerCount,
      businessCount: conversations.businessCount,
    })
    .from(conversations)
    .all();

  return rollup(rows, mode);
}

export function buildReportForPage(
  db: BetterSQLite3Database,
  pageId: string,
  mode: 'weekly' | 'monthly',
): ReportRow[] {
  const rows = db
    .select({
      updatedTime: conversations.updatedTime,
      customerCount: conversations.customerCount,
      businessCount: conversations.businessCount,
    })
    .from(conversations)
    .where(eq(conversations.pageId, pageId))
    .all();

  return rollup(rows, mode);
}
