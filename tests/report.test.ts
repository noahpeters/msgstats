import { describe, expect, it } from 'vitest';
import {
  buildReportRows,
  classifyTier,
  getMonthStartUtc,
  getWeekStartUtc,
} from '../workers/api/report';

describe('report helpers', () => {
  it('classifies tiers with thresholds 3/5', () => {
    expect(classifyTier(2, 3)).toEqual({ productive: false, highly: false });
    expect(classifyTier(3, 3)).toEqual({ productive: true, highly: false });
    expect(classifyTier(5, 5)).toEqual({ productive: true, highly: true });
  });

  it('buckets by week and month in UTC', () => {
    const date = new Date('2026-01-14T18:00:00.000Z'); // Wed
    expect(getWeekStartUtc(date)).toBe('2026-01-12T00:00:00.000Z');
    expect(getMonthStartUtc(date)).toBe('2026-01-01T00:00:00.000Z');
  });

  it('builds report rows from conversations', () => {
    const rows = [
      {
        id: 'c1',
        pageId: 'p1',
        platform: 'messenger',
        updatedTime: '2026-01-10T12:00:00.000Z',
        startedTime: '2026-01-10T10:00:00.000Z',
        lastMessageAt: '2026-01-10T12:00:00.000Z',
        customerCount: 3,
        businessCount: 3,
        priceGiven: 1,
      },
      {
        id: 'c2',
        pageId: 'p1',
        platform: 'messenger',
        updatedTime: '2026-01-11T12:00:00.000Z',
        startedTime: '2026-01-11T10:00:00.000Z',
        lastMessageAt: '2026-01-11T12:00:00.000Z',
        customerCount: 5,
        businessCount: 5,
        priceGiven: 0,
      },
    ];
    const weekly = buildReportRows(rows, 'weekly', 'started');
    expect(weekly).toHaveLength(1);
    expect(weekly[0]?.total).toBe(2);
    expect(weekly[0]?.productive).toBe(2);
    expect(weekly[0]?.highly_productive).toBe(1);
    expect(weekly[0]?.price_given).toBe(1);
  });

  it('can bucket by last message date', () => {
    const rows = [
      {
        id: 'c1',
        pageId: 'p1',
        platform: 'messenger',
        updatedTime: '2026-01-10T12:00:00.000Z',
        startedTime: '2026-01-01T10:00:00.000Z',
        lastMessageAt: '2026-01-20T10:00:00.000Z',
        customerCount: 1,
        businessCount: 1,
        priceGiven: 0,
      },
    ];
    const monthly = buildReportRows(rows, 'monthly', 'last');
    expect(monthly[0]?.periodStart).toBe('2026-01-01T00:00:00.000Z');
  });
});
