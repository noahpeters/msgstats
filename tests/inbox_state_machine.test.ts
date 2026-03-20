import { describe, expect, test } from 'vitest';
import {
  computeInboxStateMachine,
  type InboxStateMachineContext,
} from '../workers/api/inbox_state_machine';

const NOW = new Date('2026-02-11T18:00:00.000Z');

function baseContext(
  overrides: Partial<InboxStateMachineContext> = {},
): InboxStateMachineContext {
  return {
    now: NOW,
    previousState: 'NEW',
    messageCount: 2,
    inboundCount: 1,
    outboundCount: 1,
    inboundCountNonFinal: 1,
    lastInboundAt: '2026-02-10T18:00:00.000Z',
    lastOutboundAt: '2026-02-10T17:00:00.000Z',
    lastMessageAt: '2026-02-10T18:00:00.000Z',
    lastNonFinalMessageAt: '2026-02-10T18:00:00.000Z',
    lastNonFinalDirection: 'inbound',
    lastOutboundNonFinalAt: '2026-02-10T17:00:00.000Z',
    hasOptOut: false,
    hasBlocked: false,
    hasBounced: false,
    hasExplicitRejection: false,
    hasExplicitRejectionRevival: false,
    hasPriceRejection: false,
    hasPriceRejectionRevival: false,
    hasIndefiniteDeferral: false,
    hasConcreteDeferral: false,
    hasDeferral: false,
    hasConversion: false,
    hasLossPhrase: false,
    hasOffPlatform: false,
    hasExplicitContact: false,
    offPlatformReason: null,
    hasPriceMention: false,
    hasSpamPhraseMatch: false,
    spamContextConfirmed: false,
    hasSpamContent: false,
    explicitLostCandidate: null,
    followupDueAtFromDeferral: null,
    followupDueSourceFromDeferral: null,
    useAiDeferral: false,
    hasDeferralSeasonHint: false,
    daysSinceLastInbound: 1,
    daysSinceLastActivity: 1,
    slaHours: 24,
    dueSoonDays: 3,
    inactiveTimeoutDays: 30,
    lostAfterPriceRejectionDays: 14,
    lostAfterOffPlatformNoContactDays: 21,
    lostAfterPriceDays: 60,
    lostAfterIndefiniteDeferralDays: 30,
    ...overrides,
  };
}

describe('inbox state machine terminal precedence', () => {
  test('blocked overrides other states', () => {
    const result = computeInboxStateMachine(
      baseContext({
        hasBlocked: true,
        hasDeferral: true,
        hasPriceMention: true,
      }),
    );
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('BLOCKED_BY_RECIPIENT');
  });

  test('explicit rejection overrides price given', () => {
    const result = computeInboxStateMachine(
      baseContext({
        hasExplicitRejection: true,
        hasPriceMention: true,
      }),
    );
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('EXPLICIT_REJECTION');
  });

  test('price rejection strong forces lost', () => {
    const result = computeInboxStateMachine(
      baseContext({
        hasPriceRejection: true,
      }),
    );
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('PRICE_REJECTION');
  });

  test('indefinite deferral without concrete date forces lost', () => {
    const result = computeInboxStateMachine(
      baseContext({
        hasIndefiniteDeferral: true,
        hasConcreteDeferral: false,
      }),
    );
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('INDEFINITE_DEFERRAL');
  });

  test('spam is guarded and does not trigger without context confirmation', () => {
    const result = computeInboxStateMachine(
      baseContext({
        hasSpamPhraseMatch: true,
        spamContextConfirmed: false,
      }),
    );
    expect(result.state).not.toBe('SPAM');
  });
});

describe('inbound stale behavior', () => {
  test('inbound stale marks lost even when outbound is recent', () => {
    const result = computeInboxStateMachine(
      baseContext({
        previousState: 'PRICE_GIVEN',
        hasPriceMention: true,
        daysSinceLastInbound: 44,
        daysSinceLastActivity: 4,
        lastOutboundAt: '2026-02-07T18:00:00.000Z',
      }),
    );
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('INBOUND_STALE');
    expect(result.needsFollowup).toBe(false);
  });

  test('outbound-only threads do not become lost from inbound stale', () => {
    const result = computeInboxStateMachine(
      baseContext({
        previousState: 'NEW',
        inboundCount: 0,
        inboundCountNonFinal: 0,
        outboundCount: 1,
        lastInboundAt: null,
        lastNonFinalDirection: 'outbound',
        lastNonFinalMessageAt: '2026-02-10T18:00:00.000Z',
        daysSinceLastInbound: null,
      }),
    );
    expect(result.state).toBe('NEW');
    expect(result.reasons).not.toContain('INBOUND_STALE');
  });

  test('future customer-intent follow-up suppresses inbound stale lost', () => {
    const result = computeInboxStateMachine(
      baseContext({
        previousState: 'DEFERRED',
        hasDeferral: true,
        followupDueAtFromDeferral: '2026-04-12T18:00:00.000Z',
        followupDueSourceFromDeferral: 'customer_intent',
        daysSinceLastInbound: 90,
      }),
    );
    expect(result.state).toBe('DEFERRED');
    expect(result.reasons).not.toContain('INBOUND_STALE');
    expect(result.needsFollowup).toBe(false);
  });

  test('future default follow-up suppresses inbound stale lost', () => {
    const result = computeInboxStateMachine(
      baseContext({
        previousState: 'DEFERRED',
        hasDeferral: true,
        followupDueAtFromDeferral: '2026-04-12T18:00:00.000Z',
        followupDueSourceFromDeferral: 'default',
        daysSinceLastInbound: 90,
      }),
    );
    expect(result.state).toBe('DEFERRED');
    expect(result.reasons).not.toContain('INBOUND_STALE');
  });

  test('unknown follow-up source with future date suppresses inbound stale lost', () => {
    const result = computeInboxStateMachine(
      baseContext({
        previousState: 'DEFERRED',
        hasDeferral: true,
        followupDueAtFromDeferral: '2026-04-12T18:00:00.000Z',
        followupDueSourceFromDeferral: 'unknown',
        daysSinceLastInbound: 90,
      }),
    );
    expect(result.state).toBe('DEFERRED');
    expect(result.reasons).not.toContain('INBOUND_STALE');
  });
});

describe('deferred follow-up gating', () => {
  test('missing follow-up source is normalized to unknown when due_at exists', () => {
    const result = computeInboxStateMachine(
      baseContext({
        hasDeferral: true,
        followupDueAtFromDeferral: '2026-03-12T18:00:00.000Z',
        followupDueSourceFromDeferral: null,
      }),
    );
    expect(result.followupDueSource).toBe('unknown');
  });

  test('default follow-up does not trigger needs_followup or follow up now', () => {
    const result = computeInboxStateMachine(
      baseContext({
        hasDeferral: true,
        followupDueAtFromDeferral: '2026-02-12T18:00:00.000Z',
        followupDueSourceFromDeferral: 'default',
      }),
    );
    expect(result.state).toBe('DEFERRED');
    expect(result.needsFollowup).toBe(false);
    expect(result.followupSuggestion).not.toBe('Follow up now');
  });

  test('deferred with far future due date is not follow-up due', () => {
    const result = computeInboxStateMachine(
      baseContext({
        hasDeferral: true,
        followupDueAtFromDeferral: '2026-03-20T18:00:00.000Z',
        followupDueSourceFromDeferral: 'customer_intent',
      }),
    );
    expect(result.state).toBe('DEFERRED');
    expect(result.needsFollowup).toBe(false);
  });

  test('deferred with near due date is follow-up due', () => {
    const result = computeInboxStateMachine(
      baseContext({
        hasDeferral: true,
        followupDueAtFromDeferral: '2026-02-12T18:00:00.000Z',
        followupDueSourceFromDeferral: 'customer_intent',
      }),
    );
    expect(result.state).toBe('DEFERRED');
    expect(result.needsFollowup).toBe(true);
  });
});

describe('sla regression', () => {
  test('recent unreplied inbound still triggers follow-up by sla logic', () => {
    const result = computeInboxStateMachine(
      baseContext({
        hasDeferral: false,
        followupDueAtFromDeferral: null,
        followupDueSourceFromDeferral: null,
        lastNonFinalDirection: 'inbound',
        lastNonFinalMessageAt: '2026-02-09T18:00:00.000Z',
        daysSinceLastInbound: 2,
      }),
    );
    expect(result.state).not.toBe('LOST');
    expect(result.needsFollowup).toBe(true);
  });
});

describe('active outbound stale follow-up', () => {
  test('active with last outbound 3 business days ago needs follow-up now', () => {
    const result = computeInboxStateMachine(
      baseContext({
        previousState: 'ENGAGED',
        lastNonFinalDirection: 'outbound',
        lastNonFinalMessageAt: '2026-02-06T18:00:00.000Z',
        lastOutboundNonFinalAt: '2026-02-06T18:00:00.000Z',
      }),
    );
    expect(result.state).toBe('ENGAGED');
    expect(result.needsFollowup).toBe(true);
    expect(result.followupSuggestion).toBe('Follow up now');
    expect(result.followupDueAt).toBe('2026-02-10T18:00:00.000Z');
    expect(result.followupDueSource).toBe('default');
  });

  test('active with last outbound 1 business day ago suggests follow up later', () => {
    const result = computeInboxStateMachine(
      baseContext({
        previousState: 'ENGAGED',
        lastNonFinalDirection: 'outbound',
        lastNonFinalMessageAt: '2026-02-10T18:00:00.000Z',
        lastOutboundNonFinalAt: '2026-02-10T18:00:00.000Z',
      }),
    );
    expect(result.state).toBe('ENGAGED');
    expect(result.needsFollowup).toBe(false);
    expect(result.followupSuggestion).toBe('Follow up later');
    expect(result.followupDueAt).toBe('2026-02-12T18:00:00.000Z');
    expect(result.followupDueSource).toBe('default');
  });

  test('unreplied inbound wins even when outbound is stale', () => {
    const result = computeInboxStateMachine(
      baseContext({
        previousState: 'ENGAGED',
        lastNonFinalDirection: 'inbound',
        lastNonFinalMessageAt: '2026-02-11T17:00:00.000Z',
        lastOutboundNonFinalAt: '2026-02-06T18:00:00.000Z',
      }),
    );
    expect(result.state).toBe('ENGAGED');
    expect(result.needsFollowup).toBe(true);
    expect(result.followupSuggestion).toBe('Reply recommended');
  });

  test('deferred with stale outbound keeps deferred follow-up gating behavior', () => {
    const result = computeInboxStateMachine(
      baseContext({
        previousState: 'DEFERRED',
        hasDeferral: true,
        followupDueAtFromDeferral: '2026-02-20T18:00:00.000Z',
        followupDueSourceFromDeferral: 'default',
        lastOutboundNonFinalAt: '2026-02-06T18:00:00.000Z',
      }),
    );
    expect(result.state).toBe('DEFERRED');
    expect(result.needsFollowup).toBe(false);
    expect(result.followupSuggestion).toBeNull();
  });

  test('off-platform with stale outbound keeps informational follow-up only', () => {
    const result = computeInboxStateMachine(
      baseContext({
        hasOffPlatform: true,
        hasExplicitContact: true,
        offPlatformReason: 'PHONE_OR_EMAIL',
        lastOutboundNonFinalAt: '2026-02-06T18:00:00.000Z',
      }),
    );
    expect(result.state).toBe('OFF_PLATFORM');
    expect(result.needsFollowup).toBe(false);
    expect(result.followupSuggestion).toBe('Visibility lost (off-platform)');
  });

  test('terminal states always clear follow-ups', () => {
    const lost = computeInboxStateMachine(
      baseContext({
        hasOptOut: true,
        followupDueAtFromDeferral: '2026-02-20T18:00:00.000Z',
        followupDueSourceFromDeferral: 'customer_intent',
        lastOutboundNonFinalAt: '2026-02-06T18:00:00.000Z',
      }),
    );
    const spam = computeInboxStateMachine(
      baseContext({
        hasSpamPhraseMatch: true,
        spamContextConfirmed: true,
        followupDueAtFromDeferral: '2026-02-20T18:00:00.000Z',
        followupDueSourceFromDeferral: 'customer_intent',
        lastOutboundNonFinalAt: '2026-02-06T18:00:00.000Z',
      }),
    );
    const converted = computeInboxStateMachine(
      baseContext({
        hasConversion: true,
        followupDueAtFromDeferral: '2026-02-20T18:00:00.000Z',
        followupDueSourceFromDeferral: 'customer_intent',
        lastOutboundNonFinalAt: '2026-02-06T18:00:00.000Z',
      }),
    );

    expect(lost.followupSuggestion).toBeNull();
    expect(lost.needsFollowup).toBe(false);
    expect(lost.followupDueAt).toBeNull();
    expect(spam.followupSuggestion).toBeNull();
    expect(spam.needsFollowup).toBe(false);
    expect(spam.followupDueAt).toBeNull();
    expect(converted.followupSuggestion).toBeNull();
    expect(converted.needsFollowup).toBe(false);
    expect(converted.followupDueAt).toBeNull();
  });
});

describe('regression fixtures', () => {
  test('t_3866724443458932 style fixture becomes lost from inbound stale', () => {
    const result = computeInboxStateMachine(
      baseContext({
        previousState: 'PRICE_GIVEN',
        hasPriceMention: true,
        daysSinceLastInbound: 44,
        daysSinceLastActivity: 4,
      }),
    );
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('INBOUND_STALE');
    expect(result.needsFollowup).toBe(false);
  });

  test('t_26479893194932597 style fixture becomes lost from inbound stale', () => {
    const result = computeInboxStateMachine(
      baseContext({
        previousState: 'PRICE_GIVEN',
        hasPriceMention: true,
        daysSinceLastInbound: 34,
        daysSinceLastActivity: 5,
      }),
    );
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('INBOUND_STALE');
    expect(result.needsFollowup).toBe(false);
  });

  test('t_4612705208965017 style fixture becomes lost from inbound stale', () => {
    const result = computeInboxStateMachine(
      baseContext({
        previousState: 'PRICE_GIVEN',
        hasPriceMention: true,
        daysSinceLastInbound: 34,
        daysSinceLastActivity: 4,
      }),
    );
    expect(result.state).toBe('LOST');
    expect(result.reasons).toContain('INBOUND_STALE');
    expect(result.needsFollowup).toBe(false);
  });
});
