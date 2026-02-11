export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type ConversationState =
  | 'NEW'
  | 'ENGAGED'
  | 'PRODUCTIVE'
  | 'HIGHLY_PRODUCTIVE'
  | 'PRICE_GIVEN'
  | 'DEFERRED'
  | 'OFF_PLATFORM'
  | 'CONVERTED'
  | 'RESURRECTED'
  | 'LOST'
  | 'SPAM';

export type FollowupDueSource =
  | 'customer_intent'
  | 'default'
  | 'unknown'
  | null;

export type Reason =
  | string
  | {
      code: string;
      confidence: Confidence;
      evidence?: string;
    };

export type ExplicitLostCandidate = {
  code: string;
  confidence: Confidence;
  evidence?: string;
  messageId?: string | null;
};

export type InboxStateMachineContext = {
  now: Date;
  previousState?: ConversationState | null;
  messageCount: number;
  inboundCount: number;
  outboundCount: number;
  inboundCountNonFinal: number;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastMessageAt: string | null;
  lastNonFinalMessageAt: string | null;
  lastNonFinalDirection: 'inbound' | 'outbound' | null;
  hasOptOut: boolean;
  hasBlocked: boolean;
  hasBounced: boolean;
  hasExplicitRejection: boolean;
  hasExplicitRejectionRevival: boolean;
  hasPriceRejection: boolean;
  hasPriceRejectionRevival: boolean;
  hasIndefiniteDeferral: boolean;
  hasConcreteDeferral: boolean;
  hasDeferral: boolean;
  hasConversion: boolean;
  hasLossPhrase: boolean;
  hasOffPlatform: boolean;
  hasExplicitContact: boolean;
  offPlatformReason: string | null;
  hasPriceMention: boolean;
  hasSpamPhraseMatch: boolean;
  spamContextConfirmed: boolean;
  hasSpamContent: boolean;
  explicitLostCandidate: ExplicitLostCandidate | null;
  followupDueAtFromDeferral: string | null;
  followupDueSourceFromDeferral: FollowupDueSource;
  useAiDeferral: boolean;
  hasDeferralSeasonHint: boolean;
  daysSinceLastInbound: number | null;
  daysSinceLastActivity: number | null;
  slaHours: number;
  dueSoonDays: number;
  inactiveTimeoutDays: number;
  lostAfterPriceRejectionDays: number;
  lostAfterOffPlatformNoContactDays: number;
  lostAfterPriceDays: number;
  lostAfterIndefiniteDeferralDays: number;
};

export type InboxStateMachineResult = {
  state: ConversationState;
  confidence: Confidence;
  reasons: Reason[];
  followupDueAt: string | null;
  followupDueSource: FollowupDueSource;
  followupSuggestion: string | null;
  needsFollowup: boolean;
  stateTriggerMessageId: string | null;
};

function addBusinessDays(base: Date, businessDays: number): Date {
  const result = new Date(base.getTime());
  let added = 0;
  while (added < businessDays) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) {
      added += 1;
    }
  }
  return result;
}

function hasReason(reasons: Reason[], code: string): boolean {
  return reasons.some((reason) =>
    typeof reason === 'string' ? reason === code : reason.code === code,
  );
}

function isTerminalState(state: ConversationState): boolean {
  return state === 'LOST' || state === 'SPAM' || state === 'CONVERTED';
}

function hasFutureCustomerIntentFollowup(input: {
  nowMs: number;
  followupDueAt: string | null;
  followupDueSource: FollowupDueSource;
}): boolean {
  if (!input.followupDueAt || input.followupDueSource !== 'customer_intent') {
    return false;
  }
  const dueMs = Date.parse(input.followupDueAt);
  return !Number.isNaN(dueMs) && dueMs > input.nowMs;
}

function resolveProgressState(context: InboxStateMachineContext): {
  state: ConversationState;
  confidence: Confidence;
} {
  if (context.hasDeferral) {
    return { state: 'DEFERRED', confidence: 'MEDIUM' };
  }
  if (context.hasPriceMention) {
    return { state: 'PRICE_GIVEN', confidence: 'MEDIUM' };
  }
  if (context.inboundCount >= 4 && context.outboundCount >= 4) {
    return { state: 'HIGHLY_PRODUCTIVE', confidence: 'MEDIUM' };
  }
  if (context.inboundCount >= 2 && context.outboundCount >= 2) {
    return { state: 'PRODUCTIVE', confidence: 'MEDIUM' };
  }
  if (context.inboundCount >= 1 && context.outboundCount >= 1) {
    return { state: 'ENGAGED', confidence: 'LOW' };
  }
  return { state: 'NEW', confidence: 'LOW' };
}

export function computeInboxStateMachine(
  context: InboxStateMachineContext,
): InboxStateMachineResult {
  const nowMs = context.now.getTime();
  let state: ConversationState = context.previousState ?? 'NEW';
  let confidence: Confidence = 'LOW';
  let reasons: Reason[] = [];
  let followupDueAt = context.followupDueAtFromDeferral;
  let followupDueSource = context.followupDueSourceFromDeferral;
  let stateTriggerMessageId: string | null = null;
  if (followupDueAt && !followupDueSource) {
    followupDueSource = 'unknown';
  }

  if (context.hasOptOut) {
    state = 'LOST';
    confidence = 'HIGH';
    reasons = ['OPT_OUT'];
  } else if (context.hasBlocked) {
    state = 'LOST';
    confidence = 'HIGH';
    reasons = ['BLOCKED_BY_RECIPIENT'];
  } else if (context.hasBounced) {
    state = 'LOST';
    confidence = 'HIGH';
    reasons = ['BOUNCED'];
  } else if (
    context.hasExplicitRejection &&
    !context.hasExplicitRejectionRevival
  ) {
    state = 'LOST';
    confidence = 'HIGH';
    reasons = ['EXPLICIT_REJECTION'];
  } else if (context.explicitLostCandidate) {
    state = 'LOST';
    confidence = context.explicitLostCandidate.confidence;
    reasons = [
      {
        code: context.explicitLostCandidate.code,
        confidence: context.explicitLostCandidate.confidence,
        evidence: context.explicitLostCandidate.evidence,
      },
    ];
    stateTriggerMessageId = context.explicitLostCandidate.messageId ?? null;
  } else if (context.hasSpamPhraseMatch && context.spamContextConfirmed) {
    state = 'SPAM';
    confidence = 'HIGH';
    reasons = ['SPAM_PHRASE_MATCH', 'SPAM_CONTEXT_CONFIRMED'];
    if (context.hasSpamContent) {
      reasons.push('SPAM_CONTENT');
    }
  } else if (context.hasPriceRejection && !context.hasPriceRejectionRevival) {
    state = 'LOST';
    confidence = 'HIGH';
    reasons = ['PRICE_REJECTION'];
    if (context.hasIndefiniteDeferral) {
      reasons.push('WAIT_TO_PROCEED');
    }
  } else if (context.hasIndefiniteDeferral && !context.hasConcreteDeferral) {
    state = 'LOST';
    confidence = 'MEDIUM';
    reasons = ['INDEFINITE_DEFERRAL'];
  } else if (context.hasConversion) {
    state = 'CONVERTED';
    confidence = 'HIGH';
    reasons = ['CONVERSION_PHRASE'];
  } else if (context.hasLossPhrase) {
    state = 'LOST';
    confidence = 'HIGH';
    reasons = ['LOSS_PHRASE'];
  } else if (context.hasOffPlatform) {
    state = 'OFF_PLATFORM';
    confidence = 'MEDIUM';
    reasons = context.offPlatformReason ? [context.offPlatformReason] : [];
  } else {
    const progress = resolveProgressState(context);
    state = progress.state;
    confidence = progress.confidence;
    if (state === 'DEFERRED') {
      if (context.useAiDeferral) {
        reasons.push('AI_DEFERRED');
      } else {
        reasons.push('DEFERRAL_PHRASE');
        if (context.hasDeferralSeasonHint) {
          reasons.push('DEFERRAL_SEASON_PARSED');
        }
      }
    } else if (state === 'PRICE_GIVEN') {
      reasons.push('PRICE_MENTION');
    }
  }

  const hasInboundRevivalAfterRejection =
    context.hasPriceRejectionRevival || context.hasExplicitRejectionRevival;

  if (
    state === 'OFF_PLATFORM' &&
    !context.hasExplicitContact &&
    context.daysSinceLastActivity !== null &&
    context.daysSinceLastActivity >= context.lostAfterOffPlatformNoContactDays
  ) {
    state = 'LOST';
    confidence = 'MEDIUM';
    reasons = ['OFF_PLATFORM_NO_CONTACT_INFO', 'OFF_PLATFORM_STALE'];
    followupDueAt = null;
    followupDueSource = null;
  }

  const suppressInboundStale = hasFutureCustomerIntentFollowup({
    nowMs,
    followupDueAt,
    followupDueSource,
  });

  if (
    !isTerminalState(state) &&
    state !== 'OFF_PLATFORM' &&
    context.daysSinceLastInbound !== null &&
    context.daysSinceLastInbound >= context.inactiveTimeoutDays &&
    !suppressInboundStale &&
    !hasInboundRevivalAfterRejection
  ) {
    // Customer silence is measured from last inbound, not last activity.
    state = 'LOST';
    confidence = 'HIGH';
    reasons = [
      'INBOUND_STALE',
      { code: 'LOST_INACTIVE_TIMEOUT', confidence: 'HIGH' },
    ];
    followupDueAt = null;
    followupDueSource = null;
  }

  if (
    state !== 'LOST' &&
    context.hasPriceRejection &&
    !context.hasPriceRejectionRevival &&
    context.daysSinceLastInbound !== null &&
    context.daysSinceLastInbound >= context.lostAfterPriceRejectionDays
  ) {
    state = 'LOST';
    confidence = 'HIGH';
    reasons.push('PRICE_REJECTION_STALE');
    followupDueAt = null;
    followupDueSource = null;
  }

  if (
    (state === 'DEFERRED' || state === 'PRODUCTIVE' || state === 'ENGAGED') &&
    context.hasIndefiniteDeferral &&
    !context.hasConcreteDeferral &&
    context.daysSinceLastActivity !== null &&
    context.daysSinceLastActivity >= context.lostAfterIndefiniteDeferralDays
  ) {
    state = 'LOST';
    confidence = 'MEDIUM';
    followupDueAt = null;
    followupDueSource = null;
    if (!hasReason(reasons, 'INDEFINITE_DEFERRAL')) {
      reasons.push('INDEFINITE_DEFERRAL');
    }
  }

  if (state === 'PRICE_GIVEN') {
    const thresholdMs = context.lostAfterPriceDays * 24 * 60 * 60 * 1000;
    const lastActivity =
      (context.lastOutboundAt && Date.parse(context.lastOutboundAt)) ||
      (context.lastInboundAt && Date.parse(context.lastInboundAt)) ||
      null;
    if (lastActivity && nowMs - lastActivity > thresholdMs) {
      state = 'LOST';
      confidence = 'MEDIUM';
      reasons.push('PRICE_STALE');
      followupDueAt = null;
      followupDueSource = null;
    }
  }

  let needsFollowup = false;
  let followupSuggestion: string | null = null;
  const dueMs = followupDueAt ? Date.parse(followupDueAt) : Number.NaN;
  const hasValidDueAt = !Number.isNaN(dueMs);
  const hasFutureDueAt = hasValidDueAt && dueMs > nowMs;
  const hasCustomerIntentDueAt = followupDueSource === 'customer_intent';

  if (state === 'DEFERRED' && hasFutureDueAt) {
    if (hasCustomerIntentDueAt) {
      followupSuggestion = 'Follow up later';
      const dueSoonWindowMs =
        Math.max(context.slaHours, context.dueSoonDays * 24) * 60 * 60 * 1000;
      needsFollowup = dueMs - nowMs <= dueSoonWindowMs;
    } else {
      followupSuggestion = null;
      needsFollowup = false;
    }
  } else if (state === 'DEFERRED') {
    followupSuggestion = 'Follow up later';
  } else if (state === 'OFF_PLATFORM') {
    followupSuggestion = 'Visibility lost (off-platform)';
  } else if (!isTerminalState(state)) {
    const lastNonFinalMs = context.lastNonFinalMessageAt
      ? Date.parse(context.lastNonFinalMessageAt)
      : Number.NaN;

    if (
      context.lastNonFinalDirection === 'inbound' &&
      !Number.isNaN(lastNonFinalMs)
    ) {
      followupSuggestion = 'Reply recommended';
      needsFollowup = true;
      if (!hasReason(reasons, 'UNREPLIED')) {
        reasons.push('UNREPLIED');
      }
      const ageHours = (nowMs - lastNonFinalMs) / (1000 * 60 * 60);
      if (ageHours >= context.slaHours && !hasReason(reasons, 'SLA_BREACH')) {
        reasons.push('SLA_BREACH');
      }
    } else if (
      context.lastNonFinalDirection === 'outbound' &&
      !Number.isNaN(lastNonFinalMs)
    ) {
      const dueAt = addBusinessDays(new Date(lastNonFinalMs), 2).toISOString();
      if (!followupDueAt) {
        followupDueAt = dueAt;
      }
      if (!followupDueSource) {
        followupDueSource = 'default';
      }
      if (followupDueSource === 'customer_intent') {
        const dueAtMs = Date.parse(dueAt);
        const dueSoonWindowMs =
          Math.max(context.slaHours, context.dueSoonDays * 24) * 60 * 60 * 1000;
        followupSuggestion =
          dueAtMs > nowMs ? 'Follow up later' : 'Follow up now';
        needsFollowup =
          !Number.isNaN(dueAtMs) && dueAtMs - nowMs <= dueSoonWindowMs;
      } else {
        followupSuggestion = 'Follow up later';
        needsFollowup = false;
      }
    }
  }

  if (context.inboundCountNonFinal === 0) {
    reasons = reasons.filter(
      (reason) => reason !== 'UNREPLIED' && reason !== 'SLA_BREACH',
    );
  }

  if (isTerminalState(state)) {
    followupSuggestion = null;
    needsFollowup = false;
    followupDueAt = null;
    followupDueSource = null;
    reasons = reasons.filter(
      (reason) => reason !== 'UNREPLIED' && reason !== 'SLA_BREACH',
    );
  }

  if (followupDueAt && !followupDueSource) {
    followupDueSource = 'unknown';
  }

  return {
    state,
    confidence,
    reasons,
    followupDueAt,
    followupDueSource,
    followupSuggestion,
    needsFollowup,
    stateTriggerMessageId,
  };
}
