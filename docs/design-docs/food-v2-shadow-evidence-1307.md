# Issue #1307 — shadow V1×V2, telemetria e prontidão

**Estado: infraestrutura preparada, sem ativação produtiva.** Base inicial:
`develop@4ff6202ec7e0b9a895791c3f930cefdc43b97e3e`. A issue #1307 não pode
ser considerada aprovada, tampouco ter baseline real atribuído, sem o **Gate A**
da ADR §8.12, os critérios abertos de §1.3 e auditoria independente.

Fonte normativa: `docs/design-docs/adr-food-intelligence-resolver-v2.md`
§§1.3, 8.12, 8.14, 19.7, 19.9 e 20/Fase C.

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
  agregado mínimo, não pela primeira correspondência local. Os controles
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
