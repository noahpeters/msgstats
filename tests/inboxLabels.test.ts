import { describe, expect, it } from 'vitest';
import {
  getInboxLabelNames,
  isReplyWindowClosed,
  resolveInboxLabelEnv,
} from '../workers/api/inboxLabels';

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

describe('inbox label naming by environment', () => {
  it('keeps production labels unchanged', () => {
    expect(
      getInboxLabelNames({
        deployEnv: 'production',
      }),
    ).toMatchObject({
      needsReplyLabel: 'MSGSTATS_NEEDS_REPLY',
      needsReplyBiLabel: 'MSGSTATS_NEEDS_REPLY_BI',
      env: 'production',
    });
  });

  it('appends staging suffix', () => {
    expect(
      getInboxLabelNames({
        deployEnv: 'staging',
      }),
    ).toMatchObject({
      needsReplyLabel: 'MSGSTATS_NEEDS_REPLY_STAGING',
      needsReplyBiLabel: 'MSGSTATS_NEEDS_REPLY_BI_STAGING',
      env: 'staging',
    });
  });

  it('appends preview suffix', () => {
    expect(
      getInboxLabelNames({
        deployEnv: 'preview',
      }),
    ).toMatchObject({
      needsReplyLabel: 'MSGSTATS_NEEDS_REPLY_PREVIEW',
      needsReplyBiLabel: 'MSGSTATS_NEEDS_REPLY_BI_PREVIEW',
      env: 'preview',
    });
  });

  it('appends dev suffix', () => {
    expect(
      getInboxLabelNames({
        deployEnv: 'dev',
      }),
    ).toMatchObject({
      needsReplyLabel: 'MSGSTATS_NEEDS_REPLY_DEV',
      needsReplyBiLabel: 'MSGSTATS_NEEDS_REPLY_BI_DEV',
      env: 'dev',
    });
  });

  it('falls back to app origin inference', () => {
    expect(
      resolveInboxLabelEnv({
        appOrigin: 'http://localhost:5173',
      }),
    ).toBe('dev');
    expect(
      resolveInboxLabelEnv({
        appOrigin: 'https://staging.msgstats.from-trees.com',
      }),
    ).toBe('staging');
    expect(
      resolveInboxLabelEnv({
        appOrigin: 'https://feature-x.msgstats.pages.dev',
      }),
    ).toBe('preview');
  });
});
