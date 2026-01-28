import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';

const shouldRun = process.env.SKIP_D1_EMULATOR_TEST !== '1';

describe('D1 emulator (CI only)', () => {
  it.skipIf(!shouldRun)(
    'applies migrations and queries D1',
    async () => {
      const canListen = await new Promise<boolean>((resolve) => {
        const server = net.createServer();
        server.once('error', () => {
          server.close(() => {
            resolve(false);
          });
        });
        server.listen(0, '127.0.0.1', () => {
          server.close(() => resolve(true));
        });
      });
      if (!canListen) {
        console.warn('Skipping D1 emulator test: listen not permitted.');
        return;
      }
      let mf: Miniflare | null = null;
      try {
        mf = new Miniflare({
          modules: true,
          script: 'export default { fetch() { return new Response("ok"); } }',
          d1Databases: { DB: 'msgstats-db' },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? '');
        if (message.includes('listen EPERM')) {
          console.warn('Skipping D1 emulator test: listen not permitted.');
          return;
        }
        throw error;
      }
      try {
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
          const normalized = statement.replace(/\s+/g, ' ').trim();
          if (!normalized) continue;
          await db.exec(normalized);
        }
        const row = await db
          .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
          .bind('table', 'meta_users')
          .first<{ name: string }>();
        expect(row?.name).toBe('meta_users');
      } finally {
        await mf?.dispose();
      }
    },
    20000,
  );
});
