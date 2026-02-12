const FOLLOWUP_IDLE_SECONDS = 24 * 60 * 60;
const REVIVAL_WINDOW_SECONDS = 24 * 60 * 60;

type FollowupEnv = {
  DB: D1Database;
};

export type FollowupTimelineMessage = {
  id: string;
  userId: string;
  conversationId: string;
  pageId: string;
  assetId: string | null;
  createdAt: string;
  direction: string | null;
  senderType: string | null;
  body: string | null;
  messageType: string | null;
  messageTrigger: string | null;
  featuresJson: string | null;
  ruleHitsJson: string | null;
};

type ExistingEvent = {
  followupMessageId: string;
  followupSentAt: string;
  previousActivityAt: string | null;
  idleSeconds: number | null;
  revived: number;
  immediateLoss: number;
  nextInboundMessageId: string | null;
  nextInboundAt: string | null;
  nextInboundIsLoss: number | null;
};

type DerivedEvent = {
  followupMessageId: string;
  userId: string;
  conversationId: string;
  pageId: string;
  assetId: string | null;
  followupSentAt: string;
  previousActivityAt: string | null;
  idleSeconds: number | null;
  revived: number;
  immediateLoss: number;
  nextInboundMessageId: string | null;
  nextInboundAt: string | null;
  nextInboundIsLoss: number | null;
};

type RangeKey = '24h' | '7d' | '30d' | '90d';
type BucketKey = 'hour' | 'day' | 'week' | 'month';

export function parseJsonObject<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed;
  } catch {
    return null;
  }
}

function parseRuleHits(value: string | null): string[] {
  const parsed = parseJsonObject<unknown>(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item) => typeof item === 'string') as string[];
}

function parseFeatures(value: string | null): Record<string, unknown> {
  const parsed = parseJsonObject<Record<string, unknown>>(value);
  if (!parsed || typeof parsed !== 'object') return {};
  return parsed;
}

function messageEpoch(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function parseFlexibleTimestamp(value: string | null): number | null {
  if (!value) return null;
  let ms = Date.parse(value);
  if (!Number.isNaN(ms)) return ms;
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : ms;
}

export function isSystemAdministrativeMessage(message: {
  senderType: string | null;
  messageType: string | null;
  messageTrigger: string | null;
  ruleHitsJson: string | null;
}): boolean {
  const senderType = (message.senderType ?? '').trim().toLowerCase();
  const messageType = (message.messageType ?? '').trim().toLowerCase();
  const messageTrigger = (message.messageTrigger ?? '').trim().toLowerCase();
  const ruleHits = parseRuleHits(message.ruleHitsJson);

  if (senderType === 'system') return true;
  if (messageType === 'system' || messageType === 'assignment_notice') {
    return true;
  }
  if (
    messageTrigger.includes('system') ||
    messageTrigger.includes('assignment') ||
    messageTrigger.includes('admin')
  ) {
    return true;
  }
  return ruleHits.includes('SYSTEM_ASSIGNMENT');
}

export function isAckOnlyInboundMessage(message: {
  direction: string | null;
  featuresJson: string | null;
}): boolean {
  if (message.direction !== 'inbound') return false;
  const features = parseFeatures(message.featuresJson);
  return features.ack_only === true;
}

export function isLossInboundMessage(message: {
  direction: string | null;
  featuresJson: string | null;
  ruleHitsJson: string | null;
}): boolean {
  if (message.direction !== 'inbound') return false;
  const features = parseFeatures(message.featuresJson);
  const ruleHits = parseRuleHits(message.ruleHitsJson);
  if (ruleHits.includes('LOSS_PHRASE')) return true;
  if (ruleHits.includes('EXPLICIT_REJECTION')) return true;
  if (ruleHits.includes('PRICE_REJECTION')) return true;
  if (ruleHits.includes('INDEFINITE_DEFERRAL')) return true;
  if (features.has_explicit_rejection_phrase === true) return true;
  if (features.has_price_rejection_phrase === true) return true;
  if (features.contains_loss_phrase === true) return true;
  if (features.has_indefinite_deferral_phrase === true) return true;
  if (features.explicit_lost && typeof features.explicit_lost === 'object') {
    return true;
  }
  return false;
}

function isConversationActivityMessage(
  message: FollowupTimelineMessage,
): boolean {
  if (isSystemAdministrativeMessage(message)) return false;
  if (isAckOnlyInboundMessage(message)) return false;
  return true;
}

function isEligibleFollowupOutbound(message: FollowupTimelineMessage): boolean {
  if (message.direction !== 'outbound') return false;
  if (message.senderType !== 'business') return false;
  if (isSystemAdministrativeMessage(message)) return false;
  return true;
}

export function deriveFollowupEventsForMessages(
  messages: FollowupTimelineMessage[],
  existingByFollowupId: Map<string, ExistingEvent>,
): DerivedEvent[] {
  const sorted = messages
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let lastActivityAt: string | null = null;
  const events: DerivedEvent[] = [];

  for (const message of sorted) {
    const createdMs = messageEpoch(message.createdAt);
    if (createdMs === null) continue;

    if (isEligibleFollowupOutbound(message)) {
      const previousActivityAt = lastActivityAt;
      const previousActivityMs = previousActivityAt
        ? messageEpoch(previousActivityAt)
        : null;
      const idleSeconds =
        previousActivityMs === null
          ? null
          : Math.max(0, Math.floor((createdMs - previousActivityMs) / 1000));
      const isFollowup =
        previousActivityMs === null ||
        (idleSeconds !== null && idleSeconds >= FOLLOWUP_IDLE_SECONDS);

      if (isFollowup) {
        const existing = existingByFollowupId.get(message.id);
        events.push({
          followupMessageId: message.id,
          userId: message.userId,
          conversationId: message.conversationId,
          pageId: message.pageId,
          assetId: message.assetId,
          followupSentAt: message.createdAt,
          previousActivityAt,
          idleSeconds,
          revived: existing?.revived === 1 ? 1 : 0,
          immediateLoss: existing?.immediateLoss === 1 ? 1 : 0,
          nextInboundMessageId: existing?.nextInboundMessageId ?? null,
          nextInboundAt: existing?.nextInboundAt ?? null,
          nextInboundIsLoss: existing?.nextInboundIsLoss ?? null,
        });
      }
    }

    if (isConversationActivityMessage(message)) {
      lastActivityAt = message.createdAt;
    }
  }

  for (const message of sorted) {
    if (message.direction !== 'inbound') continue;
    if (isSystemAdministrativeMessage(message)) continue;
    if (isAckOnlyInboundMessage(message)) continue;
    const inboundMs = messageEpoch(message.createdAt);
    if (inboundMs === null) continue;

    let latestCandidate: DerivedEvent | null = null;
    for (const event of events) {
      const followupMs = messageEpoch(event.followupSentAt);
      if (followupMs === null) continue;
      if (followupMs > inboundMs) continue;
      if (!latestCandidate) {
        latestCandidate = event;
        continue;
      }
      const latestMs = messageEpoch(latestCandidate.followupSentAt) ?? 0;
      if (followupMs >= latestMs) {
        latestCandidate = event;
      }
    }
    if (!latestCandidate) continue;
    if (latestCandidate.nextInboundMessageId) continue;

    latestCandidate.nextInboundMessageId = message.id;
    latestCandidate.nextInboundAt = message.createdAt;
    latestCandidate.nextInboundIsLoss = isLossInboundMessage(message) ? 1 : 0;

    const followupMs = messageEpoch(latestCandidate.followupSentAt);
    if (followupMs === null) continue;
    const within24h = inboundMs - followupMs < REVIVAL_WINDOW_SECONDS * 1000;
    if (within24h) {
      latestCandidate.revived = 1;
      if (latestCandidate.nextInboundIsLoss === 1) {
        latestCandidate.immediateLoss = 1;
      }
    }
  }

  for (const event of events) {
    if (!event.nextInboundAt) continue;
    const followupMs = messageEpoch(event.followupSentAt);
    const inboundMs = messageEpoch(event.nextInboundAt);
    if (followupMs === null || inboundMs === null) continue;
    const within24h = inboundMs - followupMs < REVIVAL_WINDOW_SECONDS * 1000;
    if (within24h) {
      event.revived = 1;
      if (event.nextInboundIsLoss === 1) {
        event.immediateLoss = 1;
      }
    }
  }

  return events;
}

export async function recomputeFollowupEventsForConversation(
  env: FollowupEnv,
  input: {
    userId: string;
    conversationId: string;
  },
) {
  const messagesResult = await env.DB.prepare(
    `SELECT id,
            user_id as userId,
            conversation_id as conversationId,
            page_id as pageId,
            asset_id as assetId,
            created_time as createdAt,
            direction,
            sender_type as senderType,
            body,
            message_type as messageType,
            message_trigger as messageTrigger,
            features_json as featuresJson,
            rule_hits_json as ruleHitsJson
     FROM messages
     WHERE user_id = ? AND conversation_id = ?
     ORDER BY created_time ASC`,
  )
    .bind(input.userId, input.conversationId)
    .all<FollowupTimelineMessage>();

  const messages = messagesResult.results ?? [];
  if (!messages.length) {
    return { upserted: 0 };
  }

  const existingResult = await env.DB.prepare(
    `SELECT followup_message_id as followupMessageId,
            followup_sent_at as followupSentAt,
            previous_activity_at as previousActivityAt,
            idle_seconds as idleSeconds,
            revived,
            immediate_loss as immediateLoss,
            next_inbound_message_id as nextInboundMessageId,
            next_inbound_at as nextInboundAt,
            next_inbound_is_loss as nextInboundIsLoss
     FROM followup_events
     WHERE user_id = ? AND conversation_id = ?`,
  )
    .bind(input.userId, input.conversationId)
    .all<ExistingEvent>();

  const existingByFollowupId = new Map(
    (existingResult.results ?? []).map((row) => [row.followupMessageId, row]),
  );

  const events = deriveFollowupEventsForMessages(
    messages,
    existingByFollowupId,
  );
  if (!events.length) {
    return { upserted: 0 };
  }

  const upsert = env.DB.prepare(
    `INSERT INTO followup_events
      (followup_message_id, user_id, conversation_id, page_id, asset_id,
       followup_sent_at, previous_activity_at, idle_seconds,
       revived, immediate_loss,
       next_inbound_message_id, next_inbound_at, next_inbound_is_loss,
       updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(followup_message_id) DO UPDATE SET
       user_id = excluded.user_id,
       conversation_id = excluded.conversation_id,
       page_id = excluded.page_id,
       asset_id = excluded.asset_id,
       followup_sent_at = excluded.followup_sent_at,
       previous_activity_at = excluded.previous_activity_at,
       idle_seconds = excluded.idle_seconds,
       revived = CASE
         WHEN followup_events.revived = 1 THEN 1
         ELSE excluded.revived
       END,
       immediate_loss = CASE
         WHEN followup_events.immediate_loss = 1 THEN 1
         ELSE excluded.immediate_loss
       END,
       next_inbound_message_id = COALESCE(
         followup_events.next_inbound_message_id,
         excluded.next_inbound_message_id
       ),
       next_inbound_at = COALESCE(
         followup_events.next_inbound_at,
         excluded.next_inbound_at
       ),
       next_inbound_is_loss = CASE
         WHEN followup_events.next_inbound_is_loss IS NOT NULL
           THEN followup_events.next_inbound_is_loss
         ELSE excluded.next_inbound_is_loss
       END,
       updated_at = excluded.updated_at`,
  );

  const nowIso = new Date().toISOString();
  const statements = events.map((event) =>
    upsert.bind(
      event.followupMessageId,
      event.userId,
      event.conversationId,
      event.pageId,
      event.assetId,
      event.followupSentAt,
      event.previousActivityAt,
      event.idleSeconds,
      event.revived,
      event.immediateLoss,
      event.nextInboundMessageId,
      event.nextInboundAt,
      event.nextInboundIsLoss,
      nowIso,
    ),
  );

  const batchSize = 100;
  for (let i = 0; i < statements.length; i += batchSize) {
    await env.DB.batch(statements.slice(i, i + batchSize));
  }
  return { upserted: statements.length };
}

export async function backfillFollowupEventsForUser(
  env: FollowupEnv,
  input: { userId: string },
) {
  const conversations = await env.DB.prepare(
    `SELECT id
     FROM conversations
     WHERE user_id = ?
     ORDER BY COALESCE(started_time, last_message_at, updated_time, id) ASC, id ASC`,
  )
    .bind(input.userId)
    .all<{ id: string }>();

  const rows = conversations.results ?? [];
  let upsertedEvents = 0;
  for (const row of rows) {
    const result = await recomputeFollowupEventsForConversation(env, {
      userId: input.userId,
      conversationId: row.id,
    });
    upsertedEvents += result.upserted;
  }

  return {
    scannedConversations: rows.length,
    upsertedEvents,
  };
}

export async function repairFollowupEventLossFlags(
  env: FollowupEnv,
  input: { userId?: string | null; limit?: number },
) {
  const limit = Math.max(1, Math.min(10000, input.limit ?? 2000));
  const where: string[] = ['next_inbound_message_id IS NOT NULL'];
  const bindings: unknown[] = [];
  if (input.userId) {
    where.push('user_id = ?');
    bindings.push(input.userId);
  }

  const rows = await env.DB.prepare(
    `SELECT followup_message_id as followupMessageId,
            user_id as userId,
            next_inbound_message_id as nextInboundMessageId,
            revived
     FROM followup_events
     WHERE ${where.join(' AND ')}
     ORDER BY followup_sent_at DESC
     LIMIT ?`,
  )
    .bind(...bindings, limit)
    .all<{
      followupMessageId: string;
      userId: string;
      nextInboundMessageId: string;
      revived: number;
    }>();

  const update = env.DB.prepare(
    `UPDATE followup_events
     SET next_inbound_is_loss = ?,
         immediate_loss = CASE WHEN revived = 1 AND ? = 1 THEN 1 ELSE immediate_loss END,
         updated_at = ?
     WHERE followup_message_id = ?`,
  );

  const nowIso = new Date().toISOString();
  const updates: D1PreparedStatement[] = [];
  for (const row of rows.results ?? []) {
    const inbound = await env.DB.prepare(
      `SELECT direction,
              features_json as featuresJson,
              rule_hits_json as ruleHitsJson
       FROM messages
       WHERE user_id = ? AND id = ?`,
    )
      .bind(row.userId, row.nextInboundMessageId)
      .first<{
        direction: string | null;
        featuresJson: string | null;
        ruleHitsJson: string | null;
      }>();
    if (!inbound) continue;
    const isLoss = isLossInboundMessage(inbound) ? 1 : 0;
    updates.push(update.bind(isLoss, isLoss, nowIso, row.followupMessageId));
  }

  if (updates.length) {
    const batchSize = 100;
    for (let i = 0; i < updates.length; i += batchSize) {
      await env.DB.batch(updates.slice(i, i + batchSize));
    }
  }

  return { scanned: (rows.results ?? []).length, updated: updates.length };
}

function parseRange(range: string | null): { key: RangeKey; ms: number } {
  switch ((range ?? '').toLowerCase()) {
    case '24h':
      return { key: '24h', ms: 24 * 60 * 60 * 1000 };
    case '7d':
      return { key: '7d', ms: 7 * 24 * 60 * 60 * 1000 };
    case '90d':
      return { key: '90d', ms: 90 * 24 * 60 * 60 * 1000 };
    case '30d':
    default:
      return { key: '30d', ms: 30 * 24 * 60 * 60 * 1000 };
  }
}

function parseBucket(bucket: string | null, range: RangeKey): BucketKey {
  const normalized = (bucket ?? '').toLowerCase();
  if (
    normalized === 'hour' ||
    normalized === 'day' ||
    normalized === 'week' ||
    normalized === 'month'
  ) {
    return normalized;
  }
  if (range === '24h') return 'hour';
  if (range === '7d') return 'day';
  if (range === '90d') return 'week';
  return 'day';
}

function floorBucket(value: Date, bucket: BucketKey): Date {
  const d = new Date(value.getTime());
  if (bucket === 'hour') {
    d.setUTCMinutes(0, 0, 0);
    return d;
  }
  if (bucket === 'day') {
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (bucket === 'week') {
    d.setUTCHours(0, 0, 0, 0);
    const day = d.getUTCDay();
    const diff = (day + 6) % 7;
    d.setUTCDate(d.getUTCDate() - diff);
    return d;
  }
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function addBucket(value: Date, bucket: BucketKey): Date {
  const d = new Date(value.getTime());
  if (bucket === 'hour') {
    d.setUTCHours(d.getUTCHours() + 1);
    return d;
  }
  if (bucket === 'day') {
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }
  if (bucket === 'week') {
    d.setUTCDate(d.getUTCDate() + 7);
    return d;
  }
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

export async function getFollowupSeries(
  env: FollowupEnv,
  input: {
    userId?: string | null;
    range: string | null;
    bucket: string | null;
    now?: Date;
  },
) {
  const parsedRange = parseRange(input.range);
  const parsedBucket = parseBucket(input.bucket, parsedRange.key);
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const end = floorBucket(now, parsedBucket);
  const start = floorBucket(
    new Date(end.getTime() - parsedRange.ms + 60 * 1000),
    parsedBucket,
  );
  const startMs = start.getTime();

  const where: string[] = [];
  const bindings: unknown[] = [];
  if (input.userId) {
    where.push('user_id = ?');
    bindings.push(input.userId);
  }

  const sql = `SELECT followup_sent_at as followupSentAt,
                      revived,
                      immediate_loss as immediateLoss
               FROM followup_events${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;

  const rows = await env.DB.prepare(sql)
    .bind(...bindings)
    .all<{
      followupSentAt: string | null;
      revived: number;
      immediateLoss: number;
    }>();

  const byBucket = new Map<
    string,
    { events: number; revived: number; immediateLoss: number }
  >();
  for (const row of rows.results ?? []) {
    const followupMs = parseFlexibleTimestamp(row.followupSentAt);
    if (followupMs === null || followupMs < startMs || followupMs > nowMs) {
      continue;
    }
    const key = floorBucket(new Date(followupMs), parsedBucket).toISOString();
    const current = byBucket.get(key) ?? {
      events: 0,
      revived: 0,
      immediateLoss: 0,
    };
    current.events += 1;
    current.revived += Number(row.revived ?? 0) > 0 ? 1 : 0;
    current.immediateLoss += Number(row.immediateLoss ?? 0) > 0 ? 1 : 0;
    byBucket.set(key, current);
  }

  const series: Array<{
    t: string;
    events: number;
    revived: number;
    immediate_loss: number;
  }> = [];
  for (
    let cursor = new Date(start.getTime());
    cursor.getTime() <= end.getTime();
    cursor = addBucket(cursor, parsedBucket)
  ) {
    const key = floorBucket(cursor, parsedBucket).toISOString();
    const row = byBucket.get(key);
    series.push({
      t: key,
      events: Number(row?.events ?? 0),
      revived: Number(row?.revived ?? 0),
      immediate_loss: Number(row?.immediateLoss ?? 0),
    });
  }

  return {
    bucket: parsedBucket,
    range: parsedRange.key,
    series,
  };
}
