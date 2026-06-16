# Low-calorie beverage handling

## Context

Subissue #402 covers beverage messages such as `3 xícaras de café sem açúcar`, where the nutrition engine should not create a meaningful calorie load for drinks that are explicitly plain, black, natural or unsweetened.

## Current scope

The implementation uses explicit static catalog references for drinks whose calories are zero or practically zero when no caloric complement is present:

- `Café sem açúcar`;
- `Chá sem açúcar`;
- `Água`;
- `Água com gás`.

Coffee and tea entries intentionally use only qualified aliases, such as `sem açúcar`, `sem adição de açúcar`, `puro`, `preto` or `natural`. They do not include bare `café` or `chá` aliases, because those messages can be ambiguous and may include milk, sugar, honey, cream or another caloric complement.

Water and sparkling water remain zero-calorie catalog items because the base drink is already non-caloric.

## Selection behavior

When a user sends a qualified beverage phrase, the normal catalog fallback resolves the item to the low-calorie reference and keeps the original quantity and unit from the message.

Examples:

- `3 xícaras de café sem açúcar` resolves to `Café sem açúcar` with practically zero calories;
- `2 copos de chá sem adição de açúcar` resolves to `Chá sem açúcar` with practically zero calories;
- `500 ml de água com gás` resolves to `Água com gás` with zero calories.

Messages with caloric complements continue through the regular heuristic or catalog flow. For example, `1 xícara de café com leite` is not matched to `Café sem açúcar`, so it remains reviewable with a non-zero nutrition estimate.

## Validation

Coverage lives in `server/nutritionEngine.lowCalorieBeverages.test.ts` and checks:

- coffee without sugar by xícara;
- tea without added sugar by copo;
- sparkling water by ml;
- a control case where coffee with milk is not treated as zero calorie.

## Known limits

This change does not introduce a generic beverage parser or external nutritional lookup. It adds safe references for the explicit low-calorie beverages requested in #402 while preserving conservative behavior for ambiguous drinks.
