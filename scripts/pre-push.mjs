import { execSync } from 'node:child_process';

const run = (command) => {
  execSync(command, { stdio: 'inherit' });
};

const branch = execSync('git rev-parse --abbrev-ref HEAD', {
  encoding: 'utf8',
}).trim();

run('npm run verify');
run('npm run check:remote-migrations');

const isFeatureBranch =
  branch.startsWith('feature/') || branch.startsWith('feat/');

if (isFeatureBranch) {
  run('npm run check:staging-migrations');
} else {
  console.log(`Skipping staging migrations check for branch "${branch}".`);
}
