import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

export function initDatabase(databasePath: string) {
  const resolved = path.resolve(databasePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(resolved);
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: path.resolve('db/migrations') });

  return { db, sqlite };
}
