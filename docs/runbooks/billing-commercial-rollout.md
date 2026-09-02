# Runbook técnico da migração comercial e controles de rollout

## Finalidade e fronteira de responsabilidade

Este documento é o runbook técnico da issue #898. Ele descreve os controles implementados para que a operação comercial possa executar corte, migração, comunicações, reconciliação, pausa e rollback de forma segura.

A #898 é a fonte de verdade da **implementação técnica**. A execução operacional real pertence à **#1024**, incluindo data/hora real do corte, responsáveis nominais, homologações, provider fake/sandbox, coortes reais, durações mínimas, métricas observadas, incidentes, aprovações e ativação progressiva de `enforced`.

Merge ou encerramento técnico da #898 não autoriza cobrança em produção e não substitui os gates operacionais da #1024. Segredos, credenciais reais, dados pessoais e payloads financeiros não devem ser versionados neste repositório.

O fluxo reutiliza o control plane existente em `server/modules/billing/billingRolloutAdmin.ts` e `server/modules/billing/billingRolloutAdminSchemas.ts`, que oferece snapshot determinístico de coorte, decisão manual de gate, pausa, incidente e registro de rollback append-only. O runbook do provider permanece em `docs/runbooks/billing-asaas.md`.

## Estado seguro e invariantes técnicos

1. `BILLING_ACCESS_MODE=open_access` é o estado seguro enquanto a operação da #1024 não autorizar progressão.
2. Nenhuma etapa avança automaticamente por tempo decorrido.
3. Nenhum corte cria cliente, checkout, assinatura, cobrança ou evento financeiro automaticamente.
4. Usuário existente recebe 30 dias corridos de transição gratuita a partir do corte aplicável; reexecução não renova o período.
5. Não existe cobrança retroativa.
6. Dados, vínculos, prontuários, autorizações, assinaturas, capacidade e fatos financeiros legítimos nunca são apagados por rollback.
7. Coortes são congeladas por `snapshotKey` + `ruleVersion`; a mesma chave não pode mudar composição, percentual, critério ou regra.
8. Cobrança duplicada, ativação indevida, bloqueio indevido, perda/corrupção de dados ou exposição sensível devem bloquear a progressão operacional.
9. Retomada após incidente e progressão em `enforced` exigem confirmação reforçada e responsável identificado.
10. Pacientes não recebem detalhes financeiros nem de capacidade comercial do profissional patrocinador.

## Como a #1024 deve consumir estes controles

Antes de operar qualquer etapa real, a #1024 deve registrar evidência de que os contratos técnicos necessários estão disponíveis no SHA implantado:

- catálogo, checkout, webhook, fila e reconciliação exercitáveis;
- lifecycle de assinatura, suspensão e recuperação disponível;
- cobertura profissional e capacidade disponíveis, inclusive carteira excedida;
- onboarding integrado à elegibilidade comercial;
- medição econômica/consumo operacional;
- comunicações internas e externas com retry, obsolescência e falha definitiva;
- controles de observabilidade e rollback;
- parâmetros operacionais, homologações e responsáveis definidos pela própria #1024.

### Mapa semântico dos pré-requisitos

A #898 referencia contratos de billing já implementados em outras issues. O número isolado da issue não é evidência suficiente. A operação da #1024 deve registrar `requisito -> issue/PR/SHA/evidência` e confirmar semanticamente que cada dependência aplicável corresponde ao contrato esperado.

Se um número apontar para item renomeado, reaproveitado ou não relacionado ao billing, a operação deve ficar em `hold` até o vínculo correto ser identificado. Não inferir readiness apenas porque uma issue está fechada.

## Parâmetros operacionais pertencentes à #1024

Os campos abaixo não são definidos pela #898 e devem permanecer sem valor inventado no código ou CI. A #1024 é responsável por preenchê-los e homologá-los antes da execução correspondente:

| Campo operacional | Regra de consumo |
| --- | --- |
| instante absoluto de corte + timezone | informar ao comando técnico de corte |
| responsável de produto | registrar por etapa operacional |
| responsável técnico | registrar por etapa operacional |
| responsável de billing | registrar por etapa operacional |
| responsável de suporte | registrar por etapa operacional |
| administrador autorizador | obrigatório para coorte e `enforced` |
| privacidade/jurídico | homologar classificação/mensagens aplicáveis |
| contador/fiscal | homologar antes de publicação oficial de visão econômica |
| templates finais e remetentes reais | homologar antes da campanha |

Credenciais Asaas e segredos de e-mail/WhatsApp pertencem exclusivamente ao ambiente protegido; registrar apenas identificadores sanitizados de configuração e evidência.

## Corte e migração dos usuários existentes

### Snapshot técnico

O comando de corte recebe `cutoverKey`, instante absoluto UTC e timezone. A primeira execução materializa um manifesto e uma população congelada de usuários existentes no corte. Reexecuções usam esse mesmo manifesto e não reavaliam retroativamente a população.

A operação da #1024 deve associar ao corte real:

- identificador operacional do corte;
- SHA implantado;
- regra/versão de seleção;
- população candidata e contagens agregadas;
- responsável e autorização;
- referência segura da evidência, sem PII desnecessária.

### Regra de elegibilidade

- conta existente no instante de corte: transição gratuita de 30 dias corridos;
- conta criada depois do corte: trial/contratação normal vigente;
- a transição substitui o trial inicial para aquela conta;
- o processo de corte não cria cobrança nem exige cartão;
- reexecução não concede novo período.

### Profissionais e pacientes

Durante a transição, preservar vínculos, autorizações, acompanhamentos, prontuários e capacidade existente. Regras de capacidade temporária, carteira excedida, extensões e alertas permanecem sob os contratos canônicos de #894/#896; a #898 não cria uma máquina paralela.

Ao contratar plano inferior à carteira existente, a operação deve consumir os controles canônicos de capacidade, preservando a carteira e bloqueando somente novas aprovações, inclusões e reativações enquanto a ocupação permanecer acima do limite.

Quando nenhum plano público comportar a carteira, a operação deve abrir a pendência administrativa/comercial definida pelo contrato canônico. A #898 não cria plano customizado automaticamente.

## Comunicações da migração

Persistir primeiro a notificação interna autenticada. E-mail é o canal externo padrão; WhatsApp é complemento somente quando houver conexão validada/ativa e envio permitido. Canais externos recebem resumo e link seguro, sem expor detalhes sensíveis.

### Marcos da transição de 30 dias

- início;
- 15 dias antes do término;
- 7 dias antes;
- 1 dia antes;
- encerramento.

A chave lógica é idempotente por usuário, marco e versão da campanha. Retry reutiliza a mesma comunicação lógica. Evento superveniente torna tentativas pendentes anteriores obsoletas. Falha definitiva permanece visível e reprocessável sem remover a notificação interna.

Cadência técnica definida pela política vinculante da #145 e implementada na #898:

- e-mail: tentativa inicial, +1 hora e +24 horas;
- WhatsApp: tentativa inicial, +2 horas e +24 horas.

Textos finais, remetentes reais e homologações jurídico/privacidade pertencem à #1024.

## Jobs e comandos técnicos

Os jobs da #898 devem ser operados pela #1024 com os seguintes princípios:

- iniciar transições idempotentemente;
- usar `dry-run` antes de escrita real;
- exigir confirmação explícita para mutações;
- processar em lotes com checkpoint;
- registrar resultado por item e falha parcial;
- reprocessar somente falhas elegíveis;
- emitir marcos de comunicação idempotentes;
- encerrar transições idempotentemente após `validUntil`;
- executar reconciliação posterior;
- nunca inferir autorização de progressão de rollout pela passagem do tempo.

## Controles de fase, coorte e rollback

O control plane oferece os contratos técnicos que a #1024 deve usar para operar o rollout:

- snapshot determinístico de coorte;
- decisão manual `advance|hold|reject|rollback`;
- registro de incidente;
- pausa de progressão;
- retomada com confirmação reforçada quando aplicável;
- rollback para `open_access` preservando fatos financeiros, assinaturas e capacidade.

A #898 comprova a existência e o comportamento desses controles. A escolha de coortes reais, percentuais, durações e responsáveis é exclusivamente operacional e fica na #1024.

## Sequência operacional — autoridade da #1024

A sequência abaixo é contexto de consumo dos controles técnicos; **não é critério de encerramento da #898**. Sua execução, evidência e aprovação pertencem à #1024.

1. provider fake;
2. sandbox Asaas;
3. usuários internos;
4. piloto controlado;
5. disponibilização geral não bloqueante;
6. `enforced` progressivo.

Percentuais, tamanhos de coorte, durações mínimas, métricas observadas e autorizações devem ser obtidos da especificação vigente da #1024 no momento da operação. Este runbook não duplica esses parâmetros para evitar divergência entre documentação técnica e execução real.

## Gates técnicos que suportam a decisão operacional

O control plane bloqueia `advance` quando houver, entre outros controles codificados:

- menos de 95% dos eventos processados em até 5 minutos;
- eventos fora da janela de reconciliação de 30 minutos;
- divergência financeira igual ou superior a 0,5%;
- persistência incompleta de notificações internas essenciais;
- incidente crítico/alto aberto;
- incidente absoluto como cobrança duplicada, ativação indevida, bloqueio indevido, perda de dados ou exposição sensível;
- ausência de confirmação reforçada quando exigida.

A #1024 deve complementar esses bloqueios técnicos com a evidência operacional e aprovações humanas previstas em sua própria especificação.

## Pausa e rollback

Diante de risco operacional, a #1024 deve consumir os controles técnicos de pausa e rollback sem apagar fatos legítimos.

Procedimento técnico suportado:

1. registrar incidente;
2. pausar novas ativações/progressão;
3. retornar o acesso aplicável para `open_access`;
4. pausar comunicações e bloqueios relacionados quando definido pela decisão;
5. preservar cobranças, estornos, cancelamentos, assinaturas, auditoria, capacidade e eventos;
6. reconciliar usuários afetados;
7. registrar causa, impacto, correção e evidência;
8. exigir nova decisão explícita antes da retomada.

O registro de rollback do control plane é append-only e declara preservação dos fatos financeiros, assinaturas e capacidade.

## Evidência técnica da #898

A #898 pode ser encerrada tecnicamente quando código, testes, CI aplicável, documentação e auditoria independente demonstrarem que os controles descritos nesta issue funcionam no SHA final.

O template `docs/history/billing-commercial-rollout-evidence-template.md` pode ser utilizado pela #1024 para registrar cada janela operacional, mas a passagem de semanas, coortes reais e estabilização de `enforced` não bloqueiam o encerramento técnico da #898.

## Evidência operacional da #1024

Durante a execução real, registrar no artefato operacional aplicável:

- ambiente, SHA e janela absoluta;
- fase, snapshot/coorte e regra;
- população planejada/efetiva agregada;
- responsáveis e autorizações;
- métricas dos gates;
- incidentes, tickets e divergências;
- reconciliação e status de comunicações;
- resultado `advance|hold|reject|rollback`;
- links para evidências sanitizadas.

Nenhuma dessas evidências operacionais deve ser inventada para concluir a #898. A operação real continua obrigatória e rastreada pela #1024.

## Referências

- issue #898 — implementação técnica da migração comercial e comunicações;
- issue #1024 — execução operacional, homologação e rollout real;
- issue #145 — decisões comerciais vinculantes;
- issues #894/#896 — capacidade, cobertura, alertas e exceções;
- `server/modules/billing/billingRolloutAdmin.ts`;
- `server/modules/billing/billingRolloutAdminSchemas.ts`;
- `server/modules/billing/billingNotificationCenter.ts`;
- `docs/runbooks/billing-asaas.md`;
- `docs/product-specs/billing-commercial-decisions.md`.
