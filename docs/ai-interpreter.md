# AI Interpreter (Workers AI)

The AI interpreter augments the rules engine for **ambiguous** cases only:

- **Off-platform/handoff** detection when no explicit phone/email is extracted.
- **Deferred follow-up** detection + due-date estimation when no explicit deferral date is parsed.

Everything else remains rules-driven (conversion, loss, spam, price, etc).

## Modes

Set `CLASSIFIER_AI_MODE`:

- `off` (default): AI disabled.
- `workers_ai`: uses the Workers AI binding.
- `mock`: deterministic local heuristics (no network).
- `fixture`: loads JSON fixtures from `fixtures/ai/<input_hash>.json`.

Other env vars:

- `CLASSIFIER_AI_MODEL` (default `@cf/meta/llama-3-8b-instruct`)
- `CLASSIFIER_AI_PROMPT_VERSION` (default `v1`)
- `CLASSIFIER_AI_TIMEOUT_MS` (default `8000`)
- `CLASSIFIER_AI_MAX_OUTPUT_TOKENS` (default `128`)
- `CLASSIFIER_AI_DAILY_BUDGET_CALLS` (default `25`)
- `CLASSIFIER_AI_MAX_CALLS_PER_CONVERSATION_PER_DAY` (default `1`)

## Budgeting

Budgets are enforced in UTC day buckets:

- `ai_usage_daily` (global calls/day)
- `ai_usage_conversation_daily` (per-conversation calls/day)

Calls are counted only when an AI attempt succeeds (or returns a mock/fixture result).

## Fixtures

Fixture mode reads:

```
fixtures/ai/<input_hash>.json
```

The file must contain valid JSON in the strict schema:

```json
{
  "handoff": {
    "is_handoff": true,
    "type": "phone",
    "confidence": "MEDIUM",
    "evidence": "short excerpt"
  },
  "deferred": {
    "is_deferred": false,
    "bucket": null,
    "due_date_iso": null,
    "confidence": "LOW",
    "evidence": ""
  }
}
```

If the fixture is missing or invalid, AI is skipped.

## UI evidence

When AI fires, messages show “Handoff (AI)” or “Deferred (AI)” chips. Clicking the chip reveals:

- evidence excerpt
- confidence
- AI model + prompt version

## Debugging

- AI results are stored on the message `features.ai`.
- Reasons (`AI_HANDOFF`, `AI_DEFERRED`) show up in the state timeline.
- If AI is skipped, `features.ai.skipped_reason` and `features.ai.errors` capture details.
