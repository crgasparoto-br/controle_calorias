# Nutrition source selection

## Context

Subissue #405 defines how meal items should expose which nutritional source was selected and whether the resulting calories/macros are exact, approximate or estimated.

This delivery keeps the selection deterministic and local. It does not implement online lookup or crawling for branded products; that remains in #407.

## Structured source metadata

Meal items may now carry `nutritionSource`, a structured object with:

- `type`: selected source class, such as branded product, curated catalog, official database, documented estimate or AI inference;
- `origin`: stable origin slug or rule identifier;
- `sourceName`, `sourceVersion` and `foodCode` when available;
- `confidence`: selection confidence from 0 to 1;
- `isEstimated`: explicit flag for estimates and approximations;
- `matchedBy`: reason or matching strategy;
- `selectedAt`: timestamp of the selection;
- `selectionVersion`: current deterministic selection contract version.

The schema remains optional for compatibility with older items and client payloads.

## Current hierarchy

The initial deterministic hierarchy is:

1. Branded product with brand/source metadata, marked as `branded_product_exact`.
2. Official database source when the source slug identifies an official table such as TACO or TBCA.
3. Curated/internal catalog source for unbranded foods or reviewed global catalog items.
4. AI-inferred nutrition, marked as estimated and reviewable.
5. Documented estimate rule when no reliable catalog source is available.

The hierarchy is exposed through `server/modules/meals/nutritionSourceSelection.ts`.

## Persistence behavior

When a meal item has `foodId`, `enrichMealItemsWithNutritionSnapshots` calculates macros from the selected catalog food and embeds `nutritionSource` into `foodSnapshotJson` together with the nutrients, source record, portion and calculated values.

For items without `foodId`, the enrichment keeps the item saveable but adds a documented estimate metadata object so downstream flows can distinguish estimated nutrition from a traced catalog source.

## Relationship with previous subissues

- #401 improves brand/product/variation recognition before source selection.
- #402 prevents zero/unsweetened beverages from inheriting calories from traditional references.
- #407 will add controlled online lookup for branded product tables.
- #435 can use `nutritionSource` and `foodSnapshotJson` to compare estimates with later confirmed sources.
- #442 can review stale source versions and rules because the selection version and source version are recorded.

## Known limits

This step does not add new database columns. Existing persisted catalog snapshots already store a JSON payload, so source metadata is embedded there first. A future migration can promote selected fields to first-class columns if reporting or indexing needs it.
