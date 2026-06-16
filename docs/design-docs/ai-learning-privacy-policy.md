# AI learning privacy policy

## Context

Subissue #432 defines the privacy baseline for using real messages, corrections, decisions and conversations in AI learning. This must exist before datasets, feedback loops, low-confidence queues or global rule promotion can use real user data.

The executable policy lives in `server/modules/aiLearningPrivacy.ts`.

## Data purpose separation

The policy separates data by purpose:

- `operation`: short-lived data needed to execute the current workflow;
- `audit`: sanitized traces needed for support, safety and explainability;
- `individual_learning`: user-scoped learning candidates that must not become global knowledge without additional privacy checks;
- `global_learning`: anonymized or aggregated data allowed to inform global datasets, metrics or rule candidates.

Raw message text, transcripts and media references are not treated as global learning artifacts by default.

## Data kinds

The policy distinguishes:

- raw message;
- anonymized message;
- structured decision;
- transcript;
- media reference;
- candidate rule;
- audit event.

Each record stores kind, purpose, retention class, retention days, raw-text allowance, anonymization requirement, promotion allowance, origin, scope, anonymization applied and expiration.

## Retention classes

Initial retention defaults are:

- `ephemeral`: 7 days;
- `operational`: 30 days;
- `audit`: 365 days;
- `learning_candidate`: 180 days;
- `global_aggregate`: no automatic expiration in this module because it should contain only anonymized or aggregate data.

These defaults are implementation policy, not a complete legal retention policy.

## Anonymization

`sanitizeSampleForLearning` uses the shared privacy redaction utilities and adds document/address redaction for learning samples. Direct identifiers include email, phone, CPF-like documents and address-like text.

Global learning samples should use anonymized text or structured non-identifiable decisions. `assertGlobalRuleHasNoIdentifiableData` blocks a candidate global rule if direct identifiers remain in text or structured payload.

## Promotion guard

Global rule candidates cannot store identifiable examples. Raw messages and media references are not promotable as global knowledge. Any future promotion flow (#431) must check the privacy metadata before creating or activating global rules.

## Integration points

- #410 can persist message history with raw and anonymized fields separated.
- #413 can build datasets only from anonymized/global-safe samples.
- #414 can send low-confidence items to review without exposing raw identifiers.
- #415 can include policy version in rule/prompt/schema metadata.
- #428 and #439 can run regression/replay on anonymized fixtures.
- #430 can capture feedback while preserving user-scoped and global-scoped separation.

## Out of scope

This is not a complete legal/privacy program and does not remove operational records needed for support or safety. Durable storage, deletion workflows and consent surfaces belong to follow-up implementation and product/legal review.