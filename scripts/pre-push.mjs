import { execSync } from 'node:child_process';

const run = (command) => {
  execSync(command, { stdio: 'inherit' });
};

const branch = execSync('git rev-parse --abbrev-ref HEAD', {
  encoding: 'utf8',
}).trim();

run('npm run verify');
run('npm run check:remote-migrations:staging');
run('npm run check:remote-migrations:prod');
