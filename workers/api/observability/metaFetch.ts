export type MetaFetchEnv = {
  AE_META_CALLS: AnalyticsEngineDataset;
};

export type MetaFetchOptions = {
  op: string;
  route: string;
  method?: string;
  url: string;
  init?: RequestInit;
  workspaceId?: string | null;
  assetId?: string | null;
};

type MetaErrorInfo = {
  code?: string;
  subcode?: string;
  type?: string;
};

export function classifyStatusClass(
  status: number,
): '2xx' | '3xx' | '4xx' | '5xx' | 'other' {
  if (status >= 200 && status < 300) {
    return '2xx';
  }
  if (status >= 300 && status < 400) {
    return '3xx';
  }
  if (status >= 400 && status < 500) {
    return '4xx';
  }
  if (status >= 500 && status < 600) {
    return '5xx';
  }
  return 'other';
}

export function extractMetaError(payload: unknown): MetaErrorInfo | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const errorValue = (payload as { error?: unknown }).error;
  if (!errorValue || typeof errorValue !== 'object') {
    return null;
  }
  const error = errorValue as {
    code?: number | string;
    error_subcode?: number | string;
    type?: string;
  };
  return {
    code: error.code !== undefined ? String(error.code) : undefined,
    subcode:
      error.error_subcode !== undefined
        ? String(error.error_subcode)
        : undefined,
    type: error.type,
  };
}

function detectApiFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    if (hostname.includes('instagram')) {
      return 'instagram';
    }
    if (hostname.includes('facebook')) {
      return 'graph';
    }
    return hostname.split('.')[0] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function normalizeString(value: string | null | undefined): string {
  return value ? value : '';
}

async function parseMetaErrorFromResponse(
  response: Response,
): Promise<MetaErrorInfo | null> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return null;
  }
  try {
    const text = await response.text();
    if (!text) {
      return null;
    }
    const payload = JSON.parse(text) as unknown;
    return extractMetaError(payload);
  } catch {
    return null;
  }
}

export async function metaFetch(
  env: MetaFetchEnv,
  options: MetaFetchOptions,
): Promise<Response> {
  const method = options.method ?? options.init?.method ?? 'GET';
  const startMs = Date.now();
  const response = await fetch(options.url, options.init);
  const durationMs = Date.now() - startMs;
  let metaError: MetaErrorInfo | null = null;
  try {
    metaError = await parseMetaErrorFromResponse(response.clone());
  } catch {
    metaError = null;
  }
  const statusClass = classifyStatusClass(response.status);
  const ok = response.status >= 200 && response.status < 300;
  const api = detectApiFromUrl(options.url);
  try {
    env.AE_META_CALLS.writeDataPoint({
      blobs: [
        'meta',
        api,
        options.op,
        options.route,
        method,
        statusClass,
        String(response.status),
        normalizeString(metaError?.code),
        normalizeString(metaError?.subcode),
        normalizeString(options.workspaceId ?? undefined),
        normalizeString(options.assetId ?? undefined),
      ],
      doubles: [1, ok ? 1 : 0, durationMs],
    });
  } catch (error) {
    console.warn('Failed to write meta telemetry', {
      op: options.op,
      route: options.route,
      error: error instanceof Error ? error.message : error,
    });
  }
  return response;
}
