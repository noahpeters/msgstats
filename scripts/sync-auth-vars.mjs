import fs from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = 'wrangler.api.toml';
const DEFAULT_DIR = 'env/cloudflare';
const SECRET_KEYS = new Set([
  'MSGSTATS_JWT_SECRET',
  'AUTH_SESSION_PEPPER',
  'AUTH_INVITE_PEPPER',
  'AUTH_REFRESH_ENCRYPTION_KEY',
  'AUTH_PASSWORD_RESET_PEPPER',
  'GOOGLE_CLIENT_SECRET',
  'APPLE_PRIVATE_KEY_P8',
]);

function usage() {
  return (
    'Usage: node scripts/sync-auth-vars.mjs --env <name> [--env <name>...] [--dir env/cloudflare]\n' +
    'Reads vars.<env>.env files and updates [env.<env>.vars] in wrangler.api.toml.\n' +
    'Examples:\n' +
    '  npm run auth:vars:sync -- --env staging --env production\n' +
    '  npm run auth:vars:sync -- --env staging --dir env/cloudflare\n'
  );
}

function parseArgs(argv) {
  const envs = [];
  let dir = DEFAULT_DIR;
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
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (envs.length === 0) {
    throw new Error('At least one --env is required');
  }
  return { envs, dir };
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

function assertNoSecrets(values, envName) {
  for (const key of Object.keys(values)) {
    if (SECRET_KEYS.has(key)) {
      throw new Error(
        `Refusing to write secret key ${key} into ${CONFIG_PATH} for env ${envName}. Use auth:secrets:push.`,
      );
    }
  }
}

function tomlEscape(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function buildVarsBlock(envName, values) {
  const keys = Object.keys(values).sort();
  const lines = [`[env.${envName}.vars]`];
  for (const key of keys) {
    lines.push(`${key} = "${tomlEscape(values[key])}"`);
  }
  return `${lines.join('\n')}\n`;
}

function findHeaderBounds(content, header) {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startRegex = new RegExp(`^\\[${escaped}\\]\\s*$`, 'm');
  const match = startRegex.exec(content);
  if (!match || match.index < 0) return null;
  const start = match.index;
  const nextHeaderRegex = /^\[[^\]]+\]\s*$/gm;
  nextHeaderRegex.lastIndex = start + match[0].length;
  const next = nextHeaderRegex.exec(content);
  const end = next ? next.index : content.length;
  return { start, end };
}

function replaceEnvVarsBlock(content, envName, block) {
  const fullHeader = `env.${envName}.vars`;
  const bounds = findHeaderBounds(content, fullHeader);
  if (!bounds) {
    throw new Error(
      `Could not find [env.${envName}.vars] in ${CONFIG_PATH}. Add the section first.`,
    );
  }
  return `${content.slice(0, bounds.start)}${block}\n${content.slice(bounds.end).replace(/^\n*/, '')}`;
}

function main() {
  const { envs, dir } = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const fullDir = path.resolve(root, dir);
  const configFile = path.resolve(root, CONFIG_PATH);
  let configText = fs.readFileSync(configFile, 'utf8');

  for (const envName of envs) {
    const envFile = path.join(fullDir, `vars.${envName}.env`);
    if (!fs.existsSync(envFile)) {
      throw new Error(`Missing vars file: ${envFile}`);
    }
    const values = parseEnvFile(fs.readFileSync(envFile, 'utf8'));
    if (Object.keys(values).length === 0) {
      throw new Error(`No variables found in ${envFile}`);
    }
    assertNoSecrets(values, envName);
    const block = buildVarsBlock(envName, values);
    configText = replaceEnvVarsBlock(configText, envName, block);
    console.log(
      `Prepared ${Object.keys(values).length} vars for env "${envName}" from ${envFile}`,
    );
  }

  fs.writeFileSync(configFile, configText);
  console.log(`Updated ${CONFIG_PATH}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  console.error(usage());
  process.exit(1);
}
