export type MetricsWindow = '5m' | '15m' | '60m' | '24h';

const allowedWindows: MetricsWindow[] = ['5m', '15m', '60m', '24h'];

export function parseMetricsWindow(
  value: string | null | undefined,
  fallback: MetricsWindow,
): MetricsWindow | null {
  if (!value) {
    return fallback;
  }
  if (allowedWindows.includes(value as MetricsWindow)) {
    return value as MetricsWindow;
  }
  return null;
}

export function windowToSqlInterval(window: MetricsWindow): string {
  switch (window) {
    case '5m':
      return 'INTERVAL 5 MINUTE';
    case '15m':
      return 'INTERVAL 15 MINUTE';
    case '60m':
      return 'INTERVAL 60 MINUTE';
    case '24h':
      return 'INTERVAL 24 HOUR';
  }
}
