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
  A observação acontece em tarefa desacoplada; `trackShadowTask` opcional
  permite ao runtime manter a tarefa viva (por exemplo, `waitUntil`) sem
  torná-la parte da latência produtiva. Não há integração produtiva desse
  hook nesta fase, que permanece fail-closed pelo Gate A.
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
- `shadowComparison.ts` pareia por identidade normalizada e variante antes
  de comparar quantidades/macros, preservando duplicatas e separando itens
  sem correspondência. Mudança de ordem não cria falsa divergência, e item
  sem par não contamina deltas nutricionais. Registra contagens e diferenças
  estruturadas (identidade, variante, quantidade, fonte, macros, clarificação),
  etapas S1/S2/S3, tempo total/estágios e suspeita de fallback silencioso.
  Nunca registra texto, nome, mídia, URL, barcode, telefone, ID de titular,
  payload de provider ou erro textual. Correlação: UUID interno.
- Divergência **não** é erro comprovado: sem ground truth externo,
  `verifiedAccuracy` permanece `null`, mesmo se V1 e V2 concordarem.
  Deltas nutricionais são sinais, não critérios de tolerância C3 autorizados.
- `capabilityUsage` recebe observações de IA **do mesmo request**, por
  capacidade: chamadas, retries, latência, custo. Se ausente, o campo é
  `null` em vez de afirmar zero uso ou custo.

## Leitores históricos do shadow (Gate 19)

1. `server/repositories/mealsRepository.ts` usa `shadowReadOnly=true` para
   ler os macros e a classificação salvos quando houver snapshot válido;
   `historicalRef` vem apenas do ID persistido, jamais do catálogo atual.
   O leitor público V1 continua com o formato anterior.
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

## Baseline, bloqueios e ativação

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
