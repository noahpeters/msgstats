import {
  associateLabel,
  dissociateLabel,
  getOrCreatePageCustomLabel,
  type MetaEnv,
} from './meta';

export const NEEDS_REPLY_LABEL = 'MSGSTATS_NEEDS_REPLY';
export const NEEDS_REPLY_BI_LABEL = 'MSGSTATS_NEEDS_REPLY_BI';

const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isReplyWindowClosed(input: {
  needsReply: boolean;
  lastInboundAt: string | null;
  nowMs?: number;
}) {
  if (!input.needsReply) {
    return false;
  }
  if (!input.lastInboundAt) {
    return true;
  }
  const lastInboundMs = Date.parse(input.lastInboundAt);
  if (Number.isNaN(lastInboundMs)) {
    return true;
  }
  const nowMs = input.nowMs ?? Date.now();
  return nowMs - lastInboundMs > REPLY_WINDOW_MS;
}

export async function syncConversationInboxLabels(
  env: MetaEnv,
  input: {
    userId: string;
    pageId: string;
    accessToken: string;
    version: string;
    conversationId: string;
  },
) {
  const conversation = await env.DB.prepare(
    `SELECT platform, participant_id as participantId,
            needs_followup as needsFollowup,
            last_inbound_at as lastInboundAt
     FROM conversations
     WHERE user_id = ? AND id = ?`,
  )
    .bind(input.userId, input.conversationId)
    .first<{
      platform: string;
      participantId: string | null;
      needsFollowup: number;
      lastInboundAt: string | null;
    }>();

  if (!conversation) {
    return { skipped: true, reason: 'conversation_not_found' as const };
  }
  if (conversation.platform !== 'messenger') {
    return { skipped: true, reason: 'unsupported_platform' as const };
  }
  if (!conversation.participantId) {
    return { skipped: true, reason: 'missing_participant_id' as const };
  }

  const needsReply = Number(conversation.needsFollowup) === 1;
  const windowClosed = isReplyWindowClosed({
    needsReply,
    lastInboundAt: conversation.lastInboundAt,
  });

  const needsReplyLabelId = await getOrCreatePageCustomLabel({
    env,
    userId: input.userId,
    pageId: input.pageId,
    accessToken: input.accessToken,
    version: input.version,
    name: NEEDS_REPLY_LABEL,
  });
  const businessInboxLabelId = await getOrCreatePageCustomLabel({
    env,
    userId: input.userId,
    pageId: input.pageId,
    accessToken: input.accessToken,
    version: input.version,
    name: NEEDS_REPLY_BI_LABEL,
  });

  if (needsReply) {
    await associateLabel({
      env,
      userId: input.userId,
      pageId: input.pageId,
      labelId: needsReplyLabelId,
      accessToken: input.accessToken,
      version: input.version,
      psid: conversation.participantId,
    });
  } else {
    await dissociateLabel({
      env,
      userId: input.userId,
      pageId: input.pageId,
      labelId: needsReplyLabelId,
      accessToken: input.accessToken,
      version: input.version,
      psid: conversation.participantId,
    });
  }

  if (windowClosed) {
    await associateLabel({
      env,
      userId: input.userId,
      pageId: input.pageId,
      labelId: businessInboxLabelId,
      accessToken: input.accessToken,
      version: input.version,
      psid: conversation.participantId,
    });
  } else {
    await dissociateLabel({
      env,
      userId: input.userId,
      pageId: input.pageId,
      labelId: businessInboxLabelId,
      accessToken: input.accessToken,
      version: input.version,
      psid: conversation.participantId,
    });
  }

  return {
    skipped: false,
    needsReply,
    windowClosed,
  };
}
