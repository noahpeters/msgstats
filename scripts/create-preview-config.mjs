import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return args[index + 1];
};

const name = getArg('name');
const out = getArg('out');

if (!name || !out) {
  console.error(
    'Usage: node scripts/create-preview-config.mjs --name NAME --out PATH',
  );
  process.exit(1);
}

const sourcePath = path.join(process.cwd(), 'wrangler.web.staging.toml');
const content = fs.readFileSync(sourcePath, 'utf8');

let next = content.replace(/^name\s*=\s*".*"$/m, `name = "${name}"`);
next = next.replace(/routes\s*=\s*\[[\s\S]*?\]\n\n?/m, '');

fs.writeFileSync(out, next);
