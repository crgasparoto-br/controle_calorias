# Runbook de migração comercial e rollout da cobrança

## Finalidade

Este documento é o procedimento operacional canônico da issue #898 para preparar, executar, pausar, reverter e encerrar o rollout comercial do billing.

Ele **não autoriza produção por si só**. A ativação real continua condicionada aos parâmetros operacionais, homologações e aprovações descritos nesta issue. Segredos, credenciais reais, dados pessoais e payloads financeiros não devem ser versionados neste repositório.

O fluxo reaproveita o control plane já existente em `server/modules/billing/billingRolloutAdmin.ts` e `server/modules/billing/billingRolloutAdminSchemas.ts`, que oferece snapshot determinístico de coorte, decisão manual de gate, pausa, incidente e registro de rollback append-only. O runbook do provider permanece em `docs/runbooks/billing-asaas.md`.

## Estado seguro e invariantes

1. `BILLING_ACCESS_MODE=open_access` é o estado seguro enquanto o rollout não estiver explicitamente autorizado.
2. Nenhuma etapa avança automaticamente por tempo decorrido.
3. Nenhum corte cria cliente, checkout, assinatura, cobrança ou evento financeiro automaticamente.
4. Usuário existente recebe 30 dias corridos de transição gratuita a partir do corte individual aplicável; reexecução não renova o período.
5. Não existe cobrança retroativa.
6. Dados, vínculos, prontuários, autorizações, assinaturas, capacidade e fatos financeiros legítimos nunca são apagados por rollback.
7. Coortes são congeladas por `snapshotKey` + `ruleVersion`; a mesma chave não pode mudar composição, percentual, critério ou regra.
8. Qualquer cobrança duplicada, ativação indevida, bloqueio indevido, perda/corrupção de dados ou exposição sensível reprova a etapa independentemente do percentual agregado.
9. A retomada após incidente e qualquer progressão em `enforced` exigem confirmação reforçada e responsável identificado.
10. Pacientes não recebem detalhes financeiros nem de capacidade comercial do profissional patrocinador.

## Gate zero: readiness antes de qualquer piloto

Antes de executar uma etapa com usuários reais, registrar evidência de todos os itens abaixo:

- catálogo, checkout, webhook, fila e reconciliação exercitados no ambiente aplicável;
- lifecycle de assinatura, suspensão e recuperação testado;
- cobertura profissional e capacidade testadas, inclusive carteira excedida;
- onboarding integrado à elegibilidade comercial;
- medição econômica/consumo operacional;
- comunicações internas e externas testadas com retry, obsolescência e falha definitiva;
- observabilidade e rollback ensaiados;
- termos, privacidade, jurídico, suporte e apresentação contábil/fiscal homologados quando aplicável;
- parâmetros operacionais desta issue preenchidos e aprovados.

### Gate adicional: mapa semântico dos pré-requisitos

A #898 referencia a faixa `#869–#897`. O número isolado da issue **não é evidência suficiente** de prontidão. Antes do piloto, o responsável técnico deve registrar no artefato de evidência o mapeamento `requisito -> issue/PR/SHA/evidência` e confirmar semanticamente que cada dependência aplicável corresponde ao contrato de billing esperado.

Se um número apontar para item renomeado, reaproveitado ou não relacionado ao billing, o rollout fica em `hold` até o vínculo correto ser identificado. Não inferir readiness apenas porque o número está fechado.

## Parâmetros operacionais obrigatórios

Os campos abaixo permanecem `PENDENTE` até decisão humana autorizada. Eles não devem receber valores inventados durante implementação ou CI:

| Campo | Estado inicial | Regra |
| --- | --- | --- |
| instante absoluto de corte + timezone | `PENDENTE` | obrigatório antes do primeiro corte real |
| responsável de produto | `PENDENTE` | nominal por etapa |
| responsável técnico | `PENDENTE` | nominal por etapa |
| responsável de billing | `PENDENTE` | nominal por etapa |
| responsável de suporte | `PENDENTE` | nominal por etapa |
| administrador autorizador | `PENDENTE` | obrigatório para coorte e `enforced` |
| privacidade/jurídico | `PENDENTE` | obrigatório para homologar classificação/mensagens aplicáveis |
| contador/fiscal | `PENDENTE` | obrigatório antes de publicar visão econômica como oficial |
| templates finais e remetentes reais | `PENDENTE` | homologar antes de cada campanha |

Credenciais Asaas e segredos de e-mail/WhatsApp pertencem exclusivamente ao ambiente protegido; registrar apenas identificadores sanitizados de configuração e evidência.

## Corte e migração dos usuários existentes

### Snapshot

O corte real deve produzir um snapshot imutável e auditável com:

- `cutoverId` único;
- instante absoluto UTC e timezone da decisão;
- SHA da versão implantada;
- regra/versão de seleção;
- população candidata e contagens agregadas;
- responsável e autorização;
- hash ou referência segura do conjunto, sem PII desnecessária.

A execução deve ser idempotente. A mesma identidade de usuário no mesmo `cutoverId` conserva o início e o término originais da transição.

### Regra de elegibilidade

- conta existente no instante de corte: transição gratuita de 30 dias corridos;
- conta criada depois do corte: trial/contratação normal vigente;
- a transição substitui o trial inicial para aquela conta;
- o processo de corte não cria cobrança nem exige cartão;
- reexecução não concede novo período.

### Profissionais e pacientes

Durante os 30 dias, preservar vínculos, autorizações, acompanhamentos, prontuários e capacidade existente.

Ao contratar plano inferior à carteira já existente, o profissional entra em capacidade excedida/grandfathered: a carteira é preservada e somente novas aprovações, inclusões e reativações ficam bloqueadas enquanto a ocupação permanecer acima do limite.

A capacidade temporária inicial é de 90 dias a partir da confirmação da contratação aplicável. Registrar versão do plano, limite contratado, ocupação inicial, limite temporário, início, fim, motivo e origem da migração. Regularização ocorre por redução natural, upgrade ou extensão administrativa auditada.

Quando nenhum plano público comportar a carteira, abrir pendência administrativa/comercial. Extensão é de 30 dias por vez, nunca automática, retroativa, sem motivo/responsável ou sem data final. Não criar plano customizado implicitamente.

No vencimento sem regularização, marcar capacidade excedida vencida, preservar a carteira e manter bloqueadas somente novas aprovações, inclusões e reativações. Uma nova extensão exige ação administrativa auditada.

## Comunicações da migração

Persistir primeiro a notificação interna autenticada. E-mail é o canal externo padrão; WhatsApp é complemento quando houver número validado e envio permitido. Canais externos recebem resumo e link seguro, sem expor detalhes sensíveis.

### Marcos da transição de 30 dias

- início;
- 15 dias antes do término;
- 7 dias antes;
- 1 dia antes;
- encerramento.

### Marcos da capacidade temporária de 90 dias

- início;
- 60 dias antes;
- 30 dias antes;
- 15 dias antes;
- 7 dias antes;
- vencimento.

A chave lógica deve ser idempotente por usuário, tipo, marco e versão da campanha. Retry reutiliza a mesma comunicação lógica. Evento superveniente torna tentativas pendentes obsoletas. Falha definitiva deve ficar visível e reprocessável.

Cadência externa aprovada na #898:

- e-mail: tentativa inicial, +1 hora e +24 horas;
- WhatsApp: tentativa inicial, +2 horas e +24 horas.

## Sequência obrigatória do rollout

### 1. Provider fake

Sem usuários reais e sem cobrança. Exercitar mensal/anual, cartão/Pix Automático, trial, cupom, cancelamento, inadimplência, recuperação, webhooks duplicados/atrasados/fora de ordem, comunicação, retry e reconciliação. Exigir três ciclos completos consecutivos sem divergência não explicada e validar retorno seguro para `open_access`.

### 2. Sandbox Asaas

Duração mínima de 5 dias úteis e pelo menos 30 jornadas controladas. Cobrir todos os produtos, ciclos e meios de pagamento do lançamento, incluindo falha, abandono, recusa, expiração, atraso, estorno e reprocessamento. Seguir `docs/runbooks/billing-asaas.md`.

### 3. Usuários internos

População mínima: 6 usuários individuais e 4 profissionais, incluindo um profissional próximo do limite e um acima da capacidade pública em cenário controlado. Duração mínima de 7 dias corridos. `open_access` permanece ativo. Pagamento real exige autorização específica.

### 4. Piloto controlado

- Onda A: 25 indivíduos + 5 profissionais, mínimo 14 dias corridos.
- Onda B: 100 indivíduos + 20 profissionais, mínimo 14 dias corridos e aprovação formal da Onda A.

Quando houver base elegível, incluir novos/existentes, mensal/anual, cartão/Pix Automático, carteiras pequenas/próximas do limite/excedidas e usuários com/sem cobertura profissional.

### 5. Disponibilização geral não bloqueante

Todos os elegíveis podem visualizar catálogo, contratar, receber comunicações e administrar assinatura, ainda com `open_access`. Observar por no mínimo 14 dias corridos.

### 6. `enforced` progressivo

| Fase | Abrangência | Duração mínima |
| --- | ---: | ---: |
| `enforced_10` | 10% | 7 dias |
| `enforced_25` | 25% | 7 dias |
| `enforced_50` | 50% | 7 dias |
| `enforced_100` | 100% | 14 dias de estabilização |

Cada fase usa snapshot determinístico via control plane, evidência do período anterior, decisão registrada e autorização reforçada. Término do prazo nunca promove automaticamente a fase seguinte.

## Gates de avanço

Para decisão `advance`, registrar evidência suficiente para demonstrar:

- zero cobrança duplicada;
- zero ativação sem confirmação financeira autoritativa;
- zero bloqueio indevido;
- zero perda de dados, vínculos, prontuários ou capacidade;
- 100% dos eventos financeiros persistidos antes do processamento;
- pelo menos 95% processados em até 5 minutos;
- eventos restantes visíveis e reconciliáveis em até 30 minutos;
- divergência financeira < 0,5%, com todas as divergências analisadas/resolvidas em até 24 horas;
- 100% das notificações internas essenciais persistidas;
- falhas externas visíveis e reprocessáveis;
- nenhum incidente crítico ou alto aberto;
- nenhuma falha conhecida de segurança ou privacidade;
- rollback ensaiado e documentado;
- métricas econômicas, consumo, qualidade e cobertura disponíveis;
- aprovação nominal registrada.

O control plane já impede avanço quando `processedWithin5mBps < 9500`, `reconciledWithin30mBps < 10000`, `financialDivergenceBps >= 50`, `internalNotificationsPersistedBps < 10000`, existe incidente crítico/alto ou incidente absoluto. Os demais itens devem aparecer como evidência explícita da decisão; ausência de evidência mantém a etapa em `hold`.

## Pausa e rollback

Pausar novas ativações/progressão diante de cobrança duplicada, acesso sem origem válida, bloqueio indevido, perda/corrupção de dados, exposição sensível, reconciliação sem rastreabilidade, notificação essencial não persistida, degradação relevante de checkout/webhook/comunicação/elegibilidade, incidente crítico de segurança ou impossibilidade de retornar com segurança para `open_access`.

Procedimento:

1. registrar incidente e colocar a etapa em pausa;
2. interromper novas ativações da coorte;
3. retornar o acesso aplicável para `open_access`;
4. pausar comunicações e bloqueios relacionados;
5. preservar cobranças, estornos, cancelamentos, assinaturas, auditoria, capacidade e eventos;
6. reconciliar todos os usuários afetados;
7. registrar causa, impacto, correção e evidência;
8. repetir os gates; retomada exige confirmação reforçada e responsáveis identificados.

O registro de rollback do control plane é deliberadamente append-only e declara preservação dos fatos financeiros, assinaturas e capacidade.

## Evidência e encerramento

Usar `docs/history/billing-commercial-rollout-evidence-template.md` como base de cada etapa. Nunca substituir evidência observada por expectativa.

Para cada janela, registrar:

- ambiente, SHA e janela absoluta;
- fase, snapshot/coorte e regra;
- população planejada/efetiva agregada;
- responsáveis e autorizações;
- métricas dos gates;
- incidentes, tickets e divergências;
- reconciliação e status de comunicações;
- resultado `advance|hold|reject|rollback`;
- links para evidências sanitizadas.

Após `enforced_100`, manter observação de estabilização por no mínimo 14 dias e registrar checkpoints de 24h, 48h, 72h e encerramento final. A issue só pode ser considerada operacionalmente concluída quando os parâmetros reais, homologações, evidências e handoff de suporte estiverem preenchidos; merge deste runbook isoladamente não equivale a autorização de cobrança em produção.

## Referências

- issue #898 — contrato do rollout comercial;
- issue #145 — decisões comerciais vinculantes;
- `server/modules/billing/billingRolloutAdmin.ts`;
- `server/modules/billing/billingRolloutAdminSchemas.ts`;
- `server/modules/billing/billingNotificationCenter.ts` e módulos administrativos relacionados;
- `docs/runbooks/billing-asaas.md`;
- `docs/product-specs/billing-commercial-decisions.md`.
