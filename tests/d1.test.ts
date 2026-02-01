import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readMigrations = () => {
  const dir = path.join(process.cwd(), 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  return files.map((file) => fs.readFileSync(path.join(dir, file), 'utf8'));
};

describe('D1 migrations and isolation', () => {
  it('defines core tables with user_id columns', () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'migrations', '0001_init.sql'),
      'utf8',
    );
    const tables = [
      'meta_users',
      'meta_pages',
      'ig_assets',
      'conversations',
      'messages',
      'sync_runs',
      'sync_states',
    ];
    for (const table of tables) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    const userIdTables = [
      'meta_pages',
      'ig_assets',
      'conversations',
      'messages',
      'sync_runs',
      'sync_states',
    ];
    for (const table of userIdTables) {
      expect(migration).toMatch(new RegExp(`${table}[^;]*user_id`, 'i'));
    }
  });

  it('includes ops metrics tables', () => {
    const migrations = readMigrations().join('\n');
    expect(migrations).toContain('CREATE TABLE IF NOT EXISTS ops_counters');
    expect(migrations).toContain(
      'CREATE TABLE IF NOT EXISTS ops_messages_hourly',
    );
  });
});
