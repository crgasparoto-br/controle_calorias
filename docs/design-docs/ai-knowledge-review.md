# AI knowledge review

## Context

Subissue #442 defines a periodic review cycle for knowledge used by the AI: rules, nutrition sources, classifications, aliases, units, household measures, interpretation heuristics, promoted memories and reusable preferences.

This delivery adds the first deterministic model in `server/modules/knowledgeReview.ts`. It does not create a new UI or durable table yet; it defines the status vocabulary and review behavior that later jobs, admin endpoints and promotion flows can persist.

## Reviewable item metadata

Each reviewable item records:

- `type`: rule, source, classification, alias, unit, measure, heuristic, promoted memory or preference;
- `key`: stable logical identifier;
- `status`: `active`, `needs_review`, `deprecated`, `replaced` or `disabled`;
- `scope`: global, tenant, user, professional or system;
- origin, version, created date, last reviewed date and approver;
- confidence and affected usage scopes;
- replacement links through `replacesId` and `replacedById`;
- metadata and review contract version.

This lets old decisions remain auditable even after a rule or source is replaced.

## Required review triggers

`evaluateKnowledgeReviewNeed` can mark an item as `needs_review` when it detects:

- age beyond policy;
- confidence below policy;
- recurrent nutrition divergence;
- negative feedback;
- drift signal;
- source replacement;
- rule conflict;
- manual review request;
- operational risk.

Signals can come from quality metrics (#417), drift detection (#434), nutrition estimate evaluation (#435), manual review, feedback or source updates.

## Active-use policy

`canUseKnowledgeAsActive` blocks disabled, deprecated and replaced items. Items in review can still be used with warning only when there is no severe blocking signal. Critical review or operational risk blocks active use and should force a safe fallback.

`selectActiveKnowledgeOrFallback` chooses the first usable candidate or returns a fallback result with a clear reason.

## Replacement and history

`replaceReviewableKnowledgeItem` marks the previous item as `replaced`, links it to the replacement, activates the new item and returns a decision object. The previous version keeps metadata and can still be referenced by old decision audit snapshots.

## Integration points

- #415 should persist versioned rules, prompts and schemas using this status vocabulary.
- #417 can emit quality signals that point to the affected reviewable item.
- #431 should check the review status before promoting a candidate globally.
- #434 can mark items for review when drift suggests degradation.
- #435 can emit nutrition divergence signals for estimates, sources or rules.
- #406 can use review status to prioritize global food classification curation.

## Fallback behavior

If validity cannot be confirmed, reduce confidence, mark the item for review or use fallback instead of promoting it. If review replacement fails, keep the previous item auditable and do not activate a partial version. If an active source is disabled, future decisions should use a traceable alternative or record a lower-confidence estimate.

## Known limits

This step does not define legal retention/privacy policy (#432), full version storage (#415), general quality metrics (#417), complete drift detection (#434) or automatic recalculation of old user history.