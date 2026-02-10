import { describe, expect, it } from 'vitest';
import { isReplyWindowClosed } from '../workers/api/inboxLabels';

describe('inbox label window helper', () => {
  const nowMs = Date.parse('2026-02-10T12:00:00.000Z');

  it('returns false when a reply is not needed', () => {
    expect(
      isReplyWindowClosed({
        needsReply: false,
        lastInboundAt: null,
        nowMs,
      }),
    ).toBe(false);
  });

  it('treats missing inbound timestamp as closed when reply is needed', () => {
    expect(
      isReplyWindowClosed({
        needsReply: true,
        lastInboundAt: null,
        nowMs,
      }),
    ).toBe(true);
  });

  it('stays open at exactly 24h and closes after 24h', () => {
    expect(
      isReplyWindowClosed({
        needsReply: true,
        lastInboundAt: '2026-02-09T12:00:00.000Z',
        nowMs,
      }),
    ).toBe(false);
    expect(
      isReplyWindowClosed({
        needsReply: true,
        lastInboundAt: '2026-02-09T11:59:59.000Z',
        nowMs,
      }),
    ).toBe(true);
  });
});
