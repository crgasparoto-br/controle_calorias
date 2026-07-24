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
- The deterministic base-coffee-plus-sugar calculation is used only when sugar is the sole caloric complement in the source segment. A preparation that also names milk, honey, cream, condensed milk or another caloric complement keeps a coherent complete-preparation estimate or falls back from the complete segment; it is never flattened to sugar-only nutrition.
- The base coffee portion is read from the canonical `cafe-sem-acucar` reference instead of being repeated in a coffee-specific constant. With the current catalog, one cup equals 200 ml and 2 kcal.
- Consequently, one cup and 200 ml are equivalent inputs for the same preparation; adding 5 g of sugar produces approximately 205 g, 22 kcal and 5 g of carbohydrates.
- A usable AI estimate for the complete sweetened preparation may be preserved when semantically coherent. When the source includes an explicit sugar amount, the estimate must cover at least the calories and carbohydrates implied by that amount.
- A usable inferred item satisfies only one sweetened source segment. Multiple sweetened coffees require the same number of coherent inferred items or explicit quantities; one AI item cannot suppress clarification for companion coffees.
- Without an explicit amount or usable estimate, the nutrition engine requests only the sugar quantity.
- When several sweetened coffees are missing quantities, each valid answer is appended to the next unresolved source segment. The partially resolved text and completed-component list are persisted before the next question, so process restart does not lose progress.
- Registration and addition do not mutate a meal until every sweetened segment has usable nutrition. Multiple sweetened replacements preserve the already resolved target items in the pending operation and apply the complete batch only after the last quantity.
- Accepted clarification units include grams (`g`, `gr`, `grama` or `gramas`), teaspoon, tablespoon, sachet and packet; advertised units, semantic guard and parser support must remain aligned.
- A syntactically valid but contextually incompatible reply, such as `5 ml`, is rejected before the atomic claim. The same pending operation remains active with its original id and version, and the user is prompted again.
- On WhatsApp, registration, addition and replacement use the existing persistent `food_clarification.quantity` lifecycle. No meal or item is changed before the user replies.
- The pending operation stores the raw original message separately from the resumable food text used to continue calculation, together with inbound correlation, completed components and the exact operation target.
- Compound registration and addition preserve all companion foods when only the sugar amount is missing.
- Compound replacement preserves the other replacements from the same command. Completion revalidates every target, applies the batch with compensating rollback if an update fails, and replies from the reloaded state.
- The compensation includes an update that may have persisted before throwing from a later side effect, preventing silent partial state.
- Text webhook, transcribed audio and `simulateWhatsappInbound` converge on the same canonical sweetened-coffee handler and persistent clarification contract.
- The pending operation is consumed atomically only after the answer is valid for the missing component. Retry, expiration and re-delivery cannot duplicate the domain effect.
- Failure to persist a follow-up quantity prevents the next question and leaves the meal unchanged.
- The interaction registry declares `complete_pending_food_operation_once` as an allowed effect for the open quantity contract.

## Validation

Coverage lives in:

- `server/nutritionEngine.lowCalorieBeverages.test.ts`;
- `server/catalogMatching.semanticCompatibility.test.ts`;
- `server/nutritionEngine.coffeeSugar.test.ts`;
- `server/nutritionEngine.coffeeSugarComposite.test.ts`;
- `server/nutritionEngine.coffeeSugarComplements.test.ts`;
- `server/coffeeSugarNutrition.discriminant.test.ts`;
- `server/coffeeSugarNutrition.multipleSweetened.test.ts`;
- `server/coffeeSugarNutrition.compositeComplements.test.ts`;
- `server/coffeeSugarNutrition.adversarialComplements.test.ts`;
- `server/coffeeSugarNutrition.units.test.ts`;
- `server/modules/whatsapp/foodQuantityClarification.coffeeSugar.test.ts`;
- `server/modules/whatsapp/foodClarification.coffeeSugarLifecycle.test.ts`;
- `server/modules/whatsapp/foodClarificationContract.coffeeSugar.test.ts`;
- `server/modules/whatsapp/foodCaloricComplementPersistence.test.ts`;
- `server/modules/whatsapp/foodCaloricComplementComposite.test.ts`;
- `server/modules/whatsapp/foodCaloricComplementSequential.test.ts`;
- `server/modules/whatsapp/foodCaloricComplementSequentialPersistenceFailure.test.ts`;
- `server/modules/whatsapp/foodCaloricComplementCompensation.test.ts`;
- `server/modules/whatsapp/intent/coffeeSugarCompositeAddition.test.ts`;
- `server/modules/whatsapp/intent/coffeeSugarMutationHandlers.test.ts`;
- `server/modules/whatsapp/intentActions.coffeeSugarParity.test.ts`;
- `server/modules/whatsapp/service.coffeeSugarParity.test.ts`;
- `server/modules/whatsapp/interactionRegistry.coffeeSugar.test.ts`.

The tests cover qualified low-calorie beverages, contradictory and generic coffee variants, fuzzy matching, catalog-source parity, explicit sugar calculation, complete preparations with milk/honey/cream/condensed milk, adversarial association and cardinality cases, missing-quantity clarification, contextual unit validation before claim, persistent operation context, sequential quantities for multiple sweetened coffees, restart-safe progress, follow-up persistence failure without orphan outbound, compound registration/addition/replacement, target revalidation, compensation after persistence-before-error, text/audio/simulator parity and registry parity.

## Known limits

The semantic guard is intentionally conservative. When a qualified preparation cannot be matched safely, the system keeps it for inference or clarification rather than degrading it to a contradictory low-calorie reference.
