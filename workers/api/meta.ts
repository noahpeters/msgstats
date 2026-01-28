type GraphError = {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
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

export const metaConfig = {
  baseUrl: 'https://graph.facebook.com',
  version: 'v19.0',
  endpoints: {
    oauthAccessToken: '/oauth/access_token',
    debugToken: '/debug_token',
    mePermissions: '/me/permissions',
    meBusinesses: '/me/businesses',
    meAccounts: '/me/accounts',
    businessOwnedPages: (businessId: string) => `/${businessId}/owned_pages`,
    businessClientPages: (businessId: string) => `/${businessId}/client_pages`,
    pageDetails: (pageId: string) => `/${pageId}`,
    conversations: (pageId: string) => `/${pageId}/conversations`,
    conversationDetails: (conversationId: string) => `/${conversationId}`,
    conversationMessages: (conversationId: string) =>
      `/${conversationId}/messages`,
    igAccounts: (pageId: string) => `/${pageId}/instagram_accounts`,
  },
  fields: {
    permissions: ['permission', 'status'],
    businesses: ['id', 'name'],
    pages: ['id', 'name'],
    pageWithToken: ['id', 'name', 'access_token'],
    conversations: ['id', 'updated_time'],
    messages: ['id', 'from', 'created_time', 'message'],
    igAccounts: ['id', 'name'],
  },
};

function withVersion(path: string, version: string) {
  return `${metaConfig.baseUrl}/${version}${path}`;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  input: string,
  init?: RequestInit,
  retry: RetryOptions = defaultRetry,
): Promise<Response> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= retry.retries) {
    try {
      const response = await fetch(input, init);
      if (response.status >= 500 || response.status === 429) {
        throw new Error(`Transient error: ${response.status}`);
      }
      return response;
    } catch (err) {
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

async function fetchForToken<T>(url: string, init?: RequestInit) {
  const response = await fetchWithRetry(url, init);
  const payload = (await response.json()) as T;
  if (!response.ok) {
    throw new Error('Meta API error');
  }
  return payload;
}

async function fetchGraph<T>(url: string, init?: RequestInit) {
  const response = await fetchWithRetry(url, init);
  const payload = (await response.json()) as GraphResponse<T>;
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message ?? 'Meta API error');
  }
  return payload;
}

async function paginateList<T>(firstUrl: string) {
  const results: T[] = [];
  let nextUrl: string | undefined = firstUrl;
  while (nextUrl) {
    const payload: GraphResponse<T[]> = await fetchGraph<T[]>(nextUrl);
    results.push(...payload.data);
    nextUrl = payload.paging?.next;
  }
  return results;
}

export async function exchangeCodeForToken(options: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
  version: string;
}) {
  const url = buildUrl(metaConfig.endpoints.oauthAccessToken, options.version, {
    client_id: options.appId,
    client_secret: options.appSecret,
    redirect_uri: options.redirectUri,
    code: options.code,
  });
  const response = await fetchWithRetry(url);
  if (!response.ok) {
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
  appId: string;
  appSecret: string;
  accessToken: string;
  version: string;
}) {
  const url = buildUrl(metaConfig.endpoints.oauthAccessToken, options.version, {
    client_id: options.appId,
    client_secret: options.appSecret,
    grant_type: 'fb_exchange_token',
    fb_exchange_token: options.accessToken,
  });
  const response = await fetchWithRetry(url);
  if (!response.ok) {
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
  inputToken: string;
  appToken: string;
  version: string;
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
  }>(url);
  return payload.data;
}

export async function fetchPermissions(options: {
  accessToken: string;
  version: string;
}) {
  const url = buildUrl(metaConfig.endpoints.mePermissions, options.version, {
    access_token: options.accessToken,
  });
  const payload =
    await fetchGraph<{ permission: string; status: string }[]>(url);
  return payload.data;
}

export async function fetchBusinesses(options: {
  accessToken: string;
  version: string;
}) {
  const url = buildUrl(metaConfig.endpoints.meBusinesses, options.version, {
    access_token: options.accessToken,
    fields: metaConfig.fields.businesses.join(','),
    limit: '200',
  });
  return await paginateList<{ id: string; name: string }>(url);
}

export async function fetchBusinessPages(options: {
  businessId: string;
  accessToken: string;
  version: string;
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
    const owned = await paginateList<{ id: string; name: string }>(ownedUrl);
    if (owned.length) {
      return { source: 'owned_pages' as const, pages: owned };
    }
  } catch {
    // fall through to client_pages
  }
  const clientUrl = buildUrl(
    metaConfig.endpoints.businessClientPages(options.businessId),
    options.version,
    params,
  );
  const client = await paginateList<{ id: string; name: string }>(clientUrl);
  return { source: 'client_pages' as const, pages: client };
}

export async function fetchClassicPages(options: {
  accessToken: string;
  version: string;
}) {
  const url = buildUrl(metaConfig.endpoints.meAccounts, options.version, {
    access_token: options.accessToken,
    fields: metaConfig.fields.pages.join(','),
    limit: '200',
  });
  return await paginateList<{ id: string; name: string }>(url);
}

export async function fetchPageToken(options: {
  pageId: string;
  accessToken: string;
  version: string;
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
  }>(url);
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
  pageId: string;
  accessToken: string;
  version: string;
}) {
  const url = buildUrl(
    metaConfig.endpoints.pageDetails(options.pageId),
    options.version,
    {
      access_token: options.accessToken,
      fields: 'id,name',
    },
  );
  const payload = await fetchGraph<{ id: string; name: string }>(url);
  return payload.data;
}

export type MetaConversation = {
  id: string;
  updated_time: string;
};

export type MetaMessage = {
  id: string;
  from?: { id?: string };
  created_time: string;
  message?: string;
};

export async function fetchConversations(options: {
  pageId: string;
  accessToken: string;
  version: string;
  platform: 'messenger' | 'instagram';
  since?: string;
}) {
  const params: Record<string, string> = {
    access_token: options.accessToken,
    fields: metaConfig.fields.conversations.join(','),
    limit: '50',
    platform: options.platform,
  };
  if (options.since) {
    params.since = options.since;
  }
  const url = buildUrl(
    metaConfig.endpoints.conversations(options.pageId),
    options.version,
    params,
  );
  return await paginateList<MetaConversation>(url);
}

export async function fetchConversationMessages(options: {
  conversationId: string;
  accessToken: string;
  version: string;
}) {
  const fields = `messages.limit(50){${metaConfig.fields.messages.join(',')}}`;
  const url = buildUrl(
    metaConfig.endpoints.conversationDetails(options.conversationId),
    options.version,
    { access_token: options.accessToken, fields },
  );
  const payload = await fetchGraph<{
    messages?: { data: MetaMessage[]; paging?: { next?: string } };
  }>(url);
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
    return await paginateList<MetaMessage>(listUrl);
  }
  const results = [...payload.data.messages.data];
  let nextUrl = payload.data.messages.paging?.next;
  while (nextUrl) {
    const page = await fetchGraph<MetaMessage[]>(nextUrl);
    results.push(...page.data);
    nextUrl = page.paging?.next;
  }
  return results;
}

export type MetaIgAsset = {
  id: string;
  name?: string;
};

export async function fetchInstagramAssets(options: {
  pageId: string;
  accessToken: string;
  version: string;
}) {
  const url = buildUrl(
    metaConfig.endpoints.igAccounts(options.pageId),
    options.version,
    {
      access_token: options.accessToken,
      fields: metaConfig.fields.igAccounts.join(','),
    },
  );
  const payload = await fetchGraph<MetaIgAsset[]>(url);
  if (payload.data.length) {
    return payload.data;
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
  const pagePayload = await fetchGraph<{
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
  }>(pageUrl);
  const fallback: MetaIgAsset[] = [];
  if (pagePayload.data.instagram_business_account?.id) {
    fallback.push({
      id: pagePayload.data.instagram_business_account.id,
      name:
        pagePayload.data.instagram_business_account.name ??
        pagePayload.data.instagram_business_account.username,
    });
  }
  if (pagePayload.data.connected_instagram_account?.id) {
    fallback.push({
      id: pagePayload.data.connected_instagram_account.id,
      name:
        pagePayload.data.connected_instagram_account.name ??
        pagePayload.data.connected_instagram_account.username,
    });
  }
  return fallback;
}

export async function fetchPageIgDebug(options: {
  pageId: string;
  accessToken: string;
  version: string;
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
  const payload = await fetchGraph<{
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
  }>(url);
  return payload.data;
}
