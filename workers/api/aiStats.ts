import type { AiInterpretation } from './aiInterpreter';

export type AiRunStats = {
  attempted: number;
  succeeded: number;
  failed: number;
  invalid_json: number;
  timeout: number;
  skipped: {
    cache_hit: number;
    no_keywords: number;
    budget_exceeded: number;
    per_convo_cap: number;
    hard_signal: number;
    mode_off: number;
  };
  results: {
    handoff_true: number;
    deferred_true: number;
    handoff_conf: { HIGH: number; MEDIUM: number; LOW: number };
    deferred_conf: { HIGH: number; MEDIUM: number; LOW: number };
  };
};

export type AiAttemptOutcome = 'ok' | 'error' | 'timeout' | 'invalid_json';

export type AiAttemptSummary = {
  attempted: boolean;
  attemptOutcome?: AiAttemptOutcome;
  skippedReason?: string;
  interpretation?: AiInterpretation | null;
};

export type AiRunStatsSummary = {
  attempted: number;
  succeeded: number;
  failed: number;
  skippedTop: { reason: string; count: number } | null;
  results: { handoff_true: number; deferred_true: number };
};

const SKIP_REASON_MAP: Record<string, keyof AiRunStats['skipped']> = {
  cache_hit: 'cache_hit',
  keyword_gate: 'no_keywords',
  empty_message: 'no_keywords',
  ai_disabled: 'mode_off',
  hard_signal_present: 'hard_signal',
  daily_budget_exceeded: 'budget_exceeded',
  budget_exceeded: 'budget_exceeded',
  conversation_budget_exceeded: 'per_convo_cap',
  per_convo_cap: 'per_convo_cap',
};

export function createAiRunStats(): AiRunStats {
  return {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    invalid_json: 0,
    timeout: 0,
    skipped: {
      cache_hit: 0,
      no_keywords: 0,
      budget_exceeded: 0,
      per_convo_cap: 0,
      hard_signal: 0,
      mode_off: 0,
    },
    results: {
      handoff_true: 0,
      deferred_true: 0,
      handoff_conf: { HIGH: 0, MEDIUM: 0, LOW: 0 },
      deferred_conf: { HIGH: 0, MEDIUM: 0, LOW: 0 },
    },
  };
}

export function recordAiRunSkip(
  stats: AiRunStats,
  reason: keyof AiRunStats['skipped'],
) {
  stats.skipped[reason] += 1;
}

function recordConfidence(
  bucket: { HIGH: number; MEDIUM: number; LOW: number },
  value: string,
) {
  if (value === 'HIGH' || value === 'MEDIUM' || value === 'LOW') {
    bucket[value] += 1;
  }
}

export function recordAiRunAttempt(
  stats: AiRunStats,
  attempt: AiAttemptSummary,
) {
  if (attempt.skippedReason) {
    const key = SKIP_REASON_MAP[attempt.skippedReason];
    if (key) {
      recordAiRunSkip(stats, key);
    }
  }

  if (!attempt.attempted) {
    return;
  }

  stats.attempted += 1;

  if (attempt.attemptOutcome === 'invalid_json') {
    stats.invalid_json += 1;
  }
  if (attempt.attemptOutcome === 'timeout') {
    stats.timeout += 1;
  }

  if (attempt.interpretation) {
    stats.succeeded += 1;
    const handoff = attempt.interpretation.handoff;
    const deferred = attempt.interpretation.deferred;
    if (handoff?.is_handoff) {
      stats.results.handoff_true += 1;
      recordConfidence(stats.results.handoff_conf, handoff.confidence);
    }
    if (deferred?.is_deferred) {
      stats.results.deferred_true += 1;
      recordConfidence(stats.results.deferred_conf, deferred.confidence);
    }
  } else {
    stats.failed += 1;
  }
}

export function summarizeAiRunStats(stats: AiRunStats): AiRunStatsSummary {
  const skippedEntries = Object.entries(stats.skipped).sort(
    (a, b) => b[1] - a[1],
  );
  const top = skippedEntries.find((entry) => entry[1] > 0) ?? null;
  return {
    attempted: stats.attempted,
    succeeded: stats.succeeded,
    failed: stats.failed,
    skippedTop: top ? { reason: top[0], count: top[1] } : null,
    results: {
      handoff_true: stats.results.handoff_true,
      deferred_true: stats.results.deferred_true,
    },
  };
}
