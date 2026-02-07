import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const cmd = path.join(process.cwd(), 'node_modules', '.bin', 'react-router');
const result = spawnSync(cmd, ['build'], { stdio: 'inherit' });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const output = {
  builtAt: new Date().toISOString(),
  ts: Date.now(),
};

const outPath = path.join(process.cwd(), 'build', 'client', 'build-info.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output), 'utf8');
