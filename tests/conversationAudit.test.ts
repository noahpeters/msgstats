import { describe, expect, it } from 'vitest';
import {
  buildFeatureSnapshot,
  isValidAuditLabel,
  reasonCodesFromReasons,
  resolveComputedClassification,
} from '../workers/api/conversationAudit';
import type { ConversationInference } from '../workers/api/inference';

describe('conversation audit helpers', () => {
  it('validates allowed labels', () => {
    expect(isValidAuditLabel('LOST')).toBe(true);
    expect(isValidAuditLabel('OFF_PLATFORM')).toBe(true);
    expect(isValidAuditLabel('contactable')).toBe(false);
  });

  it('normalizes deterministic reason codes', () => {
    const codes = reasonCodesFromReasons([
      'UNREPLIED',
      { code: 'LOST_INACTIVE_TIMEOUT', confidence: 'HIGH' },
      'UNREPLIED',
    ]);
    expect(codes).toEqual(['UNREPLIED', 'LOST_INACTIVE_TIMEOUT']);
  });

  it('applies off-platform outcome override', () => {
    const inference = {
      state: 'OFF_PLATFORM',
      confidence: 'MEDIUM',
      reasons: ['PHONE_OR_EMAIL'],
      followupDueAt: null,
      followupDueSource: null,
      followupSuggestion: 'Visibility lost (off-platform)',
      lastInboundAt: '2026-02-01T10:00:00.000Z',
      lastOutboundAt: '2026-02-01T09:00:00.000Z',
      lastMessageAt: '2026-02-01T10:00:00.000Z',
      messageCount: 2,
      inboundCount: 1,
      outboundCount: 1,
      lastSnippet: 'call me',
      resurrected: false,
      needsFollowup: false,
    } satisfies ConversationInference;

    const resolved = resolveComputedClassification({
      inference,
      currentState: 'OFF_PLATFORM',
      offPlatformOutcome: 'lost',
    });

    expect(resolved.computedLabel).toBe('LOST');
    expect(resolved.reasons).toContain('USER_ANNOTATION');
  });

  it('builds stable snapshot shape', () => {
    const nowMs = Date.parse('2026-02-09T12:00:00.000Z');
    const inference = {
      state: 'ENGAGED',
      confidence: 'LOW',
      reasons: ['UNREPLIED'],
      followupDueAt: null,
      followupDueSource: null,
      followupSuggestion: 'Reply recommended',
      lastInboundAt: '2026-02-08T12:00:00.000Z',
      lastOutboundAt: '2026-02-07T12:00:00.000Z',
      lastMessageAt: '2026-02-08T12:00:00.000Z',
      messageCount: 2,
      inboundCount: 1,
      outboundCount: 1,
      lastSnippet: 'hello',
      resurrected: false,
      needsFollowup: true,
    } satisfies ConversationInference;

    const snapshot = buildFeatureSnapshot({
      conversation: {
        id: 'c1',
        participantId: 'p1',
        currentState: 'NEW',
        offPlatformOutcome: null,
        needsFollowup: 1,
        lastInboundAt: null,
        lastOutboundAt: null,
        lastMessageAt: null,
        lastEvaluatedAt: '2026-02-08T10:00:00.000Z',
        messageCount: 1,
        inboundCount: 1,
        outboundCount: 0,
        followupDueAt: null,
        followupSuggestion: null,
        blockedByRecipient: 0,
        bouncedByProvider: 0,
      },
      messages: [
        {
          id: 'm1',
          direction: 'inbound',
          text: 'hello',
          createdAt: '2026-02-08T12:00:00.000Z',
          messageType: null,
          features: {
            has_phone_number: false,
            has_email: false,
            has_price_rejection_phrase: false,
            has_explicit_rejection_phrase: false,
            has_indefinite_deferral_phrase: false,
            has_spam_content: false,
            has_currency: false,
            contains_price_terms: false,
            contains_opt_out: false,
            contains_schedule_terms: false,
            contains_deferral_phrase: false,
            deferral_date_hint: null,
            contains_conversion_phrase: false,
            contains_loss_phrase: false,
            contains_spam_phrase: false,
            contains_system_assignment: false,
            has_link: false,
            message_length: 5,
          },
          ruleHits: [],
        },
      ],
      config: {
        slaHours: 24,
        lostAfterPriceDays: 60,
        resurrectGapDays: 30,
        deferDefaultDays: 30,
      },
      inference,
      computedLabel: 'ENGAGED',
      computedConfidence: 'LOW',
      reasonCodes: ['UNREPLIED'],
      computedAt: nowMs,
    });

    expect(snapshot).toHaveProperty('timestamps.last_inbound_at');
    expect(snapshot).toHaveProperty('thresholds.sla_hours', 24);
    expect(snapshot).toHaveProperty('message_flags.has_bounced', false);
    expect(snapshot).toHaveProperty(
      'message_flags.has_price_rejection_phrase',
      false,
    );
    expect(snapshot).toHaveProperty(
      'message_flags.has_explicit_rejection_phrase',
      false,
    );
    expect(snapshot).toHaveProperty(
      'message_flags.has_indefinite_deferral_phrase',
      false,
    );
    expect(snapshot).toHaveProperty('message_flags.has_spam_content', false);
  });
});
