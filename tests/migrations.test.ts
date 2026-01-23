import { describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { initDatabase } from '../server/db';

function listMigrationFiles(): string[] {
  const migrationsDir = path.resolve('db/migrations');
  return fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql'));
}

describe('migrations', () => {
  it('applies migrations once and preserves schema', () => {
    const dbPath = `/tmp/msgstats-test-${randomUUID()}.sqlite`;
    const { sqlite } = initDatabase(dbPath);

    const tables = (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(tables).toContain('__drizzle_migrations');
    expect(tables).toContain('meta_pages');
    expect(tables).toContain('conversations');
    expect(tables).toContain('messages');

    const migrationCount = sqlite
      .prepare('SELECT COUNT(*) as count FROM __drizzle_migrations')
      .get() as { count: number };
    expect(migrationCount.count).toBe(listMigrationFiles().length);

    sqlite.close();

    const second = initDatabase(dbPath).sqlite;
    const secondCount = second
      .prepare('SELECT COUNT(*) as count FROM __drizzle_migrations')
      .get() as { count: number };
    expect(secondCount.count).toBe(migrationCount.count);

    const convoColumns = (
      second.prepare('PRAGMA table_info(conversations)').all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(convoColumns).toContain('price_given');
    expect(convoColumns).toContain('started_time');
    expect(convoColumns).toContain('last_message_at');

    second.close();
  });
});
