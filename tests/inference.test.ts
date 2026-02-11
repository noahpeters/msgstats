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
  test('marks spam only when phrase match and context are both confirmed', () => {
    const msg = baseMessage({
      text: 'This is spam, report fraud now.',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [msg],
      config,
      now: new Date('2026-02-20T10:00:00Z'),
    });
    expect(result.state).toBe('SPAM');
    expect(result.reasons).toContain('SPAM_PHRASE_MATCH');
    expect(result.reasons).toContain('SPAM_CONTEXT_CONFIRMED');
  });

  test('does not evaluate spam when last activity is outbound', () => {
    const inbound = baseMessage({
      id: 'm1',
      text: 'spam fraud report',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const outbound = baseMessage({
      id: 'm2',
      direction: 'outbound',
      text: 'Thanks for the update.',
      createdAt: new Date('2026-01-01T10:05:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [inbound, outbound],
      config,
      now: new Date('2026-02-20T10:00:00Z'),
    });
    expect(result.state).not.toBe('SPAM');
    expect(result.reasons).not.toContain('SPAM_CONTEXT_CONFIRMED');
  });

  test('does not evaluate spam for active back-and-forth conversations', () => {
    const m1 = baseMessage({
      id: 'm1',
      direction: 'inbound',
      text: "I'm hoping to have both",
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    m1.features = { ...m1.features, contains_spam_phrase: true };
    m1.ruleHits = Array.from(new Set([...m1.ruleHits, 'SPAM_PHRASE_MATCH']));
    const m2 = baseMessage({
      id: 'm2',
      direction: 'outbound',
      text: 'Great, I can help with both options.',
      createdAt: new Date('2026-01-01T10:01:00Z').toISOString(),
    });
    const m3 = baseMessage({
      id: 'm3',
      direction: 'inbound',
      text: 'Can you share dimensions too?',
      createdAt: new Date('2026-01-01T10:02:00Z').toISOString(),
    });
    const m4 = baseMessage({
      id: 'm4',
      direction: 'outbound',
      text: 'Absolutely, sending details now.',
      createdAt: new Date('2026-01-01T10:03:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [m1, m2, m3, m4],
      config,
      now: new Date('2026-02-20T10:00:00Z'),
    });
    expect(result.state).not.toBe('SPAM');
    expect(m1.ruleHits).toContain('SPAM_PHRASE_MATCH');
    expect(result.reasons).not.toContain('SPAM_CONTEXT_CONFIRMED');
  });

  test('does not evaluate spam when recent activity is within resurrect window', () => {
    const msg = baseMessage({
      text: 'spam report bot fraud',
      createdAt: new Date('2026-02-15T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [msg],
      config,
      now: new Date('2026-02-20T10:00:00Z'),
    });
    expect(result.state).not.toBe('SPAM');
    expect(result.reasons).not.toContain('SPAM_CONTEXT_CONFIRMED');
  });

  test('does not evaluate spam when business intent signals are present', () => {
    const msg = baseMessage({
      text: 'spam report bot fraud. Can we schedule delivery for the table at $1200?',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [msg],
      config,
      now: new Date('2026-02-20T10:00:00Z'),
    });
    expect(result.state).not.toBe('SPAM');
    expect(result.reasons).not.toContain('SPAM_CONTEXT_CONFIRMED');
  });

  test('outbound spam phrase text does not trigger spam phrase matching', () => {
    const outbound = baseMessage({
      direction: 'outbound',
      text: 'This is spam, report fraud now.',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [outbound],
      config,
      now: new Date('2026-02-20T10:00:00Z'),
    });
    expect(outbound.ruleHits).not.toContain('SPAM_PHRASE_MATCH');
    expect(result.state).not.toBe('SPAM');
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

  test('does not mark lost from outbound-only inactivity', () => {
    const oldDate = new Date(
      Date.now() - 61 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const msg = baseMessage({
      text: 'Checking in when you have time.',
      direction: 'outbound',
      createdAt: oldDate,
    });
    const result = inferConversation({ messages: [msg], config });
    expect(result.state).not.toBe('LOST');
    expect(result.reasons).not.toContain('INBOUND_STALE');
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
    expect(result.reasons).toContain('EXPLICIT_REJECTION');
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
    expect(result.reasons).toContain('INBOUND_STALE');
    expect(result.needsFollowup).toBe(false);
    expect(result.followupDueAt).toBeNull();
    expect(result.followupSuggestion).toBeNull();
  });

  test('does not mark lost after inactivity when a future follow-up exists', () => {
    const inbound = baseMessage({
      id: 'm1',
      text: 'Can you follow up next spring?',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const outbound = baseMessage({
      id: 'm2',
      direction: 'outbound',
      text: 'Sounds good.',
      createdAt: new Date('2026-02-01T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [inbound, outbound],
      config,
      now: new Date('2026-02-05T10:00:00Z'),
    });
    expect(result.state).not.toBe('LOST');
    expect(result.reasons).not.toContain('INBOUND_STALE');
  });

  test('does not mark lost when last inbound is recent despite recent outbound', () => {
    const inbound = baseMessage({
      id: 'm1',
      direction: 'inbound',
      text: 'Still deciding.',
      createdAt: new Date('2026-01-26T10:00:00Z').toISOString(),
    });
    const outbound = baseMessage({
      id: 'm2',
      direction: 'outbound',
      text: 'Checking in again.',
      createdAt: new Date('2026-02-04T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [inbound, outbound],
      config,
      now: new Date('2026-02-05T10:00:00Z'),
    });
    expect(result.state).not.toBe('LOST');
    expect(result.reasons).not.toContain('INBOUND_STALE');
  });

  test('does not mark lost when latest message is customer inbound', () => {
    const outbound = baseMessage({
      id: 'm1',
      direction: 'outbound',
      text: 'Checking in again.',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const inbound = baseMessage({
      id: 'm2',
      direction: 'inbound',
      text: 'Can you clarify shipping?',
      createdAt: new Date('2026-02-15T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [outbound, inbound],
      config,
      now: new Date('2026-02-20T10:00:00Z'),
    });
    expect(result.state).not.toBe('LOST');
    expect(result.needsFollowup).toBe(true);
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

  test('blocked overrides deferred and marks lost', () => {
    const msg = baseMessage({
      text: 'please follow up next week',
      createdAt: new Date('2026-02-01T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [msg],
      config,
      blockedByRecipient: true,
    });
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('BLOCKED_BY_RECIPIENT');
  });

  test('price rejection marks lost immediately', () => {
    const msg = baseMessage({
      text: 'that is too expensive for us',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [msg],
      config,
      now: new Date('2026-01-06T00:00:00Z'),
    });
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('PRICE_REJECTION');
    expect(result.needsFollowup).toBe(false);
  });

  test('price rejection can revive with later inbound', () => {
    const rejection = baseMessage({
      id: 'm1',
      text: 'too expensive',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const revival = baseMessage({
      id: 'm2',
      text: 'actually can you share dimensions',
      createdAt: new Date('2026-01-05T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [rejection, revival],
      config,
      now: new Date('2026-01-20T10:00:00Z'),
    });
    expect(result.state).not.toBe('LOST');
    expect(result.reasons).not.toContain('PRICE_REJECTION');
  });

  test('price rejection is not revived by ack-only thank you', () => {
    const rejection = baseMessage({
      id: 'm1',
      text: 'too expensive',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const ackOnly = baseMessage({
      id: 'm2',
      text: 'thank you',
      createdAt: new Date('2026-01-02T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [rejection, ackOnly],
      config,
      now: new Date('2026-01-20T10:00:00Z'),
    });
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('PRICE_REJECTION');
  });

  test('price rejection is not revived by hard no reply', () => {
    const rejection = baseMessage({
      id: 'm1',
      text: 'too expensive',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const noReply = baseMessage({
      id: 'm2',
      text: 'No',
      createdAt: new Date('2026-01-02T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [rejection, noReply],
      config,
      now: new Date('2026-01-20T10:00:00Z'),
    });
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('EXPLICIT_REJECTION');
  });

  test('off-platform AI handoff without contact info becomes lost when stale', () => {
    const msg = baseMessage({
      text: 'sounds good',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    msg.features = {
      ...msg.features,
      ai: {
        interpretation: {
          handoff: {
            is_handoff: true,
            type: 'phone',
            confidence: 'MEDIUM',
            evidence: 'call me',
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
    const result = inferConversation({
      messages: [msg],
      config,
      now: new Date('2026-02-01T10:00:00Z'),
    });
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('OFF_PLATFORM_NO_CONTACT_INFO');
    expect(result.reasons).toContain('OFF_PLATFORM_STALE');
  });

  test('indefinite deferral becomes lost immediately', () => {
    const msg = baseMessage({
      text: 'maybe someday we will revisit this, we will see',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [msg],
      config,
      now: new Date('2026-01-02T10:00:00Z'),
    });
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('INDEFINITE_DEFERRAL');
    expect(result.needsFollowup).toBe(false);
    expect(result.followupDueAt).toBeNull();
  });

  test('deferred due far future is not needs-followup', () => {
    const msg = baseMessage({
      text: 'follow up next month',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [msg],
      config,
      now: new Date('2026-01-02T10:00:00Z'),
    });
    expect(result.state).toBe('DEFERRED');
    expect(result.needsFollowup).toBe(false);
  });

  test('deferred due soon is needs-followup', () => {
    const msg = baseMessage({
      text: 'follow up tomorrow',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [msg],
      config,
      now: new Date('2026-01-01T20:00:00Z'),
    });
    expect(result.state).toBe('DEFERRED');
    expect(result.needsFollowup).toBe(true);
  });

  test('non-terminal outbound last requires follow-up after 2 business days', () => {
    const outbound = baseMessage({
      id: 'm1',
      direction: 'outbound',
      text: 'Just checking in on this.',
      createdAt: new Date('2026-01-02T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [outbound],
      config,
      now: new Date('2026-01-06T10:01:00Z'),
    });
    expect(result.state).toBe('NEW');
    expect(result.needsFollowup).toBe(true);
    expect(result.followupSuggestion).toBe('Follow up now');
    expect(result.followupDueAt?.slice(0, 10)).toBe('2026-01-06');
  });

  test('non-terminal outbound last is not due before 2 business days', () => {
    const outbound = baseMessage({
      id: 'm1',
      direction: 'outbound',
      text: 'Just checking in on this.',
      createdAt: new Date('2026-01-02T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [outbound],
      config,
      now: new Date('2026-01-05T10:00:00Z'),
    });
    expect(result.state).toBe('NEW');
    expect(result.needsFollowup).toBe(false);
    expect(result.followupSuggestion).toBe('Follow up later');
    expect(result.followupDueAt?.slice(0, 10)).toBe('2026-01-06');
  });

  test('customer-last message requires immediate follow-up', () => {
    const outbound = baseMessage({
      id: 'm1',
      direction: 'outbound',
      text: 'This is available for $900.',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const inbound = baseMessage({
      id: 'm2',
      direction: 'inbound',
      text: 'Can you send dimensions?',
      createdAt: new Date('2026-01-01T10:30:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [outbound, inbound],
      config,
      now: new Date('2026-01-01T10:45:00Z'),
    });
    expect(result.state).toBe('PRICE_GIVEN');
    expect(result.needsFollowup).toBe(true);
    expect(result.followupSuggestion).toBe('Reply recommended');
    expect(result.reasons).toContain('UNREPLIED');
    expect(result.reasons).not.toContain('SLA_BREACH');
  });

  test('parses next fall relative to message timestamp', () => {
    const msg = baseMessage({
      text: 'please follow up next fall',
      createdAt: new Date('2026-01-09T12:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [msg],
      config,
      now: new Date('2026-01-10T10:00:00Z'),
    });
    expect(result.followupDueAt?.slice(0, 10)).toBe('2026-10-15');
    expect(result.reasons).toContain('DEFERRAL_SEASON_PARSED');
  });

  test('parses this fall and fall conservatively', () => {
    const thisFall = baseMessage({
      id: 'm1',
      text: 'circle back this fall',
      createdAt: new Date('2026-01-09T12:00:00Z').toISOString(),
    });
    const fall = baseMessage({
      id: 'm2',
      text: 'follow up in fall',
      createdAt: new Date('2026-01-09T13:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [thisFall, fall],
      config,
      now: new Date('2026-01-10T10:00:00Z'),
    });
    expect(result.followupDueAt?.slice(0, 10)).toBe('2026-10-15');
  });

  test('does not parse fall as verb', () => {
    const msg = baseMessage({
      text: 'I might fall asleep after this',
    });
    expect(msg.features.deferral_date_hint).toBeNull();
  });

  test('typo-tolerant rejection detects "To much thank u"', () => {
    const msg = baseMessage({
      text: 'To much thank u',
    });
    expect(msg.features.has_price_rejection_phrase).toBe(true);
  });

  test('wait phrase with polite decline triggers rejection signal', () => {
    const msg = baseMessage({
      text: "I'll have to wait but thank you",
    });
    expect(msg.features.has_price_rejection_phrase).toBe(true);
    expect(msg.features.has_indefinite_deferral_phrase).toBe(true);
  });

  test('too much room should not trigger price rejection', () => {
    const msg = baseMessage({
      text: 'there is too much room in the kitchen',
    });
    expect(msg.features.has_price_rejection_phrase).toBe(false);
  });

  test('wait for husband reply should not trigger price rejection', () => {
    const msg = baseMessage({
      text: 'I need to wait for my husband to reply',
    });
    expect(msg.features.has_price_rejection_phrase).toBe(false);
  });

  test('explicit rejection detector flags standalone no', () => {
    const msg = baseMessage({ text: 'no' });
    expect(msg.features.has_explicit_rejection_phrase).toBe(true);
  });

  test('explicit rejection detector flags no thanks', () => {
    const msg = baseMessage({ text: 'No thanks' });
    expect(msg.features.has_explicit_rejection_phrase).toBe(true);
  });

  test('explicit rejection detector does not flag no problem', () => {
    const msg = baseMessage({ text: 'no problem' });
    expect(msg.features.has_explicit_rejection_phrase).toBe(false);
  });

  test('t_4463595643962413 fixture maps wait + thanks to lost', () => {
    const price = baseMessage({
      id: 'm1',
      direction: 'outbound',
      text: 'The table is $1,200',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const inbound = baseMessage({
      id: 'm2',
      text: "Thank I will have to wait on the table, I'll have to wait but thank",
      createdAt: new Date('2026-01-02T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [price, inbound],
      config,
      now: new Date('2026-01-11T10:00:00Z'),
    });
    expect(result.state).toBe('LOST');
    expect(
      result.reasons.includes('PRICE_REJECTION') ||
        result.reasons.includes('INDEFINITE_DEFERRAL'),
    ).toBe(true);
    expect(result.needsFollowup).toBe(false);
  });

  test('t_4439739992921551 fixture maps ranting to spam', () => {
    const rant = baseMessage({
      text: `The FBI and city hall corruption is tracking my phone for months and the police are part of a conspiracy and government surveillance with hacked devices and this is all corruption and conspiracy with no end to it.`,
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [rant],
      config,
      now: new Date('2026-02-20T10:00:00Z'),
    });
    expect(result.state).toBe('SPAM');
    expect(result.reasons).toContain('SPAM_PHRASE_MATCH');
    expect(result.reasons).toContain('SPAM_CONTEXT_CONFIRMED');
    expect(result.reasons).toContain('SPAM_CONTENT');
    expect(result.needsFollowup).toBe(false);
  });

  test('outbound-only conversation from audit fixture is never spam', () => {
    const outbound = baseMessage({
      direction: 'outbound',
      text: 'No thanks, please report this as spam.',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [outbound],
      config,
      now: new Date('2026-02-20T10:00:00Z'),
    });
    expect(result.state).not.toBe('SPAM');
    expect(result.reasons).not.toContain('SPAM_CONTEXT_CONFIRMED');
  });

  test('spam heuristic does not trigger on short product complaint', () => {
    const complaint = baseMessage({
      text: 'This wood table finish looks corrupted and I need help with a fix.',
    });
    const result = inferConversation({ messages: [complaint], config });
    expect(result.state).not.toBe('SPAM');
  });

  test('t_1402557438317091 typo rejection goes lost when stale', () => {
    const m1 = baseMessage({
      id: 'm1',
      direction: 'outbound',
      text: 'Price is $800 for this project',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const m2 = baseMessage({
      id: 'm2',
      text: 'To much thank u',
      createdAt: new Date('2026-01-02T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [m1, m2],
      config,
      now: new Date('2026-01-29T10:00:00Z'),
    });
    expect(m2.features.has_price_rejection_phrase).toBe(true);
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('PRICE_REJECTION');
  });

  test('t_10237711327829989 fixture marks price rejection lost immediately', () => {
    const price = baseMessage({
      id: 'm1',
      direction: 'outbound',
      text: 'Price is $2,100 installed.',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const reject = baseMessage({
      id: 'm2',
      direction: 'inbound',
      text: 'too expensive, thank you',
      createdAt: new Date('2026-01-02T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [price, reject],
      config,
      now: new Date('2026-01-06T00:00:00Z'),
    });
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('PRICE_REJECTION');
    expect(result.needsFollowup).toBe(false);
  });

  test('t_10163707089490090 fixture marks standalone no lost with no follow-up after closing msg', () => {
    const inboundNo = baseMessage({
      id: 'm1',
      direction: 'inbound',
      text: 'no',
      createdAt: new Date('2026-01-02T10:00:00Z').toISOString(),
    });
    const outboundClosing = baseMessage({
      id: 'm2',
      direction: 'outbound',
      text: 'Understood. If anything changes, we are here to help.',
      createdAt: new Date('2026-01-02T10:10:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [inboundNo, outboundClosing],
      config,
      now: new Date('2026-01-06T00:00:00Z'),
    });
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('EXPLICIT_REJECTION');
    expect(result.needsFollowup).toBe(false);
    expect(result.followupDueAt).toBeNull();
    expect(result.followupSuggestion).toBeNull();
  });

  test('price given remains unchanged when engagement is active and no rejection', () => {
    const price = baseMessage({
      id: 'm1',
      direction: 'outbound',
      text: 'The quote is $1,250 for the table.',
      createdAt: new Date('2026-01-01T09:00:00Z').toISOString(),
    });
    const inbound = baseMessage({
      id: 'm2',
      direction: 'inbound',
      text: 'Can you share the dimensions too?',
      createdAt: new Date('2026-01-01T09:10:00Z').toISOString(),
    });
    const outbound2 = baseMessage({
      id: 'm3',
      direction: 'outbound',
      text: 'Yes, it is 72 by 40 and finished in walnut.',
      createdAt: new Date('2026-01-01T09:20:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [price, inbound, outbound2],
      config,
      now: new Date('2026-01-01T09:30:00Z'),
    });
    expect(result.state).toBe('PRICE_GIVEN');
  });

  test('t_10241194901999951 indefinite deferral stays lost with no followup date', () => {
    const msg = baseMessage({
      text: 'Not right now, we will see later and have to wait',
      createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    });
    const result = inferConversation({
      messages: [msg],
      config,
      now: new Date('2026-01-03T10:00:00Z'),
    });
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('INDEFINITE_DEFERRAL');
    expect(result.followupDueAt).toBeNull();
    expect(result.needsFollowup).toBe(false);
  });

  test('t_3866724443458932 fixture marks lost when inbound is stale despite recent outbound', () => {
    const inbound = baseMessage({
      id: 'm1',
      direction: 'inbound',
      text: 'Thanks',
      createdAt: new Date('2025-12-28T20:40:23Z').toISOString(),
    });
    const outboundPrice = baseMessage({
      id: 'm2',
      direction: 'outbound',
      text: 'The quote is $1200.',
      createdAt: new Date('2026-02-06T20:50:40Z').toISOString(),
    });
    const result = inferConversation({
      messages: [inbound, outboundPrice],
      config,
      now: new Date('2026-02-11T18:00:38Z'),
    });
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('INBOUND_STALE');
    expect(result.needsFollowup).toBe(false);
  });

  test('t_26201632842756315 fixture remains lost via explicit rejection', () => {
    const outboundPrice = baseMessage({
      id: 'm1',
      direction: 'outbound',
      text: 'The quote is $1200.',
      createdAt: new Date('2026-02-06T20:51:20Z').toISOString(),
    });
    const inbound = baseMessage({
      id: 'm2',
      direction: 'inbound',
      text: 'No ty',
      createdAt: new Date('2026-02-06T20:50:26Z').toISOString(),
    });
    const result = inferConversation({
      messages: [inbound, outboundPrice],
      config,
      now: new Date('2026-02-11T18:00:38Z'),
    });
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('EXPLICIT_REJECTION');
    expect(result.needsFollowup).toBe(false);
  });

  test('t_26479893194932597 fixture marks lost when inbound is stale despite recent outbound', () => {
    const inbound = baseMessage({
      id: 'm1',
      direction: 'inbound',
      text: 'okay',
      createdAt: new Date('2026-01-08T04:55:21Z').toISOString(),
    });
    const outboundPrice = baseMessage({
      id: 'm2',
      direction: 'outbound',
      text: 'The quote is $900.',
      createdAt: new Date('2026-02-06T20:50:27Z').toISOString(),
    });
    const result = inferConversation({
      messages: [inbound, outboundPrice],
      config,
      now: new Date('2026-02-11T18:00:38Z'),
    });
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('INBOUND_STALE');
    expect(result.needsFollowup).toBe(false);
  });

  test('t_4612705208965017 fixture marks lost when inbound is stale despite recent outbound', () => {
    const inbound = baseMessage({
      id: 'm1',
      direction: 'inbound',
      text: 'thank you',
      createdAt: new Date('2026-01-08T04:33:47Z').toISOString(),
    });
    const outboundPrice = baseMessage({
      id: 'm2',
      direction: 'outbound',
      text: 'The quote is $1100.',
      createdAt: new Date('2026-02-06T20:49:59Z').toISOString(),
    });
    const result = inferConversation({
      messages: [inbound, outboundPrice],
      config,
      now: new Date('2026-02-11T18:00:38Z'),
    });
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('INBOUND_STALE');
    expect(result.needsFollowup).toBe(false);
  });
});
