import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';

const shouldRun = process.env.CI === 'true';

describe('D1 emulator (CI only)', () => {
  it.skipIf(!shouldRun)(
    'applies migrations and queries D1',
    async () => {
      const mf = new Miniflare({
        modules: true,
        script: 'export default { fetch() { return new Response("ok"); } }',
        host: '127.0.0.1',
        port: 0,
        d1Databases: { DB: 'msgstats-db' },
      });
      const db = await mf.getD1Database('DB');
      const migration = fs.readFileSync(
        path.join(process.cwd(), 'migrations', '0001_init.sql'),
        'utf8',
      );
      const statements = migration
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
      for (const statement of statements) {
        await db.exec(statement);
      }
      const row = await db
        .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
        .bind('table', 'meta_users')
        .first<{ name: string }>();
      expect(row?.name).toBe('meta_users');
      await mf.dispose();
    },
    20000,
  );
});
