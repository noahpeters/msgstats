import { execSync } from 'node:child_process';

const run = (command) => {
  execSync(command, { stdio: 'inherit' });
};

run('npm run verify');
run('npm run check:migration-edits');
