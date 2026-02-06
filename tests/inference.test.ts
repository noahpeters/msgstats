import { describe, expect, test } from 'vitest';
import {
  annotateMessage,
  inferConversation,
  type AnnotatedMessage,
  type InferenceConfig,
} from '../workers/api/inference';

const config: InferenceConfig = {
  slaHours: 24,
  lostAfterPriceDays: 60,
  resurrectGapDays: 30,
  deferDefaultDays: 30,
};

const baseMessage = (overrides: Partial<AnnotatedMessage>) =>
  annotateMessage({
    id: overrides.id ?? 'm1',
    direction: overrides.direction ?? 'inbound',
    text: overrides.text ?? 'hello',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  });

describe('inference engine', () => {
  test('marks spam when spam phrase detected', () => {
    const msg = baseMessage({ text: 'This is spam, stop now.' });
    const result = inferConversation({ messages: [msg], config });
    expect(result.state).toBe('SPAM');
    expect(result.reasons).toContain('SPAM_PHRASE');
  });

  test('marks converted on conversion phrases', () => {
    const msg = baseMessage({ text: 'We booked and paid. Thanks!' });
    const result = inferConversation({ messages: [msg], config });
    expect(result.state).toBe('CONVERTED');
    expect(result.reasons).toContain('CONVERSION_PHRASE');
  });

  test('does not mark converted for words that include signed as a substring', () => {
    const msg = baseMessage({
      text: 'This chat was assigned to Noah Peters through an automation.',
    });
    const result = inferConversation({ messages: [msg], config });
    expect(result.state).not.toBe('CONVERTED');
    expect(result.reasons).not.toContain('CONVERSION_PHRASE');
  });

  test('does not mark converted for system assignment messages', () => {
    const msg = baseMessage({
      text: 'This chat was assigned to Noah Peters through an automation.',
      direction: 'inbound',
    });
    const result = inferConversation({ messages: [msg], config });
    expect(result.state).not.toBe('CONVERTED');
  });

  test('marks deferred and sets followup suggestion', () => {
    const msg = baseMessage({ text: 'Please follow up next week.' });
    const result = inferConversation({ messages: [msg], config });
    expect(result.state).toBe('DEFERRED');
    expect(result.followupSuggestion).toBeTruthy();
  });

  test('marks off-platform when phone or email is present', () => {
    const msg = baseMessage({ text: 'Call me at (415) 555-1212.' });
    const result = inferConversation({ messages: [msg], config });
    expect(result.state).toBe('OFF_PLATFORM');
  });

  test('marks lost after stale price given', () => {
    const oldDate = new Date(
      Date.now() - 61 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const msg = baseMessage({
      text: 'The price is $1,200 for the package.',
      direction: 'outbound',
      createdAt: oldDate,
    });
    const result = inferConversation({ messages: [msg], config });
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('PRICE_STALE');
  });

  test('uses AI deferred when no explicit deferral date exists', () => {
    const msg = baseMessage({ text: 'We should follow up sometime.' });
    msg.features = {
      ...msg.features,
      ai: {
        interpretation: {
          handoff: {
            is_handoff: false,
            type: null,
            confidence: 'LOW',
            evidence: '',
          },
          deferred: {
            is_deferred: true,
            bucket: 'NEXT_MONTH',
            due_date_iso: null,
            confidence: 'MEDIUM',
            evidence: 'follow up sometime',
          },
        },
      },
    };
    msg.ruleHits = msg.ruleHits.filter((hit) => hit !== 'DEFERRAL_PHRASE');
    const result = inferConversation({ messages: [msg], config });
    expect(result.state).toBe('DEFERRED');
    expect(result.reasons).toContain('AI_DEFERRED');
    expect(result.followupDueAt).toBeTruthy();
  });

  test('ignores AI handoff when explicit contact exists with continued messages', () => {
    const msg1 = baseMessage({
      id: 'm1',
      text: 'Call me at (415) 555-1212.',
      createdAt: new Date('2026-02-01T10:00:00Z').toISOString(),
    });
    const msg2 = baseMessage({
      id: 'm2',
      direction: 'outbound',
      text: 'Thanks!',
      createdAt: new Date('2026-02-01T10:05:00Z').toISOString(),
    });
    const msg3 = baseMessage({
      id: 'm3',
      text: 'Sounds good.',
      createdAt: new Date('2026-02-01T10:10:00Z').toISOString(),
    });
    msg3.features = {
      ...msg3.features,
      ai: {
        interpretation: {
          handoff: {
            is_handoff: true,
            type: 'phone',
            confidence: 'MEDIUM',
            evidence: 'Sounds good',
          },
          deferred: {
            is_deferred: false,
            bucket: null,
            due_date_iso: null,
            confidence: 'LOW',
            evidence: '',
          },
        },
      },
    };
    const result = inferConversation({ messages: [msg1, msg2, msg3], config });
    expect(result.state).not.toBe('OFF_PLATFORM');
    expect(result.reasons).not.toContain('AI_HANDOFF');
  });

  test('explicit deferral overrides AI deferred false', () => {
    const msg1 = baseMessage({
      id: 'm1',
      text: 'Please follow up next week.',
      createdAt: new Date('2026-02-01T10:00:00Z').toISOString(),
    });
    const msg2 = baseMessage({
      id: 'm2',
      text: 'ok',
      createdAt: new Date('2026-02-01T10:10:00Z').toISOString(),
    });
    msg2.features = {
      ...msg2.features,
      ai: {
        interpretation: {
          handoff: {
            is_handoff: false,
            type: null,
            confidence: 'LOW',
            evidence: '',
          },
          deferred: {
            is_deferred: false,
            bucket: null,
            due_date_iso: null,
            confidence: 'LOW',
            evidence: '',
          },
        },
      },
    };
    const result = inferConversation({ messages: [msg1, msg2], config });
    expect(result.state).toBe('DEFERRED');
    expect(result.reasons).toContain('DEFERRAL_PHRASE');
    expect(result.reasons).not.toContain('AI_DEFERRED');
  });

  test('detects explicit lost: chose existing', () => {
    const msg = baseMessage({
      text: 'I have an antique table I decided just to keep.',
    });
    const result = inferConversation({ messages: [msg], config });
    expect(result.state).toBe('LOST');
    const reason = result.reasons.find(
      (entry) =>
        typeof entry === 'object' && entry.code === 'LOST_CHOSE_EXISTING',
    );
    expect(reason).toBeTruthy();
    expect(msg.features.explicit_lost?.reason_code).toBe('LOST_CHOSE_EXISTING');
  });

  test('detects explicit lost: price out of range', () => {
    const msg = baseMessage({ text: "it's out of my price range" });
    const result = inferConversation({ messages: [msg], config });
    expect(result.state).toBe('LOST');
    const reason = result.reasons.find(
      (entry) =>
        typeof entry === 'object' && entry.code === 'LOST_PRICE_OUT_OF_RANGE',
    );
    expect(reason).toBeTruthy();
  });

  test('detects explicit lost: not intentional', () => {
    const msg = baseMessage({
      text: 'oops press the wrong button didn’t mean to text you guys',
    });
    const result = inferConversation({ messages: [msg], config });
    expect(result.state).toBe('LOST');
    const reason = result.reasons.find(
      (entry) =>
        typeof entry === 'object' && entry.code === 'LOST_NOT_INTENTIONAL',
    );
    expect(reason).toBeTruthy();
  });

  test('detects explicit lost: bought elsewhere', () => {
    const msg = baseMessage({ text: 'I bought one already' });
    const result = inferConversation({ messages: [msg], config });
    expect(result.state).toBe('LOST');
    const reason = result.reasons.find(
      (entry) =>
        typeof entry === 'object' && entry.code === 'LOST_BOUGHT_ELSEWHERE',
    );
    expect(reason).toBeTruthy();
  });

  test('detects explicit lost: feasibility when context exists', () => {
    const msg1 = baseMessage({
      id: 'm1',
      text: 'Will this fit in a 54" room?',
      createdAt: new Date('2026-02-01T10:00:00Z').toISOString(),
    });
    const msg2 = baseMessage({
      id: 'm2',
      text: "Probably won't work",
      createdAt: new Date('2026-02-01T10:10:00Z').toISOString(),
    });
    const result = inferConversation({ messages: [msg1, msg2], config });
    expect(result.state).toBe('LOST');
    const reason = result.reasons.find(
      (entry) => typeof entry === 'object' && entry.code === 'LOST_FEASIBILITY',
    );
    expect(reason).toBeTruthy();
  });

  test('ack-only does not resurrect a lost conversation', () => {
    const lostMsg = baseMessage({
      id: 'm1',
      text: "it's out of my price range",
      createdAt: new Date('2026-02-01T10:00:00Z').toISOString(),
    });
    const ackMsg = baseMessage({
      id: 'm2',
      text: 'Thank you!',
      createdAt: new Date('2026-02-02T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [lostMsg, ackMsg],
      previousState: 'LOST',
      previousEvaluatedAt: new Date('2026-02-01T10:05:00Z').toISOString(),
      config,
    });
    expect(result.state).toBe('LOST');
    expect(result.resurrected).toBe(false);
    expect(ackMsg.features.ack_only).toBe(true);
  });

  test('detects explicit lost: explicit decline', () => {
    const msg = baseMessage({
      text: 'No, thank you! I appreciate the follow up though',
    });
    const result = inferConversation({ messages: [msg], config });
    expect(result.state).toBe('LOST');
    const reason = result.reasons.find(
      (entry) =>
        typeof entry === 'object' && entry.code === 'LOST_EXPLICIT_DECLINE',
    );
    expect(reason).toBeTruthy();
    expect(msg.features.explicit_lost?.reason_code).toBe(
      'LOST_EXPLICIT_DECLINE',
    );
  });

  test('explicit decline does not trigger with timing qualifiers', () => {
    const msg = baseMessage({ text: 'No, not right now' });
    const result = inferConversation({ messages: [msg], config });
    expect(
      result.reasons.find(
        (entry) =>
          typeof entry === 'object' && entry.code === 'LOST_EXPLICIT_DECLINE',
      ),
    ).toBeFalsy();
  });

  test('explicit decline does not trigger with future intent', () => {
    const msg = baseMessage({ text: 'No thank you, maybe later' });
    const result = inferConversation({ messages: [msg], config });
    expect(
      result.reasons.find(
        (entry) =>
          typeof entry === 'object' && entry.code === 'LOST_EXPLICIT_DECLINE',
      ),
    ).toBeFalsy();
  });

  test('post-lost acknowledgement stays ack-only', () => {
    const lostMsg = baseMessage({
      id: 'm1',
      text: 'No, thank you! I appreciate the follow up though',
      createdAt: new Date('2026-02-01T10:00:00Z').toISOString(),
    });
    const ackMsg = baseMessage({
      id: 'm2',
      text: 'Thank you. Have a good weekend as well!',
      createdAt: new Date('2026-02-02T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [lostMsg, ackMsg],
      previousState: 'LOST',
      previousEvaluatedAt: new Date('2026-02-01T10:05:00Z').toISOString(),
      config,
    });
    expect(result.state).toBe('LOST');
    expect(result.resurrected).toBe(false);
    expect(ackMsg.features.ack_only).toBe(true);
  });

  test('detects explicit lost: indefinite future', () => {
    const msg = baseMessage({
      text: 'I would love to but its not my time yet… I will possibly make contact then',
    });
    const result = inferConversation({ messages: [msg], config });
    expect(result.state).toBe('LOST');
    const reason = result.reasons.find(
      (entry) =>
        typeof entry === 'object' && entry.code === 'LOST_INDEFINITE_FUTURE',
    );
    expect(reason).toBeTruthy();
  });

  test('indefinite future does not override explicit deferral', () => {
    const msg = baseMessage({ text: 'Not right now — maybe next month.' });
    const result = inferConversation({ messages: [msg], config });
    expect(
      result.reasons.find(
        (entry) =>
          typeof entry === 'object' && entry.code === 'LOST_INDEFINITE_FUTURE',
      ),
    ).toBeFalsy();
    expect(result.state).toBe('DEFERRED');
  });

  test('marks lost after 30 days of inbound inactivity with outbound history', () => {
    const inbound = baseMessage({
      id: 'm1',
      text: 'Hello there',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const outbound = baseMessage({
      id: 'm2',
      direction: 'outbound',
      text: 'Thanks for reaching out!',
      createdAt: new Date('2026-01-02T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [inbound, outbound],
      config,
      now: new Date('2026-02-05T10:00:00Z'),
    });
    expect(result.state).toBe('LOST');
    const reason = result.reasons.find(
      (entry) =>
        typeof entry === 'object' && entry.code === 'LOST_INACTIVE_TIMEOUT',
    );
    expect(reason).toBeTruthy();
    expect(result.followupSuggestion).toBeNull();
  });

  test('does not mark lost after inactivity when a future follow-up exists', () => {
    const inbound = baseMessage({
      id: 'm1',
      text: 'Can you follow up next month?',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const outbound = baseMessage({
      id: 'm2',
      direction: 'outbound',
      text: 'Sounds good.',
      createdAt: new Date('2026-01-02T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [inbound, outbound],
      config,
      now: new Date('2026-01-10T10:00:00Z'),
    });
    expect(result.state).not.toBe('LOST');
    expect(
      result.reasons.find(
        (entry) =>
          typeof entry === 'object' && entry.code === 'LOST_INACTIVE_TIMEOUT',
      ),
    ).toBeFalsy();
  });

  test('final touch sent blocks resurrection without new intent', () => {
    const inbound = baseMessage({
      id: 'm1',
      text: 'Hello again',
      createdAt: new Date('2026-02-04T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [inbound],
      previousState: 'LOST',
      previousEvaluatedAt: new Date('2026-02-01T10:00:00Z').toISOString(),
      finalTouchSentAt: new Date('2026-02-03T10:00:00Z').toISOString(),
      config,
    });
    expect(result.resurrected).toBe(false);
  });
});
