import { describe, expect, test } from 'vitest';
import {
  computeInputHash,
  mapDeferredBucketToDate,
  shouldAllowAiCall,
  shouldRunAI,
  validateAiOutput,
} from '../workers/api/aiInterpreter';

describe('aiInterpreter helpers', () => {
  test('shouldRunAI gates on keywords', () => {
    const result = shouldRunAI({
      messageText: 'hello there',
      extractedFeatures: {},
      mode: 'mock',
    });
    expect(result.run).toBe(false);
    expect(result.reason).toBe('keyword_gate');
  });

  test('shouldRunAI skips when explicit contact present', () => {
    const result = shouldRunAI({
      messageText: 'call me at 415-555-1212',
      extractedFeatures: { has_phone_number: true },
      mode: 'mock',
    });
    expect(result.run).toBe(false);
    expect(result.reason).toBe('hard_signal_present');
  });

  test('computeInputHash is deterministic', async () => {
    const hashA = await computeInputHash('hello|v1');
    const hashB = await computeInputHash('hello|v1');
    expect(hashA).toBe(hashB);
  });

  test('validateAiOutput rejects malformed payloads', () => {
    expect(validateAiOutput({})).toBeNull();
    expect(validateAiOutput('not json')).toBeNull();
  });

  test('mapDeferredBucketToDate returns date string', () => {
    const dateOnly = mapDeferredBucketToDate(
      'NEXT_WEEK',
      new Date('2026-02-01T00:00:00Z'),
    );
    expect(dateOnly).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('shouldAllowAiCall enforces budgets', () => {
    expect(
      shouldAllowAiCall({
        dailyCalls: 5,
        conversationCalls: 0,
        maxDaily: 5,
        maxPerConversation: 2,
      }).allowed,
    ).toBe(false);
    expect(
      shouldAllowAiCall({
        dailyCalls: 0,
        conversationCalls: 2,
        maxDaily: 5,
        maxPerConversation: 2,
      }).allowed,
    ).toBe(false);
  });
});
