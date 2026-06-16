# WhatsApp clarification and option selection

Subissue: #425

## Goal

WhatsApp clarification prompts must be short, explicit, and safe to answer in a natural chat. When an intent has low confidence, multiple possible targets, or an active pending selection, the system must ask before saving or changing critical data.

## Prompt contract

Clarification prompts use the same structure:

1. A direct question.
2. Numbered options starting at `1`.
3. A `0. Nenhuma dessas opções` escape option.
4. A short instruction explaining accepted responses.

Accepted responses include:

- `1`, `2`, `3`, etc.
- `opção 1`, `opcao 1`.
- `a primeira`, `a segunda`, `a terceira`.
- `0`, `nenhuma`, `nenhum`, `nenhuma dessas`.
- `cancelar`, `cancela`, `ignora`.

## Runtime behavior

- A selection prompt creates a conversation pending context for the user.
- A valid option response consumes the selection and opens a confirmation pending context.
- `nenhuma`, `0`, or cancellation consumes the selection without changing records.
- Invalid indexes keep the selection pending and ask for a valid option.
- Expired pendings are not consumed; the user must resend the full item, option, or adjustment.
- Commands with enough context, such as `remove frango` or `era 150g`, continue through the normal adjustment router instead of being treated as short replies.

## Audit data

Conversation context results include structured data for review and future persistence:

- question shown to the user;
- options presented;
- user response;
- decision taken;
- selected option when applicable;
- whether the pending context was consumed.

## Safety boundaries

This implementation standardizes WhatsApp clarification and selection handling, but it does not implement the full administrative review queue. Ambiguities that cannot be resolved automatically remain safe responses or pending decisions. The complete review workflow belongs to #414.
