import { describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { createMocks } from 'node-mocks-http';
import { createApp } from '../server/app';
import { conversations } from '../server/db/schema';

function setupApp() {
  process.env.META_APP_ID = 'test';
  process.env.META_APP_SECRET = 'test';
  process.env.META_REDIRECT_URI = 'http://localhost:3000/auth/meta/callback';
  process.env.APP_ENCRYPTION_KEY = 'test-key';
  process.env.DATABASE_PATH = `/tmp/msgstats-test-${randomUUID()}.sqlite`;

  return createApp();
}

async function requestJson(
  app: ReturnType<typeof createApp>['app'],
  url: string,
) {
  const { req, res } = createMocks({ method: 'GET', url });
  const handler = app as unknown as (req: unknown, res: unknown) => void;
  handler(req, res);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const data = res._getData();
  return {
    status: res._getStatusCode(),
    body: typeof data === 'string' ? JSON.parse(data) : data,
  };
}

describe('report endpoints', () => {
  it('returns weekly report data', async () => {
    const { app, db } = setupApp();
    db.insert(conversations)
      .values([
        {
          id: 'c1',
          platform: 'facebook',
          pageId: 'p1',
          igBusinessId: null,
          startedTime: '2024-04-09T09:00:00Z',
          updatedTime: '2024-04-10T10:00:00Z',
          customerCount: 3,
          businessCount: 3,
          priceGiven: 1,
        },
        {
          id: 'c2',
          platform: 'facebook',
          pageId: 'p1',
          igBusinessId: null,
          startedTime: '2024-04-11T09:00:00Z',
          updatedTime: '2024-04-12T10:00:00Z',
          customerCount: 5,
          businessCount: 5,
          priceGiven: 0,
        },
        {
          id: 'c3',
          platform: 'facebook',
          pageId: 'p1',
          igBusinessId: null,
          startedTime: '2024-03-02T10:00:00Z',
          updatedTime: '2024-03-02T10:00:00Z',
          customerCount: 1,
          businessCount: 1,
        },
      ])
      .run();

    const response = await requestJson(app, '/api/reports/weekly');
    expect(response.status).toBe(200);
    expect(response.body.length).toBe(2);

    const latest = response.body[0];
    expect(latest.total).toBe(2);
    expect(latest.productive).toBe(1);
    expect(latest.highlyProductive).toBe(1);
    expect(latest.priceGiven).toBe(1);
  });

  it('returns monthly report data', async () => {
    const { app, db } = setupApp();
    db.insert(conversations)
      .values([
        {
          id: 'c4',
          platform: 'facebook',
          pageId: 'p2',
          igBusinessId: null,
          startedTime: '2024-01-10T10:00:00Z',
          updatedTime: '2024-01-15T10:00:00Z',
          customerCount: 3,
          businessCount: 3,
          priceGiven: 1,
        },
        {
          id: 'c5',
          platform: 'facebook',
          pageId: 'p2',
          igBusinessId: null,
          startedTime: '2024-01-20T10:00:00Z',
          updatedTime: '2024-02-02T10:00:00Z',
          customerCount: 5,
          businessCount: 5,
          priceGiven: 0,
        },
        {
          id: 'c6',
          platform: 'facebook',
          pageId: 'p2',
          igBusinessId: null,
          startedTime: '2024-02-03T10:00:00Z',
          updatedTime: '2024-02-03T10:00:00Z',
          customerCount: 1,
          businessCount: 1,
          priceGiven: 0,
        },
      ])
      .run();

    const response = await requestJson(app, '/api/reports/monthly');
    expect(response.status).toBe(200);
    expect(response.body.length).toBe(2);

    const january = response.body.find(
      (row: { period: string }) => row.period === '2024-01-01',
    ) as
      | { total: number; productive: number; highlyProductive: number }
      | undefined;
    expect(january).toBeTruthy();
    expect(january?.total).toBe(2);
    expect(january?.productive).toBe(1);
    expect(january?.highlyProductive).toBe(1);
    expect(january?.priceGiven).toBe(1);
  });
});
