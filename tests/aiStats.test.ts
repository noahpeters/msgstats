import { describe, expect, it } from 'vitest';
import {
  createAiRunStats,
  recordAiRunAttempt,
  summarizeAiRunStats,
} from '../workers/api/aiStats';

describe('ai run stats', () => {
  it('records skips without counting attempts', () => {
    const stats = createAiRunStats();
    recordAiRunAttempt(stats, {
      attempted: false,
      skippedReason: 'cache_hit',
    });
    recordAiRunAttempt(stats, {
      attempted: false,
      skippedReason: 'keyword_gate',
    });
    recordAiRunAttempt(stats, {
      attempted: false,
      skippedReason: 'conversation_budget_exceeded',
    });

    expect(stats.attempted).toBe(0);
    expect(stats.skipped.cache_hit).toBe(1);
    expect(stats.skipped.no_keywords).toBe(1);
    expect(stats.skipped.per_convo_cap).toBe(1);
  });

  it('records successes and confidence buckets', () => {
    const stats = createAiRunStats();
    recordAiRunAttempt(stats, {
      attempted: true,
      attemptOutcome: 'ok',
      interpretation: {
        handoff: {
          is_handoff: true,
          type: 'phone',
          confidence: 'HIGH',
          evidence: 'call',
        },
        deferred: {
          is_deferred: true,
          bucket: 'NEXT_WEEK',
          due_date_iso: null,
          confidence: 'LOW',
          evidence: 'next week',
        },
      },
    });

    expect(stats.attempted).toBe(1);
    expect(stats.succeeded).toBe(1);
    expect(stats.results.handoff_true).toBe(1);
    expect(stats.results.deferred_true).toBe(1);
    expect(stats.results.handoff_conf.HIGH).toBe(1);
    expect(stats.results.deferred_conf.LOW).toBe(1);
  });

  it('records failures and invalid_json/timeout counters', () => {
    const stats = createAiRunStats();
    recordAiRunAttempt(stats, {
      attempted: true,
      attemptOutcome: 'invalid_json',
      interpretation: null,
    });
    recordAiRunAttempt(stats, {
      attempted: true,
      attemptOutcome: 'timeout',
      interpretation: null,
    });

    expect(stats.attempted).toBe(2);
    expect(stats.failed).toBe(2);
    expect(stats.invalid_json).toBe(1);
    expect(stats.timeout).toBe(1);
  });

  it('summarizes top skip reason', () => {
    const stats = createAiRunStats();
    recordAiRunAttempt(stats, {
      attempted: false,
      skippedReason: 'budget_exceeded',
    });
    recordAiRunAttempt(stats, {
      attempted: false,
      skippedReason: 'budget_exceeded',
    });
    recordAiRunAttempt(stats, {
      attempted: false,
      skippedReason: 'cache_hit',
    });

    const summary = summarizeAiRunStats(stats);
    expect(summary.skippedTop).toEqual({
      reason: 'budget_exceeded',
      count: 2,
    });
  });
});
