import fs from 'node:fs';
import path from 'node:path';

const paths = ['build/client', 'build/server/index.js'];
const timeoutMs = 30000;
const intervalMs = 100;
const start = Date.now();

function allReady() {
  return paths.every((entry) => fs.existsSync(path.join(process.cwd(), entry)));
}

while (!allReady()) {
  if (Date.now() - start > timeoutMs) {
    const missing = paths.filter(
      (entry) => !fs.existsSync(path.join(process.cwd(), entry)),
    );
    console.error(`Timed out waiting for build outputs: ${missing.join(', ')}`);
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
