import type {
  AnnotatedMessage,
  Confidence,
  ConversationInference,
  ConversationState,
  InferenceConfig,
} from './inference';

export const CLASSIFIER_VERSION = 'inbox_inference_v1';

export const AUDIT_ALLOWED_LABELS: ConversationState[] = [
  'NEW',
  'ENGAGED',
  'PRODUCTIVE',
  'HIGHLY_PRODUCTIVE',
  'PRICE_GIVEN',
  'DEFERRED',
  'OFF_PLATFORM',
  'CONVERTED',
  'LOST',
  'SPAM',
];

export function isValidAuditLabel(value: string): value is ConversationState {
  return AUDIT_ALLOWED_LABELS.includes(value as ConversationState);
}

function toDaysSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  return Number(((nowMs - ts) / (1000 * 60 * 60 * 24)).toFixed(3));
}

function summarizeWindowCounts(
  messages: AnnotatedMessage[],
  windowDays: number,
  nowMs: number,
) {
  const cutoff = nowMs - windowDays * 24 * 60 * 60 * 1000;
  let inbound = 0;
  let outbound = 0;
  for (const message of messages) {
    const created = Date.parse(message.createdAt);
    if (Number.isNaN(created) || created < cutoff) continue;
    if (message.direction === 'inbound') {
      inbound += 1;
    } else {
      outbound += 1;
    }
  }
  return {
    inbound,
    outbound,
    total: inbound + outbound,
  };
}

function summarizeMessageFlags(
  messages: AnnotatedMessage[],
  conversation: {
    blockedByRecipient?: number | null;
    bouncedByProvider?: number | null;
  },
) {
  let hasOptOut = false;
  let hasPhoneOrEmail = false;
  let hasScheduleTerms = false;
  let hasDeferralPhrase = false;
  let hasCurrency = false;
  let hasPriceRejection = false;
  let hasIndefiniteDeferral = false;
  let hasSpamContent = false;
  for (const message of messages) {
    hasOptOut = hasOptOut || message.features.contains_opt_out;
    hasPhoneOrEmail =
      hasPhoneOrEmail ||
      message.features.has_phone_number ||
      message.features.has_email;
    hasScheduleTerms =
      hasScheduleTerms || message.features.contains_schedule_terms;
    hasDeferralPhrase =
      hasDeferralPhrase || message.features.contains_deferral_phrase;
    hasCurrency = hasCurrency || message.features.has_currency;
    hasPriceRejection =
      hasPriceRejection || message.features.has_price_rejection_phrase;
    hasIndefiniteDeferral =
      hasIndefiniteDeferral || message.features.has_indefinite_deferral_phrase;
    hasSpamContent = hasSpamContent || message.features.has_spam_content;
  }
  return {
    has_opt_out: hasOptOut,
    has_phone_or_email: hasPhoneOrEmail,
    has_schedule_terms: hasScheduleTerms,
    has_deferral_phrase: hasDeferralPhrase,
    has_currency: hasCurrency,
    has_price_rejection_phrase: hasPriceRejection,
    has_indefinite_deferral_phrase: hasIndefiniteDeferral,
    has_spam_content: hasSpamContent,
    has_bounced: Boolean(conversation.bouncedByProvider),
    has_blocked: Boolean(conversation.blockedByRecipient),
  };
}

export function reasonCodesFromReasons(
  reasons: Array<
    string | { code: string; confidence: Confidence; evidence?: string }
  >,
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const reason of reasons) {
    const code = typeof reason === 'string' ? reason : reason.code;
    if (!code || seen.has(code)) continue;
    seen.add(code);
    ordered.push(code);
  }
  return ordered;
}

export function resolveComputedClassification(input: {
  inference: ConversationInference;
  currentState: ConversationState | null;
  offPlatformOutcome: string | null;
}): {
  computedLabel: ConversationState;
  computedConfidence: Confidence;
  reasons: Array<
    string | { code: string; confidence: Confidence; evidence?: string }
  >;
  lostReasonCode: string | null;
} {
  let computedLabel = input.inference.state;
  let computedConfidence = input.inference.confidence;
  const reasons = input.inference.reasons.slice();

  if (
    input.offPlatformOutcome &&
    input.currentState === 'OFF_PLATFORM' &&
    computedLabel === 'OFF_PLATFORM'
  ) {
    if (input.offPlatformOutcome === 'converted') {
      computedLabel = 'CONVERTED';
      computedConfidence = 'LOW';
      reasons.push('USER_ANNOTATION');
    } else if (input.offPlatformOutcome === 'lost') {
      computedLabel = 'LOST';
      computedConfidence = 'LOW';
      reasons.push('USER_ANNOTATION');
    }
  }

  const objectReason = reasons.find((reason) => {
    if (typeof reason !== 'object' || reason === null) return false;
    return typeof reason.code === 'string' && reason.code.startsWith('LOST_');
  });
  let lostReasonCode: string | null =
    typeof objectReason === 'object' && objectReason !== null
      ? objectReason.code
      : null;
  if (!lostReasonCode) {
    for (const reason of reasons) {
      if (typeof reason === 'string' && reason.startsWith('LOST_')) {
        lostReasonCode = reason;
        break;
      }
    }
  }

  return {
    computedLabel,
    computedConfidence,
    reasons,
    lostReasonCode,
  };
}

export function buildFeatureSnapshot(input: {
  conversation: {
    id: string;
    participantId: string | null;
    currentState: ConversationState | null;
    offPlatformOutcome: string | null;
    needsFollowup: number;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    lastMessageAt: string | null;
    lastEvaluatedAt: string | null;
    messageCount: number;
    inboundCount: number;
    outboundCount: number;
    followupDueAt: string | null;
    followupSuggestion: string | null;
    blockedByRecipient?: number | null;
    bouncedByProvider?: number | null;
  };
  messages: AnnotatedMessage[];
  config: InferenceConfig;
  inference: ConversationInference;
  computedLabel: ConversationState;
  computedConfidence: Confidence;
  reasonCodes: string[];
  computedAt: number;
}) {
  const nowMs = input.computedAt;
  const counts7d = summarizeWindowCounts(input.messages, 7, nowMs);
  const counts30d = summarizeWindowCounts(input.messages, 30, nowMs);
  const messageFlags = summarizeMessageFlags(
    input.messages,
    input.conversation,
  );

  return {
    conversation_id: input.conversation.id,
    contact_id: input.conversation.participantId,
    computed_label: input.computedLabel,
    computed_confidence: input.computedConfidence,
    reason_codes: input.reasonCodes,
    state_fields: {
      previous_state: input.conversation.currentState,
      off_platform_outcome: input.conversation.offPlatformOutcome,
      needs_followup_before: Boolean(input.conversation.needsFollowup),
      followup_due_at_before: input.conversation.followupDueAt,
      followup_suggestion_before: input.conversation.followupSuggestion,
    },
    timestamps: {
      computed_at: input.computedAt,
      last_inbound_at: input.inference.lastInboundAt,
      last_outbound_at: input.inference.lastOutboundAt,
      last_activity_at: input.inference.lastMessageAt,
      previous_last_evaluated_at: input.conversation.lastEvaluatedAt,
    },
    counts: {
      all_time: {
        message_count: input.inference.messageCount,
        inbound_count: input.inference.inboundCount,
        outbound_count: input.inference.outboundCount,
      },
      window_7d: counts7d,
      window_30d: counts30d,
      previous_persisted: {
        message_count: input.conversation.messageCount,
        inbound_count: input.conversation.inboundCount,
        outbound_count: input.conversation.outboundCount,
      },
    },
    days_since: {
      last_inbound: toDaysSince(input.inference.lastInboundAt, nowMs),
      last_outbound: toDaysSince(input.inference.lastOutboundAt, nowMs),
      last_activity: toDaysSince(input.inference.lastMessageAt, nowMs),
      previous_evaluated: toDaysSince(
        input.conversation.lastEvaluatedAt,
        nowMs,
      ),
    },
    thresholds: {
      sla_hours: input.config.slaHours,
      lost_after_price_days: input.config.lostAfterPriceDays,
      lost_after_price_rejection_days:
        input.config.lostAfterPriceRejectionDays ?? 14,
      lost_after_off_platform_no_contact_days:
        input.config.lostAfterOffPlatformNoContactDays ?? 21,
      lost_after_indefinite_deferral_days:
        input.config.lostAfterIndefiniteDeferralDays ?? 30,
      resurrect_gap_days: input.config.resurrectGapDays,
      defer_default_days: input.config.deferDefaultDays,
      due_soon_days: input.config.dueSoonDays ?? 3,
      inactive_timeout_days: 30,
    },
    message_flags: messageFlags,
  };
}
