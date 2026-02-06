import {
  computeInputHash,
  defaultAiModel,
  getAiPromptInput,
  getAiMode,
  interpretAmbiguity,
  type AiInterpretation,
  shouldRunAI,
} from './aiInterpreter';
import type { MessageFeatures } from './inference';

export type AiAttemptOutcome = 'ok' | 'error' | 'timeout' | 'invalid_json';

export type AiAttemptResult = {
  inputHash: string;
  inputChars: number;
  inputTruncated: boolean;
  interpretation: AiInterpretation | null;
  skippedReason?: string;
  errors: string[];
  attempted: boolean;
  attemptOutcome?: AiAttemptOutcome;
  dailyCalls: number;
  conversationCalls: number;
  cacheHit: boolean;
};

export type AiConfig = {
  mode: ReturnType<typeof getAiMode>;
  model: string;
  promptVersion: string;
  timeoutMs: number;
  maxOutputTokens: number;
  maxInputChars: number;
  dailyBudget: number;
  maxCallsPerConversation: number;
};

export type AiEnv = {
  CLASSIFIER_AI_MODE?: string;
  CLASSIFIER_AI_MODEL?: string;
  CLASSIFIER_AI_PROMPT_VERSION?: string;
  CLASSIFIER_AI_TIMEOUT_MS?: string;
  CLASSIFIER_AI_MAX_OUTPUT_TOKENS?: string;
  CLASSIFIER_AI_MAX_INPUT_CHARS?: string;
  CLASSIFIER_AI_DAILY_BUDGET_CALLS?: string;
  CLASSIFIER_AI_MAX_CALLS_PER_CONVERSATION_PER_DAY?: string;
};

const AI_MAX_INPUT_CHARS_DEFAULT = 1000;
const AI_MAX_INPUT_CHARS_MIN = 200;
const AI_MAX_INPUT_CHARS_MAX = 5000;

function parseNumberEnv(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveAiMaxInputChars(raw?: string) {
  const parsed = parseNumberEnv(raw, AI_MAX_INPUT_CHARS_DEFAULT);
  const rounded = Math.round(parsed);
  return Math.min(
    AI_MAX_INPUT_CHARS_MAX,
    Math.max(AI_MAX_INPUT_CHARS_MIN, rounded),
  );
}

export function getAiConfig(env: AiEnv): AiConfig {
  const mode = getAiMode(env.CLASSIFIER_AI_MODE);
  return {
    mode,
    model: env.CLASSIFIER_AI_MODEL?.trim() || defaultAiModel,
    promptVersion: env.CLASSIFIER_AI_PROMPT_VERSION?.trim() || 'v1',
    timeoutMs: Math.max(
      1000,
      parseNumberEnv(env.CLASSIFIER_AI_TIMEOUT_MS, 8000),
    ),
    maxOutputTokens: Math.max(
      32,
      parseNumberEnv(env.CLASSIFIER_AI_MAX_OUTPUT_TOKENS, 128),
    ),
    maxInputChars: resolveAiMaxInputChars(env.CLASSIFIER_AI_MAX_INPUT_CHARS),
    dailyBudget: Math.max(
      0,
      parseNumberEnv(env.CLASSIFIER_AI_DAILY_BUDGET_CALLS, 25),
    ),
    maxCallsPerConversation: Math.max(
      0,
      parseNumberEnv(env.CLASSIFIER_AI_MAX_CALLS_PER_CONVERSATION_PER_DAY, 1),
    ),
  };
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

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

function classifyAiAttemptOutcome(error: unknown): AiAttemptOutcome {
  const message = errorMessage(error).toLowerCase();
  if (message.includes('abort') || message.includes('timeout')) {
    return 'timeout';
  }
  if (message.includes('ai_invalid_output') || message.includes('invalid')) {
    return 'invalid_json';
  }
  return 'error';
}

export async function runAiAttemptForMessage(options: {
  aiMode: AiConfig['mode'];
  aiConfig: AiConfig;
  envAi:
    | {
        run: (
          model: string,
          input: unknown,
          options?: unknown,
        ) => Promise<unknown>;
      }
    | undefined;
  messageText: string;
  contextDigest: string;
  extractedFeatures: MessageFeatures;
  existingAi?: MessageFeatures['ai'];
  dailyCalls: number;
  conversationCalls: number;
  incrementUsage: () => Promise<void>;
}): Promise<AiAttemptResult> {
  const promptInput = getAiPromptInput(
    options.messageText,
    options.aiConfig.maxInputChars,
  );
  const inputSeed = `${promptInput.normalizedText}|${options.aiConfig.promptVersion}|${options.aiConfig.model}|${options.contextDigest}`;
  const inputHash = await computeInputHash(inputSeed);
  const decision = shouldRunAI({
    messageText: options.messageText,
    extractedFeatures: {
      has_phone_number: options.extractedFeatures.has_phone_number,
      has_email: options.extractedFeatures.has_email,
      deferral_date_hint: options.extractedFeatures.deferral_date_hint,
    },
    mode: options.aiMode,
  });

  let interpretation: AiInterpretation | null = null;
  let skippedReason: string | undefined;
  let errors: string[] = [];
  let attempted = false;
  let attemptOutcome: AiAttemptOutcome | undefined;
  let cacheHit = false;
  let { dailyCalls, conversationCalls } = options;

  if (!decision.run) {
    skippedReason = decision.reason;
  } else if (
    options.existingAi?.input_hash === inputHash &&
    options.existingAi.interpretation
  ) {
    interpretation = options.existingAi.interpretation as AiInterpretation;
    skippedReason = 'cache_hit';
    cacheHit = true;
  } else {
    const budget = shouldAllowAiCall({
      dailyCalls,
      conversationCalls,
      maxDaily: options.aiConfig.dailyBudget,
      maxPerConversation: options.aiConfig.maxCallsPerConversation,
    });
    if (!budget.allowed) {
      skippedReason = budget.reason ?? 'budget_exceeded';
    } else {
      attempted = true;
      if (options.aiMode === 'workers_ai') {
        await options.incrementUsage();
        dailyCalls += 1;
        conversationCalls += 1;
      }
      try {
        interpretation = await interpretAmbiguity({
          envAi: options.envAi,
          mode: options.aiMode,
          model: options.aiConfig.model,
          promptVersion: options.aiConfig.promptVersion,
          timeoutMs: options.aiConfig.timeoutMs,
          maxOutputTokens: options.aiConfig.maxOutputTokens,
          maxInputChars: options.aiConfig.maxInputChars,
          inputHash,
          messageText: options.messageText,
          contextDigest: options.contextDigest,
          extractedFeatures: options.extractedFeatures,
        });
        attemptOutcome = 'ok';
        if (options.aiMode !== 'workers_ai' && interpretation) {
          await options.incrementUsage();
          dailyCalls += 1;
          conversationCalls += 1;
        }
      } catch (error) {
        errors = [errorMessage(error)];
        attemptOutcome = classifyAiAttemptOutcome(error);
      }
    }
  }

  return {
    inputHash,
    inputChars: promptInput.inputChars,
    inputTruncated: promptInput.inputTruncated,
    interpretation,
    skippedReason,
    errors,
    attempted,
    attemptOutcome,
    dailyCalls,
    conversationCalls,
    cacheHit,
  };
}
