import { MetaApiError } from './meta';
import { summarizeAiRunStats, type AiRunStats } from './aiStats';
import { isValidAuditLabel } from './conversationAudit';
import type { Env } from './worker';

type RouteHandler = (
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
) => Promise<Response> | Response;

// Auto-extracted route registrations
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerRoutes(deps: any) {
  const addRoute = deps.addRoute as (
    method: string,
    pathname: string,
    handler: RouteHandler,
  ) => void;
  const {
    json,
    cachedJson,
    readJson: readJsonRaw,
    getMetaScopes,
    getApiVersion,
    isFollowupInboxEnabled,
    isOpsDashboardEnabled,
    isAuditConversationsEnabled,
    isFollowupInboxEnabledForUser,
    isOpsDashboardEnabledForUser,
    isAuditConversationsEnabledForUser,
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
    buildSessionCookie,
    clearSessionCookie,
    createSessionToken,
    requireSession,
    requireUser,
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
  } = deps;
  const readJson = readJsonRaw as <T>(req: Request) => Promise<T | null>;
  const webhookSubscribeFields = [
    'messages',
    'messaging_postbacks',
    'messaging_optins',
    'message_deliveries',
    'message_reads',
    'message_echoes',
  ];

  const subscribePageWebhookBestEffort = async (
    env: Env,
    input: {
      userId: string;
      pageId: string;
      pageAccessToken: string;
    },
  ) => {
    try {
      const result = await subscribeAppToPage({
        env,
        pageId: input.pageId,
        accessToken: input.pageAccessToken,
        version: getApiVersion(env),
        workspaceId: input.userId,
        subscribedFields: webhookSubscribeFields,
      });
      return result.success;
    } catch (error) {
      console.warn('Failed to subscribe page webhook', {
        userId: input.userId,
        pageId: input.pageId,
        error: error instanceof Error ? error.message : error,
      });
      reportError(env, {
        errorKey: 'meta.page_subscribe_failed',
        kind: 'meta',
        route: 'POST /:pageId/subscribed_apps',
        workspaceId: input.userId,
        assetId: input.pageId,
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  const normalizeTag = (tag: string) =>
    tag.trim().toLowerCase().replace(/\s+/g, '_');
  type MessageDisplayKind =
    | 'text'
    | 'image'
    | 'file'
    | 'sticker'
    | 'like'
    | 'unknown';
  type MessageDisplay = {
    kind: MessageDisplayKind;
    label: string;
    previewUrl?: string | null;
    url?: string | null;
    filename?: string | null;
    mimeType?: string | null;
    size?: number | null;
    emoji?: string | null;
  };
  type MessageAttachment = {
    mime_type?: string;
    name?: string;
    size?: number;
    file_url?: string;
    image_data?: {
      url?: string;
      preview_url?: string;
      render_as_sticker?: boolean;
    };
  };
  const parseJsonSafeValue = (value: unknown): unknown => {
    if (!value || typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };
  const extractAttachments = (
    attachmentsValue: unknown,
    rawValue: unknown,
  ): MessageAttachment[] => {
    const attachments = parseJsonSafeValue(attachmentsValue);
    if (
      attachments &&
      typeof attachments === 'object' &&
      Array.isArray((attachments as { data?: unknown[] }).data)
    ) {
      return (
        (attachments as { data?: MessageAttachment[] }).data ?? []
      ).filter((item) => Boolean(item && typeof item === 'object'));
    }
    const raw = parseJsonSafeValue(rawValue);
    const rawAttachments =
      raw && typeof raw === 'object'
        ? (raw as { attachments?: { data?: MessageAttachment[] } }).attachments
        : null;
    if (rawAttachments?.data?.length) {
      return rawAttachments.data;
    }
    return [];
  };
  const deriveMessageDisplay = (input: {
    body: string | null;
    attachments?: unknown;
    raw?: unknown;
  }): MessageDisplay => {
    const body = (input.body ?? '').trim();
    const attachments = extractAttachments(input.attachments, input.raw);
    const sticker = attachments.find(
      (item) => item.image_data?.render_as_sticker === true,
    );
    const image = attachments.find((item) =>
      (item.mime_type ?? '').toLowerCase().startsWith('image/'),
    );
    const file = attachments[0];
    if (body) {
      if (/^(?:👍|👍🏻|👍🏼|👍🏽|👍🏾|👍🏿)+$/u.test(body)) {
        return { kind: 'like', label: '👍', emoji: '👍' };
      }
      return { kind: 'text', label: body };
    }
    if (sticker) {
      return {
        kind: 'sticker',
        label: '👍',
        previewUrl: sticker.image_data?.preview_url ?? sticker.image_data?.url,
        url: sticker.image_data?.url ?? sticker.file_url ?? null,
      };
    }
    if (image) {
      return {
        kind: 'image',
        label: '📷 Photo',
        previewUrl: image.image_data?.preview_url ?? image.image_data?.url,
        url: image.image_data?.url ?? image.file_url ?? null,
        mimeType: image.mime_type ?? null,
      };
    }
    if (file) {
      return {
        kind: 'file',
        label: '📎 Attachment',
        url: file.file_url ?? file.image_data?.url ?? null,
        filename: file.name ?? null,
        mimeType: file.mime_type ?? null,
        size: file.size ?? null,
      };
    }
    return { kind: 'unknown', label: '(no text)' };
  };
  const classifyDeliveryFailure = (
    error: unknown,
  ): { blocked: boolean; bounced: boolean } => {
    if (!(error instanceof MetaApiError)) {
      return { blocked: false, bounced: false };
    }
    const meta =
      typeof error.meta === 'object' && error.meta !== null
        ? (error.meta as {
            error?: {
              code?: number;
              error_subcode?: number;
              message?: string;
            };
          })
        : null;
    const rawMessage =
      meta?.error?.message ?? error.message ?? JSON.stringify(meta ?? {});
    const message = rawMessage.toLowerCase();
    const code = meta?.error?.code ?? null;
    const subcode = meta?.error?.error_subcode ?? null;
    const blockedMessage =
      /blocked|can't receive your message|cannot receive your message|not allowed to message|has restricted/i.test(
        rawMessage,
      );
    const blocked = blockedMessage || subcode === 1545041;
    const bounced =
      /invalid recipient|recipient unavailable|delivery failed|bounced|cannot be reached|not found/i.test(
        rawMessage,
      ) ||
      code === 100 ||
      subcode === 2018001 ||
      subcode === 2018292;
    if (blocked && message.includes('temporary')) {
      return { blocked: false, bounced: false };
    }
    return { blocked, bounced };
  };
  const markConversationDeliveryFailure = async (
    env: Env,
    input: {
      conversationId: string;
      userId: string;
      blocked: boolean;
      bounced: boolean;
    },
  ) => {
    if (!input.blocked && !input.bounced) return;
    const nowIso = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE conversations
       SET blocked_by_recipient = CASE WHEN ? = 1 THEN 1 ELSE blocked_by_recipient END,
           blocked_at = CASE WHEN ? = 1 AND blocked_at IS NULL THEN ? ELSE blocked_at END,
           bounced_by_provider = CASE WHEN ? = 1 THEN 1 ELSE bounced_by_provider END,
           bounced_at = CASE WHEN ? = 1 AND bounced_at IS NULL THEN ? ELSE bounced_at END
       WHERE user_id = ? AND id = ?`,
    )
      .bind(
        input.blocked ? 1 : 0,
        input.blocked ? 1 : 0,
        nowIso,
        input.bounced ? 1 : 0,
        input.bounced ? 1 : 0,
        nowIso,
        input.userId,
        input.conversationId,
      )
      .run();
  };
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

  addRoute('GET', '/api/auth/callback', async (req, env, ctx) => {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    if (!code) {
      return json({ error: 'Missing code' }, { status: 400 });
    }

    const shortToken = await exchangeCodeForToken({
      env,
      appId: env.META_APP_ID,
      appSecret: env.META_APP_SECRET,
      redirectUri: env.META_REDIRECT_URI,
      code,
      version: getApiVersion(env),
    });
    const longToken = await exchangeForLongLivedToken({
      env,
      appId: env.META_APP_ID,
      appSecret: env.META_APP_SECRET,
      accessToken: shortToken.accessToken,
      version: getApiVersion(env),
    });

    const appToken = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
    const debug = await debugToken({
      env,
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
    ctx.waitUntil(
      (async () => {
        const pages = await env.DB.prepare(
          'SELECT id, access_token as accessToken FROM meta_pages WHERE user_id = ?',
        )
          .bind(debug.user_id)
          .all<{ id: string; accessToken: string | null }>();
        for (const page of pages.results ?? []) {
          if (!page.accessToken) continue;
          await subscribePageWebhookBestEffort(env, {
            userId: debug.user_id,
            pageId: page.id,
            pageAccessToken: page.accessToken,
          });
        }
      })(),
    );

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
          env,
          accessToken: token.access_token,
          version: getApiVersion(env),
          workspaceId: session.userId,
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

  addRoute('GET', '/api/feature-flags', async (req, env) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({
        followupInbox: isFollowupInboxEnabled(env),
        opsDashboard: isOpsDashboardEnabled(env),
        auditConversations: isAuditConversationsEnabled(env),
      });
    }
    return json({
      followupInbox: await isFollowupInboxEnabledForUser(env, userId),
      opsDashboard: await isOpsDashboardEnabledForUser(env, userId),
      auditConversations: await isAuditConversationsEnabledForUser(env, userId),
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
      const permissions = (await fetchPermissions({
        env,
        accessToken: token.access_token,
        version: getApiVersion(env),
        workspaceId: userId,
      })) as Array<{ permission: string; status: string }>;
      const granted = permissions
        .filter((perm) => perm.status === 'granted')
        .map((perm) => perm.permission);
      const missing = (getMetaScopes(env) as string[]).filter(
        (scope) => !granted.includes(scope),
      );
      return json({ hasToken: true, permissions, missing });
    } catch (error) {
      console.error(error);
      reportError(env, {
        errorKey: 'meta.permissions_failed',
        kind: 'meta',
        route: 'GET /api/meta/permissions',
        message: error instanceof Error ? error.message : String(error),
      });
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
        env,
        accessToken: token.access_token,
        version: getApiVersion(env),
        workspaceId: userId,
      });
      return json(businesses);
    } catch (error) {
      console.error(error);
      reportError(env, {
        errorKey: 'meta.businesses_failed',
        kind: 'meta',
        route: 'GET /api/meta/businesses',
        message: error instanceof Error ? error.message : String(error),
      });
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Meta business fetch failed',
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
        const result = (await fetchBusinessPages({
          env,
          businessId,
          accessToken: token.access_token,
          version: getApiVersion(env),
          workspaceId: userId,
        })) as { source: string; pages: Array<{ id: string; name: string }> };
        return json(
          result.pages.map((page) => ({
            id: page.id,
            name: page.name,
            source: result.source,
          })),
        );
      } catch (error) {
        console.error(error);
        reportError(env, {
          errorKey: 'meta.pages_failed',
          kind: 'meta',
          route: 'GET /api/meta/businesses/:businessId/pages',
          message: error instanceof Error ? error.message : String(error),
        });
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Meta pages fetch failed',
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
        env,
        accessToken: token.access_token,
        version: getApiVersion(env),
        workspaceId: userId,
      });
      return json(pages);
    } catch (error) {
      console.error(error);
      reportError(env, {
        errorKey: 'meta.accounts_failed',
        kind: 'meta',
        route: 'GET /api/meta/accounts',
        message: error instanceof Error ? error.message : String(error),
      });
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Meta accounts fetch failed',
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
          env,
          pageId,
          accessToken: token.access_token,
          version: getApiVersion(env),
          workspaceId: userId,
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
        const subscribed = await subscribePageWebhookBestEffort(env, {
          userId,
          pageId,
          pageAccessToken: page.accessToken,
        });
        return json({
          id: page.id,
          name: resolvedName,
          webhookSubscribed: subscribed,
        });
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
          reportError(env, {
            errorKey: classifyMetaErrorKey(error),
            kind: 'meta',
            route: 'POST /api/meta/pages/:pageId/token',
            workspaceId: userId,
            assetId: pageId,
            message: error.message,
          });
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
        reportError(env, {
          errorKey: 'meta.page_token_failed',
          kind: 'meta',
          route: 'POST /api/meta/pages/:pageId/token',
          workspaceId: userId,
          assetId: pageId,
          message: norm.message,
        });
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
          env,
          pageId,
          accessToken: page.access_token,
          version: getApiVersion(env),
          workspaceId: userId,
        });
      } catch (error) {
        console.error('Failed to fetch Instagram assets', {
          pageId,
          error: error instanceof Error ? error.message : error,
        });
        reportError(env, {
          errorKey: 'meta.ig_assets_failed',
          kind: 'meta',
          route: 'GET /api/meta/pages/:pageId/ig-assets',
          workspaceId: userId,
          assetId: pageId,
          message: error instanceof Error ? error.message : String(error),
        });
        const message = error instanceof Error ? error.message : '';
        if (message.includes('Page Access Token')) {
          const token = await getUserToken(env, userId);
          if (token) {
            const refreshed = await fetchPageToken({
              env,
              pageId,
              accessToken: token.access_token,
              version: getApiVersion(env),
              workspaceId: userId,
            });
            await upsertPage(env, {
              userId,
              pageId,
              name: refreshed.name,
              accessToken: refreshed.accessToken,
            });
            await subscribePageWebhookBestEffort(env, {
              userId,
              pageId,
              pageAccessToken: refreshed.accessToken,
            });
            assets = await fetchInstagramAssets({
              env,
              pageId,
              accessToken: refreshed.accessToken,
              version: getApiVersion(env),
              workspaceId: userId,
            });
          }
        } else {
          console.error(error);
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Meta IG assets failed',
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

  addRoute('POST', '/api/meta/pages/subscribe-connected', async (req, env) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const pages = await env.DB.prepare(
      `SELECT id, access_token as accessToken
       FROM meta_pages
       WHERE user_id = ?`,
    )
      .bind(userId)
      .all<{ id: string; accessToken: string | null }>();
    let subscribed = 0;
    let skipped = 0;
    const failed: string[] = [];
    for (const page of pages.results ?? []) {
      if (!page.accessToken) {
        skipped += 1;
        continue;
      }
      const ok = await subscribePageWebhookBestEffort(env, {
        userId,
        pageId: page.id,
        pageAccessToken: page.accessToken,
      });
      if (ok) {
        subscribed += 1;
      } else {
        failed.push(page.id);
      }
    }
    return json({
      ok: true,
      total: pages.results?.length ?? 0,
      subscribed,
      skipped,
      failed,
    });
  });

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
          env,
          pageId,
          accessToken: page.access_token,
          version: getApiVersion(env),
          workspaceId: userId,
        });
        const userData = token
          ? await fetchPageIgDebug({
              env,
              pageId,
              accessToken: token.access_token,
              version: getApiVersion(env),
              workspaceId: userId,
            })
          : null;
        return json({
          pageId,
          pageToken: pageData,
          userToken: userData,
        });
      } catch (error) {
        console.error(error);
        reportError(env, {
          errorKey: 'meta.ig_debug_failed',
          kind: 'meta',
          route: 'GET /api/meta/pages/:pageId/ig-debug',
          workspaceId: userId,
          assetId: pageId,
          message: error instanceof Error ? error.message : String(error),
        });
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
      .all<{
        igBusinessId: string | null;
        lastSyncFinishedAt: string | null;
      }>();
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

  addRoute('GET', '/api/inbox/conversations', async (req, env) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isFollowupInboxEnabledForUser(env, userId))) {
      return json({ error: 'Not found' }, { status: 404 });
    }
    const url = new URL(req.url);
    const state = url.searchParams.get('state')?.trim() || null;
    const group = url.searchParams.get('group')?.trim().toLowerCase() || null;
    const channel = url.searchParams.get('channel')?.trim() || null;
    const search = url.searchParams.get('q')?.trim() || '';
    const assetId = url.searchParams.get('assetId')?.trim() || null;
    const needsFollowup = url.searchParams.get('needs_followup');
    const limit = Math.min(
      200,
      Math.max(10, Number(url.searchParams.get('limit') ?? 50)),
    );
    const cursor = url.searchParams.get('cursor');

    const where: string[] = ['c.user_id = ?'];
    const bindings: unknown[] = [userId];
    if (state) {
      where.push('c.current_state = ?');
      bindings.push(state);
    } else if (group === 'active') {
      where.push(
        "(c.current_state IS NULL OR (c.current_state != 'LOST' AND c.current_state != 'SPAM'))",
      );
    }
    if (assetId) {
      where.push('c.asset_id = ?');
      bindings.push(assetId);
    }
    if (needsFollowup && ['1', 'true', 'yes'].includes(needsFollowup)) {
      where.push('c.needs_followup = 1');
    }
    if (channel) {
      if (channel === 'facebook') {
        where.push("c.platform = 'messenger'");
      } else if (channel === 'instagram') {
        where.push("c.platform = 'instagram'");
      }
    }
    if (search) {
      where.push(
        '(c.participant_name LIKE ? OR c.participant_handle LIKE ? OR c.last_snippet LIKE ?)',
      );
      const like = `%${search}%`;
      bindings.push(like, like, like);
    }
    if (cursor) {
      where.push('c.last_message_at < ?');
      bindings.push(cursor);
    }

    const query = `SELECT c.id as conversationId,
            c.platform,
            c.page_id as pageId,
            c.ig_business_id as igBusinessId,
            c.asset_id as assetId,
            c.participant_id as participantId,
            c.participant_name as participantName,
            c.participant_handle as participantHandle,
            c.last_inbound_at as lastInboundAt,
            c.last_outbound_at as lastOutboundAt,
            c.last_message_at as lastMessageAt,
            c.current_state as currentState,
            c.current_confidence as currentConfidence,
            c.followup_due_at as followupDueAt,
            c.followup_suggestion as followupSuggestion,
            c.last_snippet as lastSnippet
     FROM conversations c
     WHERE ${where.join(' AND ')}
     ORDER BY c.last_message_at DESC
     LIMIT ?`;
    const rows = await env.DB.prepare(query)
      .bind(...bindings, limit)
      .all<{
        conversationId: string;
        platform: string;
        pageId: string;
        igBusinessId: string | null;
        assetId: string | null;
        participantId: string | null;
        participantName: string | null;
        participantHandle: string | null;
        lastInboundAt: string | null;
        lastOutboundAt: string | null;
        lastMessageAt: string | null;
        currentState: string | null;
        currentConfidence: string | null;
        followupDueAt: string | null;
        followupSuggestion: string | null;
        lastSnippet: string | null;
      }>();

    const assets = await getAssetNameMap(env, userId);
    const conversationIds = (rows.results ?? []).map(
      (row) => row.conversationId,
    );
    const latestMessageDisplayByConversation = new Map<
      string,
      MessageDisplay
    >();
    if (conversationIds.length) {
      const placeholders = conversationIds.map(() => '?').join(',');
      const latestRows = await env.DB.prepare(
        `SELECT m.conversation_id as conversationId, m.body, m.attachments, m.raw
         FROM messages m
         INNER JOIN (
           SELECT conversation_id, MAX(created_time) as createdTime
           FROM messages
           WHERE user_id = ? AND conversation_id IN (${placeholders})
           GROUP BY conversation_id
         ) latest
           ON latest.conversation_id = m.conversation_id
          AND latest.createdTime = m.created_time
         WHERE m.user_id = ?`,
      )
        .bind(userId, ...conversationIds, userId)
        .all<{
          conversationId: string;
          body: string | null;
          attachments: string | null;
          raw: string | null;
        }>();
      for (const row of latestRows.results ?? []) {
        if (!latestMessageDisplayByConversation.has(row.conversationId)) {
          latestMessageDisplayByConversation.set(
            row.conversationId,
            deriveMessageDisplay({
              body: row.body,
              attachments: row.attachments,
              raw: row.raw,
            }),
          );
        }
      }
    }
    const aiSummaryByConversation = new Map<
      string,
      {
        has_ai_processed: boolean;
        has_ai_handoff_true: boolean;
        has_ai_deferred_true: boolean;
      }
    >();
    if (conversationIds.length) {
      const placeholders = conversationIds.map(() => '?').join(',');
      const aiRows = await env.DB.prepare(
        `SELECT conversation_id as conversationId,
                features_json as featuresJson
         FROM messages
         WHERE user_id = ?
           AND conversation_id IN (${placeholders})
           AND features_json LIKE '%"ai"%'`,
      )
        .bind(userId, ...conversationIds)
        .all<{ conversationId: string; featuresJson: string | null }>();
      for (const row of aiRows.results ?? []) {
        if (!row.featuresJson) continue;
        let parsed: { ai?: unknown } | null = null;
        try {
          parsed = JSON.parse(row.featuresJson) as { ai?: unknown };
        } catch {
          parsed = null;
        }
        const ai = parsed?.ai;
        if (!ai || typeof ai !== 'object') continue;
        const aiRecord = ai as Record<string, unknown>;
        const existing = aiSummaryByConversation.get(row.conversationId) ?? {
          has_ai_processed: false,
          has_ai_handoff_true: false,
          has_ai_deferred_true: false,
        };
        const attempted =
          typeof aiRecord.attempted === 'boolean' ? aiRecord.attempted : false;
        const interpretation =
          typeof aiRecord.interpretation === 'object' && aiRecord.interpretation
            ? (aiRecord.interpretation as Record<string, unknown>)
            : null;
        const handoff =
          typeof interpretation?.handoff === 'object' && interpretation?.handoff
            ? (interpretation.handoff as Record<string, unknown>)
            : null;
        const deferred =
          typeof interpretation?.deferred === 'object' &&
          interpretation?.deferred
            ? (interpretation.deferred as Record<string, unknown>)
            : null;
        const hasAiProcessed = attempted || Boolean(interpretation);
        const handoffTrue =
          handoff?.is_handoff === true || handoff?.is_handoff === 'true';
        const deferredTrue =
          deferred?.is_deferred === true || deferred?.is_deferred === 'true';
        aiSummaryByConversation.set(row.conversationId, {
          has_ai_processed: existing.has_ai_processed || hasAiProcessed,
          has_ai_handoff_true: existing.has_ai_handoff_true || handoffTrue,
          has_ai_deferred_true: existing.has_ai_deferred_true || deferredTrue,
        });
      }
    }

    return json({
      conversations: (rows.results ?? []).map((row) => {
        const asset =
          row.assetId && assets.has(row.assetId)
            ? assets.get(row.assetId)
            : null;
        const aiSummary = aiSummaryByConversation.get(row.conversationId) ?? {
          has_ai_processed: false,
          has_ai_handoff_true: false,
          has_ai_deferred_true: false,
        };
        const inboundAgeHours = row.lastInboundAt
          ? (Date.now() - Date.parse(row.lastInboundAt)) / (1000 * 60 * 60)
          : null;
        const fallbackDisplay = latestMessageDisplayByConversation.get(
          row.conversationId,
        );
        const snippet =
          row.lastSnippet?.trim() || fallbackDisplay?.label || null;
        return {
          id: row.conversationId,
          channel: row.platform === 'instagram' ? 'instagram' : 'facebook',
          pageId: row.pageId,
          igBusinessId: row.igBusinessId,
          assetId: row.assetId,
          assetName: asset?.name ?? null,
          participantId: row.participantId,
          participantName: row.participantName ?? 'Unknown',
          participantHandle: row.participantHandle,
          lastInboundAt: row.lastInboundAt,
          lastOutboundAt: row.lastOutboundAt,
          lastMessageAt: row.lastMessageAt,
          lastSnippet: snippet,
          currentState: row.currentState ?? 'NEW',
          currentConfidence: row.currentConfidence ?? 'LOW',
          followupDueAt: row.followupDueAt,
          followupSuggestion: row.followupSuggestion,
          lastInboundAgeHours: inboundAgeHours,
          aiSummary,
        };
      }),
      nextCursor: rows.results?.length
        ? rows.results[rows.results.length - 1]?.lastMessageAt ?? null
        : null,
    });
  });

  addRoute('GET', '/api/inbox/conversations/count', async (req, env) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isFollowupInboxEnabledForUser(env, userId))) {
      return json({ error: 'Not found' }, { status: 404 });
    }
    const url = new URL(req.url);
    const needsFollowup = url.searchParams.get('needs_followup');
    const state = url.searchParams.get('state');
    const group = url.searchParams.get('group')?.trim().toLowerCase() || null;
    const where: string[] = ['user_id = ?'];
    const bindings: unknown[] = [userId];
    if (state) {
      where.push('current_state = ?');
      bindings.push(state);
    } else if (group === 'active') {
      where.push(
        "(current_state IS NULL OR (current_state != 'LOST' AND current_state != 'SPAM'))",
      );
    }
    if (needsFollowup && ['1', 'true', 'yes'].includes(needsFollowup)) {
      where.push('needs_followup = 1');
    }
    const row = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM conversations WHERE ${where.join(' AND ')}`,
    )
      .bind(...bindings)
      .first<{ count: number }>();
    return json({ count: row?.count ?? 0 });
  });

  addRoute('GET', '/api/inbox/conversations/counts', async (req, env) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isFollowupInboxEnabledForUser(env, userId))) {
      return json({ error: 'Not found' }, { status: 404 });
    }
    const url = new URL(req.url);
    const channel = url.searchParams.get('channel')?.trim() || null;
    const search = url.searchParams.get('q')?.trim() || '';
    const assetId = url.searchParams.get('assetId')?.trim() || null;
    const where: string[] = ['user_id = ?'];
    const bindings: unknown[] = [userId];
    if (assetId) {
      where.push('asset_id = ?');
      bindings.push(assetId);
    }
    if (channel) {
      if (channel === 'facebook') {
        where.push("platform = 'messenger'");
      } else if (channel === 'instagram') {
        where.push("platform = 'instagram'");
      }
    }
    if (search) {
      where.push(
        '(participant_name LIKE ? OR participant_handle LIKE ? OR last_snippet LIKE ?)',
      );
      const like = `%${search}%`;
      bindings.push(like, like, like);
    }
    const row = await env.DB.prepare(
      `SELECT COUNT(*) as total_count,
              SUM(CASE WHEN needs_followup = 1 THEN 1 ELSE 0 END) as needs_followup_count,
              SUM(CASE WHEN current_state IS NULL OR (current_state != 'LOST' AND current_state != 'SPAM') THEN 1 ELSE 0 END) as active_count,
              SUM(CASE WHEN current_state = 'DEFERRED' THEN 1 ELSE 0 END) as deferred_count,
              SUM(CASE WHEN current_state = 'OFF_PLATFORM' THEN 1 ELSE 0 END) as off_platform_count,
              SUM(CASE WHEN current_state = 'LOST' THEN 1 ELSE 0 END) as lost_count,
              SUM(CASE WHEN current_state = 'CONVERTED' THEN 1 ELSE 0 END) as converted_count,
              SUM(CASE WHEN current_state = 'SPAM' THEN 1 ELSE 0 END) as spam_count
       FROM conversations
       WHERE ${where.join(' AND ')}`,
    )
      .bind(...bindings)
      .first<{
        total_count: number | null;
        needs_followup_count: number | null;
        active_count: number | null;
        deferred_count: number | null;
        off_platform_count: number | null;
        lost_count: number | null;
        converted_count: number | null;
        spam_count: number | null;
      }>();
    return json({
      counts: {
        needs_followup: Number(row?.needs_followup_count ?? 0),
        active: Number(row?.active_count ?? 0),
        DEFERRED: Number(row?.deferred_count ?? 0),
        OFF_PLATFORM: Number(row?.off_platform_count ?? 0),
        LOST: Number(row?.lost_count ?? 0),
        CONVERTED: Number(row?.converted_count ?? 0),
        SPAM: Number(row?.spam_count ?? 0),
        all: Number(row?.total_count ?? 0),
      },
    });
  });

  addRoute('POST', '/api/inbox/recompute-all', async (req, env) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isFollowupInboxEnabledForUser(env, userId))) {
      return json({ error: 'Not found' }, { status: 404 });
    }
    await env.SYNC_QUEUE.send({
      kind: 'recompute_inbox',
      userId,
      forceLabelSync: true,
    });
    return json({ ok: true, queued: true });
  });

  addRoute(
    'GET',
    '/api/inbox/conversations/:id',
    async (req, env, _ctx, params) => {
      const conversationId = params.id;
      if (!conversationId) {
        return json({ error: 'Missing conversation id' }, { status: 400 });
      }
      const userId = await requireUser(req, env);
      if (!userId) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (!(await isFollowupInboxEnabledForUser(env, userId))) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      const conversation = await getConversation(env, userId, conversationId);
      if (!conversation) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      const url = new URL(req.url);
      const all = url.searchParams.get('all') === 'true';
      const limit = Math.min(
        1000,
        Math.max(20, Number(url.searchParams.get('limit') ?? 200)),
      );
      const cursor = url.searchParams.get('cursor');
      const messageWhere: string[] = ['user_id = ?', 'conversation_id = ?'];
      const messageBindings: unknown[] = [userId, conversationId];
      if (cursor) {
        messageWhere.push('created_time < ?');
        messageBindings.push(cursor);
      }
      const messagesQuery = `SELECT id,
            created_time as createdAt,
            body,
            direction,
            sender_type as senderType,
            sender_id as senderId,
            sender_name as senderName,
            attachments,
            raw,
            meta_message_id as metaMessageId,
            message_type as messageType,
            message_trigger as messageTrigger,
            features_json as featuresJson,
            rule_hits_json as ruleHitsJson
     FROM messages
     WHERE ${messageWhere.join(' AND ')}
     ORDER BY created_time ASC`;
      const messages = await env.DB.prepare(
        all ? messagesQuery : `${messagesQuery} LIMIT ?`,
      )
        .bind(...messageBindings, ...(all ? [] : [limit]))
        .all<{
          id: string;
          createdAt: string;
          body: string | null;
          direction: string | null;
          senderType: string | null;
          senderId: string | null;
          senderName: string | null;
          attachments: string | null;
          raw: string | null;
          metaMessageId: string | null;
          messageType: string | null;
          messageTrigger: string | null;
          featuresJson: string | null;
          ruleHitsJson: string | null;
        }>();
      const tags = await listConversationTags(env, userId, [conversationId]);
      const events = await env.DB.prepare(
        `SELECT id, from_state as fromState, to_state as toState, confidence, reasons_json as reasonsJson,
              triggered_by_message_id as triggeredByMessageId, triggered_at as triggeredAt
       FROM conversation_state_events
       WHERE user_id = ? AND conversation_id = ?
       ORDER BY triggered_at ASC`,
      )
        .bind(userId, conversationId)
        .all<{
          id: string;
          fromState: string | null;
          toState: string;
          confidence: string;
          reasonsJson: string;
          triggeredByMessageId: string | null;
          triggeredAt: string;
        }>();
      const assets = await getAssetNameMap(env, userId);
      const asset =
        conversation.assetId && assets.has(conversation.assetId)
          ? assets.get(conversation.assetId)
          : null;

      return json({
        conversation: {
          id: conversation.id,
          platform: conversation.platform,
          pageId: conversation.pageId,
          igBusinessId: conversation.igBusinessId,
          assetId: conversation.assetId,
          assetName: asset?.name ?? null,
          participantId: conversation.participantId,
          participantName: conversation.participantName ?? 'Unknown',
          participantHandle: conversation.participantHandle,
          lastInboundAt: conversation.lastInboundAt,
          lastOutboundAt: conversation.lastOutboundAt,
          lastMessageAt: conversation.lastMessageAt,
          needsFollowup: Boolean(conversation.needsFollowup),
          followupReasons: parseJsonArray(conversation.followupReasons),
          currentState: conversation.currentState ?? 'NEW',
          currentConfidence: conversation.currentConfidence ?? 'LOW',
          followupDueAt: conversation.followupDueAt,
          followupSuggestion: conversation.followupSuggestion,
          lastEvaluatedAt: conversation.lastEvaluatedAt,
          messageCount: conversation.messageCount ?? 0,
          inboundCount: conversation.inboundCount ?? 0,
          outboundCount: conversation.outboundCount ?? 0,
          isSpam: Boolean(conversation.isSpam),
          lastSnippet: conversation.lastSnippet,
          offPlatformOutcome: conversation.offPlatformOutcome,
          finalTouchRequired: Boolean(conversation.finalTouchRequired),
          finalTouchSentAt: conversation.finalTouchSentAt ?? null,
          lostReasonCode: conversation.lostReasonCode ?? null,
          tags: tags.get(conversationId) ?? [],
        },
        messages: (messages.results ?? []).map((message) => {
          const attachments = parseJsonSafeValue(message.attachments);
          const raw = parseJsonSafeValue(message.raw);
          const display = deriveMessageDisplay({
            body: message.body,
            attachments,
            raw,
          });
          return {
            id: message.id,
            createdAt: message.createdAt,
            body: message.body,
            direction:
              message.direction ??
              (message.senderType === 'business' ? 'outbound' : 'inbound'),
            senderId: message.senderId,
            senderName: message.senderName,
            attachments,
            metaMessageId: message.metaMessageId,
            raw,
            display,
            messageType: message.messageType,
            messageTrigger: message.messageTrigger,
            features: message.featuresJson
              ? JSON.parse(message.featuresJson)
              : null,
            ruleHits: message.ruleHitsJson
              ? JSON.parse(message.ruleHitsJson)
              : [],
          };
        }),
        stateEvents: (events.results ?? []).map((event) => ({
          id: event.id,
          fromState: event.fromState,
          toState: event.toState,
          confidence: event.confidence,
          reasons: parseJsonArray(event.reasonsJson),
          triggeredByMessageId: event.triggeredByMessageId,
          triggeredAt: event.triggeredAt,
        })),
        context: {},
      });
    },
  );

  addRoute(
    'GET',
    '/api/inbox/conversations/:id/classification_explain',
    async (req, env, _ctx, params) => {
      const conversationId = params.id;
      if (!conversationId) {
        return json({ error: 'Missing conversation id' }, { status: 400 });
      }
      const userId = await requireUser(req, env);
      if (!userId) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (!(await isAuditConversationsEnabledForUser(env, userId))) {
        return json({ error: 'Not found' }, { status: 404 });
      }

      const conversation = await getConversation(env, userId, conversationId);
      if (!conversation) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      const url = new URL(req.url);
      const assetId = url.searchParams.get('assetId')?.trim() || null;
      if (
        assetId &&
        assetId !== conversation.assetId &&
        assetId !== conversation.pageId
      ) {
        return json({ error: 'Not found' }, { status: 404 });
      }

      const explanation = await getConversationClassificationExplain(
        env,
        userId,
        conversationId,
      );
      if (!explanation) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      return json({
        computed_label: explanation.computedLabel,
        reason_codes: explanation.reasonCodes,
        feature_snapshot: explanation.featureSnapshot,
        classifier_version: explanation.classifierVersion,
        computed_at: explanation.computedAt,
      });
    },
  );

  addRoute(
    'POST',
    '/api/inbox/conversations/:id/audit',
    async (req, env, _ctx, params) => {
      const conversationId = params.id;
      if (!conversationId) {
        return json({ error: 'Missing conversation id' }, { status: 400 });
      }
      const userId = await requireUser(req, env);
      if (!userId) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (!(await isAuditConversationsEnabledForUser(env, userId))) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      const body = await readJson<{
        assetId?: string;
        is_correct?: boolean;
        correct_label?: string;
        followup_is_correct?: boolean;
        followup_correct_due_at?: number | null;
        followup_notes?: string;
        notes?: string;
      }>(req);
      if (typeof body?.is_correct !== 'boolean') {
        return json({ error: 'is_correct must be a boolean' }, { status: 400 });
      }

      const conversation = await getConversation(env, userId, conversationId);
      if (!conversation) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      const assetId = body?.assetId?.trim() || null;
      if (
        assetId &&
        assetId !== conversation.assetId &&
        assetId !== conversation.pageId
      ) {
        return json({ error: 'Not found' }, { status: 404 });
      }

      const explanation = await getConversationClassificationExplain(
        env,
        userId,
        conversationId,
      );
      if (!explanation) {
        return json(
          { error: 'Conversation has no inferred state' },
          { status: 409 },
        );
      }

      const currentLabel = explanation.computedLabel;
      if (!isValidAuditLabel(currentLabel)) {
        return json(
          { error: 'Classifier returned invalid label' },
          { status: 409 },
        );
      }
      let correctLabel = currentLabel;
      if (!body.is_correct) {
        if (!body.correct_label || !isValidAuditLabel(body.correct_label)) {
          return json({ error: 'Invalid correct_label' }, { status: 400 });
        }
        correctLabel = body.correct_label;
      }

      const notes = body?.notes?.trim() ? body.notes.trim() : null;
      const followupIsCorrect =
        typeof body?.followup_is_correct === 'boolean'
          ? body.followup_is_correct
          : true;
      const followupNotes = body?.followup_notes?.trim()
        ? body.followup_notes.trim()
        : null;
      const followupCorrectDueAt =
        body?.followup_correct_due_at === null ||
        body?.followup_correct_due_at === undefined
          ? null
          : Number(body.followup_correct_due_at);
      if (
        followupCorrectDueAt !== null &&
        (!Number.isFinite(followupCorrectDueAt) || followupCorrectDueAt <= 0)
      ) {
        return json(
          {
            error:
              'followup_correct_due_at must be a unix epoch milliseconds value',
          },
          { status: 400 },
        );
      }
      if (!followupIsCorrect && !followupNotes && !followupCorrectDueAt) {
        return json(
          {
            error:
              'followup_notes or followup_correct_due_at is required when followup_is_correct is false',
          },
          { status: 400 },
        );
      }
      const auditId = crypto.randomUUID();
      const feedbackId = crypto.randomUUID();
      const nowMs = Date.now();
      const resolvedAssetId = conversation.assetId ?? conversation.pageId;

      const insertAudit = env.DB.prepare(
        `INSERT INTO conversation_classification_audit
         (id, asset_id, conversation_id, contact_id, computed_label, reason_codes, feature_snapshot, computed_at, classifier_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        auditId,
        resolvedAssetId,
        conversationId,
        conversation.participantId ?? null,
        currentLabel,
        JSON.stringify(explanation.reasonCodes),
        JSON.stringify(explanation.featureSnapshot),
        explanation.computedAt,
        explanation.classifierVersion ?? null,
      );
      const insertFeedback = env.DB.prepare(
        `INSERT INTO conversation_classification_feedback
         (id, asset_id, conversation_id, contact_id, audit_id, current_label, correct_label, is_correct, notes, created_at, followup_is_correct, followup_correct_due_at, followup_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        feedbackId,
        resolvedAssetId,
        conversationId,
        conversation.participantId ?? null,
        auditId,
        currentLabel,
        correctLabel,
        body.is_correct ? 1 : 0,
        notes,
        nowMs,
        followupIsCorrect ? 1 : 0,
        followupCorrectDueAt,
        followupNotes,
      );
      await env.DB.batch([insertAudit, insertFeedback]);

      return json({
        feedback: {
          id: feedbackId,
          asset_id: resolvedAssetId,
          conversation_id: conversationId,
          contact_id: conversation.participantId ?? null,
          audit_id: auditId,
          current_label: currentLabel,
          correct_label: correctLabel,
          is_correct: body.is_correct,
          notes,
          created_at: nowMs,
          followup_is_correct: followupIsCorrect,
          followup_correct_due_at: followupCorrectDueAt,
          followup_notes: followupNotes,
        },
        audit_id: auditId,
      });
    },
  );

  addRoute(
    'POST',
    '/api/inbox/conversations/:id/send',
    async (req, env, _ctx, params) => {
      const conversationId = params.id;
      if (!conversationId) {
        return json({ error: 'Missing conversation id' }, { status: 400 });
      }
      const userId = await requireUser(req, env);
      if (!userId) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (!(await isFollowupInboxEnabledForUser(env, userId))) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      const body = await readJson<{
        text?: string;
        templateId?: string;
      }>(req);
      const text = body?.text?.trim();
      if (!text) {
        return json({ error: 'Message text required' }, { status: 400 });
      }
      const conversation = await getConversation(env, userId, conversationId);
      if (!conversation) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      const page = await getPage(env, userId, conversation.pageId);
      if (!page) {
        return json({ error: 'Page not connected' }, { status: 404 });
      }
      const recipientId =
        conversation.participantId ??
        (
          await env.DB.prepare(
            `SELECT sender_id as senderId
         FROM messages
         WHERE user_id = ? AND conversation_id = ? AND direction = 'inbound'
         ORDER BY created_time DESC
         LIMIT 1`,
          )
            .bind(userId, conversationId)
            .first<{ senderId: string | null }>()
        )?.senderId ??
        null;
      if (!recipientId) {
        return json({ error: 'Missing recipient id' }, { status: 400 });
      }
      try {
        const payload = {
          recipient: { id: recipientId },
          message: { text },
          messaging_type: 'RESPONSE',
        };
        const result = await sendMessage({
          env,
          accessToken: page.access_token,
          version: getApiVersion(env),
          payload,
          workspaceId: userId,
          assetId: conversation.assetId ?? conversation.pageId,
        });
        const now = new Date().toISOString();
        const messageId = result.message_id ?? crypto.randomUUID();
        const annotated = annotateMessage({
          id: messageId,
          direction: 'outbound',
          text,
          createdAt: now,
        });
        await env.DB.prepare(
          `INSERT OR IGNORE INTO messages
         (user_id, id, conversation_id, page_id, sender_type, body, created_time,
          asset_id, platform, ig_business_id, direction, sender_id, sender_name,
          attachments, raw, meta_message_id, features_json, rule_hits_json,
          message_type, message_trigger)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            userId,
            messageId,
            conversationId,
            conversation.pageId,
            'business',
            text,
            now,
            conversation.assetId ?? conversation.pageId,
            conversation.platform,
            conversation.igBusinessId ?? null,
            'outbound',
            conversation.assetId ?? conversation.pageId,
            page.name ?? 'Business',
            null,
            null,
            result.message_id ?? null,
            JSON.stringify(annotated.features),
            JSON.stringify(annotated.ruleHits),
            null,
            null,
          )
          .run();
        await recomputeFollowupEventsForConversation(env, {
          userId,
          conversationId,
        });
        await recomputeConversationState(env, userId, conversationId);
        await notifyInboxEvent(env, {
          userId,
          conversationId,
          type: 'message_sent',
          payload: { createdAt: now },
        });
        return json({ ok: true, messageId });
      } catch (error) {
        console.error('Send message failed', error);
        const failure = classifyDeliveryFailure(error);
        await markConversationDeliveryFailure(env, {
          conversationId,
          userId,
          blocked: failure.blocked,
          bounced: failure.bounced,
        });
        if (failure.blocked || failure.bounced) {
          await recomputeConversationState(env, userId, conversationId);
        }
        const message =
          error instanceof MetaApiError
            ? `Meta API error: ${error.message}`
            : error instanceof Error
              ? error.message
              : 'Failed to send message';
        return json({ error: message }, { status: 502 });
      }
    },
  );

  addRoute(
    'POST',
    '/api/inbox/conversations/:id/final-touch',
    async (req, env, _ctx, params) => {
      const conversationId = params.id;
      if (!conversationId) {
        return json({ error: 'Missing conversation id' }, { status: 400 });
      }
      const userId = await requireUser(req, env);
      if (!userId) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (!(await isFollowupInboxEnabledForUser(env, userId))) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      const body = await readJson<{ text?: string }>(req);
      const conversation = await getConversation(env, userId, conversationId);
      if (!conversation) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      if (
        conversation.currentState !== 'LOST' ||
        conversation.lostReasonCode !== 'LOST_INACTIVE_TIMEOUT' ||
        !conversation.finalTouchRequired ||
        conversation.finalTouchSentAt
      ) {
        return json({ error: 'Final touch not eligible' }, { status: 400 });
      }
      const page = await getPage(env, userId, conversation.pageId);
      if (!page) {
        return json({ error: 'Page not connected' }, { status: 404 });
      }
      const recipientId =
        conversation.participantId ??
        (
          await env.DB.prepare(
            `SELECT sender_id as senderId
         FROM messages
         WHERE user_id = ? AND conversation_id = ? AND direction = 'inbound'
         ORDER BY created_time DESC
         LIMIT 1`,
          )
            .bind(userId, conversationId)
            .first<{ senderId: string | null }>()
        )?.senderId ??
        null;
      if (!recipientId) {
        return json({ error: 'Missing recipient id' }, { status: 400 });
      }
      const text =
        body?.text?.trim() ??
        'Just checking in—if you want to revisit this in the future, we are here to help.';
      if (!text) {
        return json({ error: 'Message text required' }, { status: 400 });
      }
      try {
        const payload = {
          recipient: { id: recipientId },
          message: { text },
          messaging_type: 'RESPONSE',
        };
        const result = await sendMessage({
          env,
          accessToken: page.access_token,
          version: getApiVersion(env),
          payload,
          workspaceId: userId,
          assetId: conversation.assetId ?? conversation.pageId,
        });
        const now = new Date().toISOString();
        const messageId = result.message_id ?? crypto.randomUUID();
        const annotated = annotateMessage({
          id: messageId,
          direction: 'outbound',
          text,
          createdAt: now,
        });
        await env.DB.prepare(
          `INSERT OR IGNORE INTO messages
         (user_id, id, conversation_id, page_id, sender_type, body, created_time,
          asset_id, platform, ig_business_id, direction, sender_id, sender_name,
          attachments, raw, meta_message_id, features_json, rule_hits_json,
          message_type, message_trigger)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            userId,
            messageId,
            conversationId,
            conversation.pageId,
            'business',
            text,
            now,
            conversation.assetId ?? conversation.pageId,
            conversation.platform,
            conversation.igBusinessId ?? null,
            'outbound',
            conversation.assetId ?? conversation.pageId,
            page.name ?? 'Business',
            null,
            null,
            result.message_id ?? null,
            JSON.stringify(annotated.features),
            JSON.stringify(annotated.ruleHits),
            'FINAL_TOUCH',
            'LOST_INACTIVE_TIMEOUT',
          )
          .run();
        await recomputeFollowupEventsForConversation(env, {
          userId,
          conversationId,
        });
        await env.DB.prepare(
          `UPDATE conversations
           SET final_touch_required = 0,
               final_touch_sent_at = ?
           WHERE user_id = ? AND id = ?`,
        )
          .bind(now, userId, conversationId)
          .run();
        await recordStateEvent(env, {
          userId,
          conversationId,
          fromState: conversation.currentState,
          toState: 'FINAL_TOUCH_SENT',
          confidence: 'HIGH',
          reasons: [
            {
              code: 'FINAL_TOUCH_SENT',
              confidence: 'HIGH',
              evidence: now,
            },
          ],
          triggeredByMessageId: messageId,
        });
        await notifyInboxEvent(env, {
          userId,
          conversationId,
          type: 'message_sent',
          payload: { createdAt: now, messageType: 'FINAL_TOUCH' },
        });
        return json({ ok: true, messageId });
      } catch (error) {
        console.error('Final touch failed', error);
        const failure = classifyDeliveryFailure(error);
        await markConversationDeliveryFailure(env, {
          conversationId,
          userId,
          blocked: failure.blocked,
          bounced: failure.bounced,
        });
        if (failure.blocked || failure.bounced) {
          await recomputeConversationState(env, userId, conversationId);
        }
        const message =
          error instanceof MetaApiError
            ? `Meta API error: ${error.message}`
            : error instanceof Error
              ? error.message
              : 'Failed to send message';
        return json({ error: message }, { status: 502 });
      }
    },
  );

  addRoute(
    'POST',
    '/api/inbox/conversations/:id/off_platform_outcome',
    async (req, env, _ctx, params) => {
      const conversationId = params.id;
      if (!conversationId) {
        return json({ error: 'Missing conversation id' }, { status: 400 });
      }
      const userId = await requireUser(req, env);
      if (!userId) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (!(await isFollowupInboxEnabledForUser(env, userId))) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      const body = await readJson<{ outcome?: string }>(req);
      const outcome = body?.outcome ?? '';
      if (!['converted', 'lost', 'unknown'].includes(outcome)) {
        return json({ error: 'Invalid outcome' }, { status: 400 });
      }
      const conversation = await getConversation(env, userId, conversationId);
      if (!conversation) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      if (conversation.currentState !== 'OFF_PLATFORM') {
        return json(
          { error: 'Outcome only available for OFF_PLATFORM conversations' },
          { status: 409 },
        );
      }
      await env.DB.prepare(
        `UPDATE conversations
       SET off_platform_outcome = ?
       WHERE user_id = ? AND id = ?`,
      )
        .bind(outcome, userId, conversationId)
        .run();
      const updated = await recomputeConversationState(
        env,
        userId,
        conversationId,
      );
      await notifyInboxEvent(env, {
        userId,
        conversationId,
        type: 'conversation_updated',
        payload: { outcome },
      });
      return json({ ok: true, inference: updated });
    },
  );

  addRoute(
    'POST',
    '/api/inbox/conversations/:id/recompute',
    async (req, env, _ctx, params) => {
      const conversationId = params.id;
      if (!conversationId) {
        return json({ error: 'Missing conversation id' }, { status: 400 });
      }
      const userId = await requireUser(req, env);
      if (!userId) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (!(await isFollowupInboxEnabledForUser(env, userId))) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      const result = await recomputeConversationState(
        env,
        userId,
        conversationId,
      );
      if (!result) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      await notifyInboxEvent(env, {
        userId,
        conversationId,
        type: 'conversation_updated',
        payload: { recomputed: true },
      });
      return json({ ok: true, inference: result });
    },
  );

  addRoute(
    'GET',
    '/api/inbox/conversations/:id/tags',
    async (req, env, _ctx, params) => {
      const conversationId = params.id;
      const userId = await requireUser(req, env);
      if (!userId) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (!(await isFollowupInboxEnabledForUser(env, userId))) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      if (!conversationId) {
        return json({ error: 'Missing conversation id' }, { status: 400 });
      }
      const tags = await listConversationTags(env, userId, [conversationId]);
      return json({ tags: tags.get(conversationId) ?? [] });
    },
  );

  addRoute(
    'POST',
    '/api/inbox/conversations/:id/tags',
    async (req, env, _ctx, params) => {
      const conversationId = params.id;
      const userId = await requireUser(req, env);
      if (!userId) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (!(await isFollowupInboxEnabledForUser(env, userId))) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      if (!conversationId) {
        return json({ error: 'Missing conversation id' }, { status: 400 });
      }
      const body = await readJson<{ tags?: string[] }>(req);
      const tags = (body?.tags ?? []).map(normalizeTag).filter(Boolean);
      if (!tags.length) {
        return json({ error: 'Tags required' }, { status: 400 });
      }
      const now = new Date().toISOString();
      const statements = tags.map((tag) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO conversation_tags
         (user_id, conversation_id, tag, created_at)
         VALUES (?, ?, ?, ?)`,
        ).bind(userId, conversationId, tag, now),
      );
      if (statements.length) {
        await env.DB.batch(statements);
      }
      await recomputeConversationState(env, userId, conversationId);
      await notifyInboxEvent(env, {
        userId,
        conversationId,
        type: 'tags_updated',
      });
      const updated = await listConversationTags(env, userId, [conversationId]);
      return json({ tags: updated.get(conversationId) ?? [] });
    },
  );

  addRoute(
    'DELETE',
    '/api/inbox/conversations/:id/tags/:tag',
    async (req, env, _ctx, params) => {
      const conversationId = params.id;
      const userId = await requireUser(req, env);
      if (!userId) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (!(await isFollowupInboxEnabledForUser(env, userId))) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      if (!conversationId || !params.tag) {
        return json({ error: 'Missing tag' }, { status: 400 });
      }
      const tag = normalizeTag(decodeURIComponent(params.tag));
      await env.DB.prepare(
        `DELETE FROM conversation_tags
       WHERE user_id = ? AND conversation_id = ? AND tag = ?`,
      )
        .bind(userId, conversationId, tag)
        .run();
      await recomputeConversationState(env, userId, conversationId);
      await notifyInboxEvent(env, {
        userId,
        conversationId,
        type: 'tags_updated',
      });
      const updated = await listConversationTags(env, userId, [conversationId]);
      return json({ tags: updated.get(conversationId) ?? [] });
    },
  );

  addRoute('GET', '/api/inbox/templates', async (req, env) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isFollowupInboxEnabledForUser(env, userId))) {
      return json({ error: 'Not found' }, { status: 404 });
    }
    const query = `SELECT id, title, body, created_at as createdAt, updated_at as updatedAt
               FROM saved_responses
               WHERE user_id = ?
               ORDER BY updated_at DESC`;
    const rows = await env.DB.prepare(query).bind(userId).all<{
      id: string;
      title: string;
      body: string;
      createdAt: string;
      updatedAt: string;
    }>();
    return json({ templates: rows.results ?? [] });
  });

  addRoute('POST', '/api/inbox/templates', async (req, env) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isFollowupInboxEnabledForUser(env, userId))) {
      return json({ error: 'Not found' }, { status: 404 });
    }
    const body = await readJson<{
      title?: string;
      body?: string;
    }>(req);
    const title = body?.title?.trim();
    const text = body?.body?.trim();
    if (!title || !text) {
      return json({ error: 'Title and body required' }, { status: 400 });
    }
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO saved_responses
     (id, user_id, asset_id, title, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, userId, null, title, text, now, now)
      .run();
    return json({ id, title, body: text });
  });

  addRoute(
    'PUT',
    '/api/inbox/templates/:id',
    async (req, env, _ctx, params) => {
      const userId = await requireUser(req, env);
      if (!userId) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (!(await isFollowupInboxEnabledForUser(env, userId))) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      const templateId = params.id;
      if (!templateId) {
        return json({ error: 'Missing template id' }, { status: 400 });
      }
      const body = await readJson<{
        title?: string;
        body?: string;
      }>(req);
      const title = body?.title?.trim();
      const text = body?.body?.trim();
      if (!title || !text) {
        return json({ error: 'Title and body required' }, { status: 400 });
      }
      const now = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE saved_responses
     SET title = ?, body = ?, asset_id = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
      )
        .bind(title, text, null, now, templateId, userId)
        .run();
      return json({
        id: templateId,
        title,
        body: text,
      });
    },
  );

  addRoute(
    'DELETE',
    '/api/inbox/templates/:id',
    async (req, env, _ctx, params) => {
      const userId = await requireUser(req, env);
      if (!userId) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (!(await isFollowupInboxEnabledForUser(env, userId))) {
        return json({ error: 'Not found' }, { status: 404 });
      }
      const templateId = params.id;
      if (!templateId) {
        return json({ error: 'Missing template id' }, { status: 400 });
      }
      await env.DB.prepare(
        'DELETE FROM saved_responses WHERE id = ? AND user_id = ?',
      )
        .bind(templateId, userId)
        .run();
      return json({ ok: true });
    },
  );

  addRoute('POST', '/api/inbox/bulk', async (req, env) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isFollowupInboxEnabledForUser(env, userId))) {
      return json({ error: 'Not found' }, { status: 404 });
    }
    const body = await readJson<{
      conversationIds?: string[];
      action?: 'tag' | 'close' | 'send_template';
      tags?: string[];
      templateId?: string;
    }>(req);
    const conversationIds = (body?.conversationIds ?? []).filter(Boolean);
    if (!conversationIds.length || !body?.action) {
      return json({ error: 'Invalid bulk request' }, { status: 400 });
    }
    const placeholders = conversationIds.map(() => '?').join(',');
    const conversations = await env.DB.prepare(
      `SELECT id, page_id as pageId, ig_business_id as igBusinessId, asset_id as assetId, platform
     FROM conversations
     WHERE user_id = ? AND id IN (${placeholders})`,
    )
      .bind(userId, ...conversationIds)
      .all<{
        id: string;
        pageId: string;
        igBusinessId: string | null;
        assetId: string | null;
        platform: string;
      }>();
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    const now = new Date().toISOString();
    if (body.action === 'tag') {
      const tags = (body.tags ?? []).map(normalizeTag).filter(Boolean);
      if (!tags.length) {
        return json({ error: 'Tags required' }, { status: 400 });
      }
      for (const convo of conversations.results ?? []) {
        const statements = tags.map((tag) =>
          env.DB.prepare(
            `INSERT OR IGNORE INTO conversation_tags
           (user_id, conversation_id, tag, created_at)
           VALUES (?, ?, ?, ?)`,
          ).bind(userId, convo.id, tag, now),
        );
        if (statements.length) {
          await env.DB.batch(statements);
        }
        await recomputeConversationState(env, userId, convo.id);
        await notifyInboxEvent(env, {
          userId,
          conversationId: convo.id,
          type: 'tags_updated',
        });
        results.push({ id: convo.id, ok: true });
      }
      return json({ results });
    }
    if (body.action === 'close') {
      for (const convo of conversations.results ?? []) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO conversation_tags
         (user_id, conversation_id, tag, created_at)
         VALUES (?, ?, 'closed', ?)`,
        )
          .bind(userId, convo.id, now)
          .run();
        await recomputeConversationState(env, userId, convo.id);
        await notifyInboxEvent(env, {
          userId,
          conversationId: convo.id,
          type: 'tags_updated',
        });
        results.push({ id: convo.id, ok: true });
      }
      return json({ results });
    }
    if (body.action === 'send_template') {
      if (!body.templateId) {
        return json({ error: 'Template required' }, { status: 400 });
      }
      const template = await env.DB.prepare(
        `SELECT id, title, body, asset_id as assetId
       FROM saved_responses
       WHERE id = ? AND user_id = ?`,
      )
        .bind(body.templateId, userId)
        .first<{ id: string; body: string; assetId: string | null }>();
      if (!template) {
        return json({ error: 'Template not found' }, { status: 404 });
      }
      for (const convo of conversations.results ?? []) {
        try {
          const conversation = await getConversation(env, userId, convo.id);
          if (!conversation) {
            results.push({ id: convo.id, ok: false, error: 'Not found' });
            continue;
          }
          const page = await getPage(env, userId, conversation.pageId);
          if (!page) {
            results.push({
              id: convo.id,
              ok: false,
              error: 'Page not connected',
            });
            continue;
          }
          const recipientId =
            conversation.participantId ??
            (
              await env.DB.prepare(
                `SELECT sender_id as senderId
             FROM messages
             WHERE user_id = ? AND conversation_id = ? AND direction = 'inbound'
             ORDER BY created_time DESC
             LIMIT 1`,
              )
                .bind(userId, convo.id)
                .first<{ senderId: string | null }>()
            )?.senderId ??
            null;
          if (!recipientId) {
            results.push({
              id: convo.id,
              ok: false,
              error: 'Missing recipient',
            });
            continue;
          }
          const payload = {
            recipient: { id: recipientId },
            message: { text: template.body },
            messaging_type: 'RESPONSE',
          };
          const result = await sendMessage({
            env,
            accessToken: page.access_token,
            version: getApiVersion(env),
            payload,
            workspaceId: userId,
            assetId: conversation.assetId ?? conversation.pageId,
          });
          const sentAt = new Date().toISOString();
          const messageId = result.message_id ?? crypto.randomUUID();
          const annotated = annotateMessage({
            id: messageId,
            direction: 'outbound',
            text: template.body,
            createdAt: sentAt,
          });
          await env.DB.prepare(
            `INSERT OR IGNORE INTO messages
           (user_id, id, conversation_id, page_id, sender_type, body, created_time,
            asset_id, platform, ig_business_id, direction, sender_id, sender_name,
            attachments, raw, meta_message_id, features_json, rule_hits_json,
            message_type, message_trigger)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              userId,
              messageId,
              convo.id,
              conversation.pageId,
              'business',
              template.body,
              sentAt,
              conversation.assetId ?? conversation.pageId,
              conversation.platform,
              conversation.igBusinessId ?? null,
              'outbound',
              conversation.assetId ?? conversation.pageId,
              page.name ?? 'Business',
              null,
              null,
              result.message_id ?? null,
              JSON.stringify(annotated.features),
              JSON.stringify(annotated.ruleHits),
              null,
              null,
            )
            .run();
          await recomputeFollowupEventsForConversation(env, {
            userId,
            conversationId: convo.id,
          });
          await recomputeConversationState(env, userId, convo.id);
          await notifyInboxEvent(env, {
            userId,
            conversationId: convo.id,
            type: 'message_sent',
            payload: { createdAt: sentAt },
          });
          results.push({ id: convo.id, ok: true });
          await sleepMs(400);
        } catch (error) {
          const failure = classifyDeliveryFailure(error);
          await markConversationDeliveryFailure(env, {
            conversationId: convo.id,
            userId,
            blocked: failure.blocked,
            bounced: failure.bounced,
          });
          if (failure.blocked || failure.bounced) {
            await recomputeConversationState(env, userId, convo.id);
          }
          const message =
            error instanceof MetaApiError
              ? `Meta API error: ${error.message}`
              : error instanceof Error
                ? error.message
                : 'Failed to send';
          results.push({ id: convo.id, ok: false, error: message });
          if (error instanceof MetaApiError && error.status === 429) {
            await sleepMs(1500);
          }
        }
      }
      return json({ results });
    }

    return json({ error: 'Unsupported action' }, { status: 400 });
  });

  addRoute('GET', '/api/meta/webhook', async (req, env) => {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (
      mode === 'subscribe' &&
      token &&
      env.META_WEBHOOK_VERIFY_TOKEN &&
      token === env.META_WEBHOOK_VERIFY_TOKEN
    ) {
      return new Response(challenge ?? '', { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  });

  addRoute('POST', '/api/meta/webhook', async (req, env) => {
    const body = await readJson<{
      object?: string;
      entry?: Array<{ id?: string; messaging?: unknown[]; time?: number }>;
    }>(req);
    if (!body?.entry?.length) {
      return new Response('No content', { status: 204 });
    }

    for (const entry of body.entry ?? []) {
      const entryId = entry.id;
      if (!entryId) continue;

      const pageMatch = await env.DB.prepare(
        'SELECT user_id as userId FROM meta_pages WHERE id = ?',
      )
        .bind(entryId)
        .first<{ userId: string }>();
      if (pageMatch?.userId) {
        await callSyncScopeOrchestrator(
          env,
          {
            userId: pageMatch.userId,
            pageId: entryId,
            platform: 'messenger',
            igBusinessId: null,
          },
          'webhook',
        );
        continue;
      }

      const igMatch = await env.DB.prepare(
        'SELECT user_id as userId, page_id as pageId FROM ig_assets WHERE id = ?',
      )
        .bind(entryId)
        .first<{ userId: string; pageId: string }>();
      if (igMatch?.userId) {
        await callSyncScopeOrchestrator(
          env,
          {
            userId: igMatch.userId,
            pageId: igMatch.pageId,
            platform: 'instagram',
            igBusinessId: entryId,
          },
          'webhook',
        );
      }
    }

    return new Response('ok', { status: 200 });
  });

  addRoute('GET', '/api/ops/summary', async (_req, env) => {
    const counters = await env.DB.prepare(
      'SELECT key, value, updated_at as updatedAt FROM ops_counters',
    ).all<{ key: string; value: number; updatedAt: string }>();
    const map = new Map((counters.results ?? []).map((row) => [row.key, row]));
    const updatedAt = (counters.results ?? []).reduce<string | null>(
      (latest, row) => {
        if (!latest) {
          return row.updatedAt ?? null;
        }
        return row.updatedAt && row.updatedAt > latest ? row.updatedAt : latest;
      },
      null,
    );
    return json({
      usersTotal: map.get('users_total')?.value ?? 0,
      assetsTotal: map.get('assets_total')?.value ?? 0,
      conversationsTotal: map.get('conversations_total')?.value ?? 0,
      messagesTotal: map.get('messages_total')?.value ?? 0,
      updatedAt,
    });
  });

  addRoute('GET', '/api/ops/users', async (req, env) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const limit = Math.min(
      100,
      Math.max(5, Number(url.searchParams.get('limit') ?? 50)),
    );
    const rows = await env.DB.prepare(
      `SELECT u.id as userId,
              u.feature_flags as featureFlags,
              group_concat(DISTINCT mp.name) as pageNames,
              group_concat(DISTINCT ig.name) as igAssetNames
       FROM meta_users u
       LEFT JOIN meta_pages mp ON mp.user_id = u.id
       LEFT JOIN ig_assets ig ON ig.user_id = u.id
       GROUP BY u.id
       ORDER BY COALESCE(u.updated_at, u.created_at) DESC
       LIMIT ?`,
    )
      .bind(limit)
      .all<{
        userId: string;
        featureFlags: string | null;
        pageNames: string | null;
        igAssetNames: string | null;
      }>();
    const parseNames = (value: string | null) =>
      (value ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
    const users =
      rows.results?.map((row) => {
        let flags: Record<string, unknown> = {};
        if (row.featureFlags) {
          try {
            const parsed = JSON.parse(row.featureFlags) as Record<
              string,
              unknown
            >;
            if (parsed && typeof parsed === 'object') {
              flags = parsed;
            }
          } catch {
            flags = {};
          }
        }
        return {
          userId: row.userId,
          featureFlags: flags,
          assets: {
            pages: parseNames(row.pageNames),
            igAssets: parseNames(row.igAssetNames),
          },
        };
      }) ?? [];
    return json({ users });
  });

  addRoute('POST', '/api/ops/audit/export-and-clear', async (req, env) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const audits = await env.DB.prepare(
      `SELECT id, asset_id as assetId, conversation_id as conversationId,
              contact_id as contactId, computed_label as computedLabel,
              reason_codes as reasonCodes, feature_snapshot as featureSnapshot,
              computed_at as computedAt, classifier_version as classifierVersion
       FROM conversation_classification_audit
       ORDER BY computed_at ASC`,
    ).all<{
      id: string;
      assetId: string;
      conversationId: string;
      contactId: string | null;
      computedLabel: string;
      reasonCodes: string;
      featureSnapshot: string;
      computedAt: number;
      classifierVersion: string | null;
    }>();

    const feedback = await env.DB.prepare(
      `SELECT id, asset_id as assetId, conversation_id as conversationId,
              contact_id as contactId, audit_id as auditId,
              current_label as currentLabel, correct_label as correctLabel,
              is_correct as isCorrect, notes, created_at as createdAt,
              followup_is_correct as followupIsCorrect,
              followup_correct_due_at as followupCorrectDueAt,
              followup_notes as followupNotes
       FROM conversation_classification_feedback
       ORDER BY created_at ASC`,
    ).all<{
      id: string;
      assetId: string;
      conversationId: string;
      contactId: string | null;
      auditId: string | null;
      currentLabel: string;
      correctLabel: string;
      isCorrect: number;
      notes: string | null;
      createdAt: number;
      followupIsCorrect: number | null;
      followupCorrectDueAt: number | null;
      followupNotes: string | null;
    }>();

    const nowIso = new Date().toISOString();
    const auditRows = audits.results ?? [];
    const feedbackRows = feedback.results ?? [];
    const payload = {
      exportedAt: nowIso,
      counts: {
        audit: auditRows.length,
        feedback: feedbackRows.length,
      },
      audit: auditRows,
      feedback: feedbackRows,
    };
    const fileBody = JSON.stringify(payload, null, 2);

    if (auditRows.length > 0 || feedbackRows.length > 0) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM conversation_classification_feedback'),
        env.DB.prepare('DELETE FROM conversation_classification_audit'),
      ]);
    }

    const safeStamp = nowIso.replace(/[:.]/g, '-');
    const filename = `msgstats-audit-export-${safeStamp}.json`;
    const headers = new Headers();
    headers.set('content-type', 'application/json');
    headers.set('cache-control', 'no-store');
    headers.set('content-disposition', `attachment; filename="${filename}"`);
    return new Response(fileBody, {
      status: 200,
      headers,
    });
  });

  addRoute(
    'POST',
    '/api/ops/users/:id/feature-flags',
    async (req, env, _ctx, params) => {
      const userId = await requireUser(req, env);
      if (!userId) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
      const targetUserId = params.id;
      if (!targetUserId) {
        return json({ error: 'Missing user id' }, { status: 400 });
      }
      const body = await readJson<{
        flag?: string;
        value?: unknown;
      }>(req);
      const flag = body?.flag?.trim();
      if (!flag) {
        return json({ error: 'Missing flag' }, { status: 400 });
      }
      const existing = await env.DB.prepare(
        'SELECT feature_flags as featureFlags FROM meta_users WHERE id = ?',
      )
        .bind(targetUserId)
        .first<{ featureFlags: string | null }>();
      let flags: Record<string, unknown> = {};
      if (existing?.featureFlags) {
        try {
          const parsed = JSON.parse(existing.featureFlags) as Record<
            string,
            unknown
          >;
          if (parsed && typeof parsed === 'object') {
            flags = { ...parsed };
          }
        } catch {
          flags = {};
        }
      }
      if (body?.value === null) {
        delete flags[flag];
      } else {
        flags[flag] = body?.value;
      }
      const nextFlags =
        Object.keys(flags).length > 0 ? JSON.stringify(flags) : null;
      const now = new Date().toISOString();
      await env.DB.prepare(
        'UPDATE meta_users SET feature_flags = ?, updated_at = ? WHERE id = ?',
      )
        .bind(nextFlags, now, targetUserId)
        .run();
      return json({ userId: targetUserId, featureFlags: flags });
    },
  );

  addRoute(
    'POST',
    '/api/ops/users/:id/backfill-participants',
    async (req, env, _ctx, params) => {
      const userId = await requireUser(req, env);
      if (!userId) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
      const targetUserId = params.id;
      if (!targetUserId) {
        return json({ error: 'Missing user id' }, { status: 400 });
      }
      const body = await readJson<{ limit?: number }>(req);
      const limitRaw =
        typeof body?.limit === 'number' && Number.isFinite(body.limit)
          ? body.limit
          : 200;
      const limit = Math.max(1, Math.min(500, Math.floor(limitRaw)));

      const conversations = await env.DB.prepare(
        `SELECT id, page_id as pageId
         FROM conversations
         WHERE user_id = ?
           AND platform = 'messenger'
           AND needs_followup = 1
           AND participant_id IS NULL
         ORDER BY last_message_at DESC
         LIMIT ?`,
      )
        .bind(targetUserId, limit)
        .all<{ id: string; pageId: string }>();

      const rows = conversations.results ?? [];
      const pageTokenByPageId = new Map<string, string | null>();
      let scanned = 0;
      let updated = 0;
      let skippedNoToken = 0;
      let skippedNoParticipant = 0;
      let failed = 0;

      for (const row of rows) {
        scanned += 1;
        let pageToken = pageTokenByPageId.get(row.pageId);
        if (pageToken === undefined) {
          const page = await getPage(env, targetUserId, row.pageId);
          pageToken =
            (page as { access_token?: string } | null)?.access_token ?? null;
          pageTokenByPageId.set(row.pageId, pageToken);
        }
        if (!pageToken) {
          skippedNoToken += 1;
          continue;
        }

        try {
          const messages = (await fetchConversationMessages({
            env,
            conversationId: row.id,
            accessToken: pageToken,
            version: getApiVersion(env),
            workspaceId: targetUserId,
            assetId: row.pageId,
          })) as Array<{
            from?: { id?: string; name?: string };
            created_time?: string;
          }>;

          const customerCandidate = messages
            .filter((message) => {
              const senderId = message.from?.id ?? null;
              return Boolean(senderId && senderId !== row.pageId);
            })
            .sort((a, b) => {
              const aMs = Date.parse(a.created_time ?? '');
              const bMs = Date.parse(b.created_time ?? '');
              return (
                (Number.isNaN(bMs) ? 0 : bMs) - (Number.isNaN(aMs) ? 0 : aMs)
              );
            })[0];

          const participantId = customerCandidate?.from?.id ?? null;
          const participantName = customerCandidate?.from?.name ?? null;

          if (!participantId) {
            skippedNoParticipant += 1;
            continue;
          }

          const result = await env.DB.prepare(
            `UPDATE conversations
             SET participant_id = ?,
                 participant_name = COALESCE(participant_name, ?)
             WHERE user_id = ? AND id = ? AND participant_id IS NULL`,
          )
            .bind(participantId, participantName ?? null, targetUserId, row.id)
            .run();
          updated += result.meta?.changes ?? 0;
        } catch (error) {
          failed += 1;
          console.warn('Participant backfill failed for conversation', {
            targetUserId,
            conversationId: row.id,
            pageId: row.pageId,
            error: error instanceof Error ? error.message : error,
          });
        }
      }

      if (updated > 0) {
        await env.SYNC_QUEUE.send({
          kind: 'recompute_inbox',
          userId: targetUserId,
          forceLabelSync: true,
        });
      }

      return json({
        ok: true,
        userId: targetUserId,
        scanned,
        updated,
        skippedNoToken,
        skippedNoParticipant,
        failed,
        queuedRecompute: updated > 0,
      });
    },
  );

  addRoute('GET', '/api/ops/sync-runs', async (req, env) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const limit = Math.min(
      50,
      Math.max(5, Number(url.searchParams.get('limit') ?? 20)),
    );
    let query = `SELECT id,
            user_id as userId,
            page_id as pageId,
            platform,
            ig_business_id as igBusinessId,
            status,
            started_at as startedAt,
            finished_at as finishedAt,
            last_error as lastError
     FROM sync_runs
     WHERE 1=1`;
    const bindings: unknown[] = [];
    if (status) {
      if (status === 'active') {
        query += " AND status IN ('queued','running')";
      } else {
        query += ' AND status = ?';
        bindings.push(status);
      }
    }
    query += ' ORDER BY started_at DESC LIMIT ?';
    bindings.push(limit);
    const rows = await env.DB.prepare(query)
      .bind(...bindings)
      .all<{
        id: string;
        userId: string;
        pageId: string;
        platform: string;
        igBusinessId: string | null;
        status: string;
        startedAt: string;
        finishedAt: string | null;
        lastError: string | null;
      }>();
    return json({ runs: rows.results ?? [] });
  });

  addRoute('GET', '/api/ops/ai/runs', async (req, env) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const limit = Math.min(
      50,
      Math.max(5, Number(url.searchParams.get('limit') ?? 20)),
    );
    const rows = await env.DB.prepare(
      `SELECT id,
              user_id as userId,
              page_id as pageId,
              platform,
              ig_business_id as igBusinessId,
              status,
              started_at as startedAt,
              finished_at as finishedAt,
              ai_stats_json as aiStatsJson
       FROM sync_runs
       WHERE ai_stats_json IS NOT NULL
       ORDER BY started_at DESC
       LIMIT ?`,
    )
      .bind(limit)
      .all<{
        id: string;
        userId: string;
        pageId: string;
        platform: string;
        igBusinessId: string | null;
        status: string;
        startedAt: string;
        finishedAt: string | null;
        aiStatsJson: string | null;
      }>();
    const runs = (rows.results ?? []).map((row) => {
      let stats: AiRunStats | null = null;
      try {
        stats = row.aiStatsJson
          ? (JSON.parse(row.aiStatsJson) as AiRunStats)
          : null;
      } catch {
        stats = null;
      }
      const durationMs =
        row.finishedAt && row.startedAt
          ? Date.parse(row.finishedAt) - Date.parse(row.startedAt)
          : null;
      return {
        id: row.id,
        userId: row.userId,
        pageId: row.pageId,
        platform: row.platform,
        igBusinessId: row.igBusinessId,
        status: row.status,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        durationMs: Number.isFinite(durationMs ?? NaN) ? durationMs : null,
        stats: stats ? summarizeAiRunStats(stats) : null,
      };
    });
    return json({ runs });
  });

  addRoute('GET', '/api/ops/ai/runs/:runId', async (req, env, _ctx, params) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const runId = params.runId;
    if (!runId) {
      return json({ error: 'Missing run id' }, { status: 400 });
    }
    const row = await env.DB.prepare(
      `SELECT id,
              user_id as userId,
              page_id as pageId,
              platform,
              ig_business_id as igBusinessId,
              status,
              started_at as startedAt,
              finished_at as finishedAt,
              ai_stats_json as aiStatsJson,
              ai_config_json as aiConfigJson
       FROM sync_runs
       WHERE id = ?`,
    )
      .bind(runId)
      .first<{
        id: string;
        userId: string;
        pageId: string;
        platform: string;
        igBusinessId: string | null;
        status: string;
        startedAt: string;
        finishedAt: string | null;
        aiStatsJson: string | null;
        aiConfigJson: string | null;
      }>();
    if (!row) {
      return json({ error: 'Not found' }, { status: 404 });
    }
    let aiStats: AiRunStats | null = null;
    let aiConfig: Record<string, unknown> | null = null;
    try {
      aiStats = row.aiStatsJson
        ? (JSON.parse(row.aiStatsJson) as AiRunStats)
        : null;
    } catch {
      aiStats = null;
    }
    try {
      aiConfig = row.aiConfigJson
        ? (JSON.parse(row.aiConfigJson) as Record<string, unknown>)
        : null;
    } catch {
      aiConfig = null;
    }
    const durationMs =
      row.finishedAt && row.startedAt
        ? Date.parse(row.finishedAt) - Date.parse(row.startedAt)
        : null;
    return json({
      run: {
        id: row.id,
        userId: row.userId,
        pageId: row.pageId,
        platform: row.platform,
        igBusinessId: row.igBusinessId,
        status: row.status,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        durationMs: Number.isFinite(durationMs ?? NaN) ? durationMs : null,
        aiStats,
        aiConfig,
      },
    });
  });

  addRoute(
    'POST',
    '/api/ops/sync-runs/:id/cancel',
    async (req, env, _ctx, params) => {
      const userId = await requireUser(req, env);
      if (!userId) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
      const runId = params.id;
      if (!runId) {
        return json({ error: 'Missing run id' }, { status: 400 });
      }
      const now = new Date().toISOString();
      const result = await env.DB.prepare(
        `UPDATE sync_runs
       SET status = 'failed',
           finished_at = ?,
           last_error = 'cancelled',
           updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running')`,
      )
        .bind(now, now, runId)
        .run();
      if ((result.meta?.changes ?? 0) < 1) {
        return json({ ok: false, error: 'Not running' }, { status: 409 });
      }
      return json({ ok: true });
    },
  );

  addRoute('GET', '/api/ops/messages-per-hour', async (req, env) => {
    const url = new URL(req.url);
    const rawHours = url.searchParams.get('hours');
    const parsed = rawHours ? Number.parseInt(rawHours, 10) : Number.NaN;
    const clamped = Number.isFinite(parsed) ? parsed : 168;
    const hours = Math.max(24, Math.min(720, clamped));

    const now = new Date();
    const endHourIso = toHourBucket(now);
    const endMs = Date.parse(endHourIso);
    const startMs = endMs - (hours - 1) * 60 * 60 * 1000;
    const startIso = new Date(startMs).toISOString();

    const rows = await env.DB.prepare(
      `SELECT hour, count
     FROM ops_messages_hourly
     WHERE hour >= ? AND hour <= ?
     ORDER BY hour ASC`,
    )
      .bind(startIso, endHourIso)
      .all<{ hour: string; count: number }>();
    const countsByHour = new Map(
      (rows.results ?? []).map((row) => [row.hour, row.count]),
    );

    const points = Array.from({ length: hours }, (_, index) => {
      const hour = new Date(startMs + index * 60 * 60 * 1000).toISOString();
      return { hour, count: countsByHour.get(hour) ?? 0 };
    });

    return json({ hours, points });
  });

  addRoute('GET', '/api/ops/followup/series', async (req, env) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isOpsDashboardEnabledForUser(env, userId))) {
      return json({ error: 'Not found' }, { status: 404 });
    }
    const url = new URL(req.url);
    const range = url.searchParams.get('range');
    const bucket = url.searchParams.get('bucket');
    const targetUserId = url.searchParams.get('userId')?.trim() || null;

    const series = await getFollowupSeries(env, {
      userId: targetUserId,
      range,
      bucket,
    });
    return json(series);
  });

  addRoute('POST', '/api/ops/followup/backfill', async (req, env) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isOpsDashboardEnabledForUser(env, userId))) {
      return json({ error: 'Not found' }, { status: 404 });
    }
    const body = await readJson<{ userId?: string; limit?: number }>(req);
    const targetUserId = body?.userId?.trim();
    if (!targetUserId) {
      return json({ error: 'Missing userId' }, { status: 400 });
    }
    const result = await backfillFollowupEventsForUser(env, {
      userId: targetUserId,
      limit: body?.limit,
    });
    return json({ ok: true, ...result, userId: targetUserId });
  });

  addRoute('POST', '/api/ops/followup/repair-loss', async (req, env) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isOpsDashboardEnabledForUser(env, userId))) {
      return json({ error: 'Not found' }, { status: 404 });
    }
    const body = await readJson<{ userId?: string; limit?: number }>(req);
    const result = await repairFollowupEventLossFlags(env, {
      userId: body?.userId?.trim() || null,
      limit: body?.limit,
    });
    return json({ ok: true, ...result });
  });

  addRoute('GET', '/api/ops/metrics/meta', async (req, env, ctx) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const parsed = parseMetricsWindow(url.searchParams.get('window'), '15m');
    if (!parsed) {
      return json({ error: 'Invalid window' }, { status: 400 });
    }
    const cacheKey = `https://cache.msgstats/ops/meta?window=${parsed}`;
    return cachedJson(req, ctx, cacheKey, 45, async () => {
      try {
        const metrics = await getMetaMetrics(env, parsed);
        return json({ window: parsed, ...metrics });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Failed to load meta metrics', message);
        return json(
          { error: 'Failed to load metrics', detail: message },
          { status: 500 },
        );
      }
    });
  });

  addRoute('GET', '/api/ops/metrics/errors', async (req, env, ctx) => {
    const userId = await requireUser(req, env);
    if (!userId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const parsed = parseMetricsWindow(url.searchParams.get('window'), '60m');
    if (!parsed) {
      return json({ error: 'Invalid window' }, { status: 400 });
    }
    const cacheKey = `https://cache.msgstats/ops/errors?window=${parsed}`;
    return cachedJson(req, ctx, cacheKey, 45, async () => {
      try {
        const metrics = await getAppErrorMetrics(env, parsed);
        return json({ window: parsed, ...metrics });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Failed to load error metrics', message);
        return json(
          { error: 'Failed to load metrics', detail: message },
          { status: 500 },
        );
      }
    });
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
}
