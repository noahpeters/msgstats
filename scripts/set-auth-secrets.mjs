import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CONFIG = 'wrangler.api.toml';
const DEFAULT_DIR = 'env/cloudflare';
const REQUIRED_KEYS = [
  'MSGSTATS_JWT_SECRET',
  'AUTH_SESSION_PEPPER',
  'AUTH_INVITE_PEPPER',
  'AUTH_REFRESH_ENCRYPTION_KEY',
  'AUTH_PASSWORD_RESET_PEPPER',
  'GOOGLE_CLIENT_SECRET',
  'APPLE_PRIVATE_KEY_P8',
];

function parseArgs(argv) {
  const envs = [];
  let dir = DEFAULT_DIR;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--env') {
      const value = argv[i + 1];
      if (!value) throw new Error('Missing value for --env');
      envs.push(value);
      i += 1;
      continue;
    }
    if (arg === '--dir') {
      const value = argv[i + 1];
      if (!value) throw new Error('Missing value for --dir');
      dir = value;
      i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (envs.length === 0) {
    throw new Error('At least one --env is required.');
  }
  return { envs, dir, dryRun };
}

function printHelp() {
  console.log(
    'Usage: node scripts/set-auth-secrets.mjs --env <name> [--env <name>...] [--dir env/cloudflare] [--dry-run]\n\n' +
      'Reads auth.<env>.env and pushes auth secrets via Wrangler.\n\n' +
      'Examples:\n' +
      '  npm run auth:secrets:push -- --env staging --env production\n' +
      '  npm run auth:secrets:push -- --env staging --dry-run\n',
  );
}

function parseEnvFile(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function runCommand(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    ...opts,
  });
  if (result.status !== 0) {
    const stderr = result.stderr || '';
    const stdout = result.stdout || '';
    throw new Error(
      `${cmd} ${args.join(' ')} failed\n${stdout}\n${stderr}`.trim(),
    );
  }
}

function ensureWranglerAuth() {
  runCommand('npx', ['wrangler', 'whoami']);
}

function loadEnvValues(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing env file: ${filePath}`);
  }
  const parsed = parseEnvFile(fs.readFileSync(filePath, 'utf8'));
  for (const key of REQUIRED_KEYS) {
    if (!parsed[key] || parsed[key].trim() === '') {
      throw new Error(`Missing required key ${key} in ${filePath}`);
    }
  }
  return parsed;
}

function putSecret({ envName, key, value, dryRun }) {
  const args = [
    'wrangler',
    'secret',
    'put',
    key,
    '--config',
    CONFIG,
    '--env',
    envName,
  ];
  if (dryRun) {
    console.log(`[dry-run] npx ${args.join(' ')}`);
    return;
  }
  const result = spawnSync('npx', args, {
    input: `${value}\n`,
    stdio: ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Failed to set ${key} for env ${envName}`);
  }
}

function main() {
  const { envs, dir, dryRun } = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const fullDir = path.resolve(root, dir);

  if (!dryRun) {
    ensureWranglerAuth();
  }

  for (const envName of envs) {
    const envPath = path.join(fullDir, `auth.${envName}.env`);
    const values = loadEnvValues(envPath);
    console.log(
      `Applying ${REQUIRED_KEYS.length} auth secrets to env "${envName}" from ${envPath}`,
    );
    for (const key of REQUIRED_KEYS) {
      putSecret({ envName, key, value: values[key], dryRun });
    }
    console.log(`Done: ${envName}`);
  }

  console.log('Auth secret sync complete.');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
