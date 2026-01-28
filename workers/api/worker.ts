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
  fetchConversations,
  fetchConversationMessages,
  metaConfig,
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
  META_APP_ID: string;
  META_APP_SECRET: string;
  META_REDIRECT_URI: string;
  META_API_VERSION?: string;
  META_SCOPES?: string;
  SESSION_SECRET: string;
  APP_ORIGIN?: string;
};

type RouteHandler = (
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
) => Promise<Response> | Response;

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
  } catch {
    return null;
  }
}

function getMetaScopes(env: Env) {
  return (
    env.META_SCOPES ??
    'pages_show_list,pages_manage_metadata,business_management,pages_messaging,instagram_basic,instagram_manage_messages'
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
            SUM(customer_count + business_count) as messages,
            MAX(updated_time) as lastMessageAt
     FROM conversations
     WHERE user_id = ?
     GROUP BY page_id`,
  )
    .bind(userId)
    .all<{
      pageId: string;
      conversations: number;
      messages: number;
      lastMessageAt: string | null;
    }>();
  const statsByPage = new Map(stats.results.map((row) => [row.pageId, row]));
  return pages.results.map((page) => {
    const stat = statsByPage.get(page.id);
    return {
      id: page.id,
      name: page.name ?? 'Page',
      conversationCount: stat?.conversations ?? 0,
      messageCount: stat?.messages ?? 0,
      lastSyncedAt: stat?.lastMessageAt ?? null,
    };
  });
}

async function listSyncRuns(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    `SELECT id, page_id as pageId, platform, ig_business_id as igBusinessId, status,
            started_at as startedAt, finished_at as finishedAt, last_error as lastError,
            conversations, messages
     FROM sync_runs
     WHERE user_id = ?
     ORDER BY started_at DESC`,
  )
    .bind(userId)
    .all<{
      id: string;
      pageId: string;
      platform: string;
      igBusinessId: string | null;
      status: string;
      startedAt: string;
      finishedAt: string | null;
      lastError: string | null;
      conversations: number;
      messages: number;
    }>();
  return rows.results ?? [];
}

async function createSyncRun(
  env: Env,
  data: {
    userId: string;
    pageId: string;
    platform: string;
    igBusinessId?: string | null;
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
      'running',
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
) {
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
}) {
  const { env, userId, pageId, platform, igId, runId } = options;
  const page = await getPage(env, userId, pageId);
  if (!page) {
    await updateSyncRun(env, {
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
  const since = state?.lastSyncedAt ?? null;
  const conversations = await fetchConversations({
    pageId,
    accessToken,
    version: getApiVersion(env),
    platform,
    since: since ?? undefined,
  });

  let conversationCount = 0;
  let messageCount = 0;
  let newestUpdated: string | null = null;

  for (const convo of conversations) {
    conversationCount += 1;
    const messages = await fetchConversationMessages({
      conversationId: convo.id,
      accessToken,
      version: getApiVersion(env),
    });
    if (!messages.length) {
      continue;
    }
    let customerCount = 0;
    let businessCount = 0;
    let priceGiven = 0;
    let earliest: string | null = null;
    let latest: string | null = null;

    for (const message of messages) {
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
      await env.DB.prepare(
        `INSERT OR IGNORE INTO messages
         (user_id, id, conversation_id, page_id, sender_type, body, created_time)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          userId,
          message.id,
          convo.id,
          pageId,
          isBusiness ? 'business' : 'customer',
          message.message ?? null,
          created,
        )
        .run();
    }

    const updatedTime = convo.updated_time;
    const compareBase: string = newestUpdated ?? '';
    newestUpdated =
      !newestUpdated || updatedTime > compareBase ? updatedTime : newestUpdated;

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
      await updateSyncRun(env, {
        id: runId,
        conversations: conversationCount,
        messages: messageCount,
      });
    }
  }

  if (newestUpdated) {
    const newestDate = parseDate(newestUpdated);
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

  await updateSyncRun(env, {
    id: runId,
    status: 'completed',
    conversations: conversationCount,
    messages: messageCount,
    finishedAt: new Date().toISOString(),
  });
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

addRoute('POST', '/api/auth/logout', () => {
  return new Response(null, {
    status: 204,
    headers: {
      'set-cookie': clearSessionCookie(),
    },
  });
});

addRoute('GET', '/api/auth/me', async (req, env) => {
  const session = await requireSession(req, env);
  if (!session?.userId) {
    return json({ authenticated: false });
  }
  return json({ authenticated: true, userId: session.userId });
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
      console.error(error);
      return json(
        {
          error:
            error instanceof Error ? error.message : 'Meta page token failed',
        },
        { status: 502 },
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
  return json({ pages, igAssets: igAssets.results ?? [], igEnabled: true });
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
    const runId = await createSyncRun(env, {
      userId,
      pageId,
      platform: 'messenger',
    });
    ctx.waitUntil(
      runSync({
        env,
        userId,
        pageId,
        platform: 'messenger',
        runId,
      }).catch(async (error) => {
        console.error(error);
        await updateSyncRun(env, {
          id: runId,
          status: 'failed',
          lastError: error instanceof Error ? error.message : 'Sync failed',
          finishedAt: new Date().toISOString(),
        });
      }),
    );
    return json({ runId });
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
    const runId = await createSyncRun(env, {
      userId,
      pageId,
      platform: 'instagram',
      igBusinessId: igId,
    });
    ctx.waitUntil(
      runSync({
        env,
        userId,
        pageId,
        platform: 'instagram',
        igId,
        runId,
      }).catch(async (error) => {
        console.error(error);
        await updateSyncRun(env, {
          id: runId,
          status: 'failed',
          lastError: error instanceof Error ? error.message : 'Sync failed',
          finishedAt: new Date().toISOString(),
        });
      }),
    );
    return json({ runId });
  },
);

addRoute('GET', '/api/sync/runs', async (req, env) => {
  const userId = await requireUser(req, env);
  if (!userId) {
    return json([]);
  }
  const runs = await listSyncRuns(env, userId);
  return json(runs);
});

addRoute('GET', '/api/reports/weekly', async (req, env) => {
  const userId = await requireUser(req, env);
  if (!userId) {
    return json({ data: [] });
  }
  const url = new URL(req.url);
  const pageId = url.searchParams.get('pageId');
  const platform = url.searchParams.get('platform');
  const data = await buildReportFromDb({
    db: env.DB,
    userId,
    interval: 'weekly',
    pageId,
    platform,
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
  const data = await buildReportFromDb({
    db: env.DB,
    userId,
    interval: 'monthly',
    pageId,
    platform,
  });
  return json({ data });
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
        return await route.handler(req, env, ctx, match.pathname.groups);
      }
    }
    return json({ error: 'Not found' }, { status: 404 });
  },
};
