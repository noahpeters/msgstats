export type ReportErrorEnv = {
  AE_APP_ERRORS: AnalyticsEngineDataset;
};

export type ReportErrorInput = {
  errorKey: string;
  kind: string;
  route: string;
  workspaceId?: string | null;
  assetId?: string | null;
  severity?: string;
  message?: string;
};

function normalizeString(value: string | null | undefined): string {
  return value ? value : '';
}

export function reportError(env: ReportErrorEnv, input: ReportErrorInput) {
  const severity = input.severity ?? 'error';
  const payload = {
    service: 'app',
    kind: input.kind,
    severity,
    errorKey: input.errorKey,
    route: input.route,
  };
  console.info(JSON.stringify(payload));
  try {
    env.AE_APP_ERRORS.writeDataPoint({
      blobs: [
        'app',
        input.kind,
        severity,
        input.errorKey,
        input.route,
        normalizeString(input.workspaceId ?? undefined),
        normalizeString(input.assetId ?? undefined),
      ],
      doubles: [1],
    });
  } catch (error) {
    console.warn('Failed to write app error telemetry', {
      errorKey: input.errorKey,
      route: input.route,
      error: error instanceof Error ? error.message : error,
    });
  }
}
