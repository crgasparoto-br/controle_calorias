# Issue #1307 — shadow V1×V2, telemetria e prontidão

**Estado: infraestrutura preparada, sem ativação produtiva.** Base inicial:
`develop@4ff6202ec7e0b9a895791c3f930cefdc43b97e3e`. A issue #1307 pode ser
concluída somente como `TECHNICAL_READY`, depois de cumprir seus critérios
técnicos, dependências e auditoria independente; isso não equivale a aprovação
operacional nem permite atribuir baseline real. A `OPERATIONALLY_APPROVED` e a
atribuição de baseline real dependem do **Gate A** da ADR §8.12, dos critérios
abertos de §1.3 e da auditoria independente prevista para o escopo pós-deploy
em #1335.

Fonte normativa: `docs/design-docs/adr-food-intelligence-resolver-v2.md`
§§1.3, 8.12, 8.14, 19.7, 19.9 e 20/Fase C.

## Rastreabilidade técnica e pendências de certificação (17/11/2026)

Este levantamento documenta **integração de código e CI histórica**, não uma
aprovação independente, Gate A ou autorização para tráfego real. Referência de
inspeção: `develop@838ed0a466873a059f335a808947082b7818ff0e`; qualquer
auditoria posterior deve reconsultar o SHA efetivo, o contrato normativo e as
evidências do candidato auditado. Não reutilizar checks de PR ancestral como
prova de que a `develop` corrente foi executada nesses mesmos checks.

| Fase técnica | Issue dependente | Implementação integrada à `develop` | Estado de aceite |
| --- | --- | --- | --- |
| A1: contratos/adapters | #1298 | PRs #1314, #1315 e #1328 mergeadas | Issue aberta; certificação própria deve ser conferida |
| A2: corpus/harness | #1299 | PRs #1316 e #1327 mergeadas | Issue aberta; corpus sintético não homologa Gate A |
| B1: persistência | #1301 | PR #1326 mergeada | Issue aberta; validar prova de migrations e histórico |
| B2: conhecimento | #1302 | PR #1329 mergeada | Issue aberta; validar proveniência e revogação |
| C1: linguagem | #1304 | PRs #1330 e #1343 mergeadas | Issue aberta; observar correção posterior de validade governada |
| C2: resolvedor | #1305 | PR #1331 mergeada | Issue aberta; validar fail-closed e contrato do núcleo |

O estado **aberto** das issues não prova ausência de implementação, e o
estado **merged** das PRs não prova aceite independente. Antes de declarar
`TECHNICAL_READY`, reconciliar separadamente cada requisito/dependência com
seus testes, decisões da ADR e parecer independente no SHA avaliado. Não fechar
ou reclassificar as seis issues por inferência nesta documentação.

A implementação C4 foi incorporada pela [PR #1334](https://github.com/crgasparoto-br/controle_calorias/pull/1334)
(HEAD material `2a9d1a44f577cd1bfdd7edc1be5311ee33b496f8`, merge
`a471fee99f3733dcaeac1fdce4ab472f3dcbb769`). Sua CI
[Agent-first gate #41364416124](https://github.com/crgasparoto-br/controle_calorias/actions/runs/41364416124)
concluiu com `success` nos três jobs (`CI risk classification`,
`Merge preview integration`, `Agent-first gate`). O artefato
`agent-first-verification-2a9d1a44f577cd1bfdd7edc1be5311ee33b496f8`
tem ID `13106614291` e digest declarado pelo GitHub
`sha256:4fce231bc7048a64d4b257ca01a73ce0a52b02f47aee2d50907434ea70f6f208`.
Isso demonstra execução de CI no HEAD da PR, **não** auditoria independente,
oráculo nutricional real ou execução no SHA corrente da `develop`.

A separação formal entre prontidão técnica e aprovação operacional da ADR
foi incorporada pela [PR #1337](https://github.com/crgasparoto-br/controle_calorias/pull/1337)
(HEAD `c38dc81de9ad098dfa198ec6884a7267f5c5168d`; merge
`abf7ff19c1c5927b6f79ed098534ebb74c9eea9f`), com
[Agent-first gate #42283977337](https://github.com/crgasparoto-br/controle_calorias/actions/runs/42283977337)
terminal `success`. A revisão da camada de linguagem na PR #1343 também
apresenta [Agent-first gate #43314264242](https://github.com/crgasparoto-br/controle_calorias/actions/runs/43314264242)
terminal `success` no HEAD `4fef481206a15afb42d2d8e619fa21683d585e38`.

**Ledger da revisão de 17/11/2026 (IDs distintos dos achados A-001 etc.
registrados historicamente na PR #1334):**

- `AUD-1307-20261117-A001`: reconciliar as seis dependências acima por
  contrato, código, teste negativo e parecer próprio. **Integrações comprovadas;
  aceite independente ainda não comprovado**.
- `AUD-1307-20261117-A002`: reconstruir a auditoria independente C4 contra
  a identidade atual, confrontando os cinco critérios da issue com código,
  testes efetivamente executados, fixtures discriminantes, sanitização,
  preservação de V1 e histórico, replay/custos, e a cadeia CI exact-SHA.
  **Pendente de contexto auditor independente e da execução requerida**.
- `AUD-1307-20261117-REC001`: reconciliar referências a PRs #1334/#1337
  como integradas, em vez de propostas pendentes, sem marcar aceite técnico
  ou operacional antes da prova. **Retificação documental preparada**.

**Limite de fase:** a saída desta reconciliação não substitui o Gate A, corpus
real, LGPD/sink, baseline, Gate B ou rollback da [#1335](https://github.com/crgasparoto-br/controle_calorias/issues/1335).
O runner, as flags e o V1 continuam sujeitos aos bloqueios já especificados.
A issue #1307 somente pode ser encerrada após parecer independente favorável
aos critérios técnicos e às dependências; nenhuma aprovação de Gate A/B é
inferida do merge ou deste ledger.

## Matriz de verificação por requisito e dependência (17/11/2026)

**Natureza:** índice técnico reproduzível para auditor independente. Não é uma aprovação.
Base de inspeção: `develop@838ed0a466873a059f335a808947082b7818ff0e`;
HEAD documental anterior da PR #1344: `6dfe4459d22efea63706b535d607ce8dc71f66f5`.
Os testes listados são declarações de código, não execução individual comprovada.
Um SHA posterior exige revisão dos paths, oráculos e runs, sem transportar a aprovação.

### A-001 — dependências técnicas e suas CIs de origem

| Dependência | Última PR / HEAD de implementação | CI exact-HEAD | Evidência a certificar |
| --- | --- | --- | --- |
| #1298 / A1 | #1328 `02d9dbffcf51fa3ac05c1fc138abd76b5b166b8b` | [Agent-first #39587848259](https://github.com/crgasparoto-br/controle_calorias/actions/runs/39587848259) concluído `success` | Contratos, adapters e idempotência |
| #1299 / A2 | #1327 `790c104023d85e0c655f86eb713a7b8af68cb50c` | [Agent-first #39434592503](https://github.com/crgasparoto-br/controle_calorias/actions/runs/39434592503) concluído `success` | Corpus, negativos e isolamento do oráculo |
| #1301 / B1 | #1326 `65d0376ce80917b0025c79f4d289be09fc849550` | [Agent-first #39604692778](https://github.com/crgasparoto-br/controle_calorias/actions/runs/39604692778) concluído `success` | Migrations, concorrência e histórico; TiDB #39604692838 |
| #1302 / B2 | #1329 `0de11f484cdfa4ef8209dde1c74d39a5e4a4251b` | [Agent-first #39888102527](https://github.com/crgasparoto-br/controle_calorias/actions/runs/39888102527) concluído `success` | Fontes, revogação e quarentena |
| #1304 / C1 | #1343 `4fef481206a15afb42d2d8e619fa21683d585e38` | [Agent-first #43314264242](https://github.com/crgasparoto-br/controle_calorias/actions/runs/43314264242) concluído `success` | Léxico versionado, spans, locale e ownership do parser |
| #1305 / C2 | #1331 `6c17cfe6b49175d30e47c92741727c92a0cd30aa` | [Agent-first #40572015728](https://github.com/crgasparoto-br/controle_calorias/actions/runs/40572015728) concluído `success` | Proveniência, monotonicidade e corpus |


Os runs são do HEAD de cada PR, não do SHA corrente da `develop`.
Para B1, a integração real de migration tem também
[Food V2 migration TiDB #39604692838](https://github.com/crgasparoto-br/controle_calorias/actions/runs/39604692838),
concluída com `success` no HEAD #1326. Na PR #1343 a revisão registrada
foi `APROVADA INTERNAMENTE`, não auditoria independente.

#### Rastreabilidade dos trinta critérios das seis dependências

| ID e critério | Testes/contratos versionados a reexecutar | Controle discriminante |
| --- | --- | --- |
| A1.1: schema inválido, sem mutação | `server/modules/foodIntelligenceV2/contracts.test.ts:36-62` | Versão/campo/confiança inválidos rejeitados |
| A1.2: origem distinta de texto e áudio | `server/modules/foodIntelligenceV2/adapters.test.ts:55` | Mesmo texto não colapsa a modalidade |
| A1.3: snapshot sem reinferência | `server/modules/foodIntelligenceV2/adapters.test.ts:307-352` | Versão desconhecida não causa recálculo |
| A1.4: restart/retry idempotente | `server/modules/foodIntelligenceV2/pendingOperation.test.ts:536-627` | Não duplicar efeitos nem perder versão |
| A1.5: entrypoints V1 preservados | `server/modules/foodIntelligenceV2/noProductionConsumer.test.ts:99-137` | Import produtivo real é recusado |
| A2.1: referência e controles negativos | `server/modules/foodIntelligenceV2/corpus/data.test.ts:208-221`; `server/modules/foodIntelligenceV2/corpus/harnessSelfTest.test.ts:206-237` | Não expor oráculo/caseId ao resolvedor |
| A2.2: meta 95% calculável | `server/modules/foodIntelligenceV2/corpus/harness.test.ts:218-254` | Denominador zero ou falseado não vira sucesso |
| A2.3: clarificação/rejeição verificáveis | `server/modules/foodIntelligenceV2/corpus/data.test.ts:281-304`; `server/modules/foodIntelligenceV2/corpus/harnessSelfTest.test.ts:332-413` | Não contar abstenção como resolução |
| A2.4: metamórficos de superfície | `server/modules/foodIntelligenceV2/corpus/harness.test.ts:265-311` | Equivalência com resultado errado reprova |
| A2.5: relatório segmentado | `server/modules/foodIntelligenceV2/corpus/harness.test.ts:161-211` | Dimensões/custo ausente não viram média global |
| B1.1: migration e rollback | `scripts/issue-1301-schema-contract.test.mjs:10-36`; `scripts/test-food-v2-migration-tidb.mjs` | DDL reversível apenas conforme pré-condições; run TiDB #39604692838 |
| B1.2: unicidade concorrente | `scripts/issue-1301-schema-contract.test.mjs:37-44`; `server/foodIntelligenceV2Persistence.issue1301.test.ts` | Sem unicidade apenas em memória |
| B1.3: histórico estável | `scripts/issue-1301-schema-contract.test.mjs:15-24`; `server/repositories/mealsRepository.shadow.test.ts:109-161` | Não reescrever macro ou ID persistido |
| B1.4: estados separados | `scripts/issue-1301-schema-contract.test.mjs:37-44`; `server/foodIntelligenceV2Persistence.issue1301.test.ts` | Outcome/estrutura/governança não colapsam |
| B1.5: integridade de banco | `scripts/test-food-v2-migration-tidb.mjs` | Conferir run TiDB #39604692838 no SHA de B1 |
| B2.1: governado antes da rede | `server/modules/foodIntelligenceV2/knowledgeRead.test.ts:33-55` | Hit local impede chamada externa |
| B2.2: externo apenas provisório | `server/modules/foodIntelligenceV2/knowledgeRead.test.ts:55-91` | Sem autorização e evidência não persistir |
| B2.3: revogação e cache | `server/modules/foodIntelligenceV2/sourceGrants.test.ts:26-43`; `server/modules/foodIntelligenceV2/repositoryGovernance.test.ts:444-480` | Revogado não reaparece em leitura futura |
| B2.4: quarentena isolada | `server/modules/foodIntelligenceV2/privateQuarantine.test.ts:96`; `server/modules/foodIntelligenceV2/knowledgeEligibility.test.ts:8-27` | Não publicar órfão pessoal globalmente |
| B2.5: novo alimento sem hardcode | `server/modules/foodIntelligenceV2/knowledgeRead.test.ts:33-55`; `server/modules/foodIntelligenceV2/repositoryGovernance.test.ts:64-99` | Inspecionar também escrita/cadastro; teste nominal não prova sozinho |
| C1.1: equivalência linguística | `server/modules/foodIntelligenceV2/linguisticComprehension.test.ts:33-80` | Mudança de numeral/ordem não troca alimento |
| C1.2: span original | `server/modules/foodIntelligenceV2/linguisticComprehension.test.ts:401-414` | Offsets UTF-16 não são apagados |
| C1.3: desconhecido preservado | `server/modules/foodIntelligenceV2/linguisticComprehension.test.ts:422-449` | OCR incerto não gera identidade inventada |
| C1.4: locale não suportado | `server/modules/foodIntelligenceV2/linguisticComprehension.test.ts:449-462` | Sem fallback de idioma silencioso |
| C1.5: parser único | `server/modules/foodIntelligenceV2/noProductionConsumer.test.ts:99-137`; `server/modules/foodIntelligenceV2/foodArchitectureSemanticBoundaries.test.ts` | Provar ownership de MealOperation na fronteira canônica |
| C2.1: estado e proveniência | `server/modules/foodIntelligenceV2/resolver.test.ts:59-103`; `server/modules/foodIntelligenceV2/contracts.test.ts:472-526` | Não aceitar verified por confiança isolada |
| C2.2: quantidade monotônica | `server/modules/foodIntelligenceV2/resolver.test.ts:308-338` | Omissão/contradição não reabre valor sem prova |
| C2.3: fontes conflitantes | `server/modules/foodIntelligenceV2/resolver.test.ts:270-281` | Última escrita não ganha por ordem |
| C2.4: origem nutricional obrigatória | `server/modules/foodIntelligenceV2/resolver.test.ts:234-270`; `server/modules/foodIntelligenceV2/resolver.golden.test.ts:69` | Não converter ausente em macro zero |
| C2.5: corpus atravessa resolvedor | `server/modules/foodIntelligenceV2/resolver.golden.test.ts:69`; `server/modules/foodIntelligenceV2/corpus/harness.test.ts:101-108` | Verificar execução de núcleo real e não só double |


### A-002 — cinco critérios técnicos C4

| Critério | Código/testes no SHA auditado | Implementação incorreta a refutar |
| --- | --- | --- |
| C4.1: Divergência por classe/modalidade | `server/modules/foodIntelligenceV2/shadowComparison.ts`; `server/modules/foodIntelligenceV2/shadowBaseline.ts`; `server/modules/foodIntelligenceV2/shadowRunner.test.ts:442`; `server/modules/foodIntelligenceV2/shadowBaselineReplay.test.ts:31` | Troca de segmento ou parcial contado como par completo |
| C4.2: Fallback e diferenças de macro | `server/modules/foodIntelligenceV2/shadowComparison.ts`; `server/modules/foodIntelligenceV2/shadowPairing.adversarial.test.ts:53-152`; `server/modules/foodIntelligenceV2/shadowBaselineReplay.test.ts:54-107` | Marca/variante conflitantes indevidamente pareadas |
| C4.3: Chamadas, retries e custo | `server/_core/ai/observability.ts`; `server/modules/foodIntelligenceV2/shadowRunner.test.ts:918-966`; `server/modules/foodIntelligenceV2/shadowBaselineReplay.test.ts:735-909` | Ausência de medida convertida em custo zero |
| C4.4: Histórico sem recalcular | `server/repositories/mealsRepository.shadow.test.ts:109-196`; `server/modules/insights/foodQuality.shadow.test.ts`; `server/householdMeasureMealUpdate.shadow.test.ts` | Catálogo atual usado no lugar do snapshot persistido |
| C4.5: Preparação fail-closed | `server/modules/foodIntelligenceV2/shadowRunner.ts`; `server/modules/foodIntelligenceV2/shadowRunner.test.ts:59-179`; `server/modules/foodIntelligenceV2/noProductionConsumer.test.ts:99-137` | Flag sozinha ativa V2 ou V2 substitui V1 |


### Execuções verificadas e limites da prova

- No checkout offline do HEAD documental anterior #1344,
  `node --test scripts/issue-1301-schema-contract.test.mjs scripts/issue-1302-schema-contract.test.mjs`
  teve **11/11** testes aprovados (contratos SQL, snapshot e rollback estático).
- A verificação dirigida de pareamento reportou **17/17** controles e
  **800/800** casos determinísticos favoráveis; três mutações incorretas
  foram detectadas. Essas medições pertencem ao código/identidade da
  sessão anterior, não constituem auditoria de um SHA futuro.
- [CI C4 #41364416124](https://github.com/crgasparoto-br/controle_calorias/actions/runs/41364416124)
  executou 24/24 shards no HEAD #1334 `2a9d1a44f577cd1bfdd7edc1be5311ee33b496f8`.
  [CI documental #44100005644](https://github.com/crgasparoto-br/controle_calorias/actions/runs/44100005644)
  executou 24/24 shards no HEAD #1344 `6dfe4459d22efea63706b535d607ce8dc71f66f5`.
  A última classificou a alteração como documental: TypeScript e arquitetura
  foram `skipped` nesse run. Os logs de shards não provam por si sós
  cada teste individual como `reached`/`passed`.
- O teste local `node --test scripts/check-food-v2-check-enforcement.test.mjs`
  não iniciou porque este ambiente offline não tem `mysql2` instalado.
  Não confundir a falta da dependência local com uma falha do código nem
  com uma execução local positiva; o gate TiDB remoto é evidência distinta.

**Estado após esta preparação:** A-001 e A-002 continuam bloqueados até
a auditoria independente de todas as seis dependências e dos cinco critérios
C4 no HEAD final. A matriz não marca checkboxes nem autoriza fechamento
da #1307. Gate A real, LGPD, baseline, shadow real, Gate B e cutover
continuam em #1335, mantendo V1 como único decisor produtivo.

## Contrato executável C4

- `shadowRunner.ts`: executa **uma vez** a função V1 recebida e devolve o
  mesmo resultado ou relança o mesmo erro **sem aguardar Gate A, V2 ou sink**.
  A observação e o hook `trackShadowTask` são agendados por `setImmediate`
  em outro turno do event loop, após a resposta/erro original da V1 estar
  disponível ao chamador: até a parte síncrona de Gate A e do hook não bloqueia
  a resposta. Qualquer integração posterior com `waitUntil`/ciclo de vida do
  host deve validar a retenção da tarefa após essa defasagem. Não há integração
  produtiva desse hook nesta fase, que permanece fail-closed pelo Gate A.
- Executar V2 exige a flag `FOOD_V2_SHADOW_ENABLED=true` **e** um callback
  `verifyGateA` que consulta evidência real de aprovação; ausência, exceção ou
  retorno inválido desliga shadow. **Nenhum callback produtivo de aprovação
  está registrado nesta fase**. Variável de ambiente não é auditoria.
- A-025: com flag OFF ou sem callback Gate A, o wrapper chama diretamente
  `runV1` sem ler nenhum campo de entrada. Com shadow solicitado, o snapshot
  anterior a V1 lê somente propriedades de dados próprias (JSON) e não executa
  getters; falha de inspeção auxiliar degrada a evidência V2, nunca a resposta
  ou o erro produtivo da V1. O override `enabled` é exclusivo de `NODE_ENV=test`:
  em execução produtiva, `FOOD_V2_SHADOW_ENABLED` é sempre obrigatório.
- A-028: `possibleSilentFallback` contabiliza cada item V1 observado
  cuja procedência nutricional esteja ausente ou explicitamente `unavailable`,
  inclusive macros zerados. Zero com origem declarada (`catalog`, por exemplo)
  não vira suspeita; estimativa com origem explícita não é fallback *silencioso*.
  O indicador é investigativo, não prova de erro nutricional nem aprovação de
  acurácia. Os mesmos sinais chegam ao baseline via agregação direta e replay,
  inclusive quando a observação V2 é parcial ou falha.
- A-029: a classificação *fornecida com o item confirmado* atravessa o
  `mealItemSchema` e é persistida em `foodSnapshotJson.classification` com
  `schemaVersion=1`, usando apenas nível de processamento, flags de fruta/
  vegetal/água potável e fibra declarada. O gravador compõe a classificação
  com os campos já existentes do snapshot nutricional e da resolução, sem
  substituí-los; a gravação transacional do repositório e a edição
  individual preservam a mesma regra. `classification=null` limpa uma classificação
  anterior, `undefined` não a inventa e o leitor shadow aceita o formato
  legado sem versão apenas quando tipado e íntegro. Versão desconhecida,
  campo inválido ou snapshot ausente resultam em `unknown` explícito; não há
  reclassificação por catálogo, nome ou macro. Teste integrado usa o schema
  público, o gravador real do repositório, a releitura e os agregadores,
  além de simular mudança posterior de catálogo e ausência de classificação.
  Esta classificação é um snapshot do valor recebido no registro V1, **não**
  uma certificação independente de acurácia V2. Itens históricos já gravados
  sem a informação continuam desconhecidos, sem backfill nem migração tácita.
- A-030: `mealItemHistoryReconciliation.ts` isola a reconciliação pura e
  `mealsRepository.ts` aplica as mudanças na mesma transação, preservando o
  limite de crescimento do módulo principal. A atualizacao de refeicoes preserva as linhas fisicas quando a mudanca e
  apenas do rotulo, data ou outra metadata; edicoes de porcao atualizam apenas
  o item alterado e conservam os IDs de variante/perfil e o snapshot anterior.
  Em insercao, remocao e reordenacao, os itens historicos sao pareados por
  identidade armazenada e conteudo discriminante antes de reconstruir a lista.
  Alteracoes de porcao sincronizam os campos fisicos de gramatura/macros com
  os valores confirmados, sem recalculo pelo catalogo.
  Reordenacao de variantes homonimas com mesma cardinalidade tambem exige
  reconciliacao por valores discriminantes, nao atualizacao pelo indice.
  Itens realmente novos, de marca/variante alterada ou em pareamento
  ambiguo entre duplicatas nao herdam refs nem classificacao sem prova
  de correspondencia; `classification=null` continua limpando
  apenas o atributo solicitado. Nao consulta nem remapeia catálogos atuais.
- A-031/A-032: a edição e a movimentação individual passam pela mesma checagem
  de identidade histórica da atualização completa. Mudança explícita de
  alimento/marca/variante invalida IDs V2, perfil nutricional, porção,
  classificação e proveniência antigos, sem herança por posição; porção do
  mesmo alimento mantém seus vínculos e a classificação confirmada, inclusive
  quando um snapshot nutricional novo é apresentado. A gravação posterior
  por combinação de nome/porção foi removida: o repositório já persiste
  snapshots junto aos itens na transação de inserção/atualização, com escopo
  físico por linha, impedindo sobrescrita cruzada de alimentos homônimos.
  Controles positivos e adversariais abrangem edição unitária, movimentação,
  identidade nova e classificação distinta por item. Nenhum Gate A ou
  baseline de dados reais é inferido desta correção técnica.
- A-033/A-034: uma atualizacao que reordena homonimos e muda simultaneamente
  as porcoes nunca presume que a posicao e a identidade; sem correspondencia
  discriminante, IDs V2 e snapshots anteriores nao sao copiados. Quando existe
  referencia historica explicita coerente ou variante comercial confirmada,
  o pareamento pode preservar identidade mesmo apos reordenacao e edicao.
  Novos itens persistem `confirmedCommercialIdentity` tipado no mesmo
  `foodSnapshotJson`, com apenas marca e variante fornecidas; edicoes da
  mesma identidade conservam esses valores, classificacao e proveniencia.
  Snapshots legados podem provar a variante por `resolution.productVariant`;
  ausencia da variante no historico nao e evidencia de igualdade, logo nao
  autoriza herdar refs ou classificacao. Nao consulta catalogo atual e nao
  declara acuracia V2 ou aprova Gate A. Testes positivos/negativos em
  `server/repositories/mealsRepository.shadow.test.ts` cobrem dupla edicao
  homonima, reordenacao com refs, persistencia, variante identica, legado
  comprovado e legado sem prova.
- A-035/A-036: na edicao completa de uma refeicao, itens sem pareamento
  historico que substituem um alimento por alteracao do nome ou identidade
  comercial descartam o catalogo V1 anterior, a resolucao nutricional e o
  snapshot do produto substituido. Um novo ID direto de catalogo comprovado pode ser preservado,
  mas a resolucao historica anterior nao e promovida; sem nova origem
  comprovada, o campo `source` degrada para `heuristic`, sem alegar acuracia.
  A confirmacao comercial explicita em registro legado exige escrita tipada
  mesmo sem alterar porcao ou macros; confirmacao ja persistida e identica
  nao reescreve o item. Testes exercitam o leitor V1 ate a transacao, homonimos,
  substituicao de marca/variante, ID novo e controles de idempotencia.
  A reconstrucao sanitiza qualquer item sem pareamento quando ha uma linha historica
  deslocada, mesmo se nome e identidade comercial mudarem juntos ou apenas
  o nome mudar; itens irmaos retidos nao invalidam uma nova referencia direta
  comprovada, e inclusoes puras nao sao tratadas como substituicoes.
  A-037 (nutricao da substituicao): a identidade comprovada de um novo item
  nao comprova os valores numericos enviados pelo editor V1. Na mesma
  transacao de edicao completa, edicao individual ou movimentacao, uma troca
  real de alimento/marca/variante exige um snapshot nutricional novo, vinculado
  a outro `foodId` e aos macros calculados, ou um `foodCatalogId` direto,
  ativo, acessivel ao usuario, com nome/identidade comercial compativeis.
  Para este segundo caso, os macros, gramatura e fibra sao **recalculados da
  linha atual do catalogo** usando `estimatedGrams / gramsPerServing`, nao
  copiados do payload/registro antigo. A classificacao recebida junto com
  uma substituicao nao ganha procedencia historica: permanece ausente ate
  nova evidencia especifica. Snapshot, `resolution`, origem de midia e
  referencias antigas nao sao herdados. Falta, conflito, dados invalidos ou
  referencia nominal sem prova direta falham com mensagem de revisao
  nutricional, antes da gravacao dos itens, sob transacao. Durante edicoes,
  a resolucao do catalogo nao cria registro automatico a partir do payload
  antigo: uma projecao somente de consulta omite a classificacao do payload
  para que o resolvedor canonico possa verificar um ID direto ativo/acessivel,
  sem fabricar entradas classificadas ou mudar suas regras normativas.
  O item original segue intacto para validacao transacional; classificacao
  anterior sera descartada apenas quando houver substituicao efetiva.
  A criacao normal nao relaxa o gate da classificacao.
  Edição completa, edição individual e movimentação sanitizam classificacao,
  resolucao e snapshot antigos **antes** de construir valores preliminares
  de uma substituicao; o novo snapshot V2 original ainda pode ser validado
  em separado sem herdar metadados antigos.
  A transacao confirma a identidade e recalcula a nutricao antes do commit;
  apos commit, API, totais e cache releem os nutrientes persistidos.
  Em edicao mista, uma substituicao comprovada por ID direto ou novo
  snapshot V2 nao bloqueia uma insercao legitima independente, mesmo quando
  ela aparece antes da substituicao. Ambiguidade sem prova suficiente ou nova
  linha que reutilize identificacao/macro/proveniencia de registro deslocado
  falha antes da escrita, sem atribuir a insercao o historico anterior.
  Edicao da mesma
  identidade (inclusive porcao), reordenacao e inclusao sem deslocar item
  anterior conservam as regras anteriores. O contrato nao declara
  `nutritionVerified=true` por mera existencia de item do catalogo.
  Isto nao ativa V2, Gate A nem telemetria produtiva.
  Regressao de aprendizado de medida caseira: os testes transacionais modelam
  IDs fisicos e a marca legada que existia em `foodSnapshotJson`, confirmam
  que a primeira correcao de gramas grava somente o item afetado, que uma
  segunda gravacao concorrente com snapshot antigo e rejeitada e que a
  confirmacao comercial tipada e preservada. Marca alterada ou ausencia
  historica de evidencia comercial sao recusadas sem escrever preferencia
  de aprendizado ou reaproveitar nutricao do alimento anterior.
- A-026: agregador direto e replay compartilham o schema estrito
  `shadowEventValidation.ts`, incluindo enums de segmentação, campos extras,
  cardinalidades, coerência `run/failure/outcome`, etapas S1/S2/S3, sinais,
  contagens e custos. O agregador direto também rejeita `traceId` duplicado,
  sem inserir dimensões livres ou pares impossíveis no baseline.
- V2 consome apenas observação da entrada original (texto/transcrição).
  Não converte `MealSemanticContract` ou item produzido pelo V1 de volta em
  `FoodObservation`. Imagem isolada e evidência multimodal incompleta são
  explicitadas como indisponíveis/parciais, nunca adivinhadas.
- Compreensão S1/S2 usa léxico governado. S3, fuzzy sem limiar, provider
  externo, estimativa e promoção de conhecimento ficam desativados.
  O store V2 oferece somente `readLocal`/`readPendingEvidence` e recusa
  `stagePendingEvidence`.
- `shadowComparison.ts` utiliza o pareador puro `shadowPairing.ts` para alinhar
  identidade normalizada e variante antes de comparar quantidades/macros,
  preservando duplicatas e separando itens
  sem correspondência. Mudança de ordem não cria falsa divergência, e item
  sem par não contamina deltas nutricionais. Exceção V1 de clarificação
  produz observação parcial com divergência de clarificação mensurável,
  sem inventar pares ou considerar o evento comparação completa. O baseline consolida itens
  sem par com contadores separados V1/V2 por classe/modalidade, inclusive
  em observações parciais, sem alterar o denominador dos pares completos.
  Registra contagens e diferenças
  estruturadas (identidade, variante, quantidade, fonte, macros, clarificação),
  etapas S1/S2/S3, tempo total/estágios e suspeita de fallback silencioso.
  Nunca registra texto, nome, mídia, URL, barcode, telefone, ID de titular,
  payload de provider ou erro textual. Correlação: UUID interno.
- A-008 (reauditoria): `v1ItemsObserved`/`v2ItemsObserved` distinguem um
  snapshot presente mas vazio de uma falha sem snapshot. O replay reconcilia
  `pares + itens sem par` com os dois totais **sempre que ambos foram observados**,
  inclusive quando uma das listas tem zero itens e o evento é parcial.
  Exceção V1 e V2 ausente não fabricam divergências. Eventos antigos que não
  contêm os marcadores obrigatórios são rejeitados, não classificados como
  população válida; não há coleta produtiva anterior a migrar.
- A-009 (reauditoria): `historicalRef=variant:<id>` do snapshot e
  `identity.variantId` do V2 são comparáveis apenas no namespace de variante.
  O pareamento prioriza IDs iguais mesmo com reordenação ou alteração de
  rótulo/macros. IDs diferentes não formam um par nutricional: permanecem
  sem correspondência e geram sinal de divergência de variante por nome
  normalizado, sem contaminar deltas. Quando falta ID comparável, o
  pareamento legado por texto continua diagnóstico, com
  `variantIdUnverifiable` explícito e agregado, nunca prova de acurácia.
- A-010 (remediação técnica): referências persistidas `food:<id>` são confrontadas
  diretamente com o `foodEntityId` do V2, sem confundir família com
  `variantId` ou `catalog:` legado. Famílias conhecidas diferentes ou
  família V2 ausente permanecem sem par e não produzem deltas nutricionais
  entre alimentos incompatíveis. A mesma família continua comparável mesmo
  quando o rótulo muda; essa alteração de nome é observável. Variantes
  persistidas têm prioridade sobre o fallback por família. Em cada estágio,
  duplicatas são resolvidas por pareamento de cardinalidade máxima e custo
  agregado mínimo, não pela primeira correspondência local. A-027: equivalência
  de família ou nome não autoriza comparar macros/quantidade quando marcas ou
  variantes especificadas entram em conflito; nesses casos, ambos os itens
  permanecem sem par nutricional e a troca de variante é contabilizada apenas
  como diagnóstico (um a um, inclusive sem ID histórico de variante). A
  correspondência por ID imutável de variante igual mantém precedência, mesmo
  diante de rótulos alterados. Campo ausente é desconhecido, não divergência
  explícita. Os controles
  adversariais abrangem nomes iguais de famílias diferentes, nomes alterados
  da mesma família, referência de catálogo não comparável, projeção com fixture do
  leitor persistido e armadilha de pareamento guloso com reordenações.
- Divergência **não** é erro comprovado: sem ground truth externo,
  `verifiedAccuracy` permanece `null`, mesmo se V1 e V2 concordarem.
  Deltas nutricionais são sinais, não critérios de tolerância C3 autorizados.
- `capabilityUsage` recebe observações de IA **do mesmo request**, por
  capacidade: chamadas, retries, latência e custo. O V1 instrumentado por
  `emitAiInferenceEvents` é capturado por escopo assíncrono somente quando o
  shadow é solicitado, sem depender de sink global. Apenas capacidade,
  papel da tentativa, duração e custo são mantidos temporariamente; nenhum
  `correlation`, texto, ID ou payload entra nessa captura. Requisições
  concorrentes são isoladas e eventos `attemptIndex=0` não são contados
  como chamadas externas. Sem instrumentação, em excesso de captura, com
  leitura auxiliar que lança ou com duração inválida, `capabilityUsage=null`
  representa medição desconhecida sem perder o evento V1×V2 já disponível;
  não significa zero chamadas. Isso prepara
  instrumentação de chamadas V1, **não** comprova custos reais de todos os
  adapters, retenção LGPD, baseline produtivo ou a aprovação do Gate A.

## Leitores históricos do shadow (Gate 19)

1. `server/repositories/mealsRepository.ts` usa `shadowReadOnly=true` para
   ler os macros e a classificação salvos quando houver snapshot válido;
   `historicalRef` prioriza `foodVariantId` persistido, com fallback para
   `foodId` e depois `foodCatalogId` legados. Não consulta catálogo atual
   nem inventa variante quando não há ID salvo. O leitor público V1
   continua com o formato anterior.
2. `server/householdMeasureMealUpdate.ts` expõe
   `projectHistoricalHouseholdItemsForShadow` sem consulta nem remapeamento
   por nome. O escritor/atualizador produtivo V1 permanece inalterado.
3. `server/modules/insights/service.ts` expõe
   `buildHistoricalFoodQualityForShadow`, sem `searchFoods/getFoodsByIds`.
4. `server/modules/insights/foodQuality.ts` só usa classificação salva;
   ausente/inválida permanece `unknown`, não recalcula macros antigos.
5. `shared/reportsGoalAnalytics.ts` agrupa variantes pelo `historicalRef`
   persistido e preserva nomes salvos como fallback histórico.

O relatório produtivo V1 ainda consulta o catálogo atual, enquanto o leitor
do shadow é separado e imutável. A migração restante de consumidores
produtivos exige Gate A/19 e cutover autorizado, não deve ser ocultada.

## Controles e evidências

- Flag OFF e Gate A ausente/inválido: V1 intacto e zero acessos ao V2.
- Gate A simulado em testes: a mesma entrada original percorre S1/S2 e
  resolvedor V2 reais com store governado de leitura.
- Clarificação V1, falha V2 e falha de sink: objeto V1 de retorno/erro idêntico.
- Imagem-only e ausência de OCR: cobertura indisponível explícita;
  não traduzir saída V1 em entrada V2.
- Escrita de conhecimento: bloqueio de `stagePendingEvidence`.
- Sanitização: sentinelas PII, texto, URL e detalhes de provider não escapam.
- Replay por classe/modalidade: agrupar contagens sem afirmar acurácia.
- A-001/A-002/A-003 (auditoria da PR #1334): matcher Vitest compatível,
  V1 independente de Gate A/read/emit pendentes e testes metamórficos de
  permutação, duplicatas, inserção, remoção, troca real de variante,
  mudança de identidade e macros reais.
- A-016: callback síncrono de Gate A e hook de tracking somente após o
  assentamento da V1, inclusive se a V1 falhar; hook que lança não interfere.
- A-017: getter de métricas que lança e provider com duração inválida degradam
  apenas `capabilityUsage` para `null`, preservando evento sanitizado e V1.
- A-018: quando decisões V2 estão presentes e o resolvedor concluiu, o replay
  exige `s1 + s2 + s3 = v2ItemCount`, inclusive se a execução é parcial por
  ausência do resultado V1. Lista V2 vazia exige zero etapas; falha real do
  resolvedor pode preservar etapas linguísticas sem inventar decisões.
- A-019: custos positivos, negativos ou extremos não podem sofrer overflow
  nem virar zero medido após arredondamento. O máximo de custo por capacidade
  e evento é `floor(MAX_SAFE_INTEGER / (10000 * 10^8)) = 9007 USD`, valor
  conservador de integridade para até 10 mil eventos, **não orçamento nem SLO**.
  A leitura auxiliar com custo inválido degrada somente `capabilityUsage=null`;
  o replay rejeita registros com custo acima do limite e o agregador direto
  falha fechado. Custos positivos abaixo da precisão de 1e-8 USD permanecem
  positivos, sem fabricar um zero aferido.
- A-020: um snapshot imutável mínimo dos campos V1 consumidos pelo comparador
  é capturado antes do retorno ao chamador. O observador nunca retém o objeto
  V1 completo (texto bruto, mídia, raciocínio e evidências pessoais); alterações
  posteriores do resultado retornado não alteram a telemetria. O código de
  exceção de clarificação também é congelado antes de relançar o erro V1
  original. Falha na projeção preserva V1 e deixa o lado V1 explicitamente
  não observado.
- A-021: diferenças nutricionais rejeitam operandos não finitos, negativos,
  extremos ou somas por evento além de `floor(MAX_SAFE_INTEGER/(10000*1000))`.
  Replay e agregador direto rejeitam valores incompatíveis e overflow em vez
  de convertê-los em zero. Deltas positivos abaixo de 0,001 preservam sinal.
  Limites matemáticos servem apenas à integridade de até 10 mil eventos, não
  representam SLO ou tolerância nutricional aprovada.
- A-022: contadores inteiros de itens, diferenças, estágios S1/S2/S3,
  sinalizadores e chamadas/retries/custo medido por capacidade são limitados a
  `floor(Number.MAX_SAFE_INTEGER / 10000)` por evento. Em até 10 mil eventos,
  o replay e o agregador direto rejeitam valores fracionários, negativos,
  não finitos e excessivos, além de somas que ultrapassem a precisão inteira
  segura, em vez de publicar contagens arredondadas. O limite é exclusivamente
  de integridade matemática, não representa SLO nem amostragem autorizada.
- A-023: o agregador direto valida todos os campos numéricos de cada evento,
  inclusive diferenças/flags, confiança e macros de execuções `partial` ou
  `failed`, **antes** da seleção de denominadores. Uma execução parcial válida
  permanece observável, mas não aumenta pares/macros completos. Valores fora
  do limite falham fechados, sem descarte silencioso.
- A-024: produtor, replay e agregador direto compartilham os limites de
  duração e a invariante sequencial V1 + linguagem + resolvedor ≤ total +
  0,002 ms. Duração inválida não se transforma em zero. Chamadas/retries,
  custo medido e totalLatencyMs são validados por capacidade, inclusive no
  primeiro evento, e custos `null` só são aceitos quando nem todas as chamadas
  foram medidas; duplicatas de capacidade no mesmo evento são rejeitadas.
  Somatórios de tempo possuem limite de integridade derivado de 10 mil eventos,
  sem antecipar a aprovação de SLO, baseline real ou Gate A.
- A-005: baseline preserva contagem e direção de itens sem par em inserção,
  remoção e identidade trocada; permutação não gera falso desvio; evento
  parcial permanece visível sem contaminar pares/macros completos.
- A-006: leitor do banco utiliza `foodVariantId` persistido para separar
  variantes homônimas da mesma família e catálogo, propagando a referência
  até agregação de qualidade; fallback legado e formato V1 intactos.
- A-008/A-009 (reauditoria de 29/10): testes negativos simétricos para
  V1 com itens/V2 vazio e V1 vazio/V2 com itens, snapshot ausente versus
  vazio, IDs iguais, IDs trocados homônimos, nutrição reordenada e legado
  sem crosswalk. Os contadores não armazenam IDs, nomes ou fontes pessoais.
- Leitor histórico: catalogação alterada, ID ausente, variante aposentada,
  classificação inválida e duas variantes homônimas não alteram macros
  ou classificação registrada.

Testes: `server/modules/foodIntelligenceV2/shadowRunner.test.ts`,
`server/modules/insights/foodQuality.shadow.test.ts`,
`server/repositories/mealsRepository.shadow.test.ts`.

## Portões de arquitetura e telemetria

A camada shadow trata estados tipados, contagens inicialmente desconhecidas,
validação de UUID e normalização Unicode como **metadados**, não como novo
léxico ou regra de decisão alimentar. O gate 2 continua bloqueando resolvedores
concorrentes; os gates 17/18 continuam recusando listas de alimentos, aliases,
materialidade e valores nutricionais embutidos. Casos positivos e negativos de
arquitetura preservam essa distinção sem exceções por arquivo nem alteração
do livro de dívida.

## Diagnóstico de baseline offline (preparação A-004)

- O agregador `buildFoodShadowBaseline` (`shadowBaseline.ts`, reexportado
  pelo contrato `shadowComparison.ts`) separa observações **também por entrypoint**
  (web/WhatsApp/registro/edição/replay), além de classe e modalidade. Expõe a
  distribuição tipada de resultados V1/V2 e os percentis observados p50/p95
  de `v1Ms` e p95 do tempo até completar a observação, pelo método de ordem
  mais próxima (*nearest rank*). A-015 exige medição monotônica das etapas
  sequenciais (V1, linguagem e resolvedor) e rejeita no produtor e no replay
  eventos cujo `totalMs` seja inferior à soma observada, tolerando apenas
  0,002 ms de arredondamento independente na precisão de 0,001 ms. Valores
  não finitos, negativos ou superiores ao limite matemático de acumulação
  segura (10.000 eventos por replay, três casas decimais) são rejeitados,
  sem se tornarem latências zero ou percentis artificiais. Este limite
  preserva integridade numérica, **não** representa orçamento/SLO aprovado. A-013 preserva também as contagens observadas
  de S1/S2/S3, conflitos entre fontes e p50/p95 de linguagem e resolvedor,
  sempre acompanhados dos denominadores de amostras instrumentadas. Quando
  uma etapa não foi medida, seus percentis ficam `null` (não são zero inferido);
  a cobertura de `capabilityUsage` separa requisições observadas das sem captura
  (`null`), sem tratar ausência como zero chamadas. São números diagnósticos,
  **não SLOs aprovados**; nenhuma janela, coorte representativa, limite de custo
  ou tolerância é inferida.
- No replay diagnóstico (#1311), `v1ItemObservation` mostra, para cada
  segmento, execuções com snapshot V1 (`snapshotRuns`), sem snapshot
  (`missingSnapshotRuns`) e quantos itens V1 foram observados
  (`observedItems`). Um snapshot vazio conta como observado, mas não
  acrescenta itens. Observações parciais ou falhas do lado V2 não apagam
  itens V1 já observados. `observedItems` é o denominador de
  `potentialSilentFallbacks`, não a contagem de pares ou requisições.
  Denominador zero é ausência de amostra de itens; suspeitas zero com
  itens observados ainda não provam zero fallback silencioso. O sinal V2
  `missingNutritionProvenance` tem outra população (decisões com nutrição
  consumida) e não usa este denominador.
- `server/modules/foodIntelligenceV2/shadowBaselineReplay.ts` valida em profundidade
  eventos pré-sanitizados, rejeitando campos inesperados (inclusive texto/PII),
  números incoerentes, correlações duplicadas, somas de itens sem par e
  contadores incompatíveis com os totais V1/V2 em comparações completas
  e parciais com listas observadas dos dois lados. Eventos sem snapshot de
  um dos lados permanecem parciais e não inventam itens ausentes. A-011 também
  recusa contagens de identidade/variante acima dos pares e substituições sem par,
  divergências de quantidade/nutrição/fonte acima dos pares, suspeitas de fallback
  acima dos itens V1 e sinais de falha/conflito V2 acima dos itens V2. Sem pares,
  os deltas de macros devem permanecer `null`. A-012 recusa estados V1
  impossíveis, V2 resolvida após falha da camada de linguagem/resolvedor,
  sucesso V2 sem itens e deltas positivos de macro sem divergência nutricional
  registrada, preservando falha legítima, comparação parcial e amostra vazia.
  A-014 reconcilia ainda o outcome V2 com o contador de falha explícita
  (sem rejeição artificial em lista V2 vazia), a divergência booleana de
  clarificação conforme ambos outcomes observáveis e as etapas S1/S2/S3
  com falhas anteriores à obtenção das observações. Os dados de um lado
  ausente preservam `null`; falha posterior do resolvedor conserva etapas
  linguísticas já observadas. Controles negativos rejeitam sinais forjados,
  sem usar contagens agregadas como prova de acurácia real.
  Controles adversariais exercitam comparações completas/parciais, snapshots
  ausentes e limites exatos, rejeitando incoerência em vez de truncar contadores.
  Não persiste eventos nem alimenta
  o resolvedor. O comando manual, sem rede ou sink, é:

  ```bash
  pnpm exec tsx tools/food-v2-shadow-baseline-replay.ts /caminho/privado/observacoes-sanitizadas.json
  ```

  A entrada é um JSON de forma
  `{ "schemaVersion": 1, "kind": "food-v2-sanitized-shadow-events", "events": [/* FoodShadowEvent */] }`,
  com até 10.000 eventos e 8 MiB. O comando emite somente agregado e `status=diagnostic-only`,
  `gateAApproved=false`, `sampleProvenanceVerified=false`, `verifiedAccuracy=null` e
  `rolloutEligible=false`. Ele **nunca** certifica autenticidade da fonte ou Gate A,
  mesmo que o arquivo se declare aprovado. Arquivos privados não podem ser
  commitados ou enviados a artifacts de CI sem autorização LGPD específica.
- Este procedimento não valida cobertura de consumo real, rotulagem por oráculo
  independente, distribuição populacional, qualidade da amostra, tempo de retenção
  ou Gate 19 completo. Os bloqueios anteriores continuam integrais.

## Baseline, bloqueios e ativação

A decisão de produto de 29/10/2026 separou os testes reais pós-deploy técnico
na issue #1335. Até então, o escopo desta entrega é a preparação verificável
por CI/testes sintéticos, com V2 desativada, sem liberar Gate A ou shadow real.

A conclusão/fechamento técnico da #1307, depois de satisfeitos seus critérios,
dependências técnicas e auditoria, não marca Gate A/B como aprovados nem autoriza
operação real. Esses estados e evidências permanecem exclusivamente no trabalho
pós-deploy da #1335.

**Não existe baseline V1×V2 de tráfego real nesta issue até aprovação.**
`buildFoodShadowBaseline` agrega somente eventos sanitizados. Fixtures de
teste não são dados populacionais. Janelas, percentis, amostragem, orçamento,
SLOs, retenção do sink e gatilhos de rollback ainda estão `OPEN` na ADR.

Antes da operação real: aprovar Gate A independentemente; conectar callback
de verificação runtime à evidência oficial, integrações web/WhatsApp,
visão/OCR estruturados, sink LGPD com retenção e eventos de IA correlatos
por request; coletar amostra aprovada, contrastar ground truth independente,
verificar Gate 19 completo e somente então discutir canário. **Esta entrega
não habilita canário, não retira V1 e não atende automaticamente Gate B.**
