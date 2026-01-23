import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

function ensureConversationColumns(sqlite: Database.Database) {
  const migrations = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
    )
    .get();
  const table = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'",
    )
    .get();
  if (!table || !migrations) {
    return;
  }

  const columns = (
    sqlite.prepare('PRAGMA table_info(conversations)').all() as {
      name: string;
    }[]
  ).map((row) => row.name);

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

  if (!columns.includes('last_message_at')) {
    sqlite
      .prepare('ALTER TABLE conversations ADD COLUMN last_message_at TEXT')
      .run();
  }
}

function ensureSyncStates(sqlite: Database.Database) {
  const migrations = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
    )
    .get();
  if (!migrations) {
    return;
  }
  const table = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sync_states'",
    )
    .get();
  if (!table) {
    sqlite
      .prepare(
        `CREATE TABLE IF NOT EXISTS sync_states (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          page_id TEXT NOT NULL,
          platform TEXT NOT NULL,
          last_synced_at TEXT,
          updated_at TEXT NOT NULL
        )`,
      )
      .run();
  }

  sqlite
    .prepare(
      'CREATE INDEX IF NOT EXISTS sync_states_page_platform_idx ON sync_states (page_id, platform)',
    )
    .run();
}

export function initDatabase(databasePath: string) {
  const resolved = path.resolve(databasePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const startDir = path.dirname(fileURLToPath(import.meta.url));
  let rootDir = startDir;
  while (!fs.existsSync(path.join(rootDir, 'package.json'))) {
    const parent = path.dirname(rootDir);
    if (parent === rootDir) {
      rootDir = process.cwd();
      break;
    }
    rootDir = parent;
  }
  const migrationsFolder = path.join(rootDir, 'db', 'migrations');
  if (!fs.existsSync(migrationsFolder)) {
    throw new Error(`Migrations folder not found at ${migrationsFolder}`);
  }

  const sqlite = new Database(resolved);
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder });
  ensureConversationColumns(sqlite);
  ensureSyncStates(sqlite);

  if (process.env.NODE_ENV !== 'production') {
    const applied = sqlite
      .prepare(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
      )
      .get() as { count: number };
    if (applied.count === 0) {
      console.warn(
        `No __drizzle_migrations table found after migrate() for ${resolved}`,
      );
    } else {
      const rows = sqlite
        .prepare('SELECT COUNT(*) as count FROM __drizzle_migrations')
        .get() as { count: number };
      console.log(`Migrations checked: ${rows.count} applied in ${resolved}`);
    }
  }

  return { db, sqlite };
}
