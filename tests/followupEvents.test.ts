import { describe, expect, it } from 'vitest';
import {
  deriveFollowupEventsForMessages,
  type FollowupTimelineMessage,
} from '../workers/api/followupEvents';

const baseMessage = (
  overrides: Partial<FollowupTimelineMessage>,
): FollowupTimelineMessage => ({
  id: overrides.id ?? 'm1',
  userId: overrides.userId ?? 'u1',
  conversationId: overrides.conversationId ?? 'c1',
  pageId: overrides.pageId ?? 'p1',
  assetId: overrides.assetId ?? 'a1',
  createdAt: overrides.createdAt ?? '2026-02-01T00:00:00.000Z',
  direction: overrides.direction ?? 'outbound',
  senderType: overrides.senderType ?? 'business',
  body: overrides.body ?? null,
  messageType: overrides.messageType ?? null,
  messageTrigger: overrides.messageTrigger ?? null,
  featuresJson: overrides.featuresJson ?? null,
  ruleHitsJson: overrides.ruleHitsJson ?? null,
});

describe('follow-up event attribution', () => {
  it('uses previous activity and ignores system/ack-only for idle detection', () => {
    const messages: FollowupTimelineMessage[] = [
      baseMessage({
        id: 'm1',
        createdAt: '2026-02-01T00:00:00.000Z',
        direction: 'outbound',
      }),
      baseMessage({
        id: 'm2',
        createdAt: '2026-02-01T01:00:00.000Z',
        direction: 'inbound',
        senderType: 'customer',
        featuresJson: JSON.stringify({ ack_only: true }),
      }),
      baseMessage({
        id: 'm3',
        createdAt: '2026-02-01T02:00:00.000Z',
        direction: 'outbound',
      }),
      baseMessage({
        id: 'm4',
        createdAt: '2026-02-01T03:00:00.000Z',
        direction: 'outbound',
        messageTrigger: 'SYSTEM_ASSIGNMENT',
      }),
      baseMessage({
        id: 'm5',
        createdAt: '2026-02-02T02:30:00.000Z',
        direction: 'outbound',
      }),
    ];

    const events = deriveFollowupEventsForMessages(messages, new Map());
    expect(events.map((event) => event.followupMessageId)).toEqual([
      'm1',
      'm5',
    ]);
    expect(events[1]?.previousActivityAt).toBe('2026-02-01T02:00:00.000Z');
    expect(events[1]?.idleSeconds).toBeGreaterThanOrEqual(24 * 60 * 60);
  });

  it('attributes inbound only to most recent event and only first inbound counts', () => {
    const messages: FollowupTimelineMessage[] = [
      baseMessage({
        id: 'f1',
        createdAt: '2026-02-01T00:00:00.000Z',
        direction: 'outbound',
      }),
      baseMessage({
        id: 'activity',
        createdAt: '2026-02-01T00:01:00.000Z',
        direction: 'outbound',
      }),
      baseMessage({
        id: 'f2',
        createdAt: '2026-02-02T02:00:00.000Z',
        direction: 'outbound',
      }),
      baseMessage({
        id: 'inbound1',
        createdAt: '2026-02-02T02:10:00.000Z',
        direction: 'inbound',
        senderType: 'customer',
        featuresJson: JSON.stringify({ contains_loss_phrase: false }),
      }),
      baseMessage({
        id: 'inbound2',
        createdAt: '2026-02-02T02:20:00.000Z',
        direction: 'inbound',
        senderType: 'customer',
        featuresJson: JSON.stringify({ contains_loss_phrase: true }),
      }),
    ];

    const events = deriveFollowupEventsForMessages(messages, new Map());
    const first = events.find((event) => event.followupMessageId === 'f1');
    const second = events.find((event) => event.followupMessageId === 'f2');

    expect(first?.nextInboundMessageId).toBeNull();
    expect(second?.nextInboundMessageId).toBe('inbound1');
    expect(second?.revived).toBe(1);
    expect(second?.immediateLoss).toBe(0);
  });
});
