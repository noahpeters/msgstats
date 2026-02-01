import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  debugToken,
  fetchPermissions,
  fetchBusinesses,
  fetchBusinessPages,
  fetchClassicPages,
  fetchPageToken,
  fetchPageName,
  fetchInstagramAssets,
  fetchPageIgDebug,
  fetchConversationsPage,
  fetchConversationMessages,
  metaConfig,
  MetaApiError,
  type MetaConversation,
  fetchUserProfile,
} from './meta';
import { buildReportFromDb } from './report';
import {
  buildSessionCookie,
  clearSessionCookie,
  createSessionToken,
  getSessionCookie,
  readSessionToken,
} from './session';

type Env = {
  DB: D1Database;
  SYNC_QUEUE: Queue<SyncJob>;
  SYNC_RUNS_HUB: DurableObjectNamespace;
  SYNC_SCOPE_ORCHESTRATOR: DurableObjectNamespace;
  DEV_WS_PUBLISH_URL?: string;
  META_APP_ID: string;
  META_APP_SECRET: string;
  META_REDIRECT_URI: string;
  META_API_VERSION?: string;
  META_SCOPES?: string;
  EARLIEST_MESSAGES_AT?: string;
  SYNC_MIN_INTERVAL_MINUTES?: string;
  SESSION_SECRET: string;
  APP_ORIGIN?: string;
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
      newestUpdated?: string | null;
      attempt?: number;
    }
  | {
      kind: 'recompute_stats';
      runId: string;
      attempt?: number;
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
};

type SyncScope = {
  userId: string;
  pageId: string;
  platform: 'messenger' | 'instagram';
  igBusinessId: string | null;
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

async function requireSession(req: Request, env: Env) {
  const token = getSessionCookie(req.headers);
  if (!token) {
    return null;
  }
  return await readSessionToken(token, env.SESSION_SECRET);
}

async function requireUser(req: Request, env: Env) {
  const session = await requireSession(req, env);
  if (!session?.userId) {
    return null;
  }
  return session.userId;
}

async function getUserToken(env: Env, userId: string) {
  const result = await env.DB.prepare(
    'SELECT access_token, token_type, expires_at FROM meta_users WHERE id = ?',
  )
    .bind(userId)
    .first<{
      access_token: string;
      token_type: string | null;
      expires_at: number | null;
    }>();
  return result ?? null;
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
  await env.DB.prepare(
    `INSERT INTO meta_users (id, access_token, token_type, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       access_token = excluded.access_token,
       token_type = excluded.token_type,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
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
}

async function upsertPage(
  env: Env,
  data: {
    userId: string;
    pageId: string;
    name: string;
    accessToken: string;
  },
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO meta_pages (user_id, id, name, access_token, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, id) DO UPDATE SET
       name = excluded.name,
       access_token = excluded.access_token,
       updated_at = excluded.updated_at`,
  )
    .bind(data.userId, data.pageId, data.name, data.accessToken, now)
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

async function getPage(env: Env, userId: string, pageId: string) {
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
    pageId: string;
    id: string;
    name: string;
  },
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO ig_assets (user_id, id, page_id, name, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, id) DO UPDATE SET
       page_id = excluded.page_id,
       name = excluded.name,
       updated_at = excluded.updated_at`,
  )
    .bind(data.userId, data.id, data.pageId, data.name, now)
    .run();
}

async function listIgAssets(env: Env, userId: string, pageId: string) {
  const result = await env.DB.prepare(
    'SELECT id, name, page_id as pageId FROM ig_assets WHERE user_id = ? AND page_id = ?',
  )
    .bind(userId, pageId)
    .all<{ id: string; name: string; pageId: string }>();
  return result.results ?? [];
}

async function listPagesWithStats(env: Env, userId: string) {
  const pages = await env.DB.prepare(
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
            stats_error as statsError
     FROM sync_runs
     WHERE id = ?`,
  )
    .bind(id)
    .first<SyncRunRow>();
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
    newestUpdated: null,
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
  newestUpdated?: string | null;
}) {
  const { env, userId, pageId, platform, igId, runId, cursor, newestUpdated } =
    options;
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
        pageId,
        accessToken,
        version: getApiVersion(env),
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
    pageId,
    accessToken,
    version: getApiVersion(env),
    platform,
    since: since ?? undefined,
    after: cursor ?? undefined,
    limit: 20,
  });

  let conversationCount = existingRun?.conversations ?? 0;
  let messageCount = existingRun?.messages ?? 0;
  let newestUpdatedValue: string | null = newestUpdated ?? null;

  for (const convo of pageResult.conversations) {
    if (sinceDateMs) {
      const updatedDate = parseDate(convo.updated_time);
      if (updatedDate && updatedDate.getTime() < sinceDateMs) {
        continue;
      }
    }
    const messages = await fetchConversationMessages({
      conversationId: convo.id,
      accessToken,
      version: getApiVersion(env),
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
    const insert = env.DB.prepare(
      `INSERT OR IGNORE INTO messages
       (user_id, id, conversation_id, page_id, sender_type, body, created_time)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
      if (!earliest || created < earliest) {
        earliest = created;
      }
      if (!latest || created > latest) {
        latest = created;
      }
      statements.push(
        insert.bind(
          userId,
          message.id,
          convo.id,
          pageId,
          isBusiness ? 'business' : 'customer',
          message.message ?? null,
          created,
        ),
      );
    }

    const batchSize = 50;
    for (let i = 0; i < statements.length; i += batchSize) {
      const batch = statements.slice(i, i + batchSize);
      await env.DB.batch(batch);
    }

    const updatedTime = convo.updated_time;
    const compareBase: string = newestUpdatedValue ?? '';
    newestUpdatedValue =
      !newestUpdatedValue || updatedTime > compareBase
        ? updatedTime
        : newestUpdatedValue;

    await env.DB.prepare(
      `INSERT INTO conversations
       (user_id, id, platform, page_id, ig_business_id, updated_time, started_time, last_message_at,
        customer_count, business_count, price_given)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, id) DO UPDATE SET
         platform = excluded.platform,
         page_id = excluded.page_id,
         ig_business_id = excluded.ig_business_id,
         updated_time = excluded.updated_time,
         started_time = excluded.started_time,
         last_message_at = excluded.last_message_at,
         customer_count = excluded.customer_count,
         business_count = excluded.business_count,
         price_given = excluded.price_given`,
    )
      .bind(
        userId,
        convo.id,
        platform,
        pageId,
        igId ?? null,
        updatedTime,
        earliest,
        latest,
        customerCount,
        businessCount,
        priceGiven,
      )
      .run();

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
      newestUpdated: newestUpdatedValue,
    });
    return;
  }

  if (newestUpdatedValue) {
    const newestDate = parseDate(newestUpdatedValue);
    if (newestDate) {
      newestDate.setMinutes(newestDate.getMinutes() - 5);
      await upsertSyncState(env, {
        userId,
        pageId,
        platform,
        igBusinessId: igId ?? null,
        lastSyncedAt: newestDate.toISOString(),
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

async function recomputeStatsForRun(env: Env, runId: string) {
  const run = await getSyncRunRow(env, runId);
  if (!run) {
    throw new Error('Sync run not found');
  }

  await updateSyncRunStatsAndNotify(env, {
    id: runId,
    statsStatus: 'running',
    statsStartedAt: new Date().toISOString(),
    statsFinishedAt: null,
    statsError: null,
  });

  const result = await recomputeConversationStatsForRun(env, {
    userId: run.userId,
    pageId: run.pageId,
    platform: run.platform,
    igBusinessId: run.igBusinessId,
  });

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
  },
) {
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

  return { updated: result.meta?.changes ?? 0 };
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
      priceGiven: number;
      firstPriceAt: string | null;
      customerAfterPriceCount: number;
    }>();

  let updated = 0;
  for (const row of rows.results ?? []) {
    const lowResponseAfterPrice =
      row.firstPriceAt && (row.customerAfterPriceCount ?? 0) <= 2 ? 1 : 0;
    await env.DB.prepare(
      `UPDATE conversations
       SET started_time = ?,
           last_message_at = ?,
           customer_count = ?,
           business_count = ?,
           price_given = ?,
           low_response_after_price = ?
       WHERE user_id = ? AND id = ? AND page_id = ?`,
    )
      .bind(
        row.startedTime,
        row.lastMessageAt,
        row.customerCount ?? 0,
        row.businessCount ?? 0,
        row.priceGiven ?? 0,
        lowResponseAfterPrice,
        data.userId,
        row.conversationId,
        row.pageId,
      )
      .run();
    updated += 1;
  }

  return { updated };
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

addRoute('GET', '/api/health', () => json({ status: 'ok' }));

addRoute('GET', '/api/auth/login', async (req, env) => {
  const state = crypto.randomUUID();
  const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
  url.searchParams.set('client_id', env.META_APP_ID);
  url.searchParams.set('redirect_uri', env.META_REDIRECT_URI);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', getMetaScopes(env).join(','));
  url.searchParams.set('auth_type', 'rerequest');
  return Response.redirect(url.toString(), 302);
});

addRoute('GET', '/api/auth/callback', async (req, env) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) {
    return json({ error: 'Missing code' }, { status: 400 });
  }

  const shortToken = await exchangeCodeForToken({
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    redirectUri: env.META_REDIRECT_URI,
    code,
    version: getApiVersion(env),
  });
  const longToken = await exchangeForLongLivedToken({
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    accessToken: shortToken.accessToken,
    version: getApiVersion(env),
  });

  const appToken = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
  const debug = await debugToken({
    inputToken: longToken.accessToken,
    appToken,
    version: getApiVersion(env),
  });
  if (!debug?.user_id || !debug?.is_valid) {
    return json({ error: 'Token validation failed' }, { status: 400 });
  }

  await upsertMetaUser(env, {
    id: debug.user_id,
    accessToken: longToken.accessToken,
    tokenType: longToken.tokenType ?? shortToken.tokenType,
    expiresAt:
      debug.expires_at && debug.expires_at > 0
        ? debug.expires_at
        : longToken.expiresIn
          ? Math.floor(Date.now() / 1000) + longToken.expiresIn
          : null,
  });

  const fallbackExpiry = longToken.expiresIn ?? 60 * 60 * 24 * 30;
  const expiresAtSeconds =
    debug.expires_at && debug.expires_at > 0
      ? debug.expires_at
      : Math.floor(Date.now() / 1000) + fallbackExpiry;
  const session = await createSessionToken(
    {
      userId: debug.user_id,
      expiresAt: expiresAtSeconds * 1000,
    },
    env.SESSION_SECRET,
  );
  const isSecure =
    new URL(req.url).protocol === 'https:' ||
    (env.APP_ORIGIN?.startsWith('https://') ?? false);
  const cookie = buildSessionCookie(session, 60 * 60 * 24 * 30, {
    secure: isSecure,
  });
  return new Response(null, {
    status: 302,
    headers: {
      'set-cookie': cookie,
      location: env.APP_ORIGIN ?? '/',
    },
  });
});

addRoute('POST', '/api/auth/logout', (req, env) => {
  const isSecure =
    new URL(req.url).protocol === 'https:' ||
    (env.APP_ORIGIN?.startsWith('https://') ?? false);
  return new Response(null, {
    status: 204,
    headers: {
      'set-cookie': clearSessionCookie({ secure: isSecure }),
    },
  });
});

addRoute('GET', '/api/auth/me', async (req, env) => {
  const session = await requireSession(req, env);
  if (!session?.userId) {
    return json({ authenticated: false });
  }
  let name: string | null = null;
  try {
    const token = await getUserToken(env, session.userId);
    if (token?.access_token) {
      const profile = await fetchUserProfile({
        accessToken: token.access_token,
        version: getApiVersion(env),
      });
      name = profile?.name ?? null;
    }
  } catch (error) {
    console.warn('Failed to fetch user profile');
    console.warn(error);
  }
  return json({ authenticated: true, userId: session.userId, name });
});

addRoute('GET', '/api/auth/whoami', async (req, env) => {
  const userId = await requireUser(req, env);
  if (!userId) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  return json({ userId });
});

addRoute('GET', '/api/auth/config', async (_req, env) => {
  return json({
    appIdPresent: Boolean(env.META_APP_ID),
    appIdLength: env.META_APP_ID?.length ?? 0,
    redirectUri: env.META_REDIRECT_URI ?? null,
  });
});

addRoute('GET', '/api/meta/permissions', async (req, env) => {
  const userId = await requireUser(req, env);
  if (!userId) {
    return json({
      hasToken: false,
      permissions: [],
      missing: getMetaScopes(env),
    });
  }
  const token = await getUserToken(env, userId);
  if (!token) {
    return json({
      hasToken: false,
      permissions: [],
      missing: getMetaScopes(env),
    });
  }
  try {
    const permissions = await fetchPermissions({
      accessToken: token.access_token,
      version: getApiVersion(env),
    });
    const granted = permissions
      .filter((perm) => perm.status === 'granted')
      .map((perm) => perm.permission);
    const missing = getMetaScopes(env).filter(
      (scope) => !granted.includes(scope),
    );
    return json({ hasToken: true, permissions, missing });
  } catch (error) {
    console.error(error);
    return json(
      {
        hasToken: true,
        permissions: [],
        missing: getMetaScopes(env),
        error:
          error instanceof Error ? error.message : 'Meta permissions failed',
      },
      { status: 502 },
    );
  }
});

addRoute('GET', '/api/meta/businesses', async (req, env) => {
  const userId = await requireUser(req, env);
  if (!userId) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = await getUserToken(env, userId);
  if (!token) {
    return json({ error: 'No token' }, { status: 401 });
  }
  try {
    const businesses = await fetchBusinesses({
      accessToken: token.access_token,
      version: getApiVersion(env),
    });
    return json(businesses);
  } catch (error) {
    console.error(error);
    return json(
      {
        error:
          error instanceof Error ? error.message : 'Meta business fetch failed',
      },
      { status: 502 },
    );
  }
});

addRoute(
  'GET',
  '/api/meta/businesses/:businessId/pages',
  async (req, env, _ctx, params) => {
    const businessId = params.businessId;
    if (!businessId) {
      return json({ error: 'Missing business id' }, { status: 400 });
    }
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = await getUserToken(env, userId);
    if (!token) {
      return json({ error: 'No token' }, { status: 401 });
    }
    try {
      const result = await fetchBusinessPages({
        businessId,
        accessToken: token.access_token,
        version: getApiVersion(env),
      });
      return json(
        result.pages.map((page) => ({
          id: page.id,
          name: page.name,
          source: result.source,
        })),
      );
    } catch (error) {
      console.error(error);
      return json(
        {
          error:
            error instanceof Error ? error.message : 'Meta pages fetch failed',
        },
        { status: 502 },
      );
    }
  },
);

addRoute('GET', '/api/meta/accounts', async (req, env) => {
  const userId = await requireUser(req, env);
  if (!userId) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = await getUserToken(env, userId);
  if (!token) {
    return json({ error: 'No token' }, { status: 401 });
  }
  try {
    const pages = await fetchClassicPages({
      accessToken: token.access_token,
      version: getApiVersion(env),
    });
    return json(pages);
  } catch (error) {
    console.error(error);
    return json(
      {
        error:
          error instanceof Error ? error.message : 'Meta accounts fetch failed',
      },
      { status: 502 },
    );
  }
});

addRoute(
  'POST',
  '/api/meta/pages/:pageId/token',
  async (req, env, _ctx, params) => {
    const pageId = params.pageId;
    if (!pageId) {
      return json({ error: 'Missing page id' }, { status: 400 });
    }
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = await getUserToken(env, userId);
    if (!token) {
      return json({ error: 'No token' }, { status: 401 });
    }
    const body = await readJson<{ name?: string }>(req);
    const rawName = body?.name ?? '';
    try {
      const page = await fetchPageToken({
        pageId,
        accessToken: token.access_token,
        version: getApiVersion(env),
      });
      const trimmed = rawName.trim();
      const normalized = trimmed.toLowerCase();
      const resolvedName =
        !trimmed || normalized === 'page' ? page.name : trimmed;
      await upsertPage(env, {
        userId,
        pageId,
        name: resolvedName,
        accessToken: page.accessToken,
      });
      return json({ id: page.id, name: resolvedName });
    } catch (error) {
      if (error instanceof MetaApiError) {
        const meta =
          typeof error.meta === 'object' && error.meta !== null
            ? (error.meta as {
                error?: {
                  message?: string;
                  type?: string;
                  code?: number;
                  error_subcode?: number;
                  fbtrace_id?: string;
                };
              })
            : undefined;
        const fb = meta?.error;
        console.error('MetaApiError', {
          status: error.status,
          fb,
          usage: error.usage,
          pageId,
          userId,
        });
        const status =
          error.status >= 400 && error.status < 500
            ? error.status
            : error.status === 429
              ? 429
              : error.status >= 500
                ? 502
                : 500;
        return json(
          {
            error: 'Meta API error',
            meta: {
              status: error.status,
              error: fb
                ? {
                    message: fb.message,
                    type: fb.type,
                    code: fb.code,
                    error_subcode: fb.error_subcode,
                    fbtrace_id: fb.fbtrace_id,
                  }
                : undefined,
              usage: error.usage,
            },
          },
          { status },
        );
      }
      const norm = normalizeUnknownError(error);
      console.error('Meta page token failed', { userId, pageId, ...norm });
      return json(
        { error: 'Meta page token failed', details: norm },
        { status: 500 },
      );
    }
  },
);

addRoute(
  'GET',
  '/api/meta/pages/:pageId/ig-assets',
  async (req, env, _ctx, params) => {
    const pageId = params.pageId;
    if (!pageId) {
      return json({ error: 'Missing page id' }, { status: 400 });
    }
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const page = await getPage(env, userId, pageId);
    if (!page) {
      return json({ error: 'Page not enabled' }, { status: 404 });
    }
    let assets: { id: string; name?: string }[] = [];
    try {
      assets = await fetchInstagramAssets({
        pageId,
        accessToken: page.access_token,
        version: getApiVersion(env),
      });
    } catch (error) {
      console.error('Failed to fetch Instagram assets', {
        pageId,
        error: error instanceof Error ? error.message : error,
      });
      const message = error instanceof Error ? error.message : '';
      if (message.includes('Page Access Token')) {
        const token = await getUserToken(env, userId);
        if (token) {
          const refreshed = await fetchPageToken({
            pageId,
            accessToken: token.access_token,
            version: getApiVersion(env),
          });
          await upsertPage(env, {
            userId,
            pageId,
            name: refreshed.name,
            accessToken: refreshed.accessToken,
          });
          assets = await fetchInstagramAssets({
            pageId,
            accessToken: refreshed.accessToken,
            version: getApiVersion(env),
          });
        }
      } else {
        console.error(error);
        return json(
          {
            error:
              error instanceof Error ? error.message : 'Meta IG assets failed',
          },
          { status: 502 },
        );
      }
    }

    for (const asset of assets) {
      await upsertIgAsset(env, {
        userId,
        pageId,
        id: asset.id,
        name: asset.name ?? asset.id,
      });
    }
    const stored = await listIgAssets(env, userId, pageId);
    return json({ igAssets: stored });
  },
);

addRoute(
  'GET',
  '/api/meta/pages/:pageId/ig-debug',
  async (req, env, _ctx, params) => {
    const pageId = params.pageId;
    if (!pageId) {
      return json({ error: 'Missing page id' }, { status: 400 });
    }
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const page = await getPage(env, userId, pageId);
    if (!page) {
      return json({ error: 'Page not enabled' }, { status: 404 });
    }
    const token = await getUserToken(env, userId);
    try {
      const pageData = await fetchPageIgDebug({
        pageId,
        accessToken: page.access_token,
        version: getApiVersion(env),
      });
      const userData = token
        ? await fetchPageIgDebug({
            pageId,
            accessToken: token.access_token,
            version: getApiVersion(env),
          })
        : null;
      return json({
        pageId,
        pageToken: pageData,
        userToken: userData,
      });
    } catch (error) {
      console.error(error);
      return json(
        {
          error:
            error instanceof Error ? error.message : 'Meta IG debug failed',
        },
        { status: 502 },
      );
    }
  },
);

addRoute('GET', '/api/assets', async (req, env) => {
  const userId = await requireUser(req, env);
  if (!userId) {
    return json({ pages: [], igAssets: [], igEnabled: true });
  }
  const pages = await listPagesWithStats(env, userId);
  const igAssets = await env.DB.prepare(
    'SELECT id, name, page_id as pageId FROM ig_assets WHERE user_id = ?',
  )
    .bind(userId)
    .all<{ id: string; name: string; pageId: string }>();
  const igStats = await env.DB.prepare(
    `SELECT ig_business_id as igBusinessId,
            COUNT(DISTINCT id) as conversations,
            SUM(customer_count + business_count) as messages
     FROM conversations
     WHERE user_id = ? AND platform = 'instagram'
     GROUP BY ig_business_id`,
  )
    .bind(userId)
    .all<{
      igBusinessId: string | null;
      conversations: number;
      messages: number;
    }>();
  const igRuns = await env.DB.prepare(
    `SELECT ig_business_id as igBusinessId,
            MAX(finished_at) as lastSyncFinishedAt
     FROM sync_runs
     WHERE user_id = ? AND platform = 'instagram' AND status = 'completed'
     GROUP BY ig_business_id`,
  )
    .bind(userId)
    .all<{ igBusinessId: string | null; lastSyncFinishedAt: string | null }>();
  const igStatsById = new Map(
    (igStats.results ?? [])
      .filter((row) => row.igBusinessId)
      .map((row) => [row.igBusinessId as string, row]),
  );
  const igRunsById = new Map(
    (igRuns.results ?? [])
      .filter((row) => row.igBusinessId)
      .map((row) => [row.igBusinessId as string, row]),
  );
  const igAssetsWithStats = (igAssets.results ?? []).map((asset) => {
    const stats = igStatsById.get(asset.id);
    const run = igRunsById.get(asset.id);
    return {
      ...asset,
      conversationCount: stats?.conversations ?? 0,
      messageCount: stats?.messages ?? 0,
      lastSyncFinishedAt: run?.lastSyncFinishedAt ?? null,
    };
  });
  return json({ pages, igAssets: igAssetsWithStats, igEnabled: true });
});

addRoute(
  'POST',
  '/api/sync/pages/:pageId/messenger',
  async (req, env, ctx, params) => {
    const pageId = params.pageId;
    if (!pageId) {
      return json({ error: 'Missing page id' }, { status: 400 });
    }
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const result = await callSyncScopeOrchestrator(
      env,
      { userId, pageId, platform: 'messenger', igBusinessId: null },
      'manual',
    );
    return json(result);
  },
);

addRoute(
  'POST',
  '/api/sync/pages/:pageId/instagram/:igId',
  async (req, env, ctx, params) => {
    const pageId = params.pageId;
    const igId = params.igId;
    if (!pageId || !igId) {
      return json({ error: 'Missing page or Instagram id' }, { status: 400 });
    }
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const result = await callSyncScopeOrchestrator(
      env,
      { userId, pageId, platform: 'instagram', igBusinessId: igId },
      'manual',
    );
    return json(result);
  },
);

addRoute('GET', '/api/reports/weekly', async (req, env) => {
  const userId = await requireUser(req, env);
  if (!userId) {
    return json({ data: [] });
  }
  const url = new URL(req.url);
  const pageId = url.searchParams.get('pageId');
  const platform = url.searchParams.get('platform');
  const bucketParam = url.searchParams.get('bucket');
  const bucket = bucketParam === 'last' ? 'last' : 'started';
  const data = await buildReportFromDb({
    db: env.DB,
    userId,
    interval: 'weekly',
    bucket,
    pageId: pageId || null,
    platform: platform || null,
  });
  return json({ data });
});

addRoute('GET', '/api/reports/monthly', async (req, env) => {
  const userId = await requireUser(req, env);
  if (!userId) {
    return json({ data: [] });
  }
  const url = new URL(req.url);
  const pageId = url.searchParams.get('pageId');
  const platform = url.searchParams.get('platform');
  const bucketParam = url.searchParams.get('bucket');
  const bucket = bucketParam === 'last' ? 'last' : 'started';
  const data = await buildReportFromDb({
    db: env.DB,
    userId,
    interval: 'monthly',
    bucket,
    pageId: pageId || null,
    platform: platform || null,
  });
  return json({ data });
});

addRoute('POST', '/api/reports/recompute', async (req, env) => {
  const userId = await requireUser(req, env);
  if (!userId) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await readJson<{ pageId?: string | null }>(req);
  const pageId = body?.pageId ?? null;
  const result = await recomputeConversationStats(env, { userId, pageId });
  return json(result);
});

addRoute('POST', '/auth/facebook/deletion', async (req, env) => {
  const payload = await readJson<{ signed_request?: string }>(req);
  const signedRequest = payload?.signed_request;
  if (!signedRequest) {
    return json({ error: 'Missing signed_request' }, { status: 400 });
  }
  const [encodedSig, encodedPayload] = signedRequest.split('.');
  if (!encodedSig || !encodedPayload) {
    return json({ error: 'Invalid signed_request' }, { status: 400 });
  }
  const sig = Uint8Array.from(
    atob(encodedSig.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  );
  const payloadBytes = new TextEncoder().encode(encodedPayload);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.META_APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify('HMAC', key, sig, payloadBytes);
  if (!valid) {
    return json({ error: 'Invalid signature' }, { status: 400 });
  }
  const decoded = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(
        atob(encodedPayload.replace(/-/g, '+').replace(/_/g, '/')),
        (c) => c.charCodeAt(0),
      ),
    ),
  ) as { user_id?: string };
  if (!decoded.user_id) {
    return json({ error: 'Missing user_id' }, { status: 400 });
  }
  const userId = decoded.user_id;

  await env.DB.prepare('DELETE FROM messages WHERE user_id = ?')
    .bind(userId)
    .run();
  await env.DB.prepare('DELETE FROM conversations WHERE user_id = ?')
    .bind(userId)
    .run();
  await env.DB.prepare('DELETE FROM ig_assets WHERE user_id = ?')
    .bind(userId)
    .run();
  await env.DB.prepare('DELETE FROM meta_pages WHERE user_id = ?')
    .bind(userId)
    .run();
  await env.DB.prepare('DELETE FROM sync_states WHERE user_id = ?')
    .bind(userId)
    .run();
  await env.DB.prepare('DELETE FROM sync_runs WHERE user_id = ?')
    .bind(userId)
    .run();
  await env.DB.prepare('DELETE FROM meta_users WHERE id = ?')
    .bind(userId)
    .run();

  const confirmationCode = crypto.randomUUID();
  const statusUrl = `${env.APP_ORIGIN ?? ''}/deletion?code=${confirmationCode}`;
  return json({ url: statusUrl, confirmation_code: confirmationCode });
});

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

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
  },
  async queue(batch: MessageBatch<SyncJob>, env: Env) {
    for (const message of batch.messages) {
      try {
        const kind = message.body.kind ?? 'sync';
        if (kind === 'recompute_stats') {
          await recomputeStatsForRun(env, message.body.runId);
          continue;
        }
        const syncJob = message.body as Extract<SyncJob, { kind?: 'sync' }>;
        const { userId, pageId, platform, igId, runId, cursor, newestUpdated } =
          syncJob;
        await runSync({
          env,
          userId,
          pageId,
          platform,
          igId,
          runId,
          cursor,
          newestUpdated,
        });
      } catch (error) {
        const kind = message.body.kind ?? 'sync';
        if (kind === 'recompute_stats') {
          const messageText = errorMessage(error);
          console.error('Stats recompute failed', {
            runId: message.body.runId,
            error: messageText,
          });
          await updateSyncRunStatsAndNotify(env, {
            id: message.body.runId,
            statsStatus: 'failed',
            statsFinishedAt: new Date().toISOString(),
            statsError: truncateErrorText(messageText),
          });
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
            newestUpdated: syncJob.newestUpdated,
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
