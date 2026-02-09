import { describe, expect, it } from 'vitest';
import { registerRoutes } from '../workers/api/routes';

type CapturedStatement = {
  sql: string;
  values: unknown[];
};

class FakeDB {
  batches: CapturedStatement[][] = [];

  prepare(sql: string) {
    return {
      bind: (...values: unknown[]) => ({ sql, values }),
    };
  }

  async batch(statements: CapturedStatement[]) {
    this.batches.push(statements);
    return [];
  }
}

function createDeps(overrides: Record<string, unknown>) {
  const handlers = new Map<string, unknown>();
  const deps = {
    addRoute: (
      method: string,
      pathname: string,
      handler: (...args: unknown[]) => unknown,
    ) => {
      handlers.set(`${method} ${pathname}`, handler);
    },
    json: (data: unknown, init: ResponseInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('content-type', 'application/json');
      return new Response(JSON.stringify(data), { ...init, headers });
    },
    readJson: async <T>(req: Request) => (await req.json()) as T,
    requireUser: async () => 'user-1',
    isAuditConversationsEnabledForUser: async () => false,
    getConversation: async () => null,
    getConversationClassificationExplain: async () => null,
    ...overrides,
  };

  registerRoutes(deps);

  return {
    handlers,
  };
}

describe('inbox audit routes', () => {
  it('returns 404 when FEATURE_AUDIT_CONVERSATIONS is disabled', async () => {
    const { handlers } = createDeps({
      isAuditConversationsEnabledForUser: async () => false,
    });
    const handler = handlers.get(
      'GET /api/inbox/conversations/:id/classification_explain',
    ) as (
      req: Request,
      env: unknown,
      ctx: unknown,
      params: Record<string, string>,
    ) => Promise<Response>;

    const response = await handler(
      new Request(
        'https://example.test/api/inbox/conversations/c-1/classification_explain?assetId=a-1',
      ),
      {},
      {},
      { id: 'c-1' },
    );

    expect(response.status).toBe(404);
  });

  it('writes audit snapshot and feedback linked by audit_id', async () => {
    const db = new FakeDB();
    const { handlers } = createDeps({
      isAuditConversationsEnabledForUser: async () => true,
      getConversation: async () => ({
        id: 'c-1',
        assetId: 'a-1',
        pageId: 'p-1',
        participantId: 'lead-1',
      }),
      getConversationClassificationExplain: async () => ({
        computedLabel: 'DEFERRED',
        reasonCodes: ['DEFERRAL_PHRASE'],
        featureSnapshot: { foo: 'bar' },
        classifierVersion: 'inbox_inference_v1',
        computedAt: 123,
      }),
    });
    const handler = handlers.get('POST /api/inbox/conversations/:id/audit') as (
      req: Request,
      env: { DB: FakeDB },
      ctx: unknown,
      params: Record<string, string>,
    ) => Promise<Response>;

    const response = await handler(
      new Request('https://example.test/api/inbox/conversations/c-1/audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assetId: 'a-1',
          is_correct: false,
          correct_label: 'LOST',
          followup_is_correct: false,
          followup_notes: 'Due date too far out',
          notes: 'Wrong due to context',
        }),
      }),
      { DB: db },
      {},
      { id: 'c-1' },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      audit_id: string;
    };

    expect(db.batches).toHaveLength(1);
    const statements = db.batches[0] ?? [];
    const auditInsert = statements.find((statement) =>
      statement.sql.includes('conversation_classification_audit'),
    );
    const feedbackInsert = statements.find((statement) =>
      statement.sql.includes('conversation_classification_feedback'),
    );

    expect(auditInsert).toBeTruthy();
    expect(feedbackInsert).toBeTruthy();
    expect(payload.audit_id).toBe(String(auditInsert?.values[0]));
    expect(feedbackInsert?.values[4]).toBe(auditInsert?.values[0]);
    expect(feedbackInsert?.values[6]).toBe('LOST');
    expect(feedbackInsert?.values[10]).toBe(0);
    expect(feedbackInsert?.values[12]).toBe('Due date too far out');
  });

  it('validates follow-up audit fields when followup_is_correct is false', async () => {
    const db = new FakeDB();
    const { handlers } = createDeps({
      isAuditConversationsEnabledForUser: async () => true,
      getConversation: async () => ({
        id: 'c-1',
        assetId: 'a-1',
        pageId: 'p-1',
        participantId: 'lead-1',
      }),
      getConversationClassificationExplain: async () => ({
        computedLabel: 'DEFERRED',
        reasonCodes: ['DEFERRAL_PHRASE'],
        featureSnapshot: { foo: 'bar' },
        classifierVersion: 'inbox_inference_v1',
        computedAt: 123,
      }),
    });
    const handler = handlers.get('POST /api/inbox/conversations/:id/audit') as (
      req: Request,
      env: { DB: FakeDB },
      ctx: unknown,
      params: Record<string, string>,
    ) => Promise<Response>;

    const response = await handler(
      new Request('https://example.test/api/inbox/conversations/c-1/audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assetId: 'a-1',
          is_correct: true,
          followup_is_correct: false,
        }),
      }),
      { DB: db },
      {},
      { id: 'c-1' },
    );

    expect(response.status).toBe(400);
    expect(db.batches).toHaveLength(0);
  });

  it('requires correct_label when is_correct is false', async () => {
    const db = new FakeDB();
    const { handlers } = createDeps({
      isAuditConversationsEnabledForUser: async () => true,
      getConversation: async () => ({
        id: 'c-1',
        assetId: 'a-1',
        pageId: 'p-1',
        participantId: 'lead-1',
      }),
      getConversationClassificationExplain: async () => ({
        computedLabel: 'DEFERRED',
        reasonCodes: ['DEFERRAL_PHRASE'],
        featureSnapshot: { foo: 'bar' },
        classifierVersion: 'inbox_inference_v1',
        computedAt: 123,
      }),
    });
    const handler = handlers.get('POST /api/inbox/conversations/:id/audit') as (
      req: Request,
      env: { DB: FakeDB },
      ctx: unknown,
      params: Record<string, string>,
    ) => Promise<Response>;

    const response = await handler(
      new Request('https://example.test/api/inbox/conversations/c-1/audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assetId: 'a-1',
          is_correct: false,
        }),
      }),
      { DB: db },
      {},
      { id: 'c-1' },
    );

    expect(response.status).toBe(400);
    expect(db.batches).toHaveLength(0);
  });
});
