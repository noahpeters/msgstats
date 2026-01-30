import fs from 'node:fs';

const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return args[index + 1];
};

const env = getArg('env') ?? 'unknown';
const ref = getArg('ref') ?? 'unknown';
const sha = getArg('sha') ?? 'unknown';
const out = getArg('out');
const variable = getArg('var') ?? 'VITE_STAGING_INFO';
const timestamp = new Date().toISOString();
const shortSha = sha === 'unknown' ? sha : sha.slice(0, 7);

const value = `env=${env} ref=${ref} sha=${shortSha} ts=${timestamp}`;

if (out) {
  fs.appendFileSync(out, `${variable}=${value}\n`);
}

console.log(value);
