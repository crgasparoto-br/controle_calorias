# Nutrition estimate evaluation

## Context

Subissue #435 defines how estimated nutrition values should be compared with confirmed sources when better catalog data, manufacturer labels or curated sources become available later.

Previous deliveries already made the required source metadata available:

- #405 marks meal items with `nutritionSource`, including source type, confidence, rule/version and `isEstimated`.
- #407 defines the controlled lookup contract for branded product sources.
- #406 defines review states and prioritization for foods that need curation.

This delivery adds the deterministic comparison layer in `server/modules/meals/nutritionEstimateEvaluation.ts`.

## What is compared

The evaluator compares an estimated record with a confirmed record for the same food/product context. Each side contains:

- food, brand, category, preparation, unit and grams when available;
- calories, protein, carbs and fat for the compared portion;
- structured source metadata from `nutritionSourceSelection`.

The helper `buildMacroValuesFromPer100g` converts confirmed per-100g catalog values to the same portion before comparison.

## Error calculation

For calories and macros, the evaluator calculates:

- estimated value;
- confirmed value;
- absolute error;
- relative error when the confirmed value is not zero.

Default relevant divergence thresholds are:

- calories: 50 kcal absolute or 25% relative;
- macros: 8 g absolute or 30% relative.

Thresholds are configurable per call so future review jobs can tune sensitivity by risk or category.

## Review signal

A comparison only becomes reviewable when the original source is marked as estimated, AI inferred or pending review. Confirmed catalog sources are not treated as bad estimates.

Relevant divergences return:

- `reviewReason: estimated_vs_confirmed_divergence`;
- `reviewPriority` from low to critical;
- confidence adjustment for future occurrences of the same pattern;
- the original estimated source and the confirmed source for traceability.

This can feed the review queue from #406 or later quality metrics from #417.

## Category metrics

`aggregateNutritionEstimateErrorMetrics` groups comparison results by category and reports:

- sample count;
- count of relevant divergences;
- average absolute calorie error;
- average and maximum relative calorie error;
- average maximum relative error across all nutrients.

This highlights categories where fallback or AI estimates are systematically weak.

## Confidence feedback

`adjustFutureEstimateConfidence` applies the confidence adjustments from one or more evaluations to a future pattern confidence, bounded between 0 and 1. It does not mutate prompts, catalog values or historical records by itself.

## Out of scope

This step does not recalculate historical meals automatically and does not treat an untraceable source as truth. Ambiguous comparisons should stay in review instead of replacing human curation.