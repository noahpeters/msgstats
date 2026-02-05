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

const sourcePath = path.join(process.cwd(), 'wrangler.web.toml');
const content = fs.readFileSync(sourcePath, 'utf8');

const envMatch = content.match(/\[env\.staging\][\s\S]*?(?=\n\[env\.|$)/);
if (!envMatch) {
  console.error('Missing [env.staging] in wrangler.web.toml');
  process.exit(1);
}

const base = content
  .replace(envMatch[0], '')
  .replace(/\[\[services\]\][\s\S]*?\n\n?/m, '');

let envBlock = envMatch[0]
  .replace(/\[env\.staging\]\n?/g, '')
  .replace(/\[env\.staging\.vars\]/g, '[vars]')
  .replace(/\[\[env\.staging\.services\]\]/g, '[[services]]')
  .replace(/\[env\.staging\.observability\]/g, '[observability]')
  .replace(/\[env\.staging\.observability\.logs\]/g, '[observability.logs]')
  .replace(
    /\[\[env\.staging\.durable_objects\.bindings\]\]/g,
    '[[durable_objects.bindings]]',
  )
  .replace(/\[\[env\.staging\.migrations\]\]/g, '[[migrations]]');

let next = `${base.trim()}\n\n${envBlock.trim()}\n`;
next = next.replace(/^name\s*=\s*".*"$/m, `name = "${name}"`);
next = next.replace(/routes\s*=\s*\[[\s\S]*?\]\n\n?/m, '');

fs.writeFileSync(out, next);
