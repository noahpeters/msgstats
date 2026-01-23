import { describe, expect, it } from 'vitest';
import {
  formatDateKey,
  startOfMonthUTC,
  startOfWeekUTC,
} from '../src/shared/time';

describe('time helpers', () => {
  it('computes start of week (UTC) on Monday boundary', () => {
    const date = new Date('2024-04-10T12:00:00Z');
    const start = startOfWeekUTC(date);
    expect(formatDateKey(start)).toBe('2024-04-08');
  });

  it('computes start of month (UTC)', () => {
    const date = new Date('2024-02-18T12:00:00Z');
    const start = startOfMonthUTC(date);
    expect(formatDateKey(start)).toBe('2024-02-01');
  });
});
