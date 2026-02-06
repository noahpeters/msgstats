import { describe, expect, test } from 'vitest';
import {
  computeInputHash,
  getAiPromptInput,
  interpretAmbiguity,
  mapDeferredBucketToDate,
  shouldAllowAiCall,
  shouldRunAI,
  validateAiOutput,
} from '../workers/api/aiInterpreter';

describe('aiInterpreter helpers', () => {
  test('shouldRunAI gates on keywords', () => {
    const result = shouldRunAI({
      messageText: 'hello there',
      extractedFeatures: {},
      mode: 'mock',
    });
    expect(result.run).toBe(false);
    expect(result.reason).toBe('keyword_gate');
  });

  test('shouldRunAI skips when explicit contact present', () => {
    const result = shouldRunAI({
      messageText: 'call me at 415-555-1212',
      extractedFeatures: { has_phone_number: true },
      mode: 'mock',
    });
    expect(result.run).toBe(false);
    expect(result.reason).toBe('hard_signal_present');
  });

  test('computeInputHash is deterministic', async () => {
    const hashA = await computeInputHash('hello|v1');
    const hashB = await computeInputHash('hello|v1');
    expect(hashA).toBe(hashB);
  });

  test('validateAiOutput rejects malformed payloads', () => {
    expect(validateAiOutput({})).toBeNull();
    expect(validateAiOutput('not json')).toBeNull();
  });

  test('mapDeferredBucketToDate returns date string', () => {
    const dateOnly = mapDeferredBucketToDate(
      'NEXT_WEEK',
      new Date('2026-02-01T00:00:00Z'),
    );
    expect(dateOnly).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('shouldAllowAiCall enforces budgets', () => {
    expect(
      shouldAllowAiCall({
        dailyCalls: 5,
        conversationCalls: 0,
        maxDaily: 5,
        maxPerConversation: 2,
      }).allowed,
    ).toBe(false);
    expect(
      shouldAllowAiCall({
        dailyCalls: 0,
        conversationCalls: 2,
        maxDaily: 5,
        maxPerConversation: 2,
      }).allowed,
    ).toBe(false);
  });

  test('truncates prompt input and hashes truncated text', async () => {
    const messageText = 'x'.repeat(1200);
    const promptInput = getAiPromptInput(messageText, 1000);
    expect(promptInput.inputTruncated).toBe(true);
    expect(promptInput.inputChars).toBe(1000);
    const truncatedSeed = `${promptInput.normalizedText}|v1|model|ctx`;
    const fullSeed = `${messageText.trim().toLowerCase()}|v1|model|ctx`;
    const truncatedHash = await computeInputHash(truncatedSeed);
    const fullHash = await computeInputHash(fullSeed);
    expect(truncatedHash).not.toBe(fullHash);
  });

  test('interpretAmbiguity uses truncated prompt text', async () => {
    const messageText = 'a'.repeat(1100) + ' tail';
    const promptInput = getAiPromptInput(messageText, 1000);
    const inputSeed = `${promptInput.normalizedText}|v1|model|ctx`;
    const inputHash = await computeInputHash(inputSeed);
    let captured: unknown;
    const envAi = {
      run: async (_model: string, input: unknown) => {
        captured = input;
        return {
          response: {
            handoff: {
              is_handoff: false,
              type: null,
              confidence: 'LOW',
              evidence: '',
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
      },
    };
    await interpretAmbiguity({
      envAi,
      mode: 'workers_ai',
      model: 'model',
      promptVersion: 'v1',
      timeoutMs: 1000,
      maxOutputTokens: 32,
      maxInputChars: 1000,
      inputHash,
      messageText,
      contextDigest: 'ctx',
      extractedFeatures: {},
    });
    const content =
      (captured as { messages?: Array<{ content?: string }> })?.messages?.[1]
        ?.content ?? '';
    expect(content).toContain(promptInput.promptText);
    expect(content).not.toContain(messageText.slice(1000));
  });
});
