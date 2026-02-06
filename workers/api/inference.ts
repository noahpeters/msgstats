import { mapDeferredBucketToDate } from './aiInterpreter';

export type MessageDirection = 'inbound' | 'outbound';
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

export type ExplicitLostReasonCode =
  | 'LOST_NOT_INTENTIONAL'
  | 'LOST_BOUGHT_ELSEWHERE'
  | 'LOST_CHOSE_EXISTING'
  | 'LOST_PRICE_OUT_OF_RANGE'
  | 'LOST_EXPLICIT_DECLINE'
  | 'LOST_INDEFINITE_FUTURE'
  | 'LOST_INACTIVE_TIMEOUT'
  | 'LOST_TIMING_NOT_NOW'
  | 'LOST_FEASIBILITY';

export type ExplicitLostEvidence = {
  reason_code: ExplicitLostReasonCode;
  evidence: string;
  confidence: Confidence;
};

export type MessageFeatures = {
  has_phone_number: boolean;
  has_email: boolean;
  has_currency: boolean;
  contains_price_terms: boolean;
  contains_opt_out: boolean;
  contains_schedule_terms: boolean;
  contains_deferral_phrase: boolean;
  deferral_date_hint: string | null;
  contains_conversion_phrase: boolean;
  contains_loss_phrase: boolean;
  contains_spam_phrase: boolean;
  contains_system_assignment: boolean;
  has_link: boolean;
  message_length: number;
  ack_only?: boolean;
  explicit_lost?: ExplicitLostEvidence;
  ai?: {
    input_hash?: string;
    mode?: string;
    model?: string;
    prompt_version?: string;
    interpretation?: {
      handoff?: {
        is_handoff: boolean;
        type: string | null;
        confidence: string;
        evidence: string;
      };
      deferred?: {
        is_deferred: boolean;
        bucket: string | null;
        due_date_iso: string | null;
        confidence: string;
        evidence: string;
      };
    };
    skipped_reason?: string;
    errors?: string[];
    updated_at?: string;
  };
};

export type AnnotatedMessage = {
  id: string;
  direction: MessageDirection;
  text: string | null;
  createdAt: string;
  messageType?: string | null;
  features: MessageFeatures;
  ruleHits: string[];
};

export type InferenceConfig = {
  slaHours: number;
  lostAfterPriceDays: number;
  resurrectGapDays: number;
  deferDefaultDays: number;
};

const PHONE_REGEX = /(?:(?:\+?\d{1,3})?[\s\-()]*)?(?:\d[\s\-()]*){8,}\d/g;
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CURRENCY_REGEX =
  /(\$|€|£)\s?\d+|\d+(?:\.\d{2})?\s?(usd|eur|gbp|dollars)/i;
const PRICE_TERMS = /(price|pricing|cost|quote|rate|budget)/i;
const OPT_OUT_TERMS =
  /(stop|unsubscribe|opt\s*out|do not contact|dont contact|remove me)/i;
const SCHEDULE_TERMS =
  /(schedule|scheduled|appointment|book|booking|meet|meeting|call|demo|reserve|reserved|reservation)/i;
const DEFERRAL_TERMS =
  /(next week|next month|tomorrow|remind me|check back|after|in\\s+\\d{1,2}\\s+days?|in\\s+\\d{1,2}\\s+weeks?|in\\s+\\d{1,2}\\s+months?|next\\s+(spring|summer|fall|autumn|winter)|until\\s+next\\s+(spring|summer|fall|autumn|winter))/i;
const CONVERSION_TERMS =
  /\b(purchased|paid|signed|converted|closed|done deal|we went with)\b/i;
const LOSS_TERMS =
  /(not interested|no thanks|lost|we went with someone else|already have|too expensive)/i;
const SPAM_TERMS = /(spam|scam|bot|report|fraud|block you)/i;
const LINK_REGEX = /(https?:\/\/\S+)/i;
const SYSTEM_ASSIGNMENT_TERMS =
  /assigned to.*automation|assigned through an automation|assigned by an automation/i;

const ACK_ONLY_TERMS =
  /^(thanks|thank you|you too|ok|okay|sounds good|thx|ty)[!.:\s-]*$/i;
const ACK_ONLY_EMOJI = /^[\p{Emoji}\s]+$/u;
const INTENT_KEYWORDS =
  /(price|pricing|cost|quote|rate|budget|schedule|appointment|book|booking|meet|meeting|call|demo|tomorrow|next|after|remind|check back|follow up)/i;

const LOST_NOT_INTENTIONAL_REGEX =
  /\b(wrong button|didn['’]?t mean to|didnt mean to|accidental|mistake)\b/i;
const LOST_BOUGHT_ELSEWHERE_REGEX =
  /\b(bought one|bought it|already bought|already purchased|already ordered|purchased elsewhere)\b/i;
const LOST_CHOSE_EXISTING_REGEX =
  /\b(decided (?:just )?(?:to )?keep|going to keep|keep what i have|keeping what i have)\b/i;
const LOST_CHOSE_EXISTING_SO_REGEX =
  /\b(i have an?.*(so|and) i(’|')?m going to keep)\b/i;
const LOST_CHOSE_EXISTING_ALREADY_REGEX = /\b(already have)\b/i;
const LOST_PRICE_OUT_OF_RANGE_REGEX =
  /\b(out of (my )?price range|too expensive|can['’]?t afford|cant afford|beyond my budget|out of my budget)\b/i;
const LOST_EXPLICIT_DECLINE_REGEX =
  /\b(no[, ]+thank(s| you)|no thanks|not interested|i['’]?m not interested|we['’]?re not interested)\b/i;
const LOST_EXPLICIT_DECLINE_GUARD =
  /\b(right now|at the moment|yet|maybe|later|in the future|when the time comes)\b/i;
const LOST_INDEFINITE_DECLINE_REGEX =
  /\b(not my time|not right now|not at this time|can['’]?t do this now|not ready)\b/i;
const LOST_INDEFINITE_FUTURE_REGEX =
  /\b(someday|one day|when the time comes|in the future|possibly|if.*going strong|when.*doors open)\b/i;
const LOST_INDEFINITE_GUARD = /\b(check back|reach out again|follow up)\b/i;
const LOST_TIMING_NOT_NOW_REGEX =
  /\b(not right now|not my time|not at this time)\b/i;
const LOST_FEASIBILITY_REGEX =
  /\b(won['’]?t work|probably won['’]?t work|won['’]?t fit|doesn['’]?t fit)\b/i;
const FEASIBILITY_CONTEXT_REGEX =
  /\b(dimensions?|size|fit|apartment|room|feet|foot|inches|\d{2,3}(")?)\b/i;

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isAckOnly(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (normalized.includes('?')) return false;
  if (INTENT_KEYWORDS.test(normalized)) return false;
  if (ACK_ONLY_TERMS.test(normalized)) {
    if (normalized.length <= 20) return true;
    if (normalized.length <= 60 && normalized.startsWith('thank')) return true;
  }
  if (
    normalized.length <= 80 &&
    (normalized.startsWith('thank you') ||
      normalized.startsWith('thanks') ||
      normalized.startsWith('thx') ||
      normalized.startsWith('ty'))
  ) {
    return true;
  }
  return ACK_ONLY_EMOJI.test(normalized);
}

function detectExplicitLost(text: string): ExplicitLostEvidence | null {
  const normalized = normalizeText(text);
  const pick = (
    match: RegExpMatchArray | null,
    code: ExplicitLostReasonCode,
  ) =>
    match?.[0]
      ? {
          reason_code: code,
          evidence: match[0],
          confidence: 'HIGH' as Confidence,
        }
      : null;

  const notIntentional = pick(
    normalized.match(LOST_NOT_INTENTIONAL_REGEX),
    'LOST_NOT_INTENTIONAL',
  );
  if (notIntentional) return notIntentional;

  const boughtElsewhere = pick(
    normalized.match(LOST_BOUGHT_ELSEWHERE_REGEX),
    'LOST_BOUGHT_ELSEWHERE',
  );
  if (boughtElsewhere) return boughtElsewhere;

  const choseExisting =
    pick(normalized.match(LOST_CHOSE_EXISTING_REGEX), 'LOST_CHOSE_EXISTING') ??
    pick(
      normalized.match(LOST_CHOSE_EXISTING_SO_REGEX),
      'LOST_CHOSE_EXISTING',
    ) ??
    pick(
      normalized.match(LOST_CHOSE_EXISTING_ALREADY_REGEX),
      'LOST_CHOSE_EXISTING',
    );
  if (choseExisting) return choseExisting;

  const priceOut = pick(
    normalized.match(LOST_PRICE_OUT_OF_RANGE_REGEX),
    'LOST_PRICE_OUT_OF_RANGE',
  );
  if (priceOut) return priceOut;

  const explicitDeclineMatch = normalized.match(LOST_EXPLICIT_DECLINE_REGEX);
  if (explicitDeclineMatch && !LOST_EXPLICIT_DECLINE_GUARD.test(normalized)) {
    return {
      reason_code: 'LOST_EXPLICIT_DECLINE',
      evidence: explicitDeclineMatch[0],
      confidence: 'HIGH',
    };
  }

  const hasIndefiniteDecline = LOST_INDEFINITE_DECLINE_REGEX.test(normalized);
  const hasIndefiniteFuture = LOST_INDEFINITE_FUTURE_REGEX.test(normalized);
  const hasIndefiniteGuard =
    LOST_INDEFINITE_GUARD.test(normalized) ||
    DEFERRAL_TERMS.test(normalized) ||
    Boolean(inferDeferralDate(normalized));
  if (hasIndefiniteDecline && hasIndefiniteFuture && !hasIndefiniteGuard) {
    const evidence =
      normalized.match(LOST_INDEFINITE_DECLINE_REGEX)?.[0] ??
      normalized.match(LOST_INDEFINITE_FUTURE_REGEX)?.[0] ??
      normalized;
    return {
      reason_code: 'LOST_INDEFINITE_FUTURE',
      evidence,
      confidence: 'HIGH',
    };
  }

  const timing = pick(
    normalized.match(LOST_TIMING_NOT_NOW_REGEX),
    'LOST_TIMING_NOT_NOW',
  );
  if (timing) {
    if (normalized.length <= 40) {
      return { ...timing, confidence: 'MEDIUM' };
    }
  }

  const feasibility = pick(
    normalized.match(LOST_FEASIBILITY_REGEX),
    'LOST_FEASIBILITY',
  );
  if (feasibility) {
    return { ...feasibility, confidence: 'MEDIUM' };
  }

  return null;
}

export function extractFeatures(
  text: string | null,
  direction: MessageDirection = 'inbound',
): MessageFeatures {
  const body = text ?? '';
  const bodyWithoutLinks = body.replace(LINK_REGEX, '');
  const matchesPhone = bodyWithoutLinks.match(PHONE_REGEX) ?? [];
  const matchesEmail = body.match(EMAIL_REGEX) ?? [];
  const deferralHint = inferDeferralDate(body);
  const ackOnly = direction === 'inbound' ? isAckOnly(body) : false;
  const explicitLost =
    direction === 'inbound' ? detectExplicitLost(body) : null;

  return {
    has_phone_number: matchesPhone.length > 0,
    has_email: matchesEmail.length > 0,
    has_currency: CURRENCY_REGEX.test(body),
    contains_price_terms: PRICE_TERMS.test(body),
    contains_opt_out: OPT_OUT_TERMS.test(body),
    contains_schedule_terms: SCHEDULE_TERMS.test(bodyWithoutLinks),
    contains_deferral_phrase: DEFERRAL_TERMS.test(body),
    deferral_date_hint: deferralHint,
    contains_conversion_phrase: CONVERSION_TERMS.test(body),
    contains_loss_phrase: LOSS_TERMS.test(body),
    contains_spam_phrase: SPAM_TERMS.test(body),
    contains_system_assignment: SYSTEM_ASSIGNMENT_TERMS.test(body),
    has_link: LINK_REGEX.test(body),
    message_length: body.length,
    ack_only: ackOnly || undefined,
    explicit_lost: explicitLost ?? undefined,
  };
}

function inferDeferralDate(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes('tomorrow')) {
    return 'tomorrow';
  }
  if (lower.includes('next week')) {
    return 'next_week';
  }
  if (lower.includes('next month')) {
    return 'next_month';
  }
  if (lower.includes('next spring') || lower.includes('until next spring')) {
    return 'next_spring';
  }
  if (lower.includes('next summer') || lower.includes('until next summer')) {
    return 'next_summer';
  }
  if (
    lower.includes('next fall') ||
    lower.includes('next autumn') ||
    lower.includes('until next fall') ||
    lower.includes('until next autumn')
  ) {
    return 'next_fall';
  }
  if (lower.includes('next winter') || lower.includes('until next winter')) {
    return 'next_winter';
  }
  const match = lower.match(/in\s+(\d{1,2})\s+days?/i);
  if (match?.[1]) {
    return `in_${match[1]}_days`;
  }
  const weeks = lower.match(/in\s+(\d{1,2})\s+weeks?/i);
  if (weeks?.[1]) {
    return `in_${Number(weeks[1]) * 7}_days`;
  }
  const months = lower.match(/in\s+(\d{1,2})\s+months?/i);
  if (months?.[1]) {
    return `in_${Number(months[1]) * 30}_days`;
  }
  return null;
}

export function buildRuleHits(features: MessageFeatures): string[] {
  const hits: string[] = [];
  if (features.contains_spam_phrase) hits.push('SPAM_PHRASE');
  if (
    features.contains_conversion_phrase &&
    !features.contains_system_assignment
  ) {
    hits.push('CONVERSION_PHRASE');
  }
  if (features.contains_system_assignment) hits.push('SYSTEM_ASSIGNMENT');
  if (features.contains_loss_phrase) hits.push('LOSS_PHRASE');
  if (features.has_phone_number || features.has_email)
    hits.push('PHONE_OR_EMAIL');
  if (features.contains_deferral_phrase) hits.push('DEFERRAL_PHRASE');
  if (features.has_currency) hits.push('PRICE_MENTION');
  if (features.contains_schedule_terms) hits.push('SCHEDULE_MENTION');
  if (features.contains_opt_out) hits.push('OPT_OUT');
  if (features.has_link) hits.push('LINK');
  if (features.ack_only) hits.push('ACK_ONLY');
  if (features.explicit_lost) {
    hits.push(`EXPLICIT_${features.explicit_lost.reason_code}`);
  }
  return hits;
}

export function annotateMessage(
  message: Omit<AnnotatedMessage, 'features' | 'ruleHits'>,
): AnnotatedMessage {
  const features = extractFeatures(message.text, message.direction);
  const ruleHits = buildRuleHits(features);
  return { ...message, features, ruleHits };
}

export type ConversationInferenceInput = {
  messages: AnnotatedMessage[];
  previousState?: ConversationState | null;
  previousEvaluatedAt?: string | null;
  finalTouchSentAt?: string | null;
  now?: Date;
  config: InferenceConfig;
};

export type ConversationInference = {
  state: ConversationState;
  confidence: Confidence;
  reasons: Array<
    string | { code: string; confidence: Confidence; evidence?: string }
  >;
  followupDueAt: string | null;
  followupSuggestion: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  inboundCount: number;
  outboundCount: number;
  lastSnippet: string | null;
  resurrected: boolean;
  stateTriggerMessageId?: string | null;
};

function coalesceSnippet(text: string | null): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
}

function deriveFollowupDueAt(
  hint: string | null,
  now: Date,
  defaultDays: number,
): string {
  const next = new Date(now.getTime());
  if (!hint) {
    next.setUTCDate(next.getUTCDate() + defaultDays);
    return next.toISOString();
  }
  if (hint === 'tomorrow') {
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString();
  }
  if (hint === 'next_week') {
    next.setUTCDate(next.getUTCDate() + 7);
    return next.toISOString();
  }
  if (hint === 'next_month') {
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next.toISOString();
  }
  if (hint === 'next_spring') {
    next.setUTCMonth(next.getUTCMonth() + 3);
    return next.toISOString();
  }
  if (hint === 'next_summer') {
    next.setUTCMonth(next.getUTCMonth() + 6);
    return next.toISOString();
  }
  if (hint === 'next_fall') {
    next.setUTCMonth(next.getUTCMonth() + 9);
    return next.toISOString();
  }
  if (hint === 'next_winter') {
    next.setUTCMonth(next.getUTCMonth() + 12);
    return next.toISOString();
  }
  const match = hint.match(/in_(\d+)_days/);
  if (match?.[1]) {
    next.setUTCDate(next.getUTCDate() + Number(match[1]));
    return next.toISOString();
  }
  next.setUTCDate(next.getUTCDate() + defaultDays);
  return next.toISOString();
}

function isoFromDateOnly(dateOnly: string): string | null {
  const parsed = Date.parse(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function hasRule(messages: AnnotatedMessage[], rule: string): boolean {
  return messages.some((msg) => msg.ruleHits.includes(rule));
}

export function inferConversation(
  input: ConversationInferenceInput,
): ConversationInference {
  const now = input.now ?? new Date();
  const messages = input.messages
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const messageCount = messages.length;
  let inboundCount = 0;
  let outboundCount = 0;
  let lastInboundAt: string | null = null;
  let lastOutboundAt: string | null = null;
  let lastSnippet: string | null = null;
  let lastMessageAt: string | null = null;
  let deferralHint: string | null = null;
  let lastDeferralAt: string | null = null;

  for (const msg of messages) {
    const isFinalTouch = msg.messageType === 'FINAL_TOUCH';
    if (!isFinalTouch) {
      if (msg.direction === 'inbound') {
        inboundCount += 1;
        lastInboundAt = msg.createdAt;
      } else {
        outboundCount += 1;
        lastOutboundAt = msg.createdAt;
      }
    }
    lastSnippet = coalesceSnippet(msg.text) ?? lastSnippet;
    lastMessageAt = msg.createdAt;
    if (msg.direction === 'inbound' && msg.features.contains_deferral_phrase) {
      deferralHint = msg.features.deferral_date_hint ?? deferralHint;
      lastDeferralAt = msg.createdAt;
    }
    if (
      msg.direction === 'inbound' &&
      msg.features.ai?.interpretation?.deferred?.is_deferred
    ) {
      lastDeferralAt = msg.createdAt;
    }
  }

  const inboundMessages = messages.filter((msg) => msg.direction === 'inbound');
  const lastInboundMessage =
    inboundMessages[inboundMessages.length - 1] ?? null;
  const lastInboundAckOnly = Boolean(lastInboundMessage?.features.ack_only);
  const feasibilityContext = messages.some((msg) =>
    FEASIBILITY_CONTEXT_REGEX.test(msg.text ?? ''),
  );
  const explicitLostByCode = new Map<
    ExplicitLostReasonCode,
    { message: AnnotatedMessage; evidence: ExplicitLostEvidence }
  >();
  for (const msg of inboundMessages) {
    if (msg.features.explicit_lost) {
      explicitLostByCode.set(msg.features.explicit_lost.reason_code, {
        message: msg,
        evidence: msg.features.explicit_lost,
      });
    }
  }
  const hasExplicitContact = messages.some(
    (msg) => msg.features.has_phone_number || msg.features.has_email,
  );
  const hasExplicitDeferral = inboundMessages.some(
    (msg) => msg.features.deferral_date_hint,
  );
  const aiHandoffMessage = !hasExplicitContact
    ? inboundMessages
        .slice()
        .reverse()
        .find((msg) => msg.features.ai?.interpretation?.handoff?.is_handoff)
    : null;
  const aiDeferredMessage = !hasExplicitDeferral
    ? inboundMessages
        .slice()
        .reverse()
        .find((msg) => msg.features.ai?.interpretation?.deferred?.is_deferred)
    : null;
  const aiDeferred = aiDeferredMessage?.features.ai?.interpretation?.deferred;
  let aiDeferredDueAt: string | null = null;
  if (aiDeferred?.is_deferred) {
    if (aiDeferred.due_date_iso) {
      aiDeferredDueAt = isoFromDateOnly(aiDeferred.due_date_iso);
    } else if (aiDeferred.bucket) {
      const dateOnly = mapDeferredBucketToDate(
        aiDeferred.bucket as Parameters<typeof mapDeferredBucketToDate>[0],
        now,
      );
      aiDeferredDueAt = isoFromDateOnly(dateOnly);
    }
  }
  const inboundConversionMessages = inboundMessages.filter(
    (msg) =>
      msg.features.contains_conversion_phrase &&
      !msg.features.contains_system_assignment,
  );
  const hasOptOut = hasRule(messages, 'OPT_OUT');
  const hasSpam = hasRule(messages, 'SPAM_PHRASE');
  const hasConversion = inboundConversionMessages.length > 0;
  const hasLoss = hasRule(messages, 'LOSS_PHRASE');
  const explicitLostOrder: ExplicitLostReasonCode[] = [
    'LOST_NOT_INTENTIONAL',
    'LOST_BOUGHT_ELSEWHERE',
    'LOST_CHOSE_EXISTING',
    'LOST_PRICE_OUT_OF_RANGE',
    'LOST_EXPLICIT_DECLINE',
    'LOST_INDEFINITE_FUTURE',
    'LOST_FEASIBILITY',
    'LOST_TIMING_NOT_NOW',
  ];
  let explicitLost: {
    message: AnnotatedMessage;
    evidence: ExplicitLostEvidence;
  } | null = null;
  for (const code of explicitLostOrder) {
    const candidate = explicitLostByCode.get(code);
    if (!candidate) continue;
    if (code === 'LOST_FEASIBILITY' && !feasibilityContext) {
      continue;
    }
    if (code === 'LOST_TIMING_NOT_NOW') {
      const futureIntent =
        candidate.message.features.contains_deferral_phrase ||
        Boolean(candidate.message.features.deferral_date_hint) ||
        Boolean(
          candidate.message.features.ai?.interpretation?.deferred?.is_deferred,
        );
      if (futureIntent) {
        continue;
      }
    }
    explicitLost = candidate;
    break;
  }
  let hasOffPlatform = false;
  let offPlatformReason: string | null = null;
  if (hasExplicitContact) {
    const lastOffPlatformMessage = messages
      .slice()
      .reverse()
      .find((msg) => msg.ruleHits.includes('PHONE_OR_EMAIL'));
    if (lastOffPlatformMessage) {
      const messagesAfter = messages.filter(
        (msg) => msg.createdAt > lastOffPlatformMessage.createdAt,
      );
      if (messagesAfter.length === 0) {
        hasOffPlatform = true;
      } else {
        const hasInboundAfter = messagesAfter.some(
          (msg) => msg.direction === 'inbound',
        );
        const hasOutboundAfter = messagesAfter.some(
          (msg) => msg.direction === 'outbound',
        );
        const hasSchedulingAfter = messagesAfter.some((msg) =>
          msg.ruleHits.includes('SCHEDULE_MENTION'),
        );
        const hasContactAfter = messagesAfter.some((msg) =>
          msg.ruleHits.includes('PHONE_OR_EMAIL'),
        );
        if (hasInboundAfter && hasOutboundAfter) {
          hasOffPlatform = hasSchedulingAfter || hasContactAfter;
        } else {
          hasOffPlatform = true;
        }
      }
    }
    if (hasOffPlatform) {
      offPlatformReason = 'PHONE_OR_EMAIL';
    }
  } else if (aiHandoffMessage) {
    hasOffPlatform = true;
    offPlatformReason = 'AI_HANDOFF';
  }
  const hasDeferralFromRules = hasRule(inboundMessages, 'DEFERRAL_PHRASE');
  let hasDeferral = hasExplicitDeferral || hasDeferralFromRules;
  const useAiDeferral = !hasExplicitDeferral && Boolean(aiDeferredMessage);
  if (useAiDeferral) {
    hasDeferral = true;
  }
  if (hasDeferral && lastDeferralAt && lastInboundAt) {
    const deferralMs = Date.parse(lastDeferralAt);
    const lastInboundMs = Date.parse(lastInboundAt);
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (
      !Number.isNaN(deferralMs) &&
      !Number.isNaN(lastInboundMs) &&
      lastInboundMs - deferralMs > oneDayMs
    ) {
      hasDeferral = false;
    }
  }
  const hasPrice = hasRule(messages, 'PRICE_MENTION');

  let reasons: Array<
    string | { code: string; confidence: Confidence; evidence?: string }
  > = [];
  let state: ConversationState = 'NEW';
  let confidence: Confidence = 'LOW';
  let followupDueAt: string | null = null;
  let followupSuggestion: string | null = null;
  let stateTriggerMessageId: string | null = null;

  if (hasSpam) {
    state = 'SPAM';
    confidence = 'HIGH';
    reasons.push('SPAM_PHRASE');
  } else if (hasConversion) {
    state = 'CONVERTED';
    confidence = 'HIGH';
    reasons.push('CONVERSION_PHRASE');
  } else if (explicitLost) {
    state = 'LOST';
    confidence = explicitLost.evidence.confidence;
    reasons.push({
      code: explicitLost.evidence.reason_code,
      confidence: explicitLost.evidence.confidence,
      evidence: explicitLost.evidence.evidence,
    });
    stateTriggerMessageId = explicitLost.message.id;
  } else if (hasLoss) {
    state = 'LOST';
    confidence = 'HIGH';
    reasons.push('LOSS_PHRASE');
  } else if (hasOffPlatform) {
    state = 'OFF_PLATFORM';
    confidence = 'MEDIUM';
    if (offPlatformReason) {
      reasons.push(offPlatformReason);
    }
  } else if (hasDeferral) {
    state = 'DEFERRED';
    confidence = 'MEDIUM';
    if (useAiDeferral) {
      reasons.push('AI_DEFERRED');
      followupDueAt =
        aiDeferredDueAt ??
        deriveFollowupDueAt(null, now, input.config.deferDefaultDays);
    } else {
      reasons.push('DEFERRAL_PHRASE');
      followupDueAt = deriveFollowupDueAt(
        deferralHint,
        now,
        input.config.deferDefaultDays,
      );
    }
  } else if (hasPrice) {
    state = 'PRICE_GIVEN';
    confidence = 'MEDIUM';
    reasons.push('PRICE_MENTION');
  } else if (inboundCount >= 4 && outboundCount >= 4) {
    state = 'HIGHLY_PRODUCTIVE';
    confidence = 'MEDIUM';
  } else if (inboundCount >= 2 && outboundCount >= 2) {
    state = 'PRODUCTIVE';
    confidence = 'MEDIUM';
  } else if (inboundCount >= 1 && outboundCount >= 1) {
    state = 'ENGAGED';
    confidence = 'LOW';
  }

  const resurrected = detectResurrection({
    previousState: input.previousState,
    previousEvaluatedAt: input.previousEvaluatedAt,
    lastInboundAt,
    lastInboundAckOnly,
    lastInboundMessage,
    finalTouchSentAt: input.finalTouchSentAt ?? null,
    config: input.config,
  });
  if (resurrected) {
    reasons.push('RESURRECTED');
  }

  if (state === 'DEFERRED') {
    if (followupDueAt) {
      const dueMs = Date.parse(followupDueAt);
      followupSuggestion =
        !Number.isNaN(dueMs) && dueMs > now.getTime()
          ? 'Follow up later'
          : 'Follow up now';
    } else {
      followupSuggestion = 'Follow up later';
    }
  } else if (state === 'OFF_PLATFORM') {
    followupSuggestion = 'Visibility lost (off-platform)';
  } else if (state !== 'SPAM' && state !== 'LOST' && state !== 'CONVERTED') {
    if (inboundCount === 0) {
      followupSuggestion = null;
    } else if (lastInboundAt) {
      const inboundMs = Date.parse(lastInboundAt);
      const outboundMs = lastOutboundAt ? Date.parse(lastOutboundAt) : null;
      if (Number.isNaN(inboundMs)) {
        // no-op
      } else if (outboundMs === null || outboundMs < inboundMs) {
        followupSuggestion = 'Reply recommended';
        reasons.push('UNREPLIED');
        const ageHours = (now.getTime() - inboundMs) / (1000 * 60 * 60);
        if (ageHours >= input.config.slaHours) {
          reasons.push('SLA_BREACH');
        }
      }
    }
  }

  if (inboundCount === 0) {
    followupSuggestion = null;
    reasons = reasons.filter(
      (reason) => reason !== 'UNREPLIED' && reason !== 'SLA_BREACH',
    );
  }

  if (state === 'CONVERTED' || state === 'SPAM' || state === 'LOST') {
    followupSuggestion = null;
    reasons = reasons.filter(
      (reason) => reason !== 'UNREPLIED' && reason !== 'SLA_BREACH',
    );
  }

  const hasFutureFollowup =
    followupDueAt &&
    !Number.isNaN(Date.parse(followupDueAt)) &&
    Date.parse(followupDueAt) > now.getTime();
  const inactiveMs = 30 * 24 * 60 * 60 * 1000;
  const inactiveTimeout =
    lastInboundAt &&
    !Number.isNaN(Date.parse(lastInboundAt)) &&
    now.getTime() - Date.parse(lastInboundAt) >= inactiveMs;
  if (
    !['LOST', 'SPAM', 'CONVERTED', 'OFF_PLATFORM'].includes(state) &&
    outboundCount > 0 &&
    inactiveTimeout &&
    !hasOptOut &&
    !explicitLost &&
    !hasLoss &&
    !hasFutureFollowup
  ) {
    state = 'LOST';
    confidence = 'HIGH';
    followupSuggestion = null;
    followupDueAt = null;
    reasons = [
      {
        code: 'LOST_INACTIVE_TIMEOUT',
        confidence: 'HIGH',
        evidence: lastInboundAt,
      },
    ];
  }

  if (state === 'PRICE_GIVEN') {
    const thresholdMs = input.config.lostAfterPriceDays * 24 * 60 * 60 * 1000;
    const lastActivity =
      (lastOutboundAt && Date.parse(lastOutboundAt)) ||
      (lastInboundAt && Date.parse(lastInboundAt)) ||
      null;
    if (lastActivity && now.getTime() - lastActivity > thresholdMs) {
      state = 'LOST';
      confidence = 'MEDIUM';
      reasons.push('PRICE_STALE');
    }
  }

  if (state === 'NEW' && messageCount > 0) {
    confidence = 'LOW';
  }

  return {
    state,
    confidence,
    reasons,
    followupDueAt,
    followupSuggestion,
    lastInboundAt,
    lastOutboundAt,
    lastMessageAt,
    messageCount,
    inboundCount,
    outboundCount,
    lastSnippet,
    resurrected,
    stateTriggerMessageId,
  };
}

function detectResurrection(input: {
  previousState?: ConversationState | null;
  previousEvaluatedAt?: string | null;
  lastInboundAt: string | null;
  lastInboundAckOnly?: boolean;
  lastInboundMessage?: AnnotatedMessage | null;
  finalTouchSentAt?: string | null;
  config: InferenceConfig;
}): boolean {
  const prev = input.previousState;
  if (!prev || !input.lastInboundAt) return false;
  if (input.lastInboundAckOnly) return false;
  if (!['LOST', 'DEFERRED', 'OFF_PLATFORM'].includes(prev)) return false;
  if (input.finalTouchSentAt) {
    const msg = input.lastInboundMessage;
    const hasIntent = Boolean(
      msg &&
        (msg.features.contains_price_terms ||
          msg.features.has_currency ||
          msg.features.contains_schedule_terms ||
          msg.features.contains_deferral_phrase),
    );
    if (!hasIntent) {
      return false;
    }
  }
  if (!input.previousEvaluatedAt) return false;
  const lastInboundMs = Date.parse(input.lastInboundAt);
  const prevMs = Date.parse(input.previousEvaluatedAt);
  if (Number.isNaN(lastInboundMs) || Number.isNaN(prevMs)) return false;
  const gapMs = input.config.resurrectGapDays * 24 * 60 * 60 * 1000;
  return lastInboundMs - prevMs >= gapMs;
}
