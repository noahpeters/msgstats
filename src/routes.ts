import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  route('login', 'routes/login.tsx'),
  route('terms', 'routes/terms.tsx'),
  route('privacy', 'routes/privacy.tsx'),
  route('', 'routes/root.tsx', [
    index('routes/dashboard.tsx'),
    route('inbox', 'routes/inbox.tsx'),
    route('inbox/follow-up', 'routes/inbox-follow-up.tsx'),
    route('ops-dashboard', 'routes/ops-dashboard.tsx'),
    route('reports', 'routes/reports.tsx'),
    route('*', 'routes/not-found.tsx'),
  ]),
] satisfies RouteConfig;
