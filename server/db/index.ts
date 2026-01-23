import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

function ensureConversationColumns(sqlite: Database.Database) {
  const table = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'",
    )
    .get();
  if (!table) {
    return;
  }

  const columns = sqlite
    .prepare("PRAGMA table_info(conversations)")
    .all()
    .map((row) => row.name as string);

  if (!columns.includes('price_given')) {
    sqlite
      .prepare(
        'ALTER TABLE conversations ADD COLUMN price_given INTEGER NOT NULL DEFAULT 0',
      )
      .run();
  }

  if (!columns.includes('started_time')) {
    sqlite
      .prepare('ALTER TABLE conversations ADD COLUMN started_time TEXT')
      .run();
  }
}

export function initDatabase(databasePath: string) {
  const resolved = path.resolve(databasePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(resolved);
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: path.resolve('db/migrations') });
  ensureConversationColumns(sqlite);

  return { db, sqlite };
}
