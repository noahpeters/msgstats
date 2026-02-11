import {
  associateLabel,
  dissociateLabel,
  getOrCreatePageCustomLabel,
  type MetaEnv,
} from './meta';

export const NEEDS_REPLY_LABEL = 'MSGSTATS_NEEDS_REPLY';
export const NEEDS_REPLY_BI_LABEL = 'MSGSTATS_NEEDS_REPLY_BI';
type LabelEnv = 'production' | 'staging' | 'preview' | 'dev';
type LabelEnvContext = MetaEnv & {
  DEPLOY_ENV?: string;
  APP_ORIGIN?: string;
};

const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

function parseLabelEnv(value: string | null | undefined): LabelEnv | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized === 'production' ||
    normalized === 'prod' ||
    normalized === 'live'
  ) {
    return 'production';
  }
  if (normalized === 'staging' || normalized === 'stage') {
    return 'staging';
  }
  if (normalized === 'preview') {
    return 'preview';
  }
  if (
    normalized === 'dev' ||
    normalized === 'development' ||
    normalized === 'local'
  ) {
    return 'dev';
  }
  return null;
}

function inferLabelEnvFromAppOrigin(
  origin: string | null | undefined,
): LabelEnv {
  if (!origin) {
    return 'production';
  }
  let host = '';
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return 'production';
  }
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.localhost')
  ) {
    return 'dev';
  }
  if (host.includes('staging')) {
    return 'staging';
  }
  if (host.includes('preview') || host.endsWith('.pages.dev')) {
    return 'preview';
  }
  return 'production';
}

export function resolveInboxLabelEnv(context: {
  deployEnv?: string;
  appOrigin?: string;
}): LabelEnv {
  return (
    parseLabelEnv(context.deployEnv) ??
    inferLabelEnvFromAppOrigin(context.appOrigin)
  );
}

export function getInboxLabelNames(context: {
  deployEnv?: string;
  appOrigin?: string;
}) {
  const env = resolveInboxLabelEnv(context);
  if (env === 'production') {
    return {
      needsReplyLabel: NEEDS_REPLY_LABEL,
      needsReplyBiLabel: NEEDS_REPLY_BI_LABEL,
      env,
    };
  }
  const suffix = `_${env.toUpperCase()}`;
  return {
    needsReplyLabel: `${NEEDS_REPLY_LABEL}${suffix}`,
    needsReplyBiLabel: `${NEEDS_REPLY_BI_LABEL}${suffix}`,
    env,
  };
}

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
  env: LabelEnvContext,
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
  const labels = getInboxLabelNames({
    deployEnv: env.DEPLOY_ENV,
    appOrigin: env.APP_ORIGIN,
  });

  const needsReplyLabelId = await getOrCreatePageCustomLabel({
    env,
    userId: input.userId,
    pageId: input.pageId,
    accessToken: input.accessToken,
    version: input.version,
    name: labels.needsReplyLabel,
  });
  const businessInboxLabelId = await getOrCreatePageCustomLabel({
    env,
    userId: input.userId,
    pageId: input.pageId,
    accessToken: input.accessToken,
    version: input.version,
    name: labels.needsReplyBiLabel,
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
