export type AnalyticsQueryEnv = {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
};

type AnalyticsQueryResult<T> = {
  data: T[];
  rows?: T[];
  errors?: Array<{ message: string }>;
};

export async function queryAnalyticsEngine<T>(
  env: AnalyticsQueryEnv,
  sql: string,
): Promise<T[]> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error('Missing Cloudflare Analytics Engine credentials.');
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'text/plain',
      },
      body: sql,
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Analytics Engine query failed (${response.status}): ${body}`,
    );
  }
  const payload = (await response.json()) as AnalyticsQueryResult<T>;
  if (payload.errors && payload.errors.length) {
    throw new Error(
      `Analytics Engine query error: ${payload.errors[0]?.message ?? 'Unknown'}`,
    );
  }
  if (payload.rows) {
    return payload.rows;
  }
  return payload.data ?? [];
}
