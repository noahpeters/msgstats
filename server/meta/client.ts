import { metaConfig } from './config';

type GraphError = {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
};

type GraphResponse<T> = {
  data: T;
  paging?: {
    cursors?: {
      after?: string;
    };
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withVersion(path: string, version: string): string {
  return `${metaConfig.baseUrl}/${version}${path}`;
}

function buildUrl(
  path: string,
  version: string,
  params: Record<string, string>,
): string {
  const url = new URL(withVersion(path, version));
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
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

  console.error(lastError); // log the unexpected failure

  throw lastError ?? new Error('Request failed');
}

async function fetchGraph<T>(
  url: string,
  init?: RequestInit,
): Promise<GraphResponse<T>> {
  const response = await fetchWithRetry(url, init);
  const payload = (await response.json()) as GraphResponse<T>;
  if (!response.ok || payload.error) {
    const message = payload.error?.message ?? 'Meta API error';
    throw new Error(message);
  }
  return payload;
}

async function paginateList<T>(firstUrl: string): Promise<T[]> {
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
}): Promise<{ accessToken: string; tokenType: string; expiresIn?: number }> {
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

export async function debugToken(options: {
  inputToken: string;
  appId: string;
  appSecret: string;
  version: string;
}): Promise<{
  isValid: boolean;
  scopes: string[];
  userId?: string;
  appId?: string;
  expiresAt?: number;
}> {
  const appToken = `${options.appId}|${options.appSecret}`;
  const url = buildUrl(metaConfig.endpoints.debugToken, options.version, {
    input_token: options.inputToken,
    access_token: appToken,
  });
  const payload = await fetchGraph<{
    is_valid: boolean;
    scopes?: string[];
    user_id?: string;
    app_id?: string;
    expires_at?: number;
  }>(url);
  return {
    isValid: payload.data.is_valid,
    scopes: payload.data.scopes ?? [],
    userId: payload.data.user_id,
    appId: payload.data.app_id,
    expiresAt: payload.data.expires_at,
  };
}

export async function fetchPermissions(options: {
  accessToken: string;
  version: string;
}): Promise<{ permission: string; status: string }[]> {
  const url = buildUrl(metaConfig.endpoints.mePermissions, options.version, {
    access_token: options.accessToken,
    fields: metaConfig.fields.permissions.join(','),
  });
  const payload =
    await fetchGraph<{ permission: string; status: string }[]>(url);
  return payload.data;
}

export type MetaBusiness = {
  id: string;
  name: string;
};

export async function fetchBusinesses(options: {
  accessToken: string;
  version: string;
}): Promise<MetaBusiness[]> {
  const url = buildUrl(metaConfig.endpoints.meBusinesses, options.version, {
    access_token: options.accessToken,
    fields: metaConfig.fields.businesses.join(','),
    limit: '200',
  });
  return paginateList<MetaBusiness>(url);
}

export type MetaPage = {
  id: string;
  name: string;
  access_token?: string;
};

export async function fetchBusinessPages(options: {
  businessId: string;
  accessToken: string;
  version: string;
}): Promise<{ pages: MetaPage[]; source: 'owned_pages' | 'client_pages' }> {
  const ownedUrl = buildUrl(
    metaConfig.endpoints.businessOwnedPages(options.businessId),
    options.version,
    {
      access_token: options.accessToken,
      fields: metaConfig.fields.pages.join(','),
      limit: '200',
    },
  );

  try {
    const ownedPages = await paginateList<MetaPage>(ownedUrl);
    if (ownedPages.length > 0) {
      return { pages: ownedPages, source: 'owned_pages' };
    }
  } catch {
    // fallback to client_pages
  }

  const clientUrl = buildUrl(
    metaConfig.endpoints.businessClientPages(options.businessId),
    options.version,
    {
      access_token: options.accessToken,
      fields: metaConfig.fields.pages.join(','),
      limit: '200',
    },
  );
  const clientPages = await paginateList<MetaPage>(clientUrl);
  return { pages: clientPages, source: 'client_pages' };
}

export async function fetchPageToken(options: {
  pageId: string;
  accessToken: string;
  version: string;
}): Promise<{ id: string; name: string; accessToken: string }> {
  const url = buildUrl(
    metaConfig.endpoints.pageDetails(options.pageId),
    options.version,
    {
      access_token: options.accessToken,
      fields: metaConfig.fields.pageWithToken.join(','),
    },
  );
  const payload = await fetchGraph<Record<string, unknown>>(url);
  const data = payload as {
    id?: string;
    name?: string;
    access_token?: string;
  };
  console.log(payload);
  if (!data?.id || !data.access_token) {
    const keys = data ? Object.keys(data).join(',') : 'none';
    console.error(
      `Meta page token response missing fields (keys: ${keys || 'none'}) ${JSON.stringify(data, null, 2)}`,
    );
    throw new Error(
      `Meta page token response missing fields (keys: ${keys || 'none'})`,
    );
  }
  return {
    id: data.id,
    name: data.name ?? '',
    accessToken: data.access_token,
  };
}

export async function fetchPageName(options: {
  pageId: string;
  accessToken: string;
  version: string;
}): Promise<{ id: string; name: string }> {
  const url = buildUrl(
    metaConfig.endpoints.pageDetails(options.pageId),
    options.version,
    {
      access_token: options.accessToken,
      fields: metaConfig.fields.pageName.join(','),
    },
  );
  const payload = await fetchGraph<{ id: string; name: string }>(url);
  return {
    id: payload.data.id,
    name: payload.data.name,
  };
}

export type MetaConversation = {
  id: string;
  updated_time: string;
};

export async function fetchConversations(options: {
  pageId: string;
  accessToken: string;
  version: string;
  since?: string;
}): Promise<MetaConversation[]> {
  const params: Record<string, string> = {
    access_token: options.accessToken,
    fields: metaConfig.fields.conversations.join(','),
    limit: '50',
    platform: 'messenger',
  };
  if (options.since) {
    params.since = options.since;
  }
  const firstUrl = buildUrl(
    metaConfig.endpoints.conversations(options.pageId),
    options.version,
    params,
  );
  return paginateList<MetaConversation>(firstUrl);
}

export type MetaMessage = {
  id: string;
  from: {
    id: string;
  };
  created_time: string;
  message?: string;
};

export async function fetchConversationMessages(options: {
  conversationId: string;
  accessToken: string;
  version: string;
}): Promise<MetaMessage[]> {
  const fields = `messages.limit(50){${metaConfig.fields.messages.join(',')}}`;
  const url = buildUrl(
    metaConfig.endpoints.conversationDetails(options.conversationId),
    options.version,
    {
      access_token: options.accessToken,
      fields,
    },
  );
  const payload = await fetchGraph<{
    messages?: {
      data: MetaMessage[];
      paging?: {
        next?: string;
      };
    };
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
    return paginateList<MetaMessage>(listUrl);
  }

  const results: MetaMessage[] = [...payload.data.messages.data];
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
}): Promise<MetaIgAsset[]> {
  const url = buildUrl(
    metaConfig.endpoints.igAccounts(options.pageId),
    options.version,
    {
      access_token: options.accessToken,
      fields: metaConfig.fields.igAccounts.join(','),
    },
  );
  const payload = await fetchGraph<MetaIgAsset[]>(url);
  return payload.data;
}
