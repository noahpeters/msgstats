import { metaFetch } from './observability/metaFetch';

type GraphError = {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
};

type GraphResponse<T> = {
  data: T;
  paging?: {
    cursors?: { after?: string };
    next?: string;
  };
  error?: GraphError;
};

type RetryOptions = {
  retries: number;
  minDelayMs: number;
  maxDelayMs: number;
};

const defaultRetry: RetryOptions = {
  retries: 4,
  minDelayMs: 400,
  maxDelayMs: 4000,
};

type MetaUsage = Record<string, string>;

export type MetaEnv = {
  AE_META_CALLS: AnalyticsEngineDataset;
};

type MetaTelemetry = {
  env: MetaEnv;
  op: string;
  route: string;
  method?: string;
  workspaceId?: string | null;
  assetId?: string | null;
};

type MetaCallContext = {
  telemetry?: MetaTelemetry;
};

export class MetaApiError extends Error {
  status: number;
  meta?: unknown;
  usage?: MetaUsage;
  constructor(
    message: string,
    opts: { status: number; meta?: unknown; usage?: MetaUsage },
  ) {
    super(message);
    this.name = 'MetaApiError';
    this.status = opts.status;
    this.meta = opts.meta;
    this.usage = opts.usage;
  }
}

export const metaConfig = {
  baseUrl: 'https://graph.facebook.com',
  version: 'v19.0',
  endpoints: {
    oauthAccessToken: '/oauth/access_token',
    debugToken: '/debug_token',
    mePermissions: '/me/permissions',
    meBusinesses: '/me/businesses',
    meAccounts: '/me/accounts',
    meDetails: '/me',
    businessOwnedPages: (businessId: string) => `/${businessId}/owned_pages`,
    businessClientPages: (businessId: string) => `/${businessId}/client_pages`,
    pageDetails: (pageId: string) => `/${pageId}`,
    conversations: (pageId: string) => `/${pageId}/conversations`,
    conversationDetails: (conversationId: string) => `/${conversationId}`,
    conversationMessages: (conversationId: string) =>
      `/${conversationId}/messages`,
    igAccounts: (pageId: string) => `/${pageId}/instagram_accounts`,
    sendMessage: '/me/messages',
  },
  fields: {
    permissions: ['permission', 'status'],
    businesses: ['id', 'name'],
    pages: ['id', 'name'],
    pageWithToken: ['id', 'name', 'access_token'],
    me: ['id', 'name'],
    conversations: ['id', 'updated_time'],
    messages: ['id', 'from', 'to', 'created_time', 'message', 'attachments'],
    igAccounts: ['id', 'name'],
  },
};

const metaRouteLabels = {
  oauthAccessToken: '/oauth/access_token',
  debugToken: '/debug_token',
  mePermissions: '/me/permissions',
  meBusinesses: '/me/businesses',
  meAccounts: '/me/accounts',
  meDetails: '/me',
  businessOwnedPages: '/:businessId/owned_pages',
  businessClientPages: '/:businessId/client_pages',
  pageDetails: '/:pageId',
  conversations: '/:pageId/conversations',
  conversationDetails: '/:conversationId',
  conversationMessages: '/:conversationId/messages',
  igAccounts: '/:pageId/instagram_accounts',
  sendMessage: '/me/messages',
};

async function fetchWithTelemetry(
  url: string,
  init: RequestInit | undefined,
  context?: MetaCallContext,
): Promise<Response> {
  if (!context?.telemetry) {
    return fetch(url, init);
  }
  return metaFetch(context.telemetry.env, {
    op: context.telemetry.op,
    route: context.telemetry.route,
    method: context.telemetry.method,
    url,
    init,
    workspaceId: context.telemetry.workspaceId ?? undefined,
    assetId: context.telemetry.assetId ?? undefined,
  });
}

function buildTelemetry(options: {
  env: MetaEnv;
  op: string;
  route: string;
  method?: string;
  workspaceId?: string | null;
  assetId?: string | null;
}): MetaCallContext {
  return {
    telemetry: {
      env: options.env,
      op: options.op,
      route: options.route,
      method: options.method,
      workspaceId: options.workspaceId ?? null,
      assetId: options.assetId ?? null,
    },
  };
}

function withVersion(path: string, version: string) {
  return `${metaConfig.baseUrl}/${version}${path}`;
}

function redactURL(url: string) {
  return url.replace(
    /([&?])access_token=([^&]*)/g,
    '$1access_token=<redacted>',
  );
}

function buildUrl(
  path: string,
  version: string,
  params: Record<string, string>,
) {
  const url = new URL(withVersion(path, version));
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

function normalizeSince(value?: string) {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return Math.floor(parsed / 1000).toString();
  }
  return undefined;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logRateLimitUsage(response: Response, context: string) {
  const appUsage = response.headers.get('x-app-usage');
  const pageUsage = response.headers.get('x-page-usage');
  const businessUsage = response.headers.get('x-business-usage');
  if (!appUsage && !pageUsage && !businessUsage) {
    return;
  }
  console.warn('Meta rate limit usage', {
    context,
    status: response.status,
    appUsage,
    pageUsage,
    businessUsage,
  });
}

function pickUsage(headers: Headers): MetaUsage | undefined {
  const keys = [
    'x-app-usage',
    'x-page-usage',
    'x-business-use-case-usage',
    'retry-after',
  ];
  const usage: MetaUsage = {};
  for (const key of keys) {
    const value = headers.get(key);
    if (value) {
      usage[key] = value;
    }
  }
  return Object.keys(usage).length ? usage : undefined;
}

function parseJsonSafe<T>(input: string): { parsed?: T; raw: string } {
  try {
    return { parsed: JSON.parse(input) as T, raw: input };
  } catch {
    return { raw: input };
  }
}

function shouldRetryMetaError(status: number, error?: GraphError) {
  if (status >= 500 || status === 429) {
    return true;
  }
  if (error?.code === 4 || error?.code === 17) {
    return true;
  }
  return false;
}

async function fetchWithRetry(
  input: string,
  init?: RequestInit,
  retry: RetryOptions = defaultRetry,
  context?: MetaCallContext,
): Promise<Response> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= retry.retries) {
    try {
      console.info('Meta fetch request: %s', redactURL(input));
      const response = await fetchWithTelemetry(input, init, context);
      if (response.status >= 500 || response.status === 429) {
        throw new Error(`Transient error: ${response.status}`);
      }
      return response;
    } catch (err) {
      console.error('Meta API request failed', {
        url: input,
        method: init?.method ?? 'GET',
        attempt: attempt + 1,
        maxAttempts: retry.retries + 1,
        error: err instanceof Error ? err.message : err,
      });
      lastError = err;
      attempt += 1;
      if (attempt > retry.retries) {
        break;
      }
      const delay = Math.min(
        retry.maxDelayMs,
        retry.minDelayMs * 2 ** (attempt - 1),
      );
      await sleep(delay);
    }
  }
  throw lastError ?? new Error('Request failed');
}

async function fetchMetaJson<T>(
  url: string,
  init?: RequestInit,
  context?: MetaCallContext,
) {
  const response = await fetchWithTelemetry(url, init, context);
  const text = await response.text();
  const { parsed } = parseJsonSafe<T>(text);
  return { response, raw: text, parsed };
}

async function fetchForToken<T>(
  url: string,
  init?: RequestInit,
  context?: MetaCallContext,
) {
  let attempt = 0;
  let lastError: MetaApiError | undefined;
  while (attempt <= defaultRetry.retries) {
    try {
      const { response, parsed, raw } = await fetchMetaJson<T>(
        url,
        init,
        context,
      );
      if (response.ok) {
        if (parsed !== undefined) {
          return parsed;
        }
        throw new MetaApiError('Meta API error', {
          status: response.status,
          meta: raw,
          usage: pickUsage(response.headers),
        });
      }
      const usage = pickUsage(response.headers);
      logRateLimitUsage(response, 'fetchForToken');
      const meta = parsed ?? raw;
      const graphError = (parsed as GraphResponse<unknown> | undefined)?.error;
      if (
        attempt < defaultRetry.retries &&
        shouldRetryMetaError(response.status, graphError)
      ) {
        attempt += 1;
        const delay = Math.min(
          defaultRetry.maxDelayMs,
          defaultRetry.minDelayMs * 2 ** (attempt - 1),
        );
        await sleep(delay);
        continue;
      }
      throw new MetaApiError('Meta API error', {
        status: response.status,
        meta,
        usage,
      });
    } catch (error) {
      if (error instanceof MetaApiError) {
        lastError = error;
        break;
      }
      if (attempt >= defaultRetry.retries) {
        throw error;
      }
      attempt += 1;
      const delay = Math.min(
        defaultRetry.maxDelayMs,
        defaultRetry.minDelayMs * 2 ** (attempt - 1),
      );
      await sleep(delay);
    }
  }
  throw lastError ?? new MetaApiError('Meta API error', { status: 500 });
}

async function fetchGraph<T>(
  url: string,
  init?: RequestInit,
  context?: MetaCallContext,
) {
  let attempt = 0;
  let lastError: MetaApiError | undefined;
  while (attempt <= defaultRetry.retries) {
    try {
      const { response, parsed, raw } = await fetchMetaJson<GraphResponse<T>>(
        url,
        init,
        context,
      );
      const payload = parsed;
      if (response.ok && payload && !payload.error) {
        return payload;
      }
      const usage = pickUsage(response.headers);
      logRateLimitUsage(response, 'fetchGraph');
      const graphError = payload?.error;
      const meta = payload ?? raw;
      const status = response.status || (payload?.error ? 400 : 500);
      if (
        attempt < defaultRetry.retries &&
        shouldRetryMetaError(status, graphError)
      ) {
        attempt += 1;
        const delay = Math.min(
          defaultRetry.maxDelayMs,
          defaultRetry.minDelayMs * 2 ** (attempt - 1),
        );
        await sleep(delay);
        continue;
      }
      throw new MetaApiError(graphError?.message ?? 'Meta API error', {
        status,
        meta,
        usage,
      });
    } catch (error) {
      if (error instanceof MetaApiError) {
        lastError = error;
        break;
      }
      if (attempt >= defaultRetry.retries) {
        throw error;
      }
      attempt += 1;
      const delay = Math.min(
        defaultRetry.maxDelayMs,
        defaultRetry.minDelayMs * 2 ** (attempt - 1),
      );
      await sleep(delay);
    }
  }
  throw lastError ?? new MetaApiError('Meta API error', { status: 500 });
}

async function paginateList<T>(firstUrl: string, context?: MetaCallContext) {
  const results: T[] = [];
  let nextUrl: string | undefined = firstUrl;
  while (nextUrl) {
    const payload: GraphResponse<T[]> = await fetchGraph<T[]>(
      nextUrl,
      undefined,
      context,
    );
    results.push(...payload.data);
    nextUrl = payload.paging?.next;
  }
  return results;
}

export async function exchangeCodeForToken(options: {
  env: MetaEnv;
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
  version: string;
  workspaceId?: string | null;
}) {
  const url = buildUrl(metaConfig.endpoints.oauthAccessToken, options.version, {
    client_id: options.appId,
    client_secret: options.appSecret,
    redirect_uri: options.redirectUri,
    code: options.code,
  });
  const response = await fetchWithRetry(
    url,
    undefined,
    defaultRetry,
    buildTelemetry({
      env: options.env,
      op: 'meta.oauth_exchange',
      route: metaRouteLabels.oauthAccessToken,
      method: 'GET',
      workspaceId: options.workspaceId,
    }),
  );
  if (!response.ok) {
    logRateLimitUsage(response, 'exchangeCodeForToken');
    throw new Error('OAuth token request failed');
  }
  const payload = (await response.json()) as {
    access_token: string;
    token_type: string;
    expires_in?: number;
  };
  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type,
    expiresIn: payload.expires_in,
  };
}

export async function exchangeForLongLivedToken(options: {
  env: MetaEnv;
  appId: string;
  appSecret: string;
  accessToken: string;
  version: string;
  workspaceId?: string | null;
}) {
  const url = buildUrl(metaConfig.endpoints.oauthAccessToken, options.version, {
    client_id: options.appId,
    client_secret: options.appSecret,
    grant_type: 'fb_exchange_token',
    fb_exchange_token: options.accessToken,
  });
  const response = await fetchWithRetry(
    url,
    undefined,
    defaultRetry,
    buildTelemetry({
      env: options.env,
      op: 'meta.oauth_long_lived',
      route: metaRouteLabels.oauthAccessToken,
      method: 'GET',
      workspaceId: options.workspaceId,
    }),
  );
  if (!response.ok) {
    logRateLimitUsage(response, 'exchangeForLongLivedToken');
    throw new Error('Long-lived token request failed');
  }
  const payload = (await response.json()) as {
    access_token: string;
    token_type: string;
    expires_in?: number;
  };
  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type,
    expiresIn: payload.expires_in,
  };
}

export async function debugToken(options: {
  env: MetaEnv;
  inputToken: string;
  appToken: string;
  version: string;
  workspaceId?: string | null;
}) {
  const url = buildUrl(metaConfig.endpoints.debugToken, options.version, {
    input_token: options.inputToken,
    access_token: options.appToken,
  });
  const payload = await fetchGraph<{
    app_id?: string;
    user_id?: string;
    is_valid?: boolean;
    expires_at?: number;
    scopes?: string[];
  }>(
    url,
    undefined,
    buildTelemetry({
      env: options.env,
      op: 'meta.debug_token',
      route: metaRouteLabels.debugToken,
      method: 'GET',
      workspaceId: options.workspaceId,
    }),
  );
  return payload.data;
}

export async function fetchPermissions(options: {
  env: MetaEnv;
  accessToken: string;
  version: string;
  workspaceId?: string | null;
}) {
  const url = buildUrl(metaConfig.endpoints.mePermissions, options.version, {
    access_token: options.accessToken,
  });
  const payload = await fetchGraph<{ permission: string; status: string }[]>(
    url,
    undefined,
    buildTelemetry({
      env: options.env,
      op: 'meta.permissions',
      route: metaRouteLabels.mePermissions,
      method: 'GET',
      workspaceId: options.workspaceId,
    }),
  );
  return payload.data;
}

export async function fetchBusinesses(options: {
  env: MetaEnv;
  accessToken: string;
  version: string;
  workspaceId?: string | null;
}) {
  const url = buildUrl(metaConfig.endpoints.meBusinesses, options.version, {
    access_token: options.accessToken,
    fields: metaConfig.fields.businesses.join(','),
    limit: '200',
  });
  return await paginateList<{ id: string; name: string }>(
    url,
    buildTelemetry({
      env: options.env,
      op: 'meta.businesses',
      route: metaRouteLabels.meBusinesses,
      method: 'GET',
      workspaceId: options.workspaceId,
    }),
  );
}

export async function fetchBusinessPages(options: {
  env: MetaEnv;
  businessId: string;
  accessToken: string;
  version: string;
  workspaceId?: string | null;
}) {
  const params = {
    access_token: options.accessToken,
    fields: metaConfig.fields.pages.join(','),
    limit: '200',
  };
  const ownedUrl = buildUrl(
    metaConfig.endpoints.businessOwnedPages(options.businessId),
    options.version,
    params,
  );
  try {
    const owned = await paginateList<{ id: string; name: string }>(
      ownedUrl,
      buildTelemetry({
        env: options.env,
        op: 'meta.business_owned_pages',
        route: metaRouteLabels.businessOwnedPages,
        method: 'GET',
        workspaceId: options.workspaceId,
      }),
    );
    if (owned.length) {
      return { source: 'owned_pages' as const, pages: owned };
    }
  } catch (error) {
    console.warn('Failed to fetch owned pages', {
      businessId: options.businessId,
      error: error instanceof Error ? error.message : error,
    });
    // fall through to client_pages
  }
  const clientUrl = buildUrl(
    metaConfig.endpoints.businessClientPages(options.businessId),
    options.version,
    params,
  );
  const client = await paginateList<{ id: string; name: string }>(
    clientUrl,
    buildTelemetry({
      env: options.env,
      op: 'meta.business_client_pages',
      route: metaRouteLabels.businessClientPages,
      method: 'GET',
      workspaceId: options.workspaceId,
    }),
  );
  return { source: 'client_pages' as const, pages: client };
}

export async function fetchClassicPages(options: {
  env: MetaEnv;
  accessToken: string;
  version: string;
  workspaceId?: string | null;
}) {
  const url = buildUrl(metaConfig.endpoints.meAccounts, options.version, {
    access_token: options.accessToken,
    fields: metaConfig.fields.pages.join(','),
    limit: '200',
  });
  return await paginateList<{ id: string; name: string }>(
    url,
    buildTelemetry({
      env: options.env,
      op: 'meta.classic_pages',
      route: metaRouteLabels.meAccounts,
      method: 'GET',
      workspaceId: options.workspaceId,
    }),
  );
}

export async function fetchPageToken(options: {
  env: MetaEnv;
  pageId: string;
  accessToken: string;
  version: string;
  workspaceId?: string | null;
}) {
  const url = buildUrl(
    metaConfig.endpoints.pageDetails(options.pageId),
    options.version,
    {
      access_token: options.accessToken,
      fields: metaConfig.fields.pageWithToken.join(','),
    },
  );
  const payload = await fetchForToken<{
    id: string;
    name: string;
    access_token?: string;
  }>(
    url,
    undefined,
    buildTelemetry({
      env: options.env,
      op: 'meta.page_token',
      route: metaRouteLabels.pageDetails,
      method: 'GET',
      workspaceId: options.workspaceId,
      assetId: options.pageId,
    }),
  );
  if (!payload) {
    throw new Error(
      `Meta page token response missing data (keys: ${Object.keys(payload).join(',')})`,
    );
  }
  if (!payload.access_token) {
    throw new Error('Meta page token response missing fields');
  }
  return {
    id: payload.id,
    name: payload.name,
    accessToken: payload.access_token,
  };
}

export async function fetchPageName(options: {
  env: MetaEnv;
  pageId: string;
  accessToken: string;
  version: string;
  workspaceId?: string | null;
}) {
  const url = buildUrl(
    metaConfig.endpoints.pageDetails(options.pageId),
    options.version,
    {
      access_token: options.accessToken,
      fields: 'id,name',
    },
  );
  const payload = await fetchGraph<{ id: string; name: string }>(
    url,
    undefined,
    buildTelemetry({
      env: options.env,
      op: 'meta.page_name',
      route: metaRouteLabels.pageDetails,
      method: 'GET',
      workspaceId: options.workspaceId,
      assetId: options.pageId,
    }),
  );
  return payload.data;
}

export async function fetchUserProfile(options: {
  env: MetaEnv;
  accessToken: string;
  version: string;
  workspaceId?: string | null;
}) {
  const url = buildUrl(metaConfig.endpoints.meDetails, options.version, {
    access_token: options.accessToken,
    fields: metaConfig.fields.me.join(','),
  });
  return await fetchForToken<{ id: string; name?: string }>(
    url,
    undefined,
    buildTelemetry({
      env: options.env,
      op: 'meta.user_profile',
      route: metaRouteLabels.meDetails,
      method: 'GET',
      workspaceId: options.workspaceId,
    }),
  );
}

export type MetaConversation = {
  id: string;
  updated_time: string;
};

export type MetaMessage = {
  id: string;
  from?: { id?: string; name?: string };
  to?: { data?: Array<{ id?: string; name?: string }> };
  created_time: string;
  message?: string;
  attachments?: {
    data?: Array<{
      mime_type?: string;
      name?: string;
      file_url?: string;
      image_data?: { url?: string };
    }>;
  };
};

export async function fetchConversations(options: {
  env: MetaEnv;
  pageId: string;
  accessToken: string;
  version: string;
  platform: 'messenger' | 'instagram';
  since?: string;
  workspaceId?: string | null;
}) {
  const params: Record<string, string> = {
    access_token: options.accessToken,
    fields: metaConfig.fields.conversations.join(','),
    limit: '50',
    platform: options.platform,
  };
  const since = normalizeSince(options.since);
  if (since) {
    params.since = since;
  }
  const url = buildUrl(
    metaConfig.endpoints.conversations(options.pageId),
    options.version,
    params,
  );
  return await paginateList<MetaConversation>(
    url,
    buildTelemetry({
      env: options.env,
      op: 'meta.conversations',
      route: metaRouteLabels.conversations,
      method: 'GET',
      workspaceId: options.workspaceId,
      assetId: options.pageId,
    }),
  );
}

export async function fetchConversationsPage(options: {
  env: MetaEnv;
  pageId: string;
  accessToken: string;
  version: string;
  platform: 'messenger' | 'instagram';
  since?: string;
  after?: string;
  limit?: number;
  workspaceId?: string | null;
}) {
  const params: Record<string, string> = {
    access_token: options.accessToken,
    fields: metaConfig.fields.conversations.join(','),
    limit: String(options.limit ?? 50),
    platform: options.platform,
  };
  const since = normalizeSince(options.since);
  if (since) {
    params.since = since;
  }
  if (options.after) {
    params.after = options.after;
  }
  const url = buildUrl(
    metaConfig.endpoints.conversations(options.pageId),
    options.version,
    params,
  );
  const payload = await fetchGraph<MetaConversation[]>(
    url,
    undefined,
    buildTelemetry({
      env: options.env,
      op: 'meta.conversations_page',
      route: metaRouteLabels.conversations,
      method: 'GET',
      workspaceId: options.workspaceId,
      assetId: options.pageId,
    }),
  );
  return {
    conversations: payload.data ?? [],
    nextCursor: payload.paging?.cursors?.after ?? null,
  };
}

export async function fetchConversationMessages(options: {
  env: MetaEnv;
  conversationId: string;
  accessToken: string;
  version: string;
  workspaceId?: string | null;
  assetId?: string | null;
}) {
  const fields = `messages.limit(50){${metaConfig.fields.messages.join(',')}}`;
  const url = buildUrl(
    metaConfig.endpoints.conversationDetails(options.conversationId),
    options.version,
    { access_token: options.accessToken, fields },
  );
  const payload = await fetchGraph<{
    messages?: { data: MetaMessage[]; paging?: { next?: string } };
  }>(
    url,
    undefined,
    buildTelemetry({
      env: options.env,
      op: 'meta.conversation_messages',
      route: metaRouteLabels.conversationDetails,
      method: 'GET',
      workspaceId: options.workspaceId,
      assetId: options.assetId,
    }),
  );
  if (!payload.data?.messages) {
    const listUrl = buildUrl(
      metaConfig.endpoints.conversationMessages(options.conversationId),
      options.version,
      {
        access_token: options.accessToken,
        fields: metaConfig.fields.messages.join(','),
        limit: '50',
      },
    );
    return await paginateList<MetaMessage>(
      listUrl,
      buildTelemetry({
        env: options.env,
        op: 'meta.conversation_messages',
        route: metaRouteLabels.conversationMessages,
        method: 'GET',
        workspaceId: options.workspaceId,
        assetId: options.assetId,
      }),
    );
  }
  const results = [...payload.data.messages.data];
  let nextUrl = payload.data.messages.paging?.next;
  while (nextUrl) {
    const page = await fetchGraph<MetaMessage[]>(
      nextUrl,
      undefined,
      buildTelemetry({
        env: options.env,
        op: 'meta.conversation_messages',
        route: metaRouteLabels.conversationMessages,
        method: 'GET',
        workspaceId: options.workspaceId,
        assetId: options.assetId,
      }),
    );
    results.push(...page.data);
    nextUrl = page.paging?.next;
  }
  return results;
}

export type MetaIgAsset = {
  id: string;
  name?: string;
};

type PageInstagramLinkData = {
  instagram_business_account?: {
    id: string;
    username?: string;
    name?: string;
  };
  connected_instagram_account?: {
    id: string;
    username?: string;
    name?: string;
  };
};

function normalizePageInstagramLinks(
  payload: GraphResponse<PageInstagramLinkData> | PageInstagramLinkData,
): PageInstagramLinkData {
  const graphPayload = payload as GraphResponse<PageInstagramLinkData>;
  if (graphPayload.data && typeof graphPayload.data === 'object') {
    return graphPayload.data;
  }
  return payload as PageInstagramLinkData;
}

export async function fetchInstagramAssets(options: {
  env: MetaEnv;
  pageId: string;
  accessToken: string;
  version: string;
  workspaceId?: string | null;
}) {
  const url = buildUrl(
    metaConfig.endpoints.igAccounts(options.pageId),
    options.version,
    {
      access_token: options.accessToken,
      fields: metaConfig.fields.igAccounts.join(','),
    },
  );
  const payload = await fetchGraph<MetaIgAsset[]>(
    url,
    undefined,
    buildTelemetry({
      env: options.env,
      op: 'meta.ig_accounts',
      route: metaRouteLabels.igAccounts,
      method: 'GET',
      workspaceId: options.workspaceId,
      assetId: options.pageId,
    }),
  );
  const igAssets = Array.isArray(payload.data) ? payload.data : [];
  if (igAssets.length) {
    return igAssets;
  }
  const pageUrl = buildUrl(
    metaConfig.endpoints.pageDetails(options.pageId),
    options.version,
    {
      access_token: options.accessToken,
      fields:
        'instagram_business_account{id,username,name},connected_instagram_account{id,username,name}',
    },
  );
  const pagePayload = await fetchGraph<PageInstagramLinkData>(
    pageUrl,
    undefined,
    buildTelemetry({
      env: options.env,
      op: 'meta.ig_fallback',
      route: metaRouteLabels.pageDetails,
      method: 'GET',
      workspaceId: options.workspaceId,
      assetId: options.pageId,
    }),
  );
  const pageData = normalizePageInstagramLinks(pagePayload);
  const fallback: MetaIgAsset[] = [];
  if (pageData.instagram_business_account?.id) {
    fallback.push({
      id: pageData.instagram_business_account.id,
      name:
        pageData.instagram_business_account.name ??
        pageData.instagram_business_account.username,
    });
  }
  if (pageData.connected_instagram_account?.id) {
    fallback.push({
      id: pageData.connected_instagram_account.id,
      name:
        pageData.connected_instagram_account.name ??
        pageData.connected_instagram_account.username,
    });
  }
  return fallback;
}

export async function sendMessage(options: {
  env: MetaEnv;
  accessToken: string;
  version: string;
  payload: Record<string, unknown>;
  workspaceId?: string | null;
  assetId?: string | null;
}) {
  const url = buildUrl(metaConfig.endpoints.sendMessage, options.version, {
    access_token: options.accessToken,
  });
  const response = await fetchGraph<{ message_id?: string }>(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(options.payload),
    },
    buildTelemetry({
      env: options.env,
      op: 'meta.send_message',
      route: metaRouteLabels.sendMessage,
      method: 'POST',
      workspaceId: options.workspaceId,
      assetId: options.assetId,
    }),
  );
  return response.data ?? {};
}

export async function fetchPageIgDebug(options: {
  env: MetaEnv;
  pageId: string;
  accessToken: string;
  version: string;
  workspaceId?: string | null;
}) {
  const url = buildUrl(
    metaConfig.endpoints.pageDetails(options.pageId),
    options.version,
    {
      access_token: options.accessToken,
      fields:
        'instagram_business_account{id,username,name},connected_instagram_account{id,username,name}',
    },
  );
  const payload = await fetchGraph<PageInstagramLinkData>(
    url,
    undefined,
    buildTelemetry({
      env: options.env,
      op: 'meta.ig_debug',
      route: metaRouteLabels.pageDetails,
      method: 'GET',
      workspaceId: options.workspaceId,
      assetId: options.pageId,
    }),
  );
  return normalizePageInstagramLinks(payload);
}
