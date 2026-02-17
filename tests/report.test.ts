import { describe, expect, it } from 'vitest';
import {
  buildReportFromDb,
  buildReportRows,
  classifyTier,
  getMonthStartUtc,
  getWeekStartUtc,
} from '../workers/api/report';

describe('report helpers', () => {
  it('classifies tiers with thresholds 3/5', () => {
    expect(classifyTier(2, 3)).toEqual({ productive: false, highly: false });
    expect(classifyTier(3, 3)).toEqual({ productive: true, highly: false });
    expect(classifyTier(5, 5)).toEqual({ productive: false, highly: true });
  });

  it('buckets by week and month in UTC', () => {
    const date = new Date('2026-01-14T18:00:00.000Z'); // Wed
    expect(getWeekStartUtc(date)).toBe('2026-01-12');
    expect(getMonthStartUtc(date)).toBe('2026-01-01');
  });

  it('builds report rows from conversations', () => {
    const rows = [
      {
        id: 'c1',
        pageId: 'p1',
        platform: 'messenger',
        currentState: 'PRODUCTIVE',
        updatedTime: '2026-01-10T12:00:00.000Z',
        startedTime: '2026-01-10T10:00:00.000Z',
        lastMessageAt: '2026-01-10T12:00:00.000Z',
        lowResponseAfterPrice: 1,
        customerCount: 3,
        businessCount: 3,
        priceGiven: 1,
        earlyLost: 0,
      },
      {
        id: 'c2',
        pageId: 'p1',
        platform: 'messenger',
        currentState: 'HIGHLY_PRODUCTIVE',
        updatedTime: '2026-01-11T12:00:00.000Z',
        startedTime: '2026-01-11T10:00:00.000Z',
        lastMessageAt: '2026-01-11T12:00:00.000Z',
        lowResponseAfterPrice: 0,
        customerCount: 5,
        businessCount: 5,
        priceGiven: 0,
        earlyLost: 0,
      },
    ];
    const weekly = buildReportRows(rows, 'weekly', 'started');
    expect(weekly).toHaveLength(1);
    expect(weekly[0]?.total).toBe(2);
    expect(weekly[0]?.productive).toBe(1);
    expect(weekly[0]?.highly_productive).toBe(1);
    expect(weekly[0]?.price_given).toBe(1);
    expect(weekly[0]?.low_response_after_price).toBe(1);
    expect(weekly[0]?.early_lost).toBe(0);
    expect(weekly[0]?.early_lost_pct).toBe(0);
    expect(Object.keys(weekly[0]?.histogram ?? {})).toHaveLength(30);
    expect(weekly[0]?.histogram[6]).toBe(1);
    expect(weekly[0]?.histogram[10]).toBe(1);
    expect(weekly[0]?.histogram[30]).toBe(0);
  });

  it('can bucket by last message date', () => {
    const rows = [
      {
        id: 'c1',
        pageId: 'p1',
        platform: 'messenger',
        currentState: 'NEW',
        updatedTime: '2026-01-10T12:00:00.000Z',
        startedTime: '2026-01-01T10:00:00.000Z',
        lastMessageAt: '2026-01-20T10:00:00.000Z',
        lowResponseAfterPrice: 0,
        customerCount: 1,
        businessCount: 1,
        priceGiven: 0,
        earlyLost: 0,
      },
    ];
    const monthly = buildReportRows(rows, 'monthly', 'last');
    expect(monthly[0]?.periodStart).toBe('2026-01-01');
  });

  it('rolls up early lost metrics from per-conversation outcomes', () => {
    const rows = [
      {
        id: 'a-lost-no-productive-before',
        pageId: 'p1',
        platform: 'messenger',
        currentState: 'LOST',
        updatedTime: '2026-01-06T12:00:00.000Z',
        startedTime: '2026-01-06T10:00:00.000Z',
        lastMessageAt: '2026-01-06T12:00:00.000Z',
        lowResponseAfterPrice: 0,
        customerCount: 1,
        businessCount: 1,
        priceGiven: 0,
        earlyLost: 1,
      },
      {
        id: 'b-productive-then-lost',
        pageId: 'p1',
        platform: 'messenger',
        currentState: 'LOST',
        updatedTime: '2026-01-06T13:00:00.000Z',
        startedTime: '2026-01-06T11:00:00.000Z',
        lastMessageAt: '2026-01-06T13:00:00.000Z',
        lowResponseAfterPrice: 0,
        customerCount: 3,
        businessCount: 3,
        priceGiven: 0,
        earlyLost: 0,
      },
      {
        id: 'c-never-lost',
        pageId: 'p1',
        platform: 'messenger',
        currentState: 'ENGAGED',
        updatedTime: '2026-01-06T14:00:00.000Z',
        startedTime: '2026-01-06T12:00:00.000Z',
        lastMessageAt: '2026-01-06T14:00:00.000Z',
        lowResponseAfterPrice: 0,
        customerCount: 2,
        businessCount: 2,
        priceGiven: 0,
        earlyLost: 0,
      },
      {
        id: 'd-productive-after-lost',
        pageId: 'p1',
        platform: 'messenger',
        currentState: 'LOST',
        updatedTime: '2026-01-06T15:00:00.000Z',
        startedTime: '2026-01-06T13:00:00.000Z',
        lastMessageAt: '2026-01-06T15:00:00.000Z',
        lowResponseAfterPrice: 0,
        customerCount: 2,
        businessCount: 2,
        priceGiven: 0,
        earlyLost: 1,
      },
      {
        id: 'e-no-history-safe',
        pageId: 'p1',
        platform: 'messenger',
        currentState: 'LOST',
        updatedTime: '2026-01-06T16:00:00.000Z',
        startedTime: '2026-01-06T14:00:00.000Z',
        lastMessageAt: '2026-01-06T16:00:00.000Z',
        lowResponseAfterPrice: 0,
        customerCount: 1,
        businessCount: 0,
        priceGiven: 0,
        earlyLost: 0,
      },
    ];
    const weekly = buildReportRows(rows, 'weekly', 'started');
    expect(weekly).toHaveLength(1);
    expect(weekly[0]?.total).toBe(5);
    expect(weekly[0]?.early_lost).toBe(2);
    expect(weekly[0]?.early_lost_pct).toBe(0.4);
  });

  it('uses state-history ordering logic for early lost in SQL', async () => {
    let capturedSql = '';
    let capturedBindings: unknown[] = [];
    const db = {
      prepare(sql: string) {
        capturedSql = sql;
        return {
          bind: (...values: unknown[]) => {
            capturedBindings = values;
            return {
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    } as unknown as D1Database;

    await buildReportFromDb({
      db,
      userId: 'u1',
      interval: 'weekly',
      bucket: 'started',
      pageId: 'p1',
      platform: 'messenger',
    });

    expect(capturedSql).toContain('first_lost AS');
    expect(capturedSql).toContain('productive_before_lost AS');
    expect(capturedSql).toContain(
      "events.to_state IN ('PRODUCTIVE', 'HIGHLY_PRODUCTIVE')",
    );
    expect(capturedSql).toContain('events.triggered_at < lost_marker.lostAt');
    expect(capturedBindings).toEqual(['u1', 'u1', 'u1', 'p1', 'messenger']);
  });
});
