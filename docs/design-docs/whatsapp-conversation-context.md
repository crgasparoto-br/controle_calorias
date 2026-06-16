# WhatsApp conversation context

Subissue: #420

## Goal

Short WhatsApp messages that depend on previous turns must not be interpreted as food records when the target is missing. Examples include option numbers, `sim`, `cancela`, `isso`, `o ultimo`, `a primeira opcao`, and follow-up adjustment commands.

## Current delivery

This delivery adds a process-local conversation context store for the WhatsApp service. It is intentionally small and focused on pending selections and confirmations created by the current record-adjustment flow.

The context stores:

- user id;
- pending kind: `selection` or `confirmation`;
- original source action and source message;
- options presented to the user;
- selected or confirmation target data;
- creation timestamp;
- expiration timestamp.

## TTL

Pending context expires after 15 minutes by default. Expired pending context is discarded before the message can reach the food fallback. When the user sends a short contextual reply after expiration, the service asks for the full item, option, or adjustment again.

## Routing behavior

The service resolves conversation context after idempotency and before the intent router, LLM, text intents, assistant helper, or nutrition fallback.

- A valid option number consumes the selection pending and opens a confirmation pending.
- `sim` consumes a confirmation pending and returns a safe confirmation acknowledgement.
- `nao` or `não` rejects the pending action.
- `cancela` cancels the pending action.
- Invalid options keep the pending selection active and ask for a valid number.
- Short/reference-only messages without active context ask for clarification.

This avoids accidental meal creation from messages like `1`, `sim`, `isso`, or `cancela isso`.

## Persistence boundary

The store is process-local in this delivery. Durable persistence, replayable audit history, and final execution of pending updates belong to the structured history work in #410 and the follow-up pending-action flows. The current layer still logs router/context events through the existing WhatsApp inference log path.

## Validation coverage

Tests cover:

- short replies without active context;
- pending selection resolution;
- confirmation consumption;
- predictable expiration;
- service-level conversations with 2, 3, and 4 turns;
- prevention of LLM, text-intent, assistant, and nutrition fallback calls for contextual replies.
