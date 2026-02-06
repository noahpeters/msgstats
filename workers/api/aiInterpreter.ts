export type AiMode = 'off' | 'workers_ai' | 'mock' | 'fixture';
export type AiConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type AiDeferredBucket =
  | 'EXACT_DATE'
  | 'NEXT_WEEK'
  | 'NEXT_MONTH'
  | 'NEXT_QUARTER'
  | 'AFTER_HOLIDAYS'
  | 'SOMETIME_LATER';
export type AiHandoffType =
  | 'phone'
  | 'email'
  | 'website'
  | 'in_person'
  | 'other'
  | null;

export type AiInterpretation = {
  handoff: {
    is_handoff: boolean;
    type: AiHandoffType;
    confidence: AiConfidence;
    evidence: string;
  };
  deferred: {
    is_deferred: boolean;
    bucket: AiDeferredBucket | null;
    due_date_iso: string | null;
    confidence: AiConfidence;
    evidence: string;
  };
};

export type AiInterpreterMeta = {
  inputHash: string;
  contextDigest: string;
  model: string;
  promptVersion: string;
};

export type AiPromptInput = {
  promptText: string;
  normalizedText: string;
  inputChars: number;
  inputTruncated: boolean;
};

export type ShouldRunAiResult = {
  run: boolean;
  reason: string;
  needsHandoff: boolean;
  needsDeferred: boolean;
};

const HANDOFF_KEYWORDS = [
  'call',
  'phone',
  'text',
  'sms',
  'cell',
  'number',
  'reach out',
  'offline',
  'email',
  'contact me',
  'whatsapp',
];

const DEFER_KEYWORDS = [
  'next',
  'later',
  'after',
  'holiday',
  'holidays',
  'month',
  'week',
  'year',
  'q1',
  'q2',
  'q3',
  'q4',
  'summer',
  'winter',
  'spring',
  'fall',
  'circle back',
  'touch base',
  'check back',
];

const JSON_SCHEMA_HINT = `Return JSON only in this exact shape:
{
  "handoff": {
    "is_handoff": true|false,
    "type": "phone"|"email"|"website"|"in_person"|"other"|null,
    "confidence": "HIGH"|"MEDIUM"|"LOW",
    "evidence": "short excerpt"
  },
  "deferred": {
    "is_deferred": true|false,
    "bucket": "EXACT_DATE"|"NEXT_WEEK"|"NEXT_MONTH"|"NEXT_QUARTER"|"AFTER_HOLIDAYS"|"SOMETIME_LATER"|null,
    "due_date_iso": "YYYY-MM-DD"|null,
    "confidence": "HIGH"|"MEDIUM"|"LOW",
    "evidence": "short excerpt"
  }
}`;

export const defaultAiModel = '@cf/meta/llama-3-8b-instruct';

export function getAiMode(raw?: string | null): AiMode {
  const value = raw?.trim().toLowerCase();
  if (value === 'workers_ai') return 'workers_ai';
  if (value === 'mock') return 'mock';
  if (value === 'fixture') return 'fixture';
  return 'off';
}

export function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function getAiPromptInput(
  messageText: string,
  maxInputChars: number,
): AiPromptInput {
  const safeMax = Math.max(1, Math.floor(maxInputChars));
  const inputTruncated = messageText.length > safeMax;
  const promptText = inputTruncated
    ? messageText.slice(0, safeMax)
    : messageText;
  return {
    promptText,
    normalizedText: normalizeText(promptText),
    inputChars: promptText.length,
    inputTruncated,
  };
}

export function buildContextDigest(
  messages: Array<{ direction: string; text: string | null }>,
  limit = 4,
): string {
  const slice = messages.slice(-limit);
  return slice
    .map((msg) => {
      const text = msg.text ?? '';
      const trimmed = text.length > 120 ? `${text.slice(0, 117)}...` : text;
      return `${msg.direction}:${trimmed}`;
    })
    .join(' | ');
}

export async function computeInputHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(hashBuffer));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function shouldRunAI(options: {
  messageText: string | null;
  extractedFeatures: {
    has_phone_number?: boolean;
    has_email?: boolean;
    deferral_date_hint?: string | null;
  };
  mode: AiMode;
}): ShouldRunAiResult {
  if (options.mode === 'off') {
    return {
      run: false,
      reason: 'ai_disabled',
      needsHandoff: false,
      needsDeferred: false,
    };
  }
  const text = options.messageText ?? '';
  const normalized = normalizeText(text);
  if (!normalized) {
    return {
      run: false,
      reason: 'empty_message',
      needsHandoff: false,
      needsDeferred: false,
    };
  }
  const handoffKeyword = HANDOFF_KEYWORDS.some((word) =>
    normalized.includes(word),
  );
  const deferredKeyword = DEFER_KEYWORDS.some((word) =>
    normalized.includes(word),
  );
  if (!handoffKeyword && !deferredKeyword) {
    return {
      run: false,
      reason: 'keyword_gate',
      needsHandoff: false,
      needsDeferred: false,
    };
  }
  const needsHandoff =
    handoffKeyword &&
    !options.extractedFeatures.has_phone_number &&
    !options.extractedFeatures.has_email;
  const needsDeferred =
    deferredKeyword && !options.extractedFeatures.deferral_date_hint;
  if (!needsHandoff && !needsDeferred) {
    return {
      run: false,
      reason: 'hard_signal_present',
      needsHandoff: false,
      needsDeferred: false,
    };
  }
  return {
    run: true,
    reason: 'eligible',
    needsHandoff,
    needsDeferred,
  };
}

export function validateAiOutput(raw: unknown): AiInterpretation | null {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const handoff = (obj as AiInterpretation).handoff;
  const deferred = (obj as AiInterpretation).deferred;
  if (!handoff || !deferred) return null;
  const validConfidence = (value: unknown): value is AiConfidence =>
    value === 'HIGH' || value === 'MEDIUM' || value === 'LOW';
  const validBucket = (value: unknown): value is AiDeferredBucket | null =>
    value === null ||
    value === 'EXACT_DATE' ||
    value === 'NEXT_WEEK' ||
    value === 'NEXT_MONTH' ||
    value === 'NEXT_QUARTER' ||
    value === 'AFTER_HOLIDAYS' ||
    value === 'SOMETIME_LATER';
  const validType = (value: unknown): value is AiHandoffType =>
    value === null ||
    value === 'phone' ||
    value === 'email' ||
    value === 'website' ||
    value === 'in_person' ||
    value === 'other';
  if (typeof handoff.is_handoff !== 'boolean') return null;
  if (!validType(handoff.type)) return null;
  if (!validConfidence(handoff.confidence)) return null;
  if (typeof handoff.evidence !== 'string') return null;
  if (typeof deferred.is_deferred !== 'boolean') return null;
  if (!validBucket(deferred.bucket)) return null;
  if (!validConfidence(deferred.confidence)) return null;
  if (typeof deferred.evidence !== 'string') return null;
  if (deferred.due_date_iso !== null) {
    if (typeof deferred.due_date_iso !== 'string') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deferred.due_date_iso)) return null;
  }

  const clampEvidence = (value: string) =>
    value.length > 120 ? value.slice(0, 120) : value;

  return {
    handoff: {
      ...handoff,
      evidence: clampEvidence(handoff.evidence),
    },
    deferred: {
      ...deferred,
      evidence: clampEvidence(deferred.evidence),
    },
  };
}

export async function interpretAmbiguity(options: {
  envAi:
    | {
        run: (
          model: string,
          input: unknown,
          options?: unknown,
        ) => Promise<unknown>;
      }
    | undefined;
  mode: AiMode;
  model: string;
  promptVersion: string;
  timeoutMs: number;
  maxOutputTokens: number;
  maxInputChars: number;
  inputHash: string;
  messageText: string;
  contextDigest: string;
  extractedFeatures: Record<string, unknown>;
}): Promise<AiInterpretation | null> {
  const promptInput = getAiPromptInput(
    options.messageText,
    options.maxInputChars,
  );
  const normalized = promptInput.normalizedText;
  if (!normalized) return null;
  if (options.mode === 'mock') {
    const lower = normalized;
    const isDeferred =
      /(next month|after the holidays|after holidays|next week|next quarter|next year)/i.test(
        lower,
      );
    const deferredBucket: AiDeferredBucket | null = lower.includes('next month')
      ? 'NEXT_MONTH'
      : lower.includes('next week')
        ? 'NEXT_WEEK'
        : lower.includes('next quarter')
          ? 'NEXT_QUARTER'
          : lower.includes('holiday')
            ? 'AFTER_HOLIDAYS'
            : isDeferred
              ? 'SOMETIME_LATER'
              : null;
    const isHandoff =
      /(call me|text me|reach out|contact me|phone|whatsapp)/i.test(lower);
    return {
      handoff: {
        is_handoff: isHandoff,
        type: isHandoff ? 'phone' : null,
        confidence: isHandoff ? 'MEDIUM' : 'LOW',
        evidence: isHandoff ? promptInput.promptText.slice(0, 120) : '',
      },
      deferred: {
        is_deferred: Boolean(isDeferred),
        bucket: isDeferred ? deferredBucket : null,
        due_date_iso: null,
        confidence: isDeferred ? 'MEDIUM' : 'LOW',
        evidence: isDeferred ? promptInput.promptText.slice(0, 120) : '',
      },
    };
  }

  if (options.mode === 'fixture') {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const path = resolve(process.cwd(), 'fixtures', 'ai');
    const file = resolve(path, `${options.inputHash}.json`);
    const content = await readFile(file, 'utf-8');
    const parsed = validateAiOutput(JSON.parse(content));
    if (!parsed) {
      throw new Error('ai_fixture_invalid');
    }
    return parsed;
  }

  if (options.mode === 'workers_ai') {
    if (!options.envAi) {
      throw new Error('ai_binding_missing');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const input = {
        messages: [
          {
            role: 'system',
            content:
              'Return valid JSON only. No prose. If unsure set LOW confidence and prefer false.',
          },
          {
            role: 'user',
            content: `${JSON_SCHEMA_HINT}\n\nMessage:\n${promptInput.promptText}\n\nContext:\n${options.contextDigest}\n\nExtracted features:\n${JSON.stringify(
              options.extractedFeatures,
            )}`,
          },
        ],
      };
      const result = await options.envAi.run(options.model, input, {
        max_tokens: options.maxOutputTokens,
        temperature: 0,
        signal: controller.signal,
      });
      const parsed = validateAiOutput(
        (result as { response?: unknown })?.response ?? result,
      );
      if (!parsed) {
        throw new Error('ai_invalid_output');
      }
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

export function mapDeferredBucketToDate(
  bucket: AiDeferredBucket,
  now: Date,
): string {
  const next = new Date(now.getTime());
  switch (bucket) {
    case 'NEXT_WEEK':
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'NEXT_MONTH':
      next.setUTCDate(next.getUTCDate() + 30);
      break;
    case 'NEXT_QUARTER':
      next.setUTCDate(next.getUTCDate() + 90);
      break;
    case 'AFTER_HOLIDAYS':
      if (next.getUTCMonth() >= 10) {
        next.setUTCFullYear(next.getUTCFullYear() + 1, 0, 15);
      } else {
        next.setUTCDate(next.getUTCDate() + 60);
      }
      break;
    case 'SOMETIME_LATER':
    default:
      next.setUTCDate(next.getUTCDate() + 30);
  }
  return next.toISOString().slice(0, 10);
}

export function shouldAllowAiCall(options: {
  dailyCalls: number;
  conversationCalls: number;
  maxDaily: number;
  maxPerConversation: number;
}): { allowed: boolean; reason?: string } {
  if (options.dailyCalls >= options.maxDaily) {
    return { allowed: false, reason: 'daily_budget_exceeded' };
  }
  if (options.conversationCalls >= options.maxPerConversation) {
    return { allowed: false, reason: 'conversation_budget_exceeded' };
  }
  return { allowed: true };
}
