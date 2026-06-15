# Design técnico: idempotência de entrada do WhatsApp

## Responsabilidade

A subissue #423 define uma guarda antes de qualquer ação persistente do WhatsApp para evitar duplicidade por retry técnico, reenvio da plataforma ou repetição acidental em curto intervalo.

O contrato fica em `server/modules/whatsapp/inboundIdempotencyGuard.ts` e é chamado no início de `simulateWhatsappInbound`.

## Decisão

A guarda avalia:

- `messageId`, quando disponível;
- texto normalizado e hasheado;
- usuário;
- horário recebido;
- janela curta de proteção;
- sinais explícitos de novo registro, como `de novo`, `novamente`, `outra vez` ou `mais uma vez`.

## Comportamento

- Mesmo `messageId` para o mesmo usuário: bloqueia como retry técnico.
- Mesmo texto dentro da janela curta: bloqueia como possível duplicidade acidental.
- Mesmo texto com sinal explícito de novo registro: libera processamento e registra `intentional_repeat`.
- Mesmo texto fora da janela curta: libera processamento.
- Usuários diferentes não compartilham chave de duplicidade.

## Resposta segura

Quando uma duplicidade é bloqueada, o fluxo retorna uma resposta segura e não chama LLM, comandos, hidratação, correção ou fallback nutricional.

O retorno inclui:

- `action = duplicate_inbound_message_ignored`;
- `eventType` específico;
- `duplicateKind`;
- `idempotencyKey`;
- `firstSeenAt`.

## Auditoria

`simulateWhatsappInbound` registra `logInferenceEvent` com `status = warning` quando uma duplicidade é evitada. A persistência definitiva desses eventos no histórico estruturado deve ser consolidada na #410.

## Limites

Esta entrega cria a guarda operacional e os pontos de auditoria no fluxo atual. Ela não deduplica dados históricos já gravados e não impede refeições iguais em horários diferentes ou com intenção explícita de novo registro.

## Casos de teste

`server/modules/whatsapp/inboundIdempotencyGuard.test.ts` cobre:

- retry técnico com mesmo `messageId`;
- reenvio textual em janela curta;
- mensagem igual fora da janela;
- repetição intencional;
- isolamento por usuário.
