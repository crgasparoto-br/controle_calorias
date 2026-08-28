# Remediação administrativa de billing — estado, identidade e retry

Este complemento registra os controles adicionados após a auditoria independente da administração de billing. Ele complementa, sem substituir, `billing-admin-operations.md` e `usage-governance.md`.

## Autorização futura de cobrança por consumo

O ciclo persistente é `draft → approved → active ↔ suspended → revoked`; `revoked` é terminal. Criação nasce em `draft`. Ativação e reativação exigem confirmação reforçada, comunicação já concluída, vigência ainda futura e `noRetroactive=true`. Cada transição grava evento append-only `consumption_charge_authorization_transition` com estado anterior, estado novo, ator, motivo e confirmação reforçada quando aplicável. A autorização administrativa não cria cobrança ou assinatura no provider.

## Identidades de comunicação

O fato de billing, sua `idempotencyKey` e sua `correlationId` são identidades distintas. A listagem administrativa lê os três campos canônicos e o retry registra separadamente `sourceFactId`, `sourceIdempotencyKey` e `sourceCorrelationId`; nenhum deles pode ser derivado do outro.

## Retry recuperável após reinício

Reprocessamento manual mantém `requestId` idempotente e motivo auditável. O evento administrativo é persistido antes do outbound e usa lease de dispatch. Repetição durante lease válido retorna `pending`; depois de lease stale, a mesma chamada pública com o mesmo `requestId` pode retomar. Para WhatsApp, o transporte recebe `traceId=billing-admin-retry:<requestId>`, reutilizando a deduplicação durável do ledger do provider para impedir uma segunda chamada física quando o processo cai depois do outbound e antes da finalização administrativa.

## Controles adversariais

- `ADMIN-STATE-MACHINE-001`: rejeita salto `draft → active`, exige confirmação reforçada em ativação/reativação, valida comunicação/vigência e prova `revoked` terminal.
- `IDENTITY-PROP-001`: usa `id`, `idempotencyKey` e `correlationId` deliberadamente distintos e verifica sua propagação até o evento de retry.
- `RESTART-IDEM-001`: repete o mesmo entrypoint público e a mesma chave após estado persistido/stale, verificando lease e identidade estável de transporte.
