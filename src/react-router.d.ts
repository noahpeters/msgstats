declare module 'virtual:react-router/server-build' {
  import type { ServerBuild } from '@react-router/server-runtime';
  const build: ServerBuild;
  export = build;
}
