# Pendências e alertas operacionais profissionais

A central profissional usa regras determinísticas e não produz diagnóstico, avaliação clínica ou recomendação nutricional automática.

## Contrato

Cada alerta contém tipo, paciente, autorização de acompanhamento, origem, período analisado, motivo verificável, severidade operacional, estado, ação sugerida e dados de resolução ou dispensa. A chave `dedupeKey` é única no banco e torna o reprocessamento idempotente mesmo com execuções concorrentes.

## Regras iniciais

- `no_food_records`: acompanhamento aprovado e ativo, sem refeição confirmada nos três dias corridos anteriores ao início do dia atual no timezone persistido do paciente.
- `weigh_in_overdue`: solicitação de pesagem aberta cujo prazo foi ultrapassado.
- `goal_review_due`: `nextReviewAt` do acompanhamento alcançado.
- `professional_request_overdue`: solicitação profissional aberta cujo prazo foi ultrapassado.
- `record_requires_review`: sinal persistido e explicitamente marcado como revisável pelo pipeline de origem. Ausência de dados ou confiança não marcada não cria alerta.

Acompanhamentos pausados, encerrados ou sem autorização aprovada não são avaliados. Alertas abertos que deixam de ser sustentados pela origem são tornados inativos. Falha em uma regra/paciente é registrada com metadados sanitizados e não bloqueia os demais.

## Estados e ações

`open`, `resolved`, `dismissed` e `inactive`. Resolver e dispensar registram ator, data e observação opcional. Uma falha de persistência não altera o estado exibido.

## API

O contrato está em `professionalRecord.operationalAlerts`:

- `list({ patientId? })`: reavalia e lista alertas abertos autorizados;
- `evaluate()`: executa avaliação idempotente explícita;
- `close({ alertId, decision, note? })`: resolve ou dispensa;
- `createRequest({ patientId, type, title, dueAt })`: cria solicitação operacional para acompanhamento ativo.

As telas de carteira, painel e prontuário devem consumir esse mesmo contrato, sem reproduzir as regras no cliente.
