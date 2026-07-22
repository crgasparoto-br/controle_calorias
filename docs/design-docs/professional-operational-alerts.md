# Pendências e alertas operacionais profissionais

A central profissional usa regras determinísticas e não produz diagnóstico, avaliação clínica ou recomendação nutricional automática.

## Contrato

Cada alerta contém tipo, paciente, autorização de acompanhamento, origem, período analisado, motivo verificável, severidade operacional, estado, ação sugerida e dados de resolução ou dispensa. A chave `dedupeKey` é única no banco e torna o reprocessamento idempotente mesmo com execuções concorrentes.

As telas de carteira, painel e prontuário consomem esse mesmo contrato. A carteira também recebe o nome do paciente no próprio item para permitir identificar imediatamente quem exige ação.

## Regras iniciais

- `no_food_records`: acompanhamento aprovado e ativo, sem refeição confirmada no dia civil atual do paciente e nos dois dias civis imediatamente anteriores. Essa é a definição explícita de “últimos 3 dias corridos”; o início e o fim são calculados no timezone persistido do paciente pelo módulo central de timezone.
- `weigh_in_overdue`: solicitação de pesagem aberta cujo prazo foi ultrapassado. Um peso com `measuredAt` igual ou posterior à criação da solicitação encerra a solicitação automaticamente e invalida o alerta na reavaliação seguinte.
- `goal_review_due`: `nextReviewAt` do acompanhamento alcançado. Alterar ou remover `nextReviewAt` invalida o alerta anterior.
- `professional_request_overdue`: solicitação profissional aberta cujo prazo foi ultrapassado. Uma resposta associada, cancelamento, resolução ou dispensa encerra a solicitação e invalida o alerta.
- `record_requires_review`: sinal persistido e explicitamente marcado como revisável pelo pipeline de origem. Ausência de dados ou confiança não marcada não cria alerta.

Acompanhamentos pausados, encerrados ou sem autorização aprovada não são avaliados. Alertas abertos que deixam de ser sustentados pela origem são tornados inativos. Falha em uma regra é registrada com metadados sanitizados e não bloqueia as demais regras do paciente.

## Estados, auditoria e origem

Alertas usam os estados `open`, `resolved`, `dismissed` e `inactive`. Resolver e dispensar registram ator, data e observação opcional. Uma falha de persistência não altera o estado exibido.

Solicitações operacionais persistem quem encerrou, quando ocorreu o encerramento, o motivo objetivo e uma referência da resposta quando aplicável. Respostas podem ser registradas pelo paciente vinculado ou pelo profissional responsável; cancelamentos exigem o profissional responsável.

## Idempotência e carteira

A avaliação usa consultas agregadas para refeições e pesagens, evitando uma consulta pesada por paciente. A restrição única de `dedupeKey` protege contra duplicatas em avaliações simultâneas. Alterações na origem, revogação, pausa ou encerramento são refletidas durante a listagem ou reavaliação explícita.

## API

O contrato está em `professionalRecord.operationalAlerts`:

- `list({ patientId? })`: reavalia e lista alertas abertos autorizados;
- `evaluate()`: executa avaliação idempotente explícita;
- `close({ alertId, decision, note? })`: resolve ou dispensa;
- `createRequest({ patientId, type, title, dueAt })`: cria solicitação operacional para acompanhamento ativo;
- `respondRequest({ requestId, responseReference })`: associa uma resposta e encerra a solicitação;
- `cancelRequest({ requestId })`: cancela a solicitação e inativa o alerta associado;
- `registerReviewSignal(...)`: persiste somente sinais explicitamente marcados como revisáveis.
