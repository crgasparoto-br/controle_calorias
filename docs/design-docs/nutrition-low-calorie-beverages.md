# Low-calorie beverage handling

## Context

Subissue #402 covers beverage messages such as `3 xícaras de café sem açúcar`, where the nutrition engine should not create a meaningful calorie load for drinks that are explicitly plain, black, natural or unsweetened. Issue #903 extends this contract by preventing qualified low-calorie references from being selected for contradictory or generic preparations.

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

The final candidate is checked by a shared semantic guard after every catalog source. The guard also applies to persisted entries, personal aliases, TACO, semantic search and WhatsApp lookups. The canonical name has precedence, so a bare alias cannot make `Café sem açúcar` compatible with `café` or `café com açúcar`.

## Sweetened coffee quantity

- An explicit amount such as `5 g de açúcar` is incorporated once into calories and carbohydrates.
- The base coffee portion is read from the canonical `cafe-sem-acucar` reference instead of being repeated in a coffee-specific constant. With the current catalog, one cup equals 200 ml and 2 kcal.
- Consequently, one cup and 200 ml are equivalent inputs for the same preparation; adding 5 g of sugar produces approximately 205 g, 22 kcal and 5 g of carbohydrates.
- A usable AI estimate for the complete sweetened preparation may be preserved when semantically coherent.
- Without an explicit amount or usable estimate, the nutrition engine requests only the sugar quantity.
- Accepted clarification units include grams, teaspoon, tablespoon, sachet and packet; advertised units and parser support must remain aligned.
- On WhatsApp, registration, addition and replacement use the existing persistent `food_clarification.quantity` lifecycle. No meal or item is changed before the user replies.
- The pending operation stores the original text, inbound message correlation and the exact operation target; completion revalidates the target, consumes the pending operation atomically and replies from the reloaded state.
- The interaction registry declares `complete_pending_food_operation_once` as an allowed effect for the open quantity contract.

## Validation

Coverage lives in:

- `server/nutritionEngine.lowCalorieBeverages.test.ts`;
- `server/catalogMatching.semanticCompatibility.test.ts`;
- `server/nutritionEngine.coffeeSugar.test.ts`;
- `server/modules/whatsapp/foodQuantityClarification.coffeeSugar.test.ts`;
- `server/modules/whatsapp/foodClarificationContract.coffeeSugar.test.ts`;
- `server/modules/whatsapp/foodCaloricComplementPersistence.test.ts`;
- `server/modules/whatsapp/interactionRegistry.coffeeSugar.test.ts`.

The tests cover qualified low-calorie beverages, contradictory and generic coffee variants, fuzzy matching, catalog-source parity, explicit sugar calculation, missing-quantity clarification, persistent operation context, household units, registration/addition/replacement lifecycle, target revalidation and registry parity.

## Known limits

The semantic guard is intentionally conservative. When a qualified preparation cannot be matched safely, the system keeps it for inference or clarification rather than degrading it to a contradictory low-calorie reference.
