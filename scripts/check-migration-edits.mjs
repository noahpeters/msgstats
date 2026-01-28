import { execSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const existing = new Set(
  execSync('git ls-tree -r --name-only HEAD migrations', {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean),
);

const parseStatus = (output) =>
  output
    .toString()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, file] = line.split(/\s+/);
      return { status, file };
    });

const staged = parseStatus(
  execSync('git diff --cached --name-status', {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
  }),
);
const unstaged = parseStatus(
  execSync('git diff --name-status', {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
  }),
);

const violations = [];
for (const { status, file } of [...staged, ...unstaged]) {
  if (!file) continue;
  const normalized = file.replace(/\\/g, '/');
  if (!normalized.startsWith('migrations/')) continue;
  const basename = path.basename(normalized);
  if (!basename.endsWith('.sql')) continue;
  if (status.startsWith('A')) continue;
  if (existing.has(normalized)) {
    violations.push(`${status} ${normalized}`);
  }
}

if (violations.length > 0) {
  console.error(
    'Blocked: existing migration files cannot be edited or deleted.\n' +
      violations.map((line) => `- ${line}`).join('\n'),
  );
  process.exit(1);
}
