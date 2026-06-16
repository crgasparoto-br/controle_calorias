# Nutrition classification review

## Context

Subissue #406 asks for a recurring way to identify foods in the global catalog that should not be treated as fully classified. This first delivery adds a deterministic review routine that can be called by a manual command, scheduled job, protected admin endpoint or report builder without requiring a new persistence table in the same step.

The routine lives in `server/modules/foods/classificationReview.ts`.

## Review inputs

The routine accepts catalog-like food objects with:

- food identity, brand, status and source metadata;
- calories per 100 g and usage signals when available;
- classification metadata from either a direct `classification` object or `nutrientsPer100g.extra.classification`;
- optional policy values for minimum confidence, high usage, high calories, approved source versions and active rule version.

This keeps it compatible with the current `foods` model, the existing `nutrients_json` escape hatch and future migrated fields.

## Minimum classification contract

A food is considered fully classified only when it has enough metadata for downstream reports:

- `foodGroup`;
- `foodQuality`;
- `processingLevel`;
- at least one explicit classification flag such as fruit, vegetable or ultra processed;
- confidence at or above the configured minimum;
- origin/source metadata;
- review state when the item is no longer new.

Missing values produce a pending review item instead of allowing reports to silently treat absence as a valid negative classification.

## Queue behavior

`buildFoodClassificationReviewQueue` returns ordered review items with:

- affected food id/name/brand;
- review state: `classified`, `estimated`, `pending`, `low_confidence` or `unclassified`;
- reasons and problematic fields;
- current confidence, origin and source;
- priority and priority score;
- usage count and calorie impact;
- `reprocess` flag when an approved source or rule version changed.

Priority increases for incomplete classification, low confidence, estimated values, stale source versions, inactive/merged sources, high usage and high calorie foods.

## Reports

`summarizeFoodClassificationForReports` gives report code an explicit count of `classified`, `estimated`, `pending`, `low_confidence` and `unclassified` foods. The intended behavior is to render or aggregate these states separately, not to interpret unknown fields as false, safe or professionally reviewed.

## Review decisions

`buildFoodClassificationReviewDecision` models administrative decisions for `pending`, `reviewed`, `rejected`, `substituted` and `reprocessable`. Substitution requires a destination food id so a partial decision cannot accidentally hide an unresolved item.

## Failure and fallback behavior

The routine is pure and does not mutate classifications. A failed scheduled run can be retried without corrupting existing foods. If a classification cannot be inferred safely, it remains pending. If reprocessing creates conflict, the current classification should remain active until explicit review or approval.

## Known limits

This step does not add the full administrative UI or durable review table. It establishes the review contract and tests so a later job, endpoint or migration can persist queue entries and reviewer decisions with the same status vocabulary.