import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

if (process.env.SKIP_STAGING_MIGRATIONS_CHECK === '1') {
  console.log(
    'Skipping staging migrations check (SKIP_STAGING_MIGRATIONS_CHECK=1).',
  );
  process.exit(0);
}

const root = process.cwd();
const migrationsDir = path.join(root, 'migrations');
const localFiles = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

let remoteListRaw = '';
try {
  remoteListRaw = execSync(
    'npx wrangler d1 migrations list msgstats-db-staging --remote --config wrangler.api.staging.toml',
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).toString();
} catch (error) {
  console.error(
    'Failed to list staging migrations. Ensure Wrangler auth is set.',
  );
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(1);
}

const normalizedOutput = remoteListRaw.toLowerCase();
if (normalizedOutput.includes('no migrations to apply')) {
  console.log('Staging migrations check passed (no migrations to apply).');
  process.exit(0);
}

const remoteFiles = remoteListRaw
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .flatMap((line) => {
    const match = line.match(/([\w.-]+\.sql)/);
    return match ? [match[1]] : [];
  })
  .filter(Boolean);

if (remoteFiles.length === 0) {
  console.error(
    'Failed to parse staging migrations list output. ' +
      'If this is running in an environment without Wrangler auth, set SKIP_STAGING_MIGRATIONS_CHECK=1.',
  );
  process.exit(1);
}

const missing = localFiles.filter((name) => !remoteFiles.includes(name));
if (missing.length > 0) {
  console.error(
    'Staging DB is missing migrations:\n' +
      missing.map((name) => `- ${name}`).join('\n') +
      '\nRun: npm run db:migrations:staging',
  );
  process.exit(1);
}

console.log('Staging migrations check passed.');
