# WhatsApp temporal context resolution

Subissue: #421

## Goal

WhatsApp messages can refer to dates and meal periods without an absolute date, for example `jantar de ontem`, `almoço de sábado passado` or `lança isso para amanhã`. These references must be resolved before registration, correction, removal or consultation flows continue.

## Timezone rule

Relative dates are resolved from the user's configured IANA timezone. The inbound simulation accepts `userTimezone` to represent that configured value.

When no timezone is available, the resolver uses the current project fallback, `America/Sao_Paulo`, and marks the result with `timezoneSource: fallback`. The fallback is logged as a warning so it remains auditable instead of silently becoming a global assumption.

## Supported expressions

The deterministic resolver currently supports:

- `hoje`
- `ontem`
- `amanhã`
- `anteontem`
- `sábado passado` and equivalent weekdays
- `próximo sábado` and equivalent weekdays
- meal slots: `café da manhã`, `almoço`, `jantar`, `ceia`, `lanche`, `pré-treino`, `pós-treino`

Resolved context includes:

- original temporal expression;
- resolved date;
- meal slot when present;
- user timezone;
- timezone source;
- local reference date;
- date kind.

## Ambiguity handling

Some references are not safe enough to resolve automatically. Examples:

- `almoço de sábado`
- `semana passada`

In these cases, the WhatsApp flow returns a clarification response before any critical action continues. The user is asked to provide a more specific expression such as `sábado passado`, `próximo sábado`, `ontem` or a complete date.

## Pipeline integration

Temporal resolution runs after idempotency and before conversational context, routing, record adjustments, LLM/text intents and nutritional fallback.

When a temporal context is resolved, the system logs `whatsapp.time.temporal_context_resolved`. When clarification is needed, it returns `temporal_context_clarification_needed` and logs `whatsapp.time.temporal_clarification_needed`.

For record adjustments, display dates now use the resolved user timezone instead of a hardcoded timezone.

## Boundaries

This implementation makes temporal decisions explicit and traceable in the WhatsApp pipeline. Durable storage of structured temporal history belongs to #410. Full execution of future dated or retroactive persistence still depends on the specific save/update flows and their validation rules.
