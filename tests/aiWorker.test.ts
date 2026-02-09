import { describe, expect, it } from 'vitest';
import {
  computeInputHash,
  getAiPromptInput,
} from '../workers/api/aiInterpreter';
import {
  getAiConfig,
  resolveAiMaxInputChars,
  runAiAttemptForMessage,
  type AiEnv,
} from '../workers/api/aiRun';
import type { MessageFeatures } from '../workers/api/inference';

const baseFeatures = (messageText: string): MessageFeatures => ({
  has_phone_number: false,
  has_email: false,
  has_price_rejection_phrase: false,
  has_indefinite_deferral_phrase: false,
  has_spam_content: false,
  has_currency: false,
  contains_price_terms: false,
  contains_opt_out: false,
  contains_schedule_terms: false,
  contains_deferral_phrase: false,
  deferral_date_hint: null,
  contains_conversion_phrase: false,
  contains_loss_phrase: false,
  contains_spam_phrase: false,
  contains_system_assignment: false,
  has_link: false,
  message_length: messageText.length,
});

describe('ai usage budgeting', () => {
  it('counts failed workers_ai attempts against budgets', async () => {
    const env = {
      CLASSIFIER_AI_MODE: 'workers_ai',
      CLASSIFIER_AI_DAILY_BUDGET_CALLS: '1',
      CLASSIFIER_AI_MAX_CALLS_PER_CONVERSATION_PER_DAY: '1',
    } as AiEnv;
    const aiConfig = getAiConfig(env);
    const messageText = 'call me next week';
    const incrementCalls: number[] = [];
    const first = await runAiAttemptForMessage({
      aiMode: aiConfig.mode,
      aiConfig,
      envAi: {
        run: async () => {
          throw new Error('boom');
        },
      },
      messageText,
      contextDigest: 'ctx',
      extractedFeatures: baseFeatures(messageText),
      dailyCalls: 0,
      conversationCalls: 0,
      incrementUsage: async () => {
        incrementCalls.push(1);
      },
    });

    expect(first.attempted).toBe(true);
    expect(first.attemptOutcome).toBe('error');
    expect(first.errors).toEqual(['boom']);
    expect(first.dailyCalls).toBe(1);
    expect(first.conversationCalls).toBe(1);
    expect(incrementCalls).toHaveLength(1);

    const second = await runAiAttemptForMessage({
      aiMode: aiConfig.mode,
      aiConfig,
      envAi: {
        run: async () => {
          throw new Error('should_not_run');
        },
      },
      messageText,
      contextDigest: 'ctx',
      extractedFeatures: baseFeatures(messageText),
      dailyCalls: first.dailyCalls,
      conversationCalls: first.conversationCalls,
      incrementUsage: async () => {
        incrementCalls.push(1);
      },
    });

    expect(second.attempted).toBe(false);
    expect(second.skippedReason).toBe('daily_budget_exceeded');
    expect(incrementCalls).toHaveLength(1);
  });

  it('does not count cache hits as attempts', async () => {
    const env = {
      CLASSIFIER_AI_MODE: 'workers_ai',
      CLASSIFIER_AI_DAILY_BUDGET_CALLS: '5',
      CLASSIFIER_AI_MAX_CALLS_PER_CONVERSATION_PER_DAY: '5',
    } as AiEnv;
    const aiConfig = getAiConfig(env);
    const messageText = 'call me next week';
    const contextDigest = 'ctx';
    const promptInput = getAiPromptInput(messageText, aiConfig.maxInputChars);
    const inputSeed = `${promptInput.normalizedText}|${aiConfig.promptVersion}|${aiConfig.model}|${contextDigest}`;
    const inputHash = await computeInputHash(inputSeed);
    const existingAi = {
      input_hash: inputHash,
      interpretation: {
        handoff: {
          is_handoff: true,
          type: 'phone',
          confidence: 'LOW',
          evidence: 'call me',
        },
        deferred: {
          is_deferred: false,
          bucket: null,
          due_date_iso: null,
          confidence: 'LOW',
          evidence: '',
        },
      },
    };

    const incrementCalls: number[] = [];
    const result = await runAiAttemptForMessage({
      aiMode: aiConfig.mode,
      aiConfig,
      envAi: {
        run: async () => {
          throw new Error('should_not_run');
        },
      },
      messageText,
      contextDigest,
      extractedFeatures: baseFeatures(messageText),
      existingAi,
      dailyCalls: 0,
      conversationCalls: 0,
      incrementUsage: async () => {
        incrementCalls.push(1);
      },
    });

    expect(result.cacheHit).toBe(true);
    expect(result.attempted).toBe(false);
    expect(result.skippedReason).toBe('cache_hit');
    expect(result.interpretation).toEqual(existingAi.interpretation);
    expect(incrementCalls).toHaveLength(0);
  });
});

describe('ai max input env parsing', () => {
  it('clamps max input chars and applies defaults', () => {
    expect(resolveAiMaxInputChars(undefined)).toBe(1000);
    expect(resolveAiMaxInputChars('50')).toBe(200);
    expect(resolveAiMaxInputChars('6000')).toBe(5000);
    expect(resolveAiMaxInputChars('2000')).toBe(2000);
  });
});
