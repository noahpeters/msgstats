import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  route('', 'routes/root.tsx', [
    index('routes/dashboard.tsx'),
    route('reports', 'routes/reports.tsx'),
    route('terms', 'routes/terms.tsx'),
    route('privacy', 'routes/privacy.tsx'),
    route('*', 'routes/not-found.tsx'),
  ]),
] satisfies RouteConfig;
