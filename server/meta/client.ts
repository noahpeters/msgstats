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

export type MetaPage = {
  id: string;
  name: string;
  access_token?: string;
};

export async function fetchPages(options: {
  accessToken: string;
  version: string;
  fields?: string[];
}): Promise<MetaPage[]> {
  const url = buildUrl(metaConfig.endpoints.meAccounts, options.version, {
    access_token: options.accessToken,
    fields: (options.fields ?? metaConfig.fields.pages).join(','),
  });
  const payload = await fetchGraph<MetaPage[]>(url);
  return payload.data;
}

export type MetaConversation = {
  id: string;
  updated_time: string;
};

export async function fetchConversations(options: {
  pageId: string;
  accessToken: string;
  version: string;
}): Promise<MetaConversation[]> {
  const firstUrl = buildUrl(
    metaConfig.endpoints.conversations(options.pageId),
    options.version,
    {
      access_token: options.accessToken,
      fields: metaConfig.fields.conversations.join(','),
      limit: '50',
    },
  );
  const results: MetaConversation[] = [];
  let nextUrl: string | undefined = firstUrl;
  while (nextUrl) {
    const payload: GraphResponse<MetaConversation[]> =
      await fetchGraph<MetaConversation[]>(nextUrl);
    results.push(...payload.data);
    nextUrl = payload.paging?.next;
  }
  return results;
}

export type MetaMessage = {
  id: string;
  from: {
    id: string;
  };
  created_time: string;
  message?: string;
};

export async function fetchMessages(options: {
  conversationId: string;
  accessToken: string;
  version: string;
}): Promise<MetaMessage[]> {
  const firstUrl = buildUrl(
    metaConfig.endpoints.messages(options.conversationId),
    options.version,
    {
      access_token: options.accessToken,
      fields: metaConfig.fields.messages.join(','),
      limit: '100',
    },
  );
  const results: MetaMessage[] = [];
  let nextUrl: string | undefined = firstUrl;
  while (nextUrl) {
    const payload: GraphResponse<MetaMessage[]> =
      await fetchGraph<MetaMessage[]>(nextUrl);
    results.push(...payload.data);
    nextUrl = payload.paging?.next;
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
