# Controlled online nutrition source lookup

## Context

Subissue #407 adds the controlled lookup contract for branded products that may need a specific nutrition table before falling back to generic food or an estimate.

This implementation intentionally avoids unrestricted internet crawling. The runtime integration point is a provider interface that can be backed by an approved connector, curated service or future cache.

## Trigger behavior

The lookup should run only when:

- the item has a brand or branded-product signal;
- the internal catalog does not already have an exact trusted source for that product.

Unbranded foods and products already resolved to an exact internal source skip the online lookup.

## Allowed sources

The first allowlist is explicit and conservative:

- manufacturer domains for known branded references;
- official/curated Brazilian food tables such as TACO/TBCA;
- no arbitrary domains by default.

Candidate source types carry different confidence:

1. `manufacturer`;
2. `official_label`;
3. `curated_database`;
4. `trusted_retailer`;
5. `aggregator`;
6. `community`.

Sources outside the allowlist return `unsafe_source` and cannot be used as exact nutrition.

## Selection behavior

`onlineNutritionSource` compares candidates using:

- brand match;
- product-name token overlap;
- critical variants such as `zero`, `light`, `integral`, `sem açúcar` and equivalents passed by the caller;
- source confidence;
- safe portion/unit conversion.

Results can be:

- `exact`: high-confidence source and safe portion normalization;
- `similar`: plausible source, but lower confidence or non-convertible portion;
- `ambiguous`: multiple close candidates;
- `not_found`: no candidate met minimum confidence;
- `unsafe_source`: returned domains are not allowed;
- `provider_error`: external lookup failed;
- `skipped`: lookup should not run.

## Fallback behavior

Provider failure, timeout, unsafe domain, low similarity, conflict or non-convertible portion must not break the WhatsApp flow. The caller should fall back to #405 source selection, using internal catalog, generic source, documented estimate or clarification/review depending on risk.

## Validation

Coverage lives in `server/modules/meals/onlineNutritionSource.test.ts` and verifies:

- trigger rules for branded products;
- exact manufacturer source with quantity normalization;
- zero variation not being replaced by traditional;
- conflicting close candidates becoming ambiguous;
- non-convertible portions not being normalized;
- unsafe domains blocked;
- provider errors returning safe fallback.

## Known limits

This step does not configure a production search provider, crawler or cache. It creates the safe contract and scoring layer that an approved provider can call without giving arbitrary online data authority to persist exact nutrition.
