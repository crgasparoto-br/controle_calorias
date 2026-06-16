# WhatsApp multi-action intent handling

## Context

Subissue #422 adds a safe layer for messages that contain more than one WhatsApp action in the same text. The goal is to avoid executing only the first command, silently dropping later corrections, or sending a composed command to the nutritional fallback as if it were a single meal draft.

Examples covered by this layer:

- `Não é peixe é frango, não é mandioquinha é batata doce`
- `adiciona arroz, troca o frango por peixe e remove a cerveja`
- `no almoço foi arroz, feijão, frango; tira o feijão`

## Pipeline position

The multi-action interpreter runs in `simulateWhatsappInbound` after:

1. inbound idempotency;
2. active conversation context resolution;
3. temporal context resolution.

It runs before the generic intent router, professional access flow, hydration split, record adjustment parser, LLM interpretation, text actions, food assistant, and nutritional fallback.

This order keeps short follow-up replies bound to pending context, preserves date/meal-slot hints, and blocks composed action messages before they can create an unsafe draft.

## Extraction model

The interpreter splits only at clear action boundaries:

- semicolons;
- commas followed by another action verb;
- conjunctions such as `e`, `depois` or `então` when followed by another action verb.

It intentionally preserves food lists like `arroz, feijão, frango` inside a single add action.

Each extracted action records:

- order;
- original action text;
- canonical action type;
- source and target food when applicable;
- item list when applicable;
- validation status;
- validation issues;
- per-action result status.

## Validation and persistence behavior

The layer is non-persistent. It does not alter meals directly.

Supported persistent-style action families are mapped into the backend validation contract introduced in #412 when possible:

- add food to meal;
- replace food in meal;
- edit/sum quantity.

Removal is recognized and marked as requiring confirmation because the runtime persistence schema does not yet expose a direct removal intent.

The transaction mode is always `all_or_nothing` and `partialSuccessAllowed` is always `false`. If any extracted action needs clarification, the whole message is held for clarification and nothing is applied. If all actions are structurally clear, the user receives a confirmation prompt and nothing is applied until confirmation support consumes that pending context.

## Replies and audit trail

Responses list every extracted action in order and indicate whether each one is ready for confirmation or needs more detail. The result data includes the original message, extracted actions, validation summary, transaction mode, and temporal context when present.

Events emitted by this layer:

- `whatsapp.multi_action.confirmation_needed`
- `whatsapp.multi_action.clarification_needed`

## Known limits

This implementation is deliberately deterministic and conservative. It covers common Portuguese WhatsApp phrasing for add, replace, correct, remove, and sum actions. Messages with complex nested dependencies may still be asked for clarification rather than interpreted aggressively.

Durable multi-turn application of confirmed multi-action batches remains dependent on the conversation history and execution work tracked in the broader WhatsApp roadmap.
