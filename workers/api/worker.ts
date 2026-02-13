import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  debugToken,
  fetchPermissions,
  fetchBusinesses,
  fetchBusinessPages,
  fetchClassicPages,
  fetchPageToken,
  subscribeAppToPage,
  fetchPageName,
  fetchInstagramAssets,
  fetchPageIgDebug,
  fetchConversationsPage,
  fetchConversationMessages,
  metaConfig,
  type MetaApiError,
  type MetaConversation,
  sendMessage,
  fetchUserProfile,
} from './meta';
import {
  isReplyWindowClosed,
  syncConversationInboxLabels,
} from './inboxLabels';
import {
  annotateMessage,
  inferConversation,
  type AnnotatedMessage,
  type Confidence,
  type ConversationInference,
  type ConversationState,
  type InferenceConfig,
  type MessageFeatures,
} from './inference';
import {
  buildFeatureSnapshot,
  CLASSIFIER_VERSION,
  reasonCodesFromReasons,
  resolveComputedClassification,
} from './conversationAudit';
import { buildContextDigest } from './aiInterpreter';
import { getAiConfig, runAiAttemptForMessage } from './aiRun';
import {
  createAiRunStats,
  recordAiRunAttempt,
  recordAiRunSkip,
  type AiRunStats,
} from './aiStats';
import { reportError } from './observability/reportError';
import { queryAnalyticsEngine } from './observability/analyticsEngine';
import {
  parseMetricsWindow,
  windowToSqlInterval,
  type MetricsWindow,
} from './observability/window';
import { registerRoutes } from './routes';
import { buildReportFromDb } from './report';
import {
  backfillFollowupEventsForUser,
  getFollowupSeries,
  recomputeFollowupEventsForConversation,
  repairFollowupEventLossFlags,
} from './followupEvents';
import { handleAuthGateway, requireAccessAuth } from './authGateway';

export type Env = {
  DB: D1Database;
  SYNC_QUEUE: Queue<SyncJob>;
  SYNC_RUNS_HUB: DurableObjectNamespace;
  INBOX_HUB: DurableObjectNamespace;
  SYNC_SCOPE_ORCHESTRATOR: DurableObjectNamespace;
  AI?: {
    run: (model: string, input: unknown, options?: unknown) => Promise<unknown>;
  };
  DEV_WS_PUBLISH_URL?: string;
  AE_META_CALLS: AnalyticsEngineDataset;
  AE_APP_ERRORS: AnalyticsEngineDataset;
  META_APP_ID: string;
  META_APP_SECRET: string;
  META_REDIRECT_URI: string;
  META_API_VERSION?: string;
  META_SCOPES?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  EARLIEST_MESSAGES_AT?: string;
  SYNC_MIN_INTERVAL_MINUTES?: string;
  SYNC_CHECKPOINT_OVERLAP_SECONDS?: string;
  FOLLOWUP_WINDOW_DAYS?: string;
  FOLLOWUP_SLA_HOURS?: string;
  INBOX_SLA_HOURS?: string;
  INBOX_LOST_AFTER_PRICE_DAYS?: string;
  INBOX_LOST_AFTER_PRICE_REJECTION_DAYS?: string;
  INBOX_LOST_AFTER_OFF_PLATFORM_NO_CONTACT_DAYS?: string;
  INBOX_LOST_AFTER_INDEFINITE_DEFERRAL_DAYS?: string;
  INBOX_DUE_SOON_DAYS?: string;
  INBOX_RESURRECT_GAP_DAYS?: string;
  INBOX_DEFER_DEFAULT_DAYS?: string;
  CLASSIFIER_AI_MODE?: string;
  CLASSIFIER_AI_MODEL?: string;
  CLASSIFIER_AI_PROMPT_VERSION?: string;
  CLASSIFIER_AI_TIMEOUT_MS?: string;
  CLASSIFIER_AI_MAX_OUTPUT_TOKENS?: string;
  CLASSIFIER_AI_MAX_INPUT_CHARS?: string;
  CLASSIFIER_AI_DAILY_BUDGET_CALLS?: string;
  CLASSIFIER_AI_MAX_CALLS_PER_CONVERSATION_PER_DAY?: string;
  FEATURE_FOLLOWUP_INBOX?: string;
  FEATURE_OPS_DASHBOARD?: string;
  FEATURE_AUDIT_CONVERSATIONS?: string;
  SESSION_SECRET: string;
  MSGSTATS_JWT_SECRET: string;
  MSGSTATS_JWT_ISSUER: string;
  MSGSTATS_JWT_AUDIENCE: string;
  AUTH_SESSION_PEPPER: string;
  AUTH_REFRESH_ENCRYPTION_KEY: string;
  AUTH_INVITE_PEPPER: string;
  AUTH0_DOMAIN: string;
  AUTH0_CLIENT_ID: string;
  AUTH0_AUDIENCE?: string;
  AUTH0_REDIRECT_URI: string;
  AUTH0_AUTHORIZE_URL: string;
  AUTH0_TOKEN_URL: string;
  AUTH0_JWKS_URL: string;
  APP_ORIGIN?: string;
  DEPLOY_ENV?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  RESEND_API_KEY?: string;
  ALERT_EMAIL_TO?: string;
  ALERT_EMAIL_FROM?: string;
  META_ERROR_RATE_THRESHOLD?: string;
  META_MIN_CALLS_THRESHOLD?: string;
  APP_ERRORS_THRESHOLD?: string;
};

type SyncJob =
  | {
      kind?: 'sync';
      userId: string;
      pageId: string;
      platform: 'messenger' | 'instagram';
      igId?: string;
      runId: string;
      cursor?: string | null;
      attempt?: number;
    }
  | {
      kind: 'recompute_stats';
      runId: string;
      cursor?: string | null;
      initialized?: boolean;
      attempt?: number;
    }
  | {
      kind: 'recompute_inbox';
      userId: string;
      cursor?: string | null;
      attempt?: number;
      forceLabelSync?: boolean;
    };

type RouteHandler = (
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
) => Promise<Response> | Response;

type SyncRunRow = {
  id: string;
  userId: string;
  pageId: string;
  platform: string;
  igBusinessId: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  conversations: number;
  messages: number;
  updatedAt: string;
  statsStatus: string | null;
  statsStartedAt: string | null;
  statsFinishedAt: string | null;
  statsError: string | null;
  aiStatsJson?: string | null;
  aiConfigJson?: string | null;
};

type SyncScope = {
  userId: string;
  pageId: string;
  platform: 'messenger' | 'instagram';
  igBusinessId: string | null;
};

type ConversationRow = {
  id: string;
  userId: string;
  platform: 'messenger' | 'instagram';
  pageId: string;
  igBusinessId: string | null;
  assetId: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastMessageAt: string | null;
  participantId: string | null;
  participantName: string | null;
  participantHandle: string | null;
  needsFollowup: number;
  followupReasons: string | null;
  currentState: ConversationState | null;
  currentConfidence: string | null;
  followupDueAt: string | null;
  followupSuggestion: string | null;
  lastEvaluatedAt: string | null;
  messageCount: number;
  inboundCount: number;
  outboundCount: number;
  isSpam: number;
  lastSnippet: string | null;
  offPlatformOutcome: string | null;
  blockedByRecipient?: number | null;
  blockedAt?: string | null;
  bouncedByProvider?: number | null;
  bouncedAt?: string | null;
  finalTouchRequired?: number | null;
  finalTouchSentAt?: string | null;
  lostReasonCode?: string | null;
};

// function pickUsage(headers: Headers) {
//   const keys = ["x-app-usage", "x-page-usage", "x-business-use-case-usage", "retry-after"];
//   const out: Record<string, string> = {};
//   for (const k of keys) {
//     const v = headers.get(k);
//     if (v) out[k] = v;
//   }
//   return out;
// }

function normalizeUnknownError(err: unknown): {
  name?: string;
  message: string;
  stack?: string;
  rawType: string;
  extra?: Record<string, unknown>;
} {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      rawType: 'Error',
    };
  }

  // Response thrown?
  if (typeof err === 'object' && err && 'status' in err && 'headers' in err) {
    // likely a Response
    const responseLike = err as { status?: unknown; headers?: unknown };
    const status =
      typeof responseLike.status === 'number' ? responseLike.status : undefined;
    return {
      message: 'Non-Error thrown (Response-like)',
      rawType: 'ResponseLike',
      extra: {
        status,
        // don’t try to serialize headers directly; extract interesting ones
      },
    };
  }

  // Plain object
  if (typeof err === 'object' && err) {
    return {
      message: 'Non-Error thrown (object)',
      rawType: 'Object',
      extra: Object.fromEntries(
        Object.entries(err as Record<string, unknown>).slice(0, 50),
      ),
    };
  }

  return {
    message: String(err),
    rawType: typeof err,
  };
}

function classifyMetaErrorKey(error: MetaApiError): string {
  const meta =
    typeof error.meta === 'object' && error.meta !== null
      ? (error.meta as { error?: { code?: number; type?: string } })
      : undefined;
  const fb = meta?.error;
  if (error.status === 429 || fb?.code === 4 || fb?.code === 17) {
    return 'meta.rate_limited';
  }
  if (fb?.type === 'OAuthException' || fb?.code === 190) {
    return 'meta.oauth_exception';
  }
  return 'meta.unknown_error';
}

function parseNumberEnv(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const routes: Array<{
  method: string;
  pattern: URLPattern;
  handler: RouteHandler;
}> = [];

function addRoute(method: string, pathname: string, handler: RouteHandler) {
  routes.push({
    method,
    pattern: new URLPattern({ pathname }),
    handler,
  });
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function cachedJson(
  req: Request,
  ctx: ExecutionContext,
  cacheKey: string,
  ttlSeconds: number,
  builder: () => Promise<Response>,
) {
  const cache = await caches.open('ops-metrics');
  const key = new Request(cacheKey, req);
  const cached = await cache.match(key);
  if (cached) {
    return cached;
  }
  const response = await builder();
  const cacheControl = `public, max-age=${ttlSeconds}`;
  const cachedResponse = new Response(response.body, response);
  cachedResponse.headers.set('cache-control', cacheControl);
  ctx.waitUntil(cache.put(key, cachedResponse.clone()));
  return cachedResponse;
}

async function readJson<T>(req: Request): Promise<T | null> {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return null;
  }
  try {
    return (await req.json()) as T;
  } catch (error) {
    console.warn('Failed to parse JSON body', {
      method: req.method,
      url: req.url,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

function getMetaScopes(env: Env) {
  return (
    env.META_SCOPES ??
    'pages_show_list,pages_manage_metadata,business_management,pages_messaging,instagram_basic,instagram_manage_messages,pages_read_engagement'
  )
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function getApiVersion(env: Env) {
  return env.META_API_VERSION ?? metaConfig.version;
}

function parseDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function parseEnvDate(value?: string | null) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    const asMs = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    return parseDate(new Date(asMs).toISOString());
  }
  return parseDate(trimmed);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

function truncateErrorText(message: string, maxLength = 500) {
  if (message.length <= maxLength) {
    return message;
  }
  return message.slice(0, maxLength);
}

function isNetworkError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('network') ||
    message.includes('connection') ||
    message.includes('fetch')
  );
}

function getSyncMinIntervalMinutes(env: Env) {
  const raw = env.SYNC_MIN_INTERVAL_MINUTES?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 55;
  }
  return parsed;
}

function getSyncCheckpointOverlapSeconds(env: Env) {
  const raw = env.SYNC_CHECKPOINT_OVERLAP_SECONDS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 120;
  }
  return parsed;
}

function getInferenceConfig(env: Env): InferenceConfig {
  const slaHours = Math.max(
    1,
    parseNumberEnv(env.INBOX_SLA_HOURS ?? env.FOLLOWUP_SLA_HOURS, 24),
  );
  const lostAfterPriceDays = Math.max(
    1,
    parseNumberEnv(env.INBOX_LOST_AFTER_PRICE_DAYS, 60),
  );
  const resurrectGapDays = Math.max(
    1,
    parseNumberEnv(env.INBOX_RESURRECT_GAP_DAYS, 30),
  );
  const deferDefaultDays = Math.max(
    1,
    parseNumberEnv(env.INBOX_DEFER_DEFAULT_DAYS, 30),
  );
  const lostAfterPriceRejectionDays = Math.max(
    1,
    parseNumberEnv(env.INBOX_LOST_AFTER_PRICE_REJECTION_DAYS, 14),
  );
  const lostAfterOffPlatformNoContactDays = Math.max(
    1,
    parseNumberEnv(env.INBOX_LOST_AFTER_OFF_PLATFORM_NO_CONTACT_DAYS, 21),
  );
  const lostAfterIndefiniteDeferralDays = Math.max(
    1,
    parseNumberEnv(env.INBOX_LOST_AFTER_INDEFINITE_DEFERRAL_DAYS, 30),
  );
  const dueSoonDays = Math.max(1, parseNumberEnv(env.INBOX_DUE_SOON_DAYS, 3));
  return {
    slaHours,
    lostAfterPriceDays,
    resurrectGapDays,
    deferDefaultDays,
    lostAfterPriceRejectionDays,
    lostAfterOffPlatformNoContactDays,
    lostAfterIndefiniteDeferralDays,
    dueSoonDays,
  };
}

function getAiDateKey(now: Date) {
  return now.toISOString().slice(0, 10);
}

async function getAiUsageDaily(env: Env, dateKey: string) {
  const row = await env.DB.prepare(
    'SELECT calls FROM ai_usage_daily WHERE date = ?',
  )
    .bind(dateKey)
    .first<{ calls: number }>();
  return row?.calls ?? 0;
}

async function getAiUsageConversation(
  env: Env,
  conversationId: string,
  dateKey: string,
) {
  const row = await env.DB.prepare(
    'SELECT calls FROM ai_usage_conversation_daily WHERE conversation_id = ? AND date = ?',
  )
    .bind(conversationId, dateKey)
    .first<{ calls: number }>();
  return row?.calls ?? 0;
}

async function incrementAiUsage(
  env: Env,
  conversationId: string,
  dateKey: string,
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO ai_usage_daily (date, calls, updated_at)
     VALUES (?, 1, ?)
     ON CONFLICT(date) DO UPDATE SET
       calls = calls + 1,
       updated_at = excluded.updated_at`,
  )
    .bind(dateKey, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO ai_usage_conversation_daily (conversation_id, date, calls)
     VALUES (?, ?, 1)
     ON CONFLICT(conversation_id, date) DO UPDATE SET
       calls = calls + 1`,
  )
    .bind(conversationId, dateKey)
    .run();
}

function isFeatureEnabled(raw?: string) {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function isFollowupInboxEnabled(env: Env) {
  return isFeatureEnabled(env.FEATURE_FOLLOWUP_INBOX);
}

function isOpsDashboardEnabled(env: Env) {
  return isFeatureEnabled(env.FEATURE_OPS_DASHBOARD);
}

function isAuditConversationsEnabled(env: Env) {
  return isFeatureEnabled(env.FEATURE_AUDIT_CONVERSATIONS);
}

async function getUserFeatureFlags(env: Env, userId: string) {
  const merged: Record<string, unknown> = {};
  const applyJson = (raw: string | null | undefined) => {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        Object.assign(merged, parsed as Record<string, unknown>);
      }
    } catch {
      // ignore bad row payload
    }
  };

  const userRows = await env.DB.prepare(
    'SELECT flag_key as flagKey, flag_value as flagValue FROM feature_flags_user WHERE user_id = ?',
  )
    .bind(userId)
    .all<{ flagKey: string; flagValue: string }>();
  for (const row of userRows.results ?? []) {
    const normalized = (row.flagValue ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      merged[row.flagKey] = true;
      continue;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      merged[row.flagKey] = false;
      continue;
    }
    merged[row.flagKey] = row.flagValue;
  }

  const legacyDirect = await env.DB.prepare(
    'SELECT feature_flags as featureFlags FROM meta_users WHERE id = ?',
  )
    .bind(userId)
    .first<{ featureFlags: string | null }>();
  applyJson(legacyDirect?.featureFlags);

  const legacyMapped = await env.DB.prepare(
    `SELECT mu.feature_flags as featureFlags
     FROM org_meta_user omu
     JOIN meta_users mu ON mu.id = omu.meta_user_id
     WHERE omu.user_id = ?`,
  )
    .bind(userId)
    .all<{ featureFlags: string | null }>();
  for (const row of legacyMapped.results ?? []) {
    applyJson(row.featureFlags);
  }

  return merged;
}

async function getOrgFeatureFlags(env: Env, orgId: string) {
  const rows = await env.DB.prepare(
    'SELECT flag_key as flagKey, flag_value as flagValue FROM feature_flags_org WHERE org_id = ?',
  )
    .bind(orgId)
    .all<{ flagKey: string; flagValue: string }>();
  const flags: Record<string, unknown> = {};
  for (const row of rows.results ?? []) {
    const normalized = (row.flagValue ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      flags[row.flagKey] = true;
      continue;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      flags[row.flagKey] = false;
      continue;
    }
    flags[row.flagKey] = row.flagValue;
  }
  return flags;
}

function resolveFeatureFlagValue(
  defaultValue: boolean,
  override: unknown,
): boolean {
  if (override === undefined) return defaultValue;
  if (override === null) return false;
  if (typeof override === 'boolean') return override;
  if (typeof override === 'string') {
    const normalized = override.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return Boolean(override);
}

async function isFollowupInboxEnabledForUser(env: Env, userId: string) {
  const defaultValue = isFollowupInboxEnabled(env);
  const flags = await getUserFeatureFlags(env, userId);
  if (!Object.prototype.hasOwnProperty.call(flags, 'FEATURE_FOLLOWUP_INBOX')) {
    return defaultValue;
  }
  return resolveFeatureFlagValue(
    defaultValue,
    (flags as Record<string, unknown>).FEATURE_FOLLOWUP_INBOX,
  );
}

async function isOpsDashboardEnabledForUser(env: Env, userId: string) {
  const defaultValue = isOpsDashboardEnabled(env);
  const flags = await getUserFeatureFlags(env, userId);
  if (!Object.prototype.hasOwnProperty.call(flags, 'FEATURE_OPS_DASHBOARD')) {
    return defaultValue;
  }
  return resolveFeatureFlagValue(
    defaultValue,
    (flags as Record<string, unknown>).FEATURE_OPS_DASHBOARD,
  );
}

async function isAuditConversationsEnabledForUser(env: Env, userId: string) {
  const defaultValue = isAuditConversationsEnabled(env);
  const flags = await getUserFeatureFlags(env, userId);
  if (
    !Object.prototype.hasOwnProperty.call(flags, 'FEATURE_AUDIT_CONVERSATIONS')
  ) {
    return defaultValue;
  }
  return resolveFeatureFlagValue(
    defaultValue,
    (flags as Record<string, unknown>).FEATURE_AUDIT_CONVERSATIONS,
  );
}

function parseJsonArray(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function sleepMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toHourBucket(date: Date) {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      0,
      0,
      0,
    ),
  ).toISOString();
}

async function opsIncrement(env: Env, key: string, delta: number) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO ops_counters (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = value + excluded.value,
       updated_at = excluded.updated_at`,
  )
    .bind(key, delta, now)
    .run();
}

async function opsSet(env: Env, key: string, value: number) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO ops_counters (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  )
    .bind(key, value, now)
    .run();
}

async function opsIncrementHour(env: Env, hourIso: string, delta: number) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO ops_messages_hourly (hour, count, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(hour) DO UPDATE SET
       count = count + excluded.count,
       updated_at = excluded.updated_at`,
  )
    .bind(hourIso, delta, now)
    .run();
}

async function requireSession(req: Request, env: Env) {
  const auth = await requireAccessAuth(req, env);
  if (!auth) {
    return null;
  }
  return {
    userId: auth.claims.meta_user_id ?? auth.claims.sub,
    expiresAt: auth.claims.exp * 1000,
  };
}

async function requireUser(req: Request, env: Env) {
  const session = await requireSession(req, env);
  if (!session?.userId) {
    return null;
  }
  return session.userId;
}

async function getUserToken(env: Env, userId: string, orgId?: string | null) {
  if (orgId) {
    const mappedByMetaId = await env.DB.prepare(
      `SELECT mu.access_token as access_token, mu.token_type as token_type, mu.expires_at as expires_at
       FROM meta_users mu
       JOIN org_meta_user omu ON omu.meta_user_id = mu.id
       WHERE omu.org_id = ? AND omu.meta_user_id = ?
       LIMIT 1`,
    )
      .bind(orgId, userId)
      .first<{
        access_token: string;
        token_type: string | null;
        expires_at: number | null;
      }>();
    if (mappedByMetaId) {
      return mappedByMetaId;
    }
    const mappedByAppUser = await env.DB.prepare(
      `SELECT mu.access_token as access_token, mu.token_type as token_type, mu.expires_at as expires_at
       FROM org_meta_user omu
       JOIN meta_users mu ON mu.id = omu.meta_user_id
       WHERE omu.org_id = ? AND omu.user_id = ?
       ORDER BY omu.created_at ASC
       LIMIT 1`,
    )
      .bind(orgId, userId)
      .first<{
        access_token: string;
        token_type: string | null;
        expires_at: number | null;
      }>();
    if (mappedByAppUser) {
      return mappedByAppUser;
    }
  }
  const legacy = await env.DB.prepare(
    'SELECT access_token, token_type, expires_at FROM meta_users WHERE id = ?',
  )
    .bind(userId)
    .first<{
      access_token: string;
      token_type: string | null;
      expires_at: number | null;
    }>();
  return legacy ?? null;
}

async function upsertMetaUser(
  env: Env,
  data: {
    id: string;
    accessToken: string;
    tokenType?: string | null;
    expiresAt?: number | null;
  },
) {
  const now = new Date().toISOString();
  const insertResult = await env.DB.prepare(
    `INSERT OR IGNORE INTO meta_users (id, access_token, token_type, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      data.id,
      data.accessToken,
      data.tokenType ?? null,
      data.expiresAt ?? null,
      now,
      now,
    )
    .run();
  if ((insertResult.meta?.changes ?? 0) > 0) {
    await opsIncrement(env, 'users_total', 1);
  }
  await env.DB.prepare(
    `UPDATE meta_users
     SET access_token = ?, token_type = ?, expires_at = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      data.accessToken,
      data.tokenType ?? null,
      data.expiresAt ?? null,
      now,
      data.id,
    )
    .run();
}

async function upsertPage(
  env: Env,
  data: {
    userId: string;
    orgId?: string | null;
    pageId: string;
    name: string;
    accessToken: string;
  },
) {
  const now = new Date().toISOString();
  const insertResult = await env.DB.prepare(
    `INSERT OR IGNORE INTO meta_pages (user_id, org_id, id, name, access_token, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      data.userId,
      data.orgId ?? null,
      data.pageId,
      data.name,
      data.accessToken,
      now,
    )
    .run();
  if ((insertResult.meta?.changes ?? 0) > 0) {
    await opsIncrement(env, 'assets_total', 1);
  }
  await env.DB.prepare(
    `UPDATE meta_pages
     SET name = ?, access_token = ?, org_id = COALESCE(org_id, ?), updated_at = ?
     WHERE user_id = ? AND id = ?`,
  )
    .bind(
      data.name,
      data.accessToken,
      data.orgId ?? null,
      now,
      data.userId,
      data.pageId,
    )
    .run();
}

async function updatePageNameIfPlaceholder(
  env: Env,
  data: {
    userId: string;
    pageId: string;
    name: string;
  },
) {
  const normalized = data.name.trim().toLowerCase();
  if (!normalized || normalized === 'page') {
    return;
  }
  await env.DB.prepare(
    `UPDATE meta_pages SET name = ?, updated_at = ? WHERE user_id = ? AND id = ?`,
  )
    .bind(data.name.trim(), new Date().toISOString(), data.userId, data.pageId)
    .run();
}

async function getPage(
  env: Env,
  userId: string,
  pageId: string,
  orgId?: string | null,
) {
  if (orgId) {
    const scoped = await env.DB.prepare(
      `SELECT id, name, access_token
       FROM meta_pages
       WHERE user_id = ? AND id = ? AND (org_id = ? OR org_id IS NULL)
       ORDER BY CASE WHEN org_id = ? THEN 0 ELSE 1 END
       LIMIT 1`,
    )
      .bind(userId, pageId, orgId, orgId)
      .first<{ id: string; name: string | null; access_token: string }>();
    if (scoped) {
      return scoped;
    }
  }
  return await env.DB.prepare(
    'SELECT id, name, access_token FROM meta_pages WHERE user_id = ? AND id = ?',
  )
    .bind(userId, pageId)
    .first<{ id: string; name: string | null; access_token: string }>();
}

async function upsertIgAsset(
  env: Env,
  data: {
    userId: string;
    orgId?: string | null;
    pageId: string;
    id: string;
    name: string;
  },
) {
  const now = new Date().toISOString();
  const insertResult = await env.DB.prepare(
    `INSERT OR IGNORE INTO ig_assets (user_id, org_id, id, page_id, name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(data.userId, data.orgId ?? null, data.id, data.pageId, data.name, now)
    .run();
  if ((insertResult.meta?.changes ?? 0) > 0) {
    await opsIncrement(env, 'assets_total', 1);
  }
  await env.DB.prepare(
    `UPDATE ig_assets
     SET page_id = ?, name = ?, org_id = COALESCE(org_id, ?), updated_at = ?
     WHERE user_id = ? AND id = ?`,
  )
    .bind(data.pageId, data.name, data.orgId ?? null, now, data.userId, data.id)
    .run();
}

async function listIgAssets(
  env: Env,
  userId: string,
  pageId: string,
  orgId?: string | null,
) {
  const query = orgId
    ? 'SELECT id, name, page_id as pageId FROM ig_assets WHERE user_id = ? AND page_id = ? AND (org_id = ? OR org_id IS NULL)'
    : 'SELECT id, name, page_id as pageId FROM ig_assets WHERE user_id = ? AND page_id = ?';
  const result = orgId
    ? await env.DB.prepare(query)
        .bind(userId, pageId, orgId)
        .all<{ id: string; name: string; pageId: string }>()
    : await env.DB.prepare(query)
        .bind(userId, pageId)
        .all<{ id: string; name: string; pageId: string }>();
  return result.results ?? [];
}

async function listPagesWithStats(
  env: Env,
  userId: string,
  orgId?: string | null,
) {
  const pages = orgId
    ? await env.DB.prepare(
        'SELECT id, name, updated_at FROM meta_pages WHERE user_id = ? AND (org_id = ? OR org_id IS NULL)',
      )
        .bind(userId, orgId)
        .all<{ id: string; name: string | null; updated_at: string | null }>()
    : await env.DB.prepare(
        'SELECT id, name, updated_at FROM meta_pages WHERE user_id = ?',
      )
        .bind(userId)
        .all<{ id: string; name: string | null; updated_at: string | null }>();
  const stats = await env.DB.prepare(
    `SELECT page_id as pageId,
            COUNT(DISTINCT id) as conversations,
            SUM(customer_count + business_count) as messages
     FROM conversations
     WHERE user_id = ?
     GROUP BY page_id`,
  )
    .bind(userId)
    .all<{
      pageId: string;
      conversations: number;
      messages: number;
    }>();
  const statsByPage = new Map(stats.results.map((row) => [row.pageId, row]));

  const runs = await env.DB.prepare(
    `SELECT page_id as pageId,
            MAX(finished_at) as lastSyncFinishedAt
     FROM sync_runs
     WHERE user_id = ? AND platform = 'messenger' AND status = 'completed' AND ig_business_id IS NULL
     GROUP BY page_id`,
  )
    .bind(userId)
    .all<{ pageId: string; lastSyncFinishedAt: string | null }>();
  const runByPage = new Map(
    (runs.results ?? []).map((row) => [row.pageId, row]),
  );

  return pages.results.map((page) => {
    const stat = statsByPage.get(page.id);
    const run = runByPage.get(page.id);
    return {
      id: page.id,
      name: page.name ?? 'Page',
      conversationCount: stat?.conversations ?? 0,
      messageCount: stat?.messages ?? 0,
      lastSyncFinishedAt: run?.lastSyncFinishedAt ?? null,
    };
  });
}

async function getAssetNameMap(
  env: Env,
  userId: string,
  orgId?: string | null,
) {
  const pages = orgId
    ? await env.DB.prepare(
        'SELECT id, name FROM meta_pages WHERE user_id = ? AND (org_id = ? OR org_id IS NULL)',
      )
        .bind(userId, orgId)
        .all<{ id: string; name: string | null }>()
    : await env.DB.prepare('SELECT id, name FROM meta_pages WHERE user_id = ?')
        .bind(userId)
        .all<{ id: string; name: string | null }>();
  const igAssets = orgId
    ? await env.DB.prepare(
        'SELECT id, name, page_id as pageId FROM ig_assets WHERE user_id = ? AND (org_id = ? OR org_id IS NULL)',
      )
        .bind(userId, orgId)
        .all<{ id: string; name: string | null; pageId: string }>()
    : await env.DB.prepare(
        'SELECT id, name, page_id as pageId FROM ig_assets WHERE user_id = ?',
      )
        .bind(userId)
        .all<{ id: string; name: string | null; pageId: string }>();
  const map = new Map<
    string,
    { name: string; platform: string; pageId?: string }
  >();
  for (const page of pages.results ?? []) {
    map.set(page.id, {
      name: page.name ?? 'Page',
      platform: 'facebook',
    });
  }
  for (const asset of igAssets.results ?? []) {
    map.set(asset.id, {
      name: asset.name ?? 'Instagram',
      platform: 'instagram',
      pageId: asset.pageId,
    });
  }
  return map;
}

async function getConversation(
  env: Env,
  userId: string,
  conversationId: string,
) {
  return await env.DB.prepare(
    `SELECT id,
            user_id as userId,
            platform,
            page_id as pageId,
            ig_business_id as igBusinessId,
            asset_id as assetId,
            last_inbound_at as lastInboundAt,
            last_outbound_at as lastOutboundAt,
            last_message_at as lastMessageAt,
            participant_id as participantId,
            participant_name as participantName,
            participant_handle as participantHandle,
            needs_followup as needsFollowup,
            followup_reasons as followupReasons,
            current_state as currentState,
            current_confidence as currentConfidence,
            followup_due_at as followupDueAt,
            followup_suggestion as followupSuggestion,
            last_evaluated_at as lastEvaluatedAt,
            message_count as messageCount,
            inbound_count as inboundCount,
            outbound_count as outboundCount,
            is_spam as isSpam,
            last_snippet as lastSnippet,
            off_platform_outcome as offPlatformOutcome,
            blocked_by_recipient as blockedByRecipient,
            blocked_at as blockedAt,
            bounced_by_provider as bouncedByProvider,
            bounced_at as bouncedAt,
            final_touch_required as finalTouchRequired,
            final_touch_sent_at as finalTouchSentAt,
            lost_reason_code as lostReasonCode
     FROM conversations
     WHERE user_id = ? AND id = ?`,
  )
    .bind(userId, conversationId)
    .first<ConversationRow>();
}

async function listConversationTags(
  env: Env,
  userId: string,
  conversationIds: string[],
) {
  if (!conversationIds.length) return new Map<string, string[]>();
  const placeholders = conversationIds.map(() => '?').join(',');
  const result = await env.DB.prepare(
    `SELECT conversation_id as conversationId, tag
     FROM conversation_tags
     WHERE user_id = ? AND conversation_id IN (${placeholders})`,
  )
    .bind(userId, ...conversationIds)
    .all<{ conversationId: string; tag: string }>();
  const map = new Map<string, string[]>();
  for (const row of result.results ?? []) {
    const list = map.get(row.conversationId) ?? [];
    list.push(row.tag);
    map.set(row.conversationId, list);
  }
  return map;
}

async function loadConversationMessagesForInference(
  env: Env,
  userId: string,
  conversationId: string,
  forceRecompute = false,
  aiRunStats?: AiRunStats,
): Promise<AnnotatedMessage[]> {
  const rows = await env.DB.prepare(
    `SELECT id, created_time as createdAt, body, direction, sender_type as senderType,
            message_type as messageType,
            attachments, raw,
            features_json as featuresJson, rule_hits_json as ruleHitsJson
     FROM messages
     WHERE user_id = ? AND conversation_id = ?
     ORDER BY created_time ASC`,
  )
    .bind(userId, conversationId)
    .all<{
      id: string;
      createdAt: string;
      body: string | null;
      direction: 'inbound' | 'outbound' | null;
      senderType: string | null;
      messageType: string | null;
      attachments: string | null;
      raw: string | null;
      featuresJson: string | null;
      ruleHitsJson: string | null;
    }>();

  const annotated: AnnotatedMessage[] = [];
  const updates: D1PreparedStatement[] = [];
  const updateStmt = env.DB.prepare(
    `UPDATE messages
     SET features_json = ?, rule_hits_json = ?
     WHERE user_id = ? AND id = ?`,
  );
  const aiConfig = getAiConfig(env);
  const aiMode = aiConfig.mode;
  const now = new Date();
  const dateKey = getAiDateKey(now);
  let dailyCalls = aiMode === 'off' ? 0 : await getAiUsageDaily(env, dateKey);
  let conversationCalls =
    aiMode === 'off'
      ? 0
      : await getAiUsageConversation(env, conversationId, dateKey);

  for (const row of rows.results ?? []) {
    const direction =
      row.direction === 'outbound'
        ? 'outbound'
        : row.direction === 'inbound'
          ? 'inbound'
          : row.senderType === 'business'
            ? 'outbound'
            : 'inbound';
    let parsedAttachments: unknown = null;
    if (row.attachments) {
      try {
        parsedAttachments = JSON.parse(row.attachments);
      } catch {
        parsedAttachments = null;
      }
    }
    let parsedRaw: unknown = null;
    if (row.raw) {
      try {
        parsedRaw = JSON.parse(row.raw);
      } catch {
        parsedRaw = null;
      }
    }
    const baseAnnotated = annotateMessage({
      id: row.id,
      direction,
      text: row.body,
      createdAt: row.createdAt,
      attachments: parsedAttachments,
      raw: parsedRaw,
    });
    let features = baseAnnotated.features;
    let ruleHits = [...baseAnnotated.ruleHits];
    let existingAi: MessageFeatures['ai'] | undefined;
    if (row.featuresJson) {
      try {
        const parsed = JSON.parse(row.featuresJson) as MessageFeatures;
        if (parsed?.ai) {
          existingAi = parsed.ai;
        }
      } catch {
        existingAi = undefined;
      }
    }

    if (aiMode === 'off') {
      features = { ...features, ai: undefined };
      ruleHits = ruleHits.filter(
        (hit) => hit !== 'AI_HANDOFF_INTERPRET' && hit !== 'AI_DEFER_INTERPRET',
      );
      if (aiRunStats && direction === 'inbound' && row.body) {
        recordAiRunSkip(aiRunStats, 'mode_off');
      }
    } else if (direction === 'inbound' && row.body) {
      const contextDigest = buildContextDigest(
        [...annotated, { ...baseAnnotated }].map((msg) => ({
          direction: msg.direction,
          text: msg.text,
        })),
        4,
      );
      let aiRecord: MessageFeatures['ai'] | undefined = existingAi;
      const aiAttempt = await runAiAttemptForMessage({
        aiMode,
        aiConfig,
        envAi: env.AI,
        messageText: row.body,
        contextDigest,
        extractedFeatures: features,
        existingAi,
        dailyCalls,
        conversationCalls,
        incrementUsage: () => incrementAiUsage(env, conversationId, dateKey),
      });
      if (aiRunStats) {
        recordAiRunAttempt(aiRunStats, aiAttempt);
      }
      dailyCalls = aiAttempt.dailyCalls;
      conversationCalls = aiAttempt.conversationCalls;
      const inputHash = aiAttempt.inputHash;
      const interpretation = aiAttempt.interpretation;
      const skippedReason = aiAttempt.skippedReason;
      const errors = aiAttempt.errors;
      const ranAt = aiAttempt.attempted
        ? new Date().toISOString()
        : existingAi?.ran_at;

      if (interpretation) {
        aiRecord = {
          input_hash: inputHash,
          mode: aiMode,
          model: aiConfig.model,
          prompt_version: aiConfig.promptVersion,
          input_truncated: aiAttempt.inputTruncated,
          input_chars: aiAttempt.inputChars,
          attempted: aiAttempt.attempted || undefined,
          attempt_outcome: aiAttempt.attemptOutcome,
          skipped_reason: skippedReason,
          errors: errors.length ? errors : undefined,
          ran_at: ranAt,
          interpretation,
          updated_at: new Date().toISOString(),
        };
        if (interpretation.handoff?.is_handoff) {
          ruleHits.push('AI_HANDOFF_INTERPRET');
        }
        if (interpretation.deferred?.is_deferred) {
          ruleHits.push('AI_DEFER_INTERPRET');
        }
      } else if (skippedReason || errors.length) {
        aiRecord = {
          input_hash: inputHash,
          mode: aiMode,
          model: aiConfig.model,
          prompt_version: aiConfig.promptVersion,
          input_truncated: aiAttempt.inputTruncated,
          input_chars: aiAttempt.inputChars,
          attempted: aiAttempt.attempted || undefined,
          attempt_outcome: aiAttempt.attemptOutcome,
          skipped_reason: skippedReason,
          errors: errors.length ? errors : undefined,
          ran_at: ranAt,
          updated_at: new Date().toISOString(),
        };
      }

      if (aiRecord) {
        features = { ...features, ai: aiRecord };
      }
    }

    if (forceRecompute || !row.featuresJson || !row.ruleHitsJson) {
      updates.push(
        updateStmt.bind(
          JSON.stringify(features),
          JSON.stringify(ruleHits),
          userId,
          row.id,
        ),
      );
    }
    annotated.push({
      id: row.id,
      direction,
      text: row.body,
      createdAt: row.createdAt,
      messageType: row.messageType,
      features,
      ruleHits,
    });
  }

  if (updates.length) {
    const batchSize = 50;
    for (let i = 0; i < updates.length; i += batchSize) {
      await env.DB.batch(updates.slice(i, i + batchSize));
    }
  }
  return annotated;
}

async function recordStateEvent(
  env: Env,
  data: {
    userId: string;
    conversationId: string;
    fromState: ConversationState | null;
    toState: ConversationState;
    confidence: string;
    reasons: Array<
      string | { code: string; confidence: string; evidence?: string }
    >;
    triggeredByMessageId?: string | null;
  },
) {
  await env.DB.prepare(
    `INSERT INTO conversation_state_events
     (id, user_id, conversation_id, from_state, to_state, confidence, reasons_json, triggered_by_message_id, triggered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      data.userId,
      data.conversationId,
      data.fromState,
      data.toState,
      data.confidence,
      JSON.stringify(data.reasons),
      data.triggeredByMessageId ?? null,
      new Date().toISOString(),
    )
    .run();
}

type ConversationClassificationExplain = {
  conversation: ConversationRow;
  inference: ConversationInference;
  computedLabel: ConversationState;
  computedConfidence: Confidence;
  reasons: Array<
    string | { code: string; confidence: Confidence; evidence?: string }
  >;
  reasonCodes: string[];
  lostReasonCode: string | null;
  classifierVersion: string;
  computedAt: number;
  featureSnapshot: Record<string, unknown>;
};

async function getConversationClassificationExplain(
  env: Env,
  userId: string,
  conversationId: string,
  options?: {
    forceRecomputeFeatures?: boolean;
    aiRunStats?: AiRunStats;
  },
): Promise<ConversationClassificationExplain | null> {
  const conversation = await getConversation(env, userId, conversationId);
  if (!conversation) return null;
  const messages = await loadConversationMessagesForInference(
    env,
    userId,
    conversationId,
    options?.forceRecomputeFeatures ?? true,
    options?.aiRunStats,
  );
  if (!messages.length) return null;
  const config = getInferenceConfig(env);
  const inference = inferConversation({
    messages,
    previousState: conversation.currentState ?? null,
    previousEvaluatedAt: conversation.lastEvaluatedAt ?? null,
    finalTouchSentAt: conversation.finalTouchSentAt ?? null,
    blockedByRecipient: Boolean(conversation.blockedByRecipient),
    bouncedByProvider: Boolean(conversation.bouncedByProvider),
    config,
  });
  const resolved = resolveComputedClassification({
    inference,
    currentState: conversation.currentState,
    offPlatformOutcome: conversation.offPlatformOutcome,
  });
  const reasonCodes = reasonCodesFromReasons(resolved.reasons);
  const computedAt = Date.now();
  const featureSnapshot = buildFeatureSnapshot({
    conversation,
    messages,
    config,
    inference,
    computedLabel: resolved.computedLabel,
    computedConfidence: resolved.computedConfidence,
    reasonCodes,
    computedAt,
  });
  return {
    conversation,
    inference,
    computedLabel: resolved.computedLabel,
    computedConfidence: resolved.computedConfidence,
    reasons: resolved.reasons,
    reasonCodes,
    lostReasonCode: resolved.lostReasonCode,
    classifierVersion: CLASSIFIER_VERSION,
    computedAt,
    featureSnapshot,
  };
}

async function recomputeConversationState(
  env: Env,
  userId: string,
  conversationId: string,
  aiRunStats?: AiRunStats,
  options?: {
    syncInboxLabels?: boolean;
    waitUntil?: (promise: Promise<unknown>) => void;
  },
) {
  const explanation = await getConversationClassificationExplain(
    env,
    userId,
    conversationId,
    {
      forceRecomputeFeatures: true,
      aiRunStats,
    },
  );
  if (!explanation) return null;
  const conversation = explanation.conversation;
  const inference = explanation.inference;
  const finalState = explanation.computedLabel;
  const finalConfidence = explanation.computedConfidence;
  const reasons = explanation.reasons;
  const lostReasonCode = explanation.lostReasonCode;
  const nowIso = new Date(explanation.computedAt).toISOString();
  const needsFollowup =
    finalState !== 'LOST' &&
    finalState !== 'SPAM' &&
    finalState !== 'CONVERTED' &&
    Boolean(inference.needsFollowup);
  const finalTouchSentAt = conversation.finalTouchSentAt ?? null;
  const finalTouchRequired =
    finalState === 'LOST' &&
    lostReasonCode === 'LOST_INACTIVE_TIMEOUT' &&
    !finalTouchSentAt
      ? 1
      : 0;
  const previousNeedsReply = Boolean(conversation.needsFollowup);
  const previousWindowClosed = isReplyWindowClosed({
    needsReply: previousNeedsReply,
    lastInboundAt: conversation.lastInboundAt,
  });
  const nextNeedsReply = needsFollowup;
  const nextWindowClosed = isReplyWindowClosed({
    needsReply: nextNeedsReply,
    lastInboundAt: inference.lastInboundAt,
  });
  const needsFollowupChanged = previousNeedsReply !== nextNeedsReply;
  const windowClosedChanged = previousWindowClosed !== nextWindowClosed;

  await env.DB.prepare(
    `UPDATE conversations
     SET last_inbound_at = ?,
         last_outbound_at = ?,
         last_message_at = ?,
         message_count = ?,
         inbound_count = ?,
         outbound_count = ?,
         current_state = ?,
         current_confidence = ?,
         followup_due_at = ?,
         followup_suggestion = ?,
         last_evaluated_at = ?,
         is_spam = ?,
         last_snippet = ?,
         needs_followup = ?,
         followup_reasons = ?,
         final_touch_required = ?,
         final_touch_sent_at = ?,
         lost_reason_code = ?
     WHERE user_id = ? AND id = ?`,
  )
    .bind(
      inference.lastInboundAt,
      inference.lastOutboundAt,
      inference.lastMessageAt ?? conversation.lastMessageAt,
      inference.messageCount,
      inference.inboundCount,
      inference.outboundCount,
      finalState,
      finalConfidence,
      inference.followupDueAt,
      inference.followupSuggestion,
      nowIso,
      finalState === 'SPAM' ? 1 : 0,
      inference.lastSnippet,
      needsFollowup ? 1 : 0,
      JSON.stringify(reasons),
      finalTouchRequired,
      finalTouchSentAt,
      lostReasonCode,
      userId,
      conversationId,
    )
    .run();

  if (inference.resurrected) {
    await recordStateEvent(env, {
      userId,
      conversationId,
      fromState: conversation.currentState,
      toState: 'RESURRECTED',
      confidence: 'LOW',
      reasons: ['RESURRECTED'],
    });
  }
  if (conversation.currentState !== finalState || !conversation.currentState) {
    await recordStateEvent(env, {
      userId,
      conversationId,
      fromState: inference.resurrected
        ? 'RESURRECTED'
        : conversation.currentState,
      toState: finalState,
      confidence: finalConfidence,
      reasons,
      triggeredByMessageId: inference.stateTriggerMessageId ?? null,
    });
  }

  const shouldSyncLabels = options?.syncInboxLabels !== false;
  if (shouldSyncLabels && (needsFollowupChanged || windowClosedChanged)) {
    const syncPromise = (async () => {
      const page = await getPage(env, userId, conversation.pageId);
      if (!page?.access_token) {
        return;
      }
      await syncConversationInboxLabels(env, {
        userId,
        pageId: conversation.pageId,
        accessToken: page.access_token,
        version: getApiVersion(env),
        conversationId,
      });
    })().catch((error) => {
      console.warn('Failed to sync Business Inbox labels', {
        userId,
        conversationId,
        pageId: conversation.pageId,
        error: error instanceof Error ? error.message : error,
      });
    });

    if (options?.waitUntil) {
      options.waitUntil(syncPromise);
    } else {
      await syncPromise;
    }
  }

  return {
    state: finalState,
    confidence: finalConfidence,
    followupSuggestion: inference.followupSuggestion,
    followupDueAt: inference.followupDueAt,
    reasons,
    needsFollowupChanged,
    windowClosedChanged,
    needsReply: nextNeedsReply,
    windowClosed: nextWindowClosed,
  };
}

async function getSyncRunById(env: Env, id: string) {
  return await env.DB.prepare(
    `SELECT id, status, conversations, messages
     FROM sync_runs
     WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      status: string;
      conversations: number;
      messages: number;
    }>();
}

async function getActiveSyncRun(
  env: Env,
  data: {
    userId: string;
    pageId: string;
    platform: string;
    igBusinessId?: string | null;
  },
) {
  return await env.DB.prepare(
    `SELECT id, status
     FROM sync_runs
     WHERE user_id = ? AND page_id = ? AND platform = ? AND ig_business_id IS ?
       AND status IN ('queued', 'running')
     ORDER BY started_at DESC
     LIMIT 1`,
  )
    .bind(data.userId, data.pageId, data.platform, data.igBusinessId ?? null)
    .first<{ id: string; status: string }>();
}

async function createSyncRun(
  env: Env,
  data: {
    userId: string;
    pageId: string;
    platform: string;
    igBusinessId?: string | null;
    status?: 'queued' | 'running';
  },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO sync_runs (id, user_id, page_id, platform, ig_business_id, status, started_at, finished_at, last_error, conversations, messages, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      data.userId,
      data.pageId,
      data.platform,
      data.igBusinessId ?? null,
      data.status ?? 'running',
      now,
      null,
      null,
      0,
      0,
      now,
    )
    .run();
  return id;
}

async function getSyncRunRow(env: Env, id: string) {
  return await env.DB.prepare(
    `SELECT id,
            user_id as userId,
            page_id as pageId,
            platform,
            ig_business_id as igBusinessId,
            status,
            started_at as startedAt,
            finished_at as finishedAt,
            last_error as lastError,
            conversations,
            messages,
            updated_at as updatedAt,
            stats_status as statsStatus,
            stats_started_at as statsStartedAt,
            stats_finished_at as statsFinishedAt,
            stats_error as statsError,
            ai_stats_json as aiStatsJson,
            ai_config_json as aiConfigJson
     FROM sync_runs
     WHERE id = ?`,
  )
    .bind(id)
    .first<SyncRunRow>();
}

function parseAiRunStatsJson(value: string | null | undefined): AiRunStats {
  const empty = createAiRunStats();
  if (!value) return empty;
  try {
    const parsed = JSON.parse(value) as Partial<AiRunStats>;
    return {
      ...empty,
      ...parsed,
      skipped: {
        ...empty.skipped,
        ...(parsed.skipped ?? {}),
      },
      results: {
        ...empty.results,
        ...(parsed.results ?? {}),
        handoff_conf: {
          ...empty.results.handoff_conf,
          ...(parsed.results?.handoff_conf ?? {}),
        },
        deferred_conf: {
          ...empty.results.deferred_conf,
          ...(parsed.results?.deferred_conf ?? {}),
        },
      },
    };
  } catch {
    return empty;
  }
}

async function updateSyncRun(
  env: Env,
  data: {
    id: string;
    status?: string;
    conversations?: number;
    messages?: number;
    lastError?: string | null;
    finishedAt?: string | null;
  },
): Promise<SyncRunRow | null> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE sync_runs
     SET status = COALESCE(?, status),
         conversations = COALESCE(?, conversations),
         messages = COALESCE(?, messages),
         last_error = COALESCE(?, last_error),
         finished_at = COALESCE(?, finished_at),
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      data.status ?? null,
      data.conversations ?? null,
      data.messages ?? null,
      data.lastError ?? null,
      data.finishedAt ?? null,
      now,
      data.id,
    )
    .run();
  return await getSyncRunRow(env, data.id);
}

function sanitizeSyncRunForClient(run: SyncRunRow) {
  return {
    id: run.id,
    pageId: run.pageId,
    platform: run.platform,
    igBusinessId: run.igBusinessId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    lastError: run.lastError,
    conversations: run.conversations,
    messages: run.messages,
    statsStatus: run.statsStatus,
    statsStartedAt: run.statsStartedAt,
    statsFinishedAt: run.statsFinishedAt,
    statsError: run.statsError,
  };
}

async function notifySyncRunUpdated(env: Env, run: SyncRunRow) {
  const payload = {
    type: 'run_updated',
    run: sanitizeSyncRunForClient(run),
  };
  try {
    const stub = env.SYNC_RUNS_HUB.get(
      env.SYNC_RUNS_HUB.idFromName(run.userId),
    );
    await stub.fetch('https://sync-runs/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('Failed to notify sync run update', {
      runId: run.id,
      error: error instanceof Error ? error.message : error,
    });
  }

  if (env.DEV_WS_PUBLISH_URL) {
    try {
      await fetch(env.DEV_WS_PUBLISH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: run.userId, payload }),
      });
    } catch (error) {
      console.warn('Failed to publish dev ws update', {
        runId: run.id,
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}

async function notifyInboxEvent(
  env: Env,
  data: {
    userId: string;
    conversationId: string;
    type: string;
    payload?: Record<string, unknown>;
  },
) {
  const updatedAt = new Date().toISOString();
  const payload = {
    type: data.type,
    conversationId: data.conversationId,
    updatedAt,
    ...data.payload,
  };
  try {
    const stub = env.INBOX_HUB.get(env.INBOX_HUB.idFromName(data.userId));
    await stub.fetch('https://inbox/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('Failed to notify inbox update', {
      conversationId: data.conversationId,
      error: error instanceof Error ? error.message : error,
    });
  }
}

async function updateSyncRunAndNotify(
  env: Env,
  data: {
    id: string;
    status?: string;
    conversations?: number;
    messages?: number;
    lastError?: string | null;
    finishedAt?: string | null;
  },
) {
  const run = await updateSyncRun(env, data);
  if (run) {
    await notifySyncRunUpdated(env, run);
  }
  return run;
}

async function updateSyncRunStats(
  env: Env,
  data: {
    id: string;
    statsStatus?: string | null;
    statsStartedAt?: string | null;
    statsFinishedAt?: string | null;
    statsError?: string | null;
  },
): Promise<SyncRunRow | null> {
  const setParts: string[] = [];
  const bindings: unknown[] = [];

  if ('statsStatus' in data) {
    setParts.push('stats_status = ?');
    bindings.push(data.statsStatus ?? null);
  }
  if ('statsStartedAt' in data) {
    setParts.push('stats_started_at = ?');
    bindings.push(data.statsStartedAt ?? null);
  }
  if ('statsFinishedAt' in data) {
    setParts.push('stats_finished_at = ?');
    bindings.push(data.statsFinishedAt ?? null);
  }
  if ('statsError' in data) {
    setParts.push('stats_error = ?');
    bindings.push(data.statsError ?? null);
  }

  const now = new Date().toISOString();
  setParts.push('updated_at = ?');
  bindings.push(now);

  await env.DB.prepare(
    `UPDATE sync_runs
     SET ${setParts.join(', ')}
     WHERE id = ?`,
  )
    .bind(...bindings, data.id)
    .run();

  return await getSyncRunRow(env, data.id);
}

async function updateSyncRunAiStats(
  env: Env,
  data: {
    id: string;
    aiStatsJson?: string | null;
    aiConfigJson?: string | null;
  },
) {
  const setParts: string[] = [];
  const bindings: unknown[] = [];

  if ('aiStatsJson' in data) {
    setParts.push('ai_stats_json = ?');
    bindings.push(data.aiStatsJson ?? null);
  }
  if ('aiConfigJson' in data) {
    setParts.push('ai_config_json = ?');
    bindings.push(data.aiConfigJson ?? null);
  }
  if (!setParts.length) {
    return await getSyncRunRow(env, data.id);
  }
  setParts.push('updated_at = ?');
  bindings.push(new Date().toISOString());

  await env.DB.prepare(
    `UPDATE sync_runs
     SET ${setParts.join(', ')}
     WHERE id = ?`,
  )
    .bind(...bindings, data.id)
    .run();

  return await getSyncRunRow(env, data.id);
}

async function updateSyncRunStatsAndNotify(
  env: Env,
  data: {
    id: string;
    statsStatus?: string | null;
    statsStartedAt?: string | null;
    statsFinishedAt?: string | null;
    statsError?: string | null;
  },
) {
  const run = await updateSyncRunStats(env, data);
  if (run) {
    await notifySyncRunUpdated(env, run);
  }
  return run;
}

function buildSyncScopeKey(scope: SyncScope) {
  const igPart = scope.igBusinessId ?? '';
  return `${scope.userId}:${scope.pageId}:${scope.platform}:${igPart}`;
}

async function ensureSyncForScope(env: Env, scope: SyncScope, source: string) {
  const active = await getActiveSyncRun(env, {
    userId: scope.userId,
    pageId: scope.pageId,
    platform: scope.platform,
    igBusinessId: scope.igBusinessId,
  });
  if (active) {
    return { started: false, skipped: true, reason: 'active_run' };
  }

  const state = await getSyncState(env, {
    userId: scope.userId,
    pageId: scope.pageId,
    platform: scope.platform,
    igBusinessId: scope.igBusinessId,
  });
  const intervalMinutes = getSyncMinIntervalMinutes(env);
  if (state?.lastSyncedAt) {
    const last = parseDate(state.lastSyncedAt);
    if (last) {
      const threshold = Date.now() - intervalMinutes * 60 * 1000;
      if (last.getTime() >= threshold) {
        return { started: false, skipped: true, reason: 'freshness' };
      }
    }
  }

  const runId = await createSyncRun(env, {
    userId: scope.userId,
    pageId: scope.pageId,
    platform: scope.platform,
    igBusinessId: scope.igBusinessId,
    status: 'queued',
  });
  await updateSyncRunAndNotify(env, { id: runId });
  await env.SYNC_QUEUE.send({
    kind: 'sync',
    userId: scope.userId,
    pageId: scope.pageId,
    platform: scope.platform,
    igId:
      scope.platform === 'instagram'
        ? scope.igBusinessId ?? undefined
        : undefined,
    runId,
    cursor: null,
  });

  console.log('[sync-orchestrator] started', {
    source,
    runId,
    scope,
  });

  return { started: true, skipped: false, runId };
}

async function callSyncScopeOrchestrator(
  env: Env,
  scope: SyncScope,
  source: string,
) {
  const key = buildSyncScopeKey(scope);
  const stub = env.SYNC_SCOPE_ORCHESTRATOR.get(
    env.SYNC_SCOPE_ORCHESTRATOR.idFromName(key),
  );
  const response = await stub.fetch('https://sync-scope/ensure', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...scope,
      source,
    }),
  });
  const data = (await response.json().catch(() => null)) as {
    started: boolean;
    skipped: boolean;
    reason?: string;
    runId?: string;
  } | null;
  if (!data) {
    return { started: false, skipped: true, reason: 'invalid_response' };
  }
  return data;
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function listCronScopes(env: Env): Promise<SyncScope[]> {
  const pages = await env.DB.prepare(
    'SELECT user_id as userId, id as pageId FROM meta_pages',
  ).all<{ userId: string; pageId: string }>();
  const igAssets = await env.DB.prepare(
    `SELECT ig_assets.user_id as userId,
            ig_assets.page_id as pageId,
            ig_assets.id as igBusinessId
     FROM ig_assets
     INNER JOIN meta_pages
       ON meta_pages.user_id = ig_assets.user_id
      AND meta_pages.id = ig_assets.page_id`,
  ).all<{ userId: string; pageId: string; igBusinessId: string }>();

  const messengerScopes = (pages.results ?? []).map((row) => ({
    userId: row.userId,
    pageId: row.pageId,
    platform: 'messenger' as const,
    igBusinessId: null,
  }));
  const instagramScopes = (igAssets.results ?? []).map((row) => ({
    userId: row.userId,
    pageId: row.pageId,
    platform: 'instagram' as const,
    igBusinessId: row.igBusinessId,
  }));
  return [...messengerScopes, ...instagramScopes];
}

async function reconcileOpsMetrics(env: Env) {
  const users = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM meta_users',
  ).first<{ count: number }>();
  const assets = await env.DB.prepare(
    'SELECT (SELECT COUNT(*) FROM meta_pages) + (SELECT COUNT(*) FROM ig_assets) as count',
  ).first<{ count: number }>();
  const conversations = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM conversations',
  ).first<{ count: number }>();
  const messages = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM messages',
  ).first<{ count: number }>();

  await opsSet(env, 'users_total', users?.count ?? 0);
  await opsSet(env, 'assets_total', assets?.count ?? 0);
  await opsSet(env, 'conversations_total', conversations?.count ?? 0);
  await opsSet(env, 'messages_total', messages?.count ?? 0);

  const windowDays = 14;
  const cutoffMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const cutoffIso = toHourBucket(new Date(cutoffMs));
  await env.DB.prepare('DELETE FROM ops_messages_hourly WHERE hour < ?')
    .bind(cutoffIso)
    .run();
}

// AE_META_CALLS blobs:
// 1 service, 2 api, 3 op, 4 route, 5 method, 6 status_class, 7 http_status,
// 8 meta_error_code, 9 meta_error_subcode, 10 workspace_id, 11 asset_id
// doubles: 1 count, 2 ok, 3 duration_ms
async function getMetaMetrics(
  env: Env,
  window: MetricsWindow,
): Promise<{
  overall: {
    total: number;
    errors: number;
    errorRate: number;
    avgDurationMs: number | null;
  };
  byOp: Array<{
    op: string;
    total: number;
    errors: number;
    errorRate: number;
    avgDurationMs: number | null;
  }>;
  topRoutes: Array<{
    route: string;
    status: string;
    metaErrorCode: string;
    metaErrorSubcode: string;
    count: number;
  }>;
}> {
  const empty = {
    overall: { total: 0, errors: 0, errorRate: 0, avgDurationMs: null },
    byOp: [],
    topRoutes: [],
  };
  const interval = windowToSqlInterval(window);
  try {
    const countRows = await queryAnalyticsEngine<{ total: number }>(
      env as Required<Env>,
      `SELECT count() as total\n     FROM AE_META_CALLS\n     WHERE timestamp >= now() - ${interval}`,
    );
    const totalRows = Number(countRows[0]?.total ?? 0);
    if (totalRows === 0) {
      return empty;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('unknown table') ||
      message.includes('unable to find type of column')
    ) {
      return empty;
    }
    throw error;
  }

  const overallRows = await queryAnalyticsEngine<{
    total: number;
    ok: number;
    avg_duration_ms: number | null;
  }>(
    env as Required<Env>,
    `SELECT sum(double1) as total, sum(double2) as ok, avg(double3) as avg_duration_ms\n     FROM AE_META_CALLS\n     WHERE timestamp >= now() - ${interval}`,
  );
  const overall = overallRows[0] ?? {
    total: 0,
    ok: 0,
    avg_duration_ms: null,
  };
  const total = Number(overall.total ?? 0);
  const ok = Number(overall.ok ?? 0);
  const errors = Math.max(0, total - ok);
  const errorRate = total > 0 ? errors / total : 0;
  const avgDurationMs =
    typeof overall.avg_duration_ms === 'number'
      ? overall.avg_duration_ms
      : null;

  const byOpRows = await queryAnalyticsEngine<{
    op: string;
    total: number;
    ok: number;
    avg_duration_ms: number | null;
  }>(
    env as Required<Env>,
    `SELECT blob3 as op, sum(double1) as total, sum(double2) as ok, avg(double3) as avg_duration_ms\n     FROM AE_META_CALLS\n     WHERE timestamp >= now() - ${interval}\n     GROUP BY op\n     ORDER BY (sum(double1) - sum(double2)) DESC, total DESC\n     LIMIT 25`,
  );
  const byOp = byOpRows.map((row) => {
    const rowTotal = Number(row.total ?? 0);
    const rowOk = Number(row.ok ?? 0);
    const rowErrors = Math.max(0, rowTotal - rowOk);
    return {
      op: row.op,
      total: rowTotal,
      errors: rowErrors,
      errorRate: rowTotal > 0 ? rowErrors / rowTotal : 0,
      avgDurationMs:
        typeof row.avg_duration_ms === 'number' ? row.avg_duration_ms : null,
    };
  });

  const topRoutesRows = await queryAnalyticsEngine<{
    route: string;
    status: string;
    meta_error_code: string;
    meta_error_subcode: string;
    count: number;
  }>(
    env as Required<Env>,
    `SELECT blob4 as route,\n            blob7 as status,\n            blob8 as meta_error_code,\n            blob9 as meta_error_subcode,\n            sum(double1) as count\n     FROM AE_META_CALLS\n     WHERE timestamp >= now() - ${interval}\n       AND blob6 != '2xx'\n     GROUP BY route, status, meta_error_code, meta_error_subcode\n     ORDER BY count DESC\n     LIMIT 20`,
  );
  const topRoutes = topRoutesRows.map((row) => ({
    route: row.route,
    status: row.status,
    metaErrorCode: row.meta_error_code ?? '',
    metaErrorSubcode: row.meta_error_subcode ?? '',
    count: Number(row.count ?? 0),
  }));

  return {
    overall: { total, errors, errorRate, avgDurationMs },
    byOp,
    topRoutes,
  };
}

// AE_APP_ERRORS blobs:
// 1 service, 2 kind, 3 severity, 4 error_key, 5 route, 6 workspace_id, 7 asset_id
// doubles: 1 count
async function getAppErrorMetrics(
  env: Env,
  window: MetricsWindow,
): Promise<{
  overall: { totalErrors: number };
  byMinute: Array<{ minuteISO: string; errors: number }>;
  topKeys: Array<{
    errorKey: string;
    kind: string;
    severity: string;
    count: number;
  }>;
}> {
  const empty = { overall: { totalErrors: 0 }, byMinute: [], topKeys: [] };
  const interval = windowToSqlInterval(window);
  try {
    const countRows = await queryAnalyticsEngine<{ total: number }>(
      env as Required<Env>,
      `SELECT count() as total\n     FROM AE_APP_ERRORS\n     WHERE timestamp >= now() - ${interval}`,
    );
    const totalRows = Number(countRows[0]?.total ?? 0);
    if (totalRows === 0) {
      return empty;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('unknown table') ||
      message.includes('unable to find type of column')
    ) {
      return empty;
    }
    throw error;
  }

  const totalRows = await queryAnalyticsEngine<{ total: number }>(
    env as Required<Env>,
    `SELECT sum(double1) as total\n     FROM AE_APP_ERRORS\n     WHERE timestamp >= now() - ${interval}`,
  );
  const totalErrors = Number(totalRows[0]?.total ?? 0);

  const byMinuteRows = await queryAnalyticsEngine<{
    minute: string;
    count: number;
  }>(
    env as Required<Env>,
    `SELECT toStartOfMinute(timestamp) as minute, sum(double1) as count\n     FROM AE_APP_ERRORS\n     WHERE timestamp >= now() - ${interval}\n     GROUP BY minute\n     ORDER BY minute ASC`,
  );
  const byMinute = byMinuteRows.map((row) => ({
    minuteISO: row.minute,
    errors: Number(row.count ?? 0),
  }));

  const topKeyRows = await queryAnalyticsEngine<{
    error_key: string;
    kind: string;
    severity: string;
    count: number;
  }>(
    env as Required<Env>,
    `SELECT blob4 as error_key, blob2 as kind, blob3 as severity, sum(double1) as count\n     FROM AE_APP_ERRORS\n     WHERE timestamp >= now() - ${interval}\n     GROUP BY error_key, kind, severity\n     ORDER BY count DESC\n     LIMIT 10`,
  );
  const topKeys = topKeyRows.map((row) => ({
    errorKey: row.error_key,
    kind: row.kind,
    severity: row.severity,
    count: Number(row.count ?? 0),
  }));

  return { overall: { totalErrors }, byMinute, topKeys };
}

async function sendAlertEmail(
  env: Env,
  options: { subject: string; html: string; text: string },
) {
  const apiKey = env.RESEND_API_KEY;
  const to = env.ALERT_EMAIL_TO;
  const from = env.ALERT_EMAIL_FROM;
  if (!apiKey || !to || !from) {
    console.warn('Alert email not configured');
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    console.error('Failed to send alert email', {
      status: response.status,
      body,
    });
  }
}

async function getAlertState(env: Env, key: string) {
  return await env.DB.prepare(
    'SELECT key, last_sent_at as lastSentAt, last_value as lastValue, last_payload as lastPayload FROM ops_alert_state WHERE key = ?',
  )
    .bind(key)
    .first<{
      key: string;
      lastSentAt: number | null;
      lastValue: number | null;
      lastPayload: string | null;
    }>();
}

async function setAlertState(
  env: Env,
  key: string,
  value: number,
  payload: string,
) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO ops_alert_state (key, last_sent_at, last_value, last_payload)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET last_sent_at = excluded.last_sent_at,
       last_value = excluded.last_value,
       last_payload = excluded.last_payload`,
  )
    .bind(key, now, value, payload)
    .run();
}

function shouldSendAlert(params: {
  lastSentAt: number | null;
  lastValue: number | null;
  currentValue: number;
  threshold: number;
}) {
  const now = Date.now();
  const lastSentAt = params.lastSentAt ?? 0;
  const lastValue = params.lastValue ?? 0;
  const minutesSince = (now - lastSentAt) / (1000 * 60);
  if (params.currentValue < params.threshold) {
    return false;
  }
  const lastBand = Math.floor(lastValue / params.threshold);
  const currentBand = Math.floor(params.currentValue / params.threshold);
  if (
    minutesSince < 30 &&
    params.currentValue <= lastValue * 1.5 &&
    currentBand <= lastBand
  ) {
    return false;
  }
  return true;
}

async function runCronSync(env: Env) {
  const scopes = await listCronScopes(env);
  const counts = {
    scanned: scopes.length,
    started: 0,
    skipped: 0,
    skippedByReason: {} as Record<string, number>,
    errors: 0,
  };
  const batches = chunk(scopes, 25);
  for (const batch of batches) {
    const results = await Promise.all(
      batch.map((scope) =>
        callSyncScopeOrchestrator(env, scope, 'cron').catch((error) => {
          console.error('Cron orchestrator call failed', {
            scope,
            error: errorMessage(error),
          });
          counts.errors += 1;
          return { started: false, skipped: true, reason: 'error' };
        }),
      ),
    );
    for (const result of results) {
      if (result.started) {
        counts.started += 1;
        continue;
      }
      if (result.skipped) {
        counts.skipped += 1;
        const reason = result.reason ?? 'unknown';
        counts.skippedByReason[reason] =
          (counts.skippedByReason[reason] ?? 0) + 1;
      }
    }
  }

  console.log('[cron-sync] summary', counts);
}

async function runOpsAlerts(env: Env) {
  const window: MetricsWindow = '5m';
  const metaThreshold = parseNumberEnv(env.META_ERROR_RATE_THRESHOLD, 0.02);
  const metaMinCalls = parseNumberEnv(env.META_MIN_CALLS_THRESHOLD, 50);
  const appThreshold = parseNumberEnv(env.APP_ERRORS_THRESHOLD, 10);

  try {
    const metaMetrics = await getMetaMetrics(env, window);
    const { total, errors, errorRate } = metaMetrics.overall;
    if (total >= metaMinCalls && errorRate >= metaThreshold) {
      const state = await getAlertState(env, 'meta_error_rate_5m');
      if (
        shouldSendAlert({
          lastSentAt: state?.lastSentAt ?? null,
          lastValue: state?.lastValue ?? null,
          currentValue: errorRate,
          threshold: metaThreshold,
        })
      ) {
        const topOps = metaMetrics.byOp.slice(0, 5);
        const topRoutes = metaMetrics.topRoutes.slice(0, 5);
        const subject = `Meta API error rate ${
          Math.round(errorRate * 1000) / 10
        }% in last ${window}`;
        const html = `<h1>Meta API health alert</h1>\n<p>Window: ${window}</p>\n<p>Total calls: ${total}</p>\n<p>Errors: ${errors}</p>\n<p>Error rate: ${(
          errorRate * 100
        ).toFixed(
          2,
        )}% (threshold ${(metaThreshold * 100).toFixed(2)}%)</p>\n<h2>Top ops</h2>\n<ul>${topOps
          .map(
            (op) =>
              `<li>${op.op}: ${op.errors} errors (${(
                op.errorRate * 100
              ).toFixed(2)}%)</li>`,
          )
          .join('')}</ul>\n<h2>Top routes</h2>\n<ul>${topRoutes
          .map(
            (route) =>
              `<li>${route.route} ${route.status} code ${route.metaErrorCode}/${route.metaErrorSubcode}: ${route.count}</li>`,
          )
          .join('')}</ul>`;
        const text = `Meta API health alert\nWindow: ${window}\nTotal calls: ${total}\nErrors: ${errors}\nError rate: ${(
          errorRate * 100
        ).toFixed(2)}% (threshold ${(metaThreshold * 100).toFixed(
          2,
        )}%)\nTop ops:\n${topOps
          .map(
            (op) =>
              `- ${op.op}: ${op.errors} errors (${(op.errorRate * 100).toFixed(
                2,
              )}%)`,
          )
          .join('\n')}\nTop routes:\n${topRoutes
          .map(
            (route) =>
              `- ${route.route} ${route.status} code ${route.metaErrorCode}/${route.metaErrorSubcode}: ${route.count}`,
          )
          .join('\n')}`;
        await sendAlertEmail(env, { subject, html, text });
        await setAlertState(
          env,
          'meta_error_rate_5m',
          errorRate,
          JSON.stringify({
            window,
            total,
            errors,
            errorRate,
            topOps,
            topRoutes,
          }),
        );
      }
    }
  } catch (error) {
    reportError(env, {
      errorKey: 'meta.alert_failed',
      kind: 'meta',
      route: 'cron.alert.meta',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const errorMetrics = await getAppErrorMetrics(env, window);
    const totalErrors = errorMetrics.overall.totalErrors;
    if (totalErrors >= appThreshold) {
      const state = await getAlertState(env, 'app_errors_5m');
      if (
        shouldSendAlert({
          lastSentAt: state?.lastSentAt ?? null,
          lastValue: state?.lastValue ?? null,
          currentValue: totalErrors,
          threshold: appThreshold,
        })
      ) {
        const topKeys = errorMetrics.topKeys.slice(0, 10);
        const subject = `App errors ${totalErrors} in last ${window}`;
        const html = `<h1>App errors alert</h1>\n<p>Window: ${window}</p>\n<p>Total errors: ${totalErrors}</p>\n<p>Threshold: ${appThreshold}</p>\n<h2>Top error keys</h2>\n<ul>${topKeys
          .map(
            (entry) =>
              `<li>${entry.errorKey} (${entry.kind}/${entry.severity}): ${entry.count}</li>`,
          )
          .join('')}</ul>`;
        const text = `App errors alert\nWindow: ${window}\nTotal errors: ${totalErrors}\nThreshold: ${appThreshold}\nTop error keys:\n${topKeys
          .map(
            (entry) =>
              `- ${entry.errorKey} (${entry.kind}/${entry.severity}): ${entry.count}`,
          )
          .join('\n')}`;
        await sendAlertEmail(env, { subject, html, text });
        await setAlertState(
          env,
          'app_errors_5m',
          totalErrors,
          JSON.stringify({ window, totalErrors, topKeys }),
        );
      }
    }
  } catch (error) {
    reportError(env, {
      errorKey: 'app.alert_failed',
      kind: 'exception',
      route: 'cron.alert.app',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function getSyncState(
  env: Env,
  data: {
    userId: string;
    pageId: string;
    platform: string;
    igBusinessId?: string | null;
  },
) {
  return await env.DB.prepare(
    `SELECT last_synced_at as lastSyncedAt
     FROM sync_states
     WHERE user_id = ? AND page_id = ? AND platform = ? AND ig_business_id IS ?`,
  )
    .bind(data.userId, data.pageId, data.platform, data.igBusinessId ?? null)
    .first<{ lastSyncedAt: string | null }>();
}

async function upsertSyncState(
  env: Env,
  data: {
    userId: string;
    pageId: string;
    platform: string;
    igBusinessId?: string | null;
    lastSyncedAt: string | null;
  },
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO sync_states (user_id, page_id, platform, ig_business_id, last_synced_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, page_id, platform, ig_business_id) DO UPDATE SET
       last_synced_at = excluded.last_synced_at,
       updated_at = excluded.updated_at`,
  )
    .bind(
      data.userId,
      data.pageId,
      data.platform,
      data.igBusinessId ?? null,
      data.lastSyncedAt,
      now,
    )
    .run();
}

async function runSync(options: {
  env: Env;
  userId: string;
  pageId: string;
  platform: 'messenger' | 'instagram';
  igId?: string;
  runId: string;
  cursor?: string | null;
}) {
  const { env, userId, pageId, platform, igId, runId, cursor } = options;
  const followupEnabled = await isFollowupInboxEnabledForUser(env, userId);
  const existingRun = await getSyncRunById(env, runId);
  await updateSyncRunAndNotify(env, { id: runId, status: 'running' });
  const page = await getPage(env, userId, pageId);
  if (!page) {
    await updateSyncRunAndNotify(env, {
      id: runId,
      status: 'failed',
      lastError: 'Page not enabled',
      finishedAt: new Date().toISOString(),
    });
    return;
  }
  const accessToken = page.access_token;
  const normalizedName = (page.name ?? '').trim().toLowerCase();
  if (!normalizedName || normalizedName === 'page') {
    try {
      const pageName = await fetchPageName({
        env,
        pageId,
        accessToken,
        version: getApiVersion(env),
        workspaceId: userId,
      });
      await updatePageNameIfPlaceholder(env, {
        userId,
        pageId,
        name: pageName.name,
      });
    } catch (error) {
      console.warn('Failed to refresh page name');
      console.warn(error);
    }
  }

  const state = await getSyncState(env, {
    userId,
    pageId,
    platform,
    igBusinessId: igId ?? null,
  });
  const stateDate = state?.lastSyncedAt ? parseDate(state.lastSyncedAt) : null;
  const earliestDate = parseEnvDate(env.EARLIEST_MESSAGES_AT);
  const sinceDate =
    stateDate && earliestDate
      ? new Date(Math.max(stateDate.getTime(), earliestDate.getTime()))
      : stateDate ?? earliestDate;
  const since = sinceDate ? sinceDate.toISOString() : null;
  const sinceDateMs = sinceDate?.getTime() ?? null;
  const pageResult: {
    conversations: MetaConversation[];
    nextCursor: string | null;
  } = await fetchConversationsPage({
    env,
    pageId,
    accessToken,
    version: getApiVersion(env),
    platform,
    since: since ?? undefined,
    after: cursor ?? undefined,
    limit: 20,
    workspaceId: userId,
  });

  let conversationCount = existingRun?.conversations ?? 0;
  let messageCount = existingRun?.messages ?? 0;
  const overlapSeconds = getSyncCheckpointOverlapSeconds(env);
  let runMaxMessageCreatedMs: number | null = null;

  for (const convo of pageResult.conversations) {
    if (sinceDateMs) {
      const updatedDate = parseDate(convo.updated_time);
      if (updatedDate && updatedDate.getTime() < sinceDateMs) {
        continue;
      }
    }
    const messages = await fetchConversationMessages({
      env,
      conversationId: convo.id,
      accessToken,
      version: getApiVersion(env),
      workspaceId: userId,
      assetId: igId ?? pageId,
    });
    const filteredMessages = sinceDateMs
      ? messages.filter((message) => {
          const created = parseDate(message.created_time);
          return created ? created.getTime() >= sinceDateMs : false;
        })
      : messages;
    if (!filteredMessages.length) {
      continue;
    }
    conversationCount += 1;
    let customerCount = 0;
    let businessCount = 0;
    let priceGiven = 0;
    let earliest: string | null = null;
    let latest: string | null = null;
    let lastInboundAt: string | null = null;
    let lastOutboundAt: string | null = null;
    let participantId: string | null = null;
    let participantName: string | null = null;
    const insert = env.DB.prepare(
      `INSERT OR IGNORE INTO messages
       (user_id, id, conversation_id, page_id, sender_type, body, created_time,
        asset_id, platform, ig_business_id, direction, sender_id, sender_name,
        attachments, raw, meta_message_id, features_json, rule_hits_json,
        message_type, message_trigger)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const repairMessage = env.DB.prepare(
      `UPDATE messages
       SET raw = CASE
             WHEN raw IS NULL OR raw = '' THEN ?
             WHEN ? IS NOT NULL AND json_extract(raw, '$.attachments') IS NULL THEN ?
             ELSE raw
           END,
           attachments = CASE
             WHEN ? IS NOT NULL AND (attachments IS NULL OR attachments = '' OR attachments = 'null') THEN ?
             ELSE attachments
           END
       WHERE user_id = ? AND id = ?
         AND (
           raw IS NULL OR raw = '' OR
           (? IS NOT NULL AND (
             attachments IS NULL OR attachments = '' OR attachments = 'null' OR json_extract(raw, '$.attachments') IS NULL
           ))
         )`,
    );
    const statements: D1PreparedStatement[] = [];

    for (const message of filteredMessages) {
      const senderId = message.from?.id;
      const isBusiness =
        platform === 'messenger'
          ? senderId === pageId
          : igId
            ? senderId === igId
            : false;
      const direction = isBusiness ? 'outbound' : 'inbound';
      const senderName = message.from?.name ?? null;
      if (isBusiness) {
        businessCount += 1;
        if (message.message?.includes('$')) {
          priceGiven = 1;
        }
      } else {
        customerCount += 1;
      }
      messageCount += 1;
      const created = message.created_time;
      if (!isBusiness) {
        if (!participantId && senderId) {
          participantId = senderId;
        }
        if (!participantName && senderName) {
          participantName = senderName;
        }
      }
      const createdMs = Date.parse(created);
      if (!Number.isNaN(createdMs)) {
        runMaxMessageCreatedMs =
          runMaxMessageCreatedMs === null
            ? createdMs
            : Math.max(runMaxMessageCreatedMs, createdMs);
      }
      if (!earliest || created < earliest) {
        earliest = created;
      }
      if (!latest || created > latest) {
        latest = created;
      }
      if (direction === 'inbound') {
        if (!lastInboundAt || created > lastInboundAt) {
          lastInboundAt = created;
        }
      } else if (!lastOutboundAt || created > lastOutboundAt) {
        lastOutboundAt = created;
      }
      const attachments =
        message.attachments && message.attachments.data?.length
          ? JSON.stringify(message.attachments)
          : null;
      const raw = JSON.stringify(message);
      const annotatedMessage = annotateMessage({
        id: message.id,
        direction,
        text: message.message ?? null,
        createdAt: created,
        attachments: message.attachments ?? null,
        raw: message,
      });
      const featuresJson = JSON.stringify(annotatedMessage.features);
      const ruleHitsJson = JSON.stringify(annotatedMessage.ruleHits);
      statements.push(
        insert.bind(
          userId,
          message.id,
          convo.id,
          pageId,
          isBusiness ? 'business' : 'customer',
          message.message ?? null,
          created,
          igId ?? pageId,
          platform,
          igId ?? null,
          direction,
          senderId ?? null,
          senderName,
          attachments,
          raw,
          message.id,
          featuresJson,
          ruleHitsJson,
          null,
          null,
        ),
      );
      statements.push(
        repairMessage.bind(
          raw,
          attachments,
          raw,
          attachments,
          attachments,
          userId,
          message.id,
          attachments,
        ),
      );
    }

    const batchSize = 50;
    for (let i = 0; i < statements.length; i += batchSize) {
      const batch = statements.slice(i, i + batchSize);
      const results = await env.DB.batch(batch);
      let insertedMessages = 0;
      for (let index = 0; index < results.length; index += 1) {
        const changes = results[index]?.meta?.changes ?? 0;
        if (changes < 1) {
          continue;
        }
        insertedMessages += changes;
      }
      if (insertedMessages > 0) {
        await opsIncrement(env, 'messages_total', insertedMessages);
        const ingestHour = toHourBucket(new Date());
        await opsIncrementHour(env, ingestHour, insertedMessages);
      }
    }

    const conversationInsert = await env.DB.prepare(
      `INSERT OR IGNORE INTO conversations
       (user_id, id, platform, page_id, ig_business_id, updated_time, started_time, last_message_at,
        customer_count, business_count, price_given, last_inbound_at, last_outbound_at,
        participant_id, participant_name, meta_thread_id, asset_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        userId,
        convo.id,
        platform,
        pageId,
        igId ?? null,
        convo.updated_time,
        earliest,
        latest,
        customerCount,
        businessCount,
        priceGiven,
        lastInboundAt,
        lastOutboundAt,
        participantId,
        participantName,
        convo.id,
        igId ?? pageId,
      )
      .run();
    if ((conversationInsert.meta?.changes ?? 0) > 0) {
      await opsIncrement(env, 'conversations_total', 1);
    }
    await env.DB.prepare(
      `UPDATE conversations
       SET platform = ?,
           page_id = ?,
           ig_business_id = ?,
           updated_time = ?,
           started_time = ?,
           last_message_at = ?,
           customer_count = ?,
           business_count = ?,
           price_given = ?,
           last_inbound_at = CASE
             WHEN ? IS NULL THEN last_inbound_at
             WHEN last_inbound_at IS NULL OR ? > last_inbound_at THEN ?
             ELSE last_inbound_at
           END,
           last_outbound_at = CASE
             WHEN ? IS NULL THEN last_outbound_at
             WHEN last_outbound_at IS NULL OR ? > last_outbound_at THEN ?
             ELSE last_outbound_at
           END,
           participant_id = COALESCE(participant_id, ?),
           participant_name = COALESCE(participant_name, ?),
           meta_thread_id = COALESCE(meta_thread_id, ?),
           asset_id = ?
       WHERE user_id = ? AND id = ?`,
    )
      .bind(
        platform,
        pageId,
        igId ?? null,
        convo.updated_time,
        earliest,
        latest,
        customerCount,
        businessCount,
        priceGiven,
        lastInboundAt,
        lastInboundAt,
        lastInboundAt,
        lastOutboundAt,
        lastOutboundAt,
        lastOutboundAt,
        participantId,
        participantName,
        convo.id,
        igId ?? pageId,
        userId,
        convo.id,
      )
      .run();

    await recomputeFollowupEventsForConversation(env, {
      userId,
      conversationId: convo.id,
    });

    if (followupEnabled) {
      const followupState = await recomputeConversationState(
        env,
        userId,
        convo.id,
      );
      if (followupState) {
        await notifyInboxEvent(env, {
          userId,
          conversationId: convo.id,
          type: 'conversation_updated',
          payload: {
            state: followupState.state,
            reasons: followupState.reasons,
          },
        });
      }
    }

    if (conversationCount % 5 === 0) {
      await updateSyncRunAndNotify(env, {
        id: runId,
        conversations: conversationCount,
        messages: messageCount,
      });
    }
  }

  if (pageResult.nextCursor) {
    await updateSyncRunAndNotify(env, {
      id: runId,
      conversations: conversationCount,
      messages: messageCount,
    });
    await env.SYNC_QUEUE.send({
      kind: 'sync',
      userId,
      pageId,
      platform,
      igId,
      runId,
      cursor: pageResult.nextCursor,
    });
    return;
  }

  if (runMaxMessageCreatedMs !== null) {
    const checkpointMs = runMaxMessageCreatedMs - overlapSeconds * 1000;
    const checkpointDate = new Date(checkpointMs);
    if (!Number.isNaN(checkpointDate.getTime())) {
      await upsertSyncState(env, {
        userId,
        pageId,
        platform,
        igBusinessId: igId ?? null,
        lastSyncedAt: checkpointDate.toISOString(),
      });
    }
  }

  await updateSyncRunAndNotify(env, {
    id: runId,
    status: 'completed',
    conversations: conversationCount,
    messages: messageCount,
    finishedAt: new Date().toISOString(),
  });
  await enqueueStatsRecomputeOnce(env, runId);
}

async function enqueueStatsRecomputeOnce(env: Env, runId: string) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE sync_runs
     SET stats_status = 'queued',
         stats_started_at = NULL,
         stats_finished_at = NULL,
         stats_error = NULL,
         updated_at = ?
     WHERE id = ? AND stats_status IS NULL`,
  )
    .bind(now, runId)
    .run();
  const changes = result.meta?.changes ?? 0;
  if (changes < 1) {
    return false;
  }

  const run = await getSyncRunRow(env, runId);
  if (run) {
    await notifySyncRunUpdated(env, run);
  }

  try {
    await env.SYNC_QUEUE.send({
      kind: 'recompute_stats',
      runId,
    });
  } catch (error) {
    await updateSyncRunStatsAndNotify(env, {
      id: runId,
      statsStatus: 'failed',
      statsFinishedAt: new Date().toISOString(),
      statsError: truncateErrorText(errorMessage(error)),
    });
    return false;
  }

  return true;
}

async function recomputeStatsForRun(
  env: Env,
  runId: string,
  options?: { cursor?: string | null; initialized?: boolean },
) {
  const run = await getSyncRunRow(env, runId);
  if (!run) {
    throw new Error('Sync run not found');
  }

  const chunkSize = 20;
  const cursor = options?.cursor ?? null;
  const initialized = Boolean(options?.initialized);
  const aiConfig = getAiConfig(env);
  const aiStats =
    initialized && run.aiStatsJson
      ? parseAiRunStatsJson(run.aiStatsJson)
      : createAiRunStats();
  if (!initialized) {
    await updateSyncRunAiStats(env, {
      id: runId,
      aiStatsJson: JSON.stringify(aiStats),
      aiConfigJson: JSON.stringify({
        mode: aiConfig.mode,
        model: aiConfig.model,
        prompt_version: aiConfig.promptVersion,
        max_output_tokens: aiConfig.maxOutputTokens,
        max_input_chars: aiConfig.maxInputChars,
        timeout_ms: aiConfig.timeoutMs,
      }),
    });

    await updateSyncRunStatsAndNotify(env, {
      id: runId,
      statsStatus: 'running',
      statsStartedAt: new Date().toISOString(),
      statsFinishedAt: null,
      statsError: null,
    });
  }

  const result = await recomputeConversationStatsForRun(env, {
    userId: run.userId,
    pageId: run.pageId,
    platform: run.platform,
    igBusinessId: run.igBusinessId,
    aiRunStats: aiStats,
    cursor,
    chunkSize,
    refreshAggregates: !initialized,
  });

  await updateSyncRunAiStats(env, {
    id: runId,
    aiStatsJson: JSON.stringify(aiStats),
  });
  if (result.hasMore) {
    await env.SYNC_QUEUE.send({
      kind: 'recompute_stats',
      runId,
      cursor: result.nextCursor,
      initialized: true,
    });
    return result;
  }

  await updateSyncRunStatsAndNotify(env, {
    id: runId,
    statsStatus: 'completed',
    statsFinishedAt: new Date().toISOString(),
    statsError: null,
  });

  return result;
}

async function recomputeConversationStatsForRun(
  env: Env,
  data: {
    userId: string;
    pageId: string;
    platform: string;
    igBusinessId: string | null;
    aiRunStats?: AiRunStats;
    cursor?: string | null;
    chunkSize?: number;
    refreshAggregates?: boolean;
  },
) {
  let updated = 0;
  if (data.refreshAggregates !== false) {
    const bindings = [
      data.userId,
      data.pageId,
      data.platform,
      data.igBusinessId ?? null,
      data.userId,
      data.pageId,
      data.userId,
      data.pageId,
      data.platform,
      data.igBusinessId ?? null,
    ];

    const result = await env.DB.prepare(
      `WITH scoped_conversations AS (
         SELECT id
         FROM conversations
         WHERE user_id = ? AND page_id = ? AND platform = ? AND ig_business_id IS ?
       ),
       stats AS (
         SELECT m.conversation_id as conversation_id,
                MIN(m.created_time) as started_time,
                MAX(m.created_time) as last_message_at,
                SUM(CASE WHEN m.sender_type = 'customer' THEN 1 ELSE 0 END) as customer_count,
                SUM(CASE WHEN m.sender_type = 'business' THEN 1 ELSE 0 END) as business_count,
                MAX(CASE WHEN m.sender_type = 'customer' THEN m.created_time END) as last_inbound_at,
                MAX(CASE WHEN m.sender_type = 'business' THEN m.created_time END) as last_outbound_at,
                MAX(CASE WHEN m.sender_type = 'customer' THEN m.sender_id END) as participant_id,
                MAX(CASE WHEN m.sender_type = 'customer' THEN m.sender_name END) as participant_name,
                MAX(CASE WHEN m.sender_type = 'business' AND m.body LIKE '%$%' THEN 1 ELSE 0 END) as price_given,
                MIN(CASE WHEN m.sender_type = 'business' AND m.body LIKE '%$%' THEN m.created_time END) as first_price_at,
                SUM(
                  CASE
                    WHEN m.sender_type = 'customer'
                     AND m.created_time > (
                       SELECT MIN(m2.created_time)
                       FROM messages m2
                       WHERE m2.user_id = m.user_id
                         AND m2.conversation_id = m.conversation_id
                         AND m2.sender_type = 'business'
                         AND m2.body LIKE '%$%'
                     )
                    THEN 1
                    ELSE 0
                  END
                ) as customer_after_price_count
         FROM messages m
         JOIN scoped_conversations s ON s.id = m.conversation_id
         WHERE m.user_id = ? AND m.page_id = ?
         GROUP BY m.conversation_id
       )
       UPDATE conversations
       SET started_time = (SELECT started_time FROM stats WHERE stats.conversation_id = conversations.id),
           last_message_at = (SELECT last_message_at FROM stats WHERE stats.conversation_id = conversations.id),
           last_inbound_at = (SELECT last_inbound_at FROM stats WHERE stats.conversation_id = conversations.id),
           last_outbound_at = (SELECT last_outbound_at FROM stats WHERE stats.conversation_id = conversations.id),
           participant_id = COALESCE(participant_id, (SELECT participant_id FROM stats WHERE stats.conversation_id = conversations.id)),
           participant_name = COALESCE(participant_name, (SELECT participant_name FROM stats WHERE stats.conversation_id = conversations.id)),
           customer_count = COALESCE((SELECT customer_count FROM stats WHERE stats.conversation_id = conversations.id), 0),
           business_count = COALESCE((SELECT business_count FROM stats WHERE stats.conversation_id = conversations.id), 0),
           price_given = COALESCE((SELECT price_given FROM stats WHERE stats.conversation_id = conversations.id), 0),
           low_response_after_price = CASE
             WHEN (SELECT first_price_at FROM stats WHERE stats.conversation_id = conversations.id) IS NOT NULL
              AND COALESCE((SELECT customer_after_price_count FROM stats WHERE stats.conversation_id = conversations.id), 0) <= 2
             THEN 1
             ELSE 0
           END
       WHERE user_id = ? AND page_id = ? AND platform = ? AND ig_business_id IS ?
         AND id IN (SELECT conversation_id FROM stats)`,
    )
      .bind(...bindings)
      .run();
    updated = result.meta?.changes ?? 0;
  }

  const chunkSize = Math.max(1, Math.min(100, data.chunkSize ?? 25));
  const cursor = data.cursor ?? null;
  let convoQuery = `SELECT id FROM conversations
     WHERE user_id = ? AND page_id = ? AND platform = ? AND ig_business_id IS ?`;
  const convoBindings: unknown[] = [
    data.userId,
    data.pageId,
    data.platform,
    data.igBusinessId ?? null,
  ];
  if (cursor) {
    convoQuery += ` AND id > ?`;
    convoBindings.push(cursor);
  }
  convoQuery += ` ORDER BY id ASC LIMIT ?`;
  convoBindings.push(chunkSize + 1);
  const convoIds = await env.DB.prepare(convoQuery)
    .bind(...convoBindings)
    .all<{ id: string }>();
  const allIds = convoIds.results ?? [];
  const pageIds = allIds.slice(0, chunkSize);
  const hasMore = allIds.length > chunkSize;
  const lastProcessedId = pageIds[pageIds.length - 1]?.id ?? null;
  const nextCursor = hasMore ? lastProcessedId : null;
  const followupEnabled = await isFollowupInboxEnabledForUser(env, data.userId);
  if (followupEnabled) {
    for (const row of pageIds) {
      await recomputeConversationState(
        env,
        data.userId,
        row.id,
        data.aiRunStats,
      );
    }
  }

  return { updated, hasMore, nextCursor };
}

async function recomputeConversationStats(
  env: Env,
  data: { userId: string; pageId?: string | null },
) {
  let query = `SELECT conversation_id as conversationId, page_id as pageId,
            MIN(created_time) as startedTime,
            MAX(created_time) as lastMessageAt,
            SUM(CASE WHEN sender_type = 'customer' THEN 1 ELSE 0 END) as customerCount,
            SUM(CASE WHEN sender_type = 'business' THEN 1 ELSE 0 END) as businessCount,
            MAX(CASE WHEN sender_type = 'customer' THEN created_time END) as lastInboundAt,
            MAX(CASE WHEN sender_type = 'business' THEN created_time END) as lastOutboundAt,
            MAX(CASE WHEN sender_type = 'customer' THEN sender_id END) as participantId,
            MAX(CASE WHEN sender_type = 'customer' THEN sender_name END) as participantName,
            MAX(CASE WHEN sender_type = 'business' AND body LIKE '%$%' THEN 1 ELSE 0 END) as priceGiven,
            MIN(CASE WHEN sender_type = 'business' AND body LIKE '%$%' THEN created_time END) as firstPriceAt,
            SUM(
              CASE
                WHEN sender_type = 'customer'
                 AND created_time > (
                   SELECT MIN(m2.created_time)
                   FROM messages m2
                   WHERE m2.user_id = messages.user_id
                     AND m2.conversation_id = messages.conversation_id
                     AND m2.sender_type = 'business'
                     AND m2.body LIKE '%$%'
                 )
                THEN 1
                ELSE 0
              END
            ) as customerAfterPriceCount
     FROM messages
     WHERE user_id = ?`;
  const bindings: unknown[] = [data.userId];
  if (data.pageId) {
    query += ' AND page_id = ?';
    bindings.push(data.pageId);
  }
  query += ' GROUP BY conversation_id, page_id';
  const rows = await env.DB.prepare(query)
    .bind(...bindings)
    .all<{
      conversationId: string;
      pageId: string;
      startedTime: string | null;
      lastMessageAt: string | null;
      customerCount: number;
      businessCount: number;
      lastInboundAt: string | null;
      lastOutboundAt: string | null;
      participantId: string | null;
      participantName: string | null;
      priceGiven: number;
      firstPriceAt: string | null;
      customerAfterPriceCount: number;
    }>();

  let updated = 0;
  const followupEnabled = await isFollowupInboxEnabledForUser(env, data.userId);
  for (const row of rows.results ?? []) {
    const lowResponseAfterPrice =
      row.firstPriceAt && (row.customerAfterPriceCount ?? 0) <= 2 ? 1 : 0;
    await env.DB.prepare(
      `UPDATE conversations
       SET started_time = ?,
           last_message_at = ?,
           last_inbound_at = ?,
           last_outbound_at = ?,
           participant_id = COALESCE(participant_id, ?),
           participant_name = COALESCE(participant_name, ?),
           customer_count = ?,
           business_count = ?,
           price_given = ?,
           low_response_after_price = ?
       WHERE user_id = ? AND id = ? AND page_id = ?`,
    )
      .bind(
        row.startedTime,
        row.lastMessageAt,
        row.lastInboundAt,
        row.lastOutboundAt,
        row.participantId,
        row.participantName,
        row.customerCount ?? 0,
        row.businessCount ?? 0,
        row.priceGiven ?? 0,
        lowResponseAfterPrice,
        data.userId,
        row.conversationId,
        row.pageId,
      )
      .run();
    if (followupEnabled) {
      await recomputeConversationState(env, data.userId, row.conversationId);
    }
    updated += 1;
  }

  return { updated };
}

async function recomputeInboxForUser(
  env: Env,
  data: {
    userId: string;
    cursor?: string | null;
    chunkSize?: number;
    forceLabelSync?: boolean;
  },
) {
  const chunkSize = Math.max(1, Math.min(50, data.chunkSize ?? 10));
  const cursor = data.cursor ?? null;
  let query = `SELECT id
     FROM conversations
     WHERE user_id = ?`;
  const bindings: unknown[] = [data.userId];
  if (cursor) {
    query += ` AND id > ?`;
    bindings.push(cursor);
  }
  query += ` ORDER BY id ASC LIMIT ?`;
  bindings.push(chunkSize + 1);

  const rows = await env.DB.prepare(query)
    .bind(...bindings)
    .all<{ id: string }>();
  const allIds = rows.results ?? [];
  const page = allIds.slice(0, chunkSize);
  const hasMore = allIds.length > chunkSize;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  let updated = 0;
  for (const row of page) {
    const result = await recomputeConversationState(
      env,
      data.userId,
      row.id,
      undefined,
      {
        syncInboxLabels: false,
      },
    );
    if (!result) {
      if (!data.forceLabelSync) {
        continue;
      }
    } else {
      updated += 1;
    }
    const shouldSyncLabels = Boolean(
      data.forceLabelSync ||
        (result && (result.needsFollowupChanged || result.windowClosedChanged)),
    );
    if (!shouldSyncLabels) {
      continue;
    }
    const conversation = await getConversation(env, data.userId, row.id);
    if (!conversation || conversation.platform !== 'messenger') {
      continue;
    }
    const page = await getPage(env, data.userId, conversation.pageId);
    if (!page?.access_token) {
      continue;
    }
    try {
      await syncConversationInboxLabels(env, {
        userId: data.userId,
        pageId: conversation.pageId,
        accessToken: page.access_token,
        version: getApiVersion(env),
        conversationId: row.id,
      });
    } catch (error) {
      console.warn('Failed to sync Business Inbox labels', {
        userId: data.userId,
        conversationId: row.id,
        pageId: conversation.pageId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  return { updated, hasMore, nextCursor };
}

class SyncScopeOrchestrator {
  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/ensure') {
      return new Response('Not found', { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return json(
        { started: false, skipped: true, reason: 'invalid_body' },
        { status: 400 },
      );
    }

    const payload = body as {
      userId?: string;
      pageId?: string;
      platform?: string;
      igBusinessId?: string | null;
      source?: string;
    };

    const userId = payload.userId;
    const pageId = payload.pageId;
    const platform = payload.platform;
    const igBusinessId = payload.igBusinessId ?? null;

    if (
      !userId ||
      !pageId ||
      (platform !== 'messenger' && platform !== 'instagram')
    ) {
      return json(
        { started: false, skipped: true, reason: 'invalid_scope' },
        { status: 400 },
      );
    }
    if (platform === 'messenger' && igBusinessId) {
      return json(
        { started: false, skipped: true, reason: 'invalid_scope' },
        { status: 400 },
      );
    }
    if (platform === 'instagram' && !igBusinessId) {
      return json(
        { started: false, skipped: true, reason: 'invalid_scope' },
        { status: 400 },
      );
    }

    const scope: SyncScope = {
      userId,
      pageId,
      platform,
      igBusinessId: platform === 'instagram' ? igBusinessId : null,
    };

    const result = await ensureSyncForScope(
      this.env,
      scope,
      payload.source ?? 'unknown',
    );
    return json(result);
  }
}

registerRoutes({
  addRoute,
  json,
  cachedJson,
  readJson,
  getMetaScopes,
  getApiVersion,
  isFollowupInboxEnabled,
  isOpsDashboardEnabled,
  isAuditConversationsEnabled,
  isFollowupInboxEnabledForUser,
  isOpsDashboardEnabledForUser,
  isAuditConversationsEnabledForUser,
  getUserFeatureFlags,
  getOrgFeatureFlags,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  debugToken,
  fetchPermissions,
  fetchBusinesses,
  fetchBusinessPages,
  fetchClassicPages,
  fetchPageToken,
  subscribeAppToPage,
  fetchInstagramAssets,
  fetchPageIgDebug,
  fetchConversationMessages,
  sendMessage,
  fetchUserProfile,
  requireSession,
  requireUser,
  requireAccessAuth,
  getUserToken,
  upsertMetaUser,
  upsertPage,
  getPage,
  upsertIgAsset,
  listIgAssets,
  listPagesWithStats,
  getAssetNameMap,
  getConversation,
  getConversationClassificationExplain,
  listConversationTags,
  recomputeConversationState,
  recordStateEvent,
  annotateMessage,
  notifyInboxEvent,
  callSyncScopeOrchestrator,
  parseMetricsWindow,
  buildReportFromDb,
  getMetaMetrics,
  getAppErrorMetrics,
  classifyMetaErrorKey,
  normalizeUnknownError,
  recomputeConversationStats,
  sleepMs,
  toHourBucket,
  parseJsonArray,
  reportError,
  recomputeFollowupEventsForConversation,
  backfillFollowupEventsForUser,
  repairFollowupEventLossFlags,
  getFollowupSeries,
});

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const authGatewayResponse = await handleAuthGateway(req, env);
    if (authGatewayResponse) {
      return authGatewayResponse;
    }
    const url = new URL(req.url);
    const pathname = url.pathname;
    const method = req.method.toUpperCase();
    const publicApiPaths = new Set([
      '/api/health',
      '/api/auth/login',
      '/api/auth/callback',
      '/api/auth/config',
      '/api/auth/me',
      '/api/meta/webhook',
    ]);
    if (pathname.startsWith('/api/') && !publicApiPaths.has(pathname)) {
      const auth = await requireAccessAuth(req, env);
      if (!auth) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    for (const route of routes) {
      if (route.method !== method) {
        continue;
      }
      const match = route.pattern.exec({ pathname });
      if (match) {
        try {
          return await route.handler(req, env, ctx, match.pathname.groups);
        } catch (error) {
          console.error('Unhandled route error', {
            method,
            pathname,
            error: error instanceof Error ? error.message : error,
          });
          reportError(env, {
            errorKey: 'route.unhandled_error',
            kind: 'exception',
            route: `${method} ${pathname}`,
            message: error instanceof Error ? error.message : String(error),
          });
          return json({ error: 'Internal server error' }, { status: 500 });
        }
      }
    }
    return json({ error: 'Not found' }, { status: 404 });
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(runCronSync(env));
    ctx.waitUntil(reconcileOpsMetrics(env));
    ctx.waitUntil(runOpsAlerts(env));
  },
  async queue(batch: MessageBatch<SyncJob>, env: Env) {
    for (const message of batch.messages) {
      try {
        const kind = message.body.kind ?? 'sync';
        if (kind === 'recompute_stats') {
          const statsJob = message.body as Extract<
            SyncJob,
            { kind: 'recompute_stats' }
          >;
          await recomputeStatsForRun(env, statsJob.runId, {
            cursor: statsJob.cursor,
            initialized: statsJob.initialized,
          });
          continue;
        }
        if (kind === 'recompute_inbox') {
          const inboxJob = message.body as Extract<
            SyncJob,
            { kind: 'recompute_inbox' }
          >;
          const result = await recomputeInboxForUser(env, {
            userId: inboxJob.userId,
            cursor: inboxJob.cursor,
            chunkSize: 10,
            forceLabelSync: inboxJob.forceLabelSync,
          });
          if (result.hasMore) {
            await env.SYNC_QUEUE.send({
              kind: 'recompute_inbox',
              userId: inboxJob.userId,
              cursor: result.nextCursor,
              forceLabelSync: inboxJob.forceLabelSync,
            });
          }
          continue;
        }
        const syncJob = message.body as Extract<SyncJob, { kind?: 'sync' }>;
        const { userId, pageId, platform, igId, runId, cursor } = syncJob;
        await runSync({
          env,
          userId,
          pageId,
          platform,
          igId,
          runId,
          cursor,
        });
      } catch (error) {
        const kind = message.body.kind ?? 'sync';
        if (kind === 'recompute_stats') {
          const statsJob = message.body as Extract<
            SyncJob,
            { kind: 'recompute_stats' }
          >;
          const messageText = errorMessage(error);
          console.error('Stats recompute failed', {
            runId: statsJob.runId,
            error: messageText,
          });
          reportError(env, {
            errorKey: 'sync.recompute_failed',
            kind: 'sync',
            route: 'queue.recompute_stats',
            message: messageText,
          });
          await updateSyncRunStatsAndNotify(env, {
            id: statsJob.runId,
            statsStatus: 'failed',
            statsFinishedAt: new Date().toISOString(),
            statsError: truncateErrorText(messageText),
          });
          continue;
        }
        if (kind === 'recompute_inbox') {
          const inboxJob = message.body as Extract<
            SyncJob,
            { kind: 'recompute_inbox' }
          >;
          const attempt = inboxJob.attempt ?? 0;
          const messageText = errorMessage(error);
          console.error('Inbox recompute failed', {
            userId: inboxJob.userId,
            cursor: inboxJob.cursor ?? null,
            attempt,
            error: messageText,
          });
          reportError(env, {
            errorKey: 'inbox.recompute_failed',
            kind: 'sync',
            route: 'queue.recompute_inbox',
            workspaceId: inboxJob.userId,
            message: messageText,
          });
          if (attempt < 3) {
            await env.SYNC_QUEUE.send({
              kind: 'recompute_inbox',
              userId: inboxJob.userId,
              cursor: inboxJob.cursor ?? null,
              attempt: attempt + 1,
              forceLabelSync: inboxJob.forceLabelSync,
            });
          }
          continue;
        }

        const syncJob = message.body as Extract<SyncJob, { kind?: 'sync' }>;
        const attempt = syncJob.attempt ?? 0;
        const messageText = errorMessage(error);
        console.error('Sync job failed', {
          pageId: syncJob.pageId,
          platform: syncJob.platform,
          igId: syncJob.igId,
          runId: syncJob.runId,
          attempt,
          error: messageText,
        });
        reportError(env, {
          errorKey: 'sync.run_failed',
          kind: 'sync',
          route: 'queue.sync',
          workspaceId: syncJob.userId,
          assetId: syncJob.igId ?? syncJob.pageId,
          message: messageText,
        });
        if (isNetworkError(error) && attempt < 3) {
          await updateSyncRunAndNotify(env, {
            id: syncJob.runId,
            status: 'queued',
            lastError: messageText,
          });
          await env.SYNC_QUEUE.send({
            kind: 'sync',
            userId: syncJob.userId,
            pageId: syncJob.pageId,
            platform: syncJob.platform,
            igId: syncJob.igId,
            runId: syncJob.runId,
            cursor: syncJob.cursor,
            attempt: attempt + 1,
          });
          continue;
        }
        await updateSyncRunAndNotify(env, {
          id: syncJob.runId,
          status: 'failed',
          lastError: messageText || 'Sync failed',
          finishedAt: new Date().toISOString(),
        });
      }
    }
  },
};

export { SyncScopeOrchestrator };
