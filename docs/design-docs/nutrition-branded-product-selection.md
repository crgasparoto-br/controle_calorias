# Branded product selection

## Context

Subissue #401 improves meal interpretation when the user mentions a brand, product variation, package or size in WhatsApp text. The goal is to prefer a specific branded catalog product over a generic food when the message carries enough evidence.

Examples:

- `comi um iogurte Nestlé natural 170g`
- `pão integral Wickbold`
- `Coca-Cola zero lata`
- `Leite Molico 200ml`
- `2 fatias de queijo Polenghi light`

## Current scope

This implementation stays inside the existing nutrition engine and catalog fallback flow. It does not add online lookup, crawler behavior, durable learning or a new global food taxonomy.

The static catalog now includes representative branded products with:

- `brandName`;
- `variants`;
- `isBrandedProduct`;
- aliases covering common Portuguese orderings of brand, product and variation.

The meal draft item type can carry `brand` so the structured result preserves the brand signal for later validation and persistence.

## Selection behavior

Catalog matching now scores candidates instead of returning the first partial substring match.

The scorer prefers:

1. exact product/alias match;
2. product alias present in the user text;
3. catalog product where the mentioned brand matches `brandName`;
4. catalog product where critical variants, such as `zero`, `light`, `integral`, `desnatado`, `sem açúcar` or `tradicional`, match the user text.

A branded catalog item is not selected merely because a generic portion of its alias matches. For example, `iogurte natural 170g` continues to resolve to the generic `Iogurte natural integral`, while `iogurte Nestlé natural 170g` resolves to `Iogurte natural Nestlé`.

## Approximation behavior

When the text mentions a known brand that has no exact branded catalog item, the engine can still use a compatible generic catalog item, but the item is marked as an approximation by:

- preserving `brand` from the user text;
- capping confidence at `0.62`;
- returning `source: "heuristic"` instead of `source: "catalog"`.

This keeps the user-visible result reviewable and avoids false certainty that the exact branded table was found.

## Known limits

This is not the full source-selection layer from #405/#407. It improves local selection for known catalog products and preserves approximation signals, but external nutritional source lookup, richer provenance and review routing remain in later subissues.
