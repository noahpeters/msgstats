# Conversation Inspector Inference (v1)

This document describes the Inferred Engagement Intelligence Model (v1) used by the Conversation Inspector.

## States (v1)

- `NEW`
- `ENGAGED`
- `PRODUCTIVE`
- `HIGHLY_PRODUCTIVE`
- `PRICE_GIVEN`
- `DEFERRED`
- `OFF_PLATFORM`
- `CONVERTED`
- `RESURRECTED`
- `LOST`
- `SPAM`

## Feature Extraction

Per-message feature extraction powers rule hits and the state engine:

- `has_phone_number`
- `has_email`
- `has_currency`
- `contains_price_terms`
- `contains_opt_out`
- `contains_schedule_terms`
- `contains_deferral_phrase`
- `deferral_date_hint`
- `contains_conversion_phrase`
- `contains_loss_phrase`
- `contains_spam_phrase`
- `has_link`
- `message_length`

Features and rule hits are stored on each message for auditability.

## Rule Precedence

Highest-priority rules win when they fire:

1. `SPAM`
2. `CONVERTED`
3. `LOST`
4. `OFF_PLATFORM`
5. `DEFERRED`
6. `PRICE_GIVEN`
7. `HIGHLY_PRODUCTIVE`
8. `PRODUCTIVE`
9. `ENGAGED`
10. `NEW`

`RESURRECTED` is tracked as an event when a new inbound arrives after a long gap from a prior `LOST`, `DEFERRED`, or `OFF_PLATFORM` state.

## Follow-up Suggestions

Suggestions are computed from state + last inbound/outbound timestamps:

- `Reply recommended` if last inbound is unanswered.
- `Follow up later` or `Follow up now` when `DEFERRED` and a due date exists.
- `Visibility lost (off-platform)` for `OFF_PLATFORM`.
- No suggestion for `LOST` or `SPAM`.

## Configurable Thresholds

Defaults are configurable via env vars:

- `INBOX_SLA_HOURS` (default 24)
- `INBOX_LOST_AFTER_PRICE_DAYS` (default 60)
- `INBOX_RESURRECT_GAP_DAYS` (default 30)
- `INBOX_DEFER_DEFAULT_DAYS` (default 30)

## App Review Demo Steps

1. Connect a Page or Instagram business account.
2. Open `/inbox`.
3. Select a conversation and review the state timeline + message decorations.
4. Send a reply from the inspector.
5. Verify delivery in Messenger or Instagram native client.
