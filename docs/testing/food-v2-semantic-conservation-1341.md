# Experimento C1b — conservação semântica (issue #1341)

**Natureza:** protocolo e diagnóstico técnico reproduzível, **não** autorização de
rollout, gate nutricional ou aprovação independente. Fonte normativa:
`docs/design-docs/adr-food-intelligence-resolver-v2.md` §§4.1.2–4.1.8, 16–18;
evidência atual do corpus em `server/modules/foodIntelligenceV2/corpus/`.

## Hipótese a refutar

A preservação de `rawInput` e de um span que inclui a frase inteira **não prova**
que a quantidade foi atribuída ao alimento e ingrediente corretos. A LCL pode
segmentar alimentos distintos e ainda perder a estrutura de medidas internas.
O diagnóstico precisa distinguir:

1. **Estruturado:** observação tipada representa quantidade/unidade e o dono
   do fato; negação possui qualificador do mesmo dono.
2. **Rastreável, mas não interpretado:** fato está dentro de uma âncora original
   e tem estado não resolvido; não pode autorizar mutação.
3. **Vínculo de componente ausente:** alimento, ingrediente e medida estão no
   texto, mas o contrato atual não declara a relação entre eles. Não preencher
   a lacuna apenas com um token/regex coincidente ou quantidade do alimento.
4. **Omissão silenciosa:** um fato rotulado não está em nenhum span observável;
   é falha do gate mesmo que os demais itens sejam reconhecidos.
5. **Vínculo errado / fechamento falso:** quantidade passou a outro alimento ou
   o sistema declarou resolvido algo sem a evidência estruturada requerida.
6. **Continuação indevidamente tratada como alimento:** `mais açúcar` tem dono
   indeterminado; criar candidato alimentar com esse texto não prova segurança.

## Como reproduzir

Base de implementação do experimento: `develop@abf7ff19c1c5927b6f79ed098534ebb74c9eea9f`.

```sh
pnpm exec vitest run server/modules/foodIntelligenceV2/corpus/semanticConservation1341.test.ts
pnpm check
pnpm agent:check
```

O teste chama `comprehendFoodLanguage` **real** com léxico governado vazio e
versão fixa, sem S3 nem chamadas externas. Ele reutiliza a pasta canônica do
Golden Food Corpus da #1299, com referência manual suplementar por fato
material e span; **não** cria resolvedor, endpoint ou corpus nutricional
concorrente. As referências independentes de saída do parser são declaradas
em `semanticConservation1341.test.fixture.ts`; o verificador tipado está em
`semanticConservation1341.test.support.fixture.ts`.

As entradas incluem duas porções de açúcar ligadas a alimentos diferentes,
ordem invertida, vírgula, ponto e vírgula, escrita por extenso/numeral,
conversão de unidade **não autorizada** (`g` versus colher), complemento
solto, negação local, termo `brigadeiro de colher`, quantidade simples de
alimentos, fração, texto e transcrição. O gerador é cartesiano e
**determinístico** (`c1b-cartesian-v2`): 2 grafias × 3 delimitadores × 2
ordens. Não usa aleatoriedade; semente: `not-applicable`. O contraexemplo
mínimo deve ser identificado pelo `caseId` e pelo fato da matriz, sem copiar
texto pessoal para telemetria.

O comando Vitest direto imprime `C1B_1341_AGGREGATE=` seguido de JSON,
mas o runner de shards suprime stdout dos testes aprovados no log público.
No CI, a matriz é preservada em `c1b-1341-semantic-conservation.json`
no artefato existente `food-v2-c3-calibration-<HEAD>`, com
`VERIFICATION_HEAD_SHA`, contagens por tipo, partição e modalidade, revisão
de léxico, classificação de vínculo, comparador **parcial** V1 e decisão.
O extrator V1 `extractExplicitSugarQuantity` apenas informa se encontra uma
medida numérica singular: **não** representa todo o fluxo público V1 e não
pode ser usado como oráculo da verdade.

## Leitura do resultado e limites

A aprovação do **teste diagnóstico** indica que o oráculo e seus detectores
foram exercitados, **não** que a LCL passou na conservação semântica. A
aprovação arquitetural exige `casesStructurallyComplete == cases` em conjunto
reservado independente, zero omissões silenciosas e zero vínculos falsos,
com revisão do contrato e evidência adversarial exact-SHA. Uma medida de
acurácia nutricional real não é fornecida aqui; meta >=95% da ADR só pode
ser julgada no denominador resolvível rotulado, incluindo abstenções, e não
pela proporção de spans preservados. Marcar S3, custo, latência, nutrição,
consistência multimodal visual e persistência real como **não avaliados**.

Os testes de mutação removem uma observação, trocam quantidades entre donos e
simulam tentativa de admitir lote incompleto **apenas no verificador**. A
prevenção de persistência parcial real exige controles positivos e negativos
nos entrypoints públicos da #1308, sem mock do resolvedor, e integração com o
lifecycle original. A #1307 segue responsável pelo shadow técnico inativo;
a #1335 é a dona exclusiva dos Gates A/B reais pós-deploy.

## Diagnóstico arquitetural inicial (não certificado)

A inspeção da `develop` mostra que `FoodObservation` tem **um único**
`quantityHints` por observação e não possui um vínculo tipado repetível entre
quantidade de ingrediente e alimento dono. Em frases como "café com uma
colher de chá de açúcar e um pudim com 2 g de açúcar", o segmentador S1
separa os dois escopos, mas a quantidade `2 g` é interna ao modificador de
pudim; no teste estrutural local de `splitFoodSurface/readQuantity`, ela não
se torna uma medição de açúcar atribuída ao pudim. A presença do texto
original impede concluir descarte total, mas **não prova vínculo**.

**Decisão proposta:** `ajustar contrato/ADR`, caso a execução exata da LCL
confirme essas lacunas. Não resolver com uma nova lista de frases V1. Abrir
recorte de mudança do contrato na #1298/ADR, evoluir a única LCL na #1304,
adicionar oráculos por fato ao Golden Food Corpus #1299 e somente então
liberar D1 #1308 para migração decisória. Nenhuma flag V2 deve ser ativada
por este diagnóstico; revisão independente é etapa separada.

## Remediação de auditoria #1342

- A referência inclui agora alimentos sem quantidade, como `brigadeiro de colher`.
- O split é feito por família semântica inteira; nenhum grupo atravessa
  calibração e holdout. O gerador usa `o café` para eliminar duplicata literal.
- O verificador distingue contradição material de owner/quantidade da ausência
  estrutural de vínculo tipado: nenhum dos dois autoriza gravar o lote.
- A comparação por grupos reaproveita a projeção canônica da #1299 e mede
  divergência de projeções observadas e colisões de controles negativos;
  um teste diagnóstico verde NÃO equivale a aprovação do gate semântico.
- A matriz de cada caso contém fatos esperados/observados e resultados por
  escopo do extrator V1, explicitamente parcial e sem autoridade de owner.
- Além do console `C1B_1341_AGGREGATE`, a CI salva
  `c1b-1341-semantic-conservation.json` no artefato já existente
  `food-v2-c3-calibration-<HEAD>` via `C3_EVIDENCE_OUTPUT_DIR`,
  sem editar workflows. Essa evidência C1b não é calibração C3.
- Persistência real, clarificação pública, S3, nutrição e acurácia em produção
  continuam `not-measured` e dependentes das respectivas issues.

## Fechamento técnico da rodada A-1342-07…11 (13/11/2026)

**Regra de evidência:** estes ajustes ampliam o diagnóstico, não modificam a LCL
produtiva ou aprovam o gate semântico. A matriz continua registrando falhas
materiais e não deve ser convertida em PASS semântico apenas porque o Vitest
termina verde. O corpus A2 permanece governado pelo seu contrato e partições.

| Achado | Controle material implementado |
| --- | --- |
| A-1342-07 | O diagnóstico executa casos textuais/transcritos reais de `goldenFoodCorpusCases`, com `caseId`, versão, split, classe, controles negativos, expectativas projetadas por `projectExpectedDecision` e observações projetadas por `projectObservation`. Registra cobertura por ID e compara indícios pré-resolução sem equiparar a decisão final ao extrator S1. Os casos da mortadela possuem correspondência literal demonstrável com a anotação C1b. |
| A-1342-08 | Há agora grades distintos para ingrediente não materializado (`ingredient-quantity-unobserved`), número/unidade incompatíveis (`ingredient-quantity-mismatch`) e número observado sem vínculo tipado (`missing-component-binding`). Troca de dono ou de quantidades entre irmãos permanece `misbound`. Testes mutacionais exercitam as três diferenças; preservar span não substitui nenhum valor. |
| A-1342-09 | Fatos de continuação ambígua declaram dois donos possíveis, razão, obrigação de abstenção e quantidade quando observada. O validador rejeita referências sem alternativas; o relatório confronta as alternativas observadas da LCL com os candidatos esperados. Ausência de alternativas em estado não resolvido é `owner-alternatives-missing`, não êxito. |
| A-1342-10 | O baseline V1 recebe a **frase inteira** e executa `splitFoodTextSegments`, `parseFoodText`, `extractExplicitSugarQuantity` em cada segmento resultante e `normalizeSweetenedCoffeeDraftItems`. Registra os segmentos do V1, seus offsets e tentativas de reconhecer açúcar, preservando a identidade do fato esperado apenas como anotação. Não passa `fact.scope` ao V1 nem usa seu resultado como oráculo; o pipeline público completo e efeitos persistidos continuam `not-measured`. |
| A-1342-11 | `attemptDiagnosticBatchAdmission` recebe explicitamente IDs selecionados de observações e computa novamente cada fato rotulado sobre o subconjunto. Refuta tentativa parcial quando há item irmão ou continuação ambígua, mas admite o controle simples integral. É **simulação** que jamais escreve refeição; o teste real de mutação pública pertence à #1308. |

**Reprodução:**

```sh
pnpm exec vitest run server/modules/foodIntelligenceV2/corpus/semanticConservation1341.test.ts
pnpm check
pnpm agent:check
```

A matriz do Vitest é publicada como `c1b-1341-semantic-conservation.json`
no artefato oficial do CI `food-v2-c3-calibration-<HEAD>`. Os blocos
`canonicalBaseline`, `legacy.caseResults`, `grades`, `metamorphic`,
`negativeControls` e `caseResults` permitem auditoria por ID e por SHA, sem
promover equivalência em subclasses ainda não representadas. Não confundir
projeção de decisão A2 e observação LCL; os campos de nutrição, S3, latência,
clarificação pública e persistência real permanecem `not-measured`.

## Remediação A-1342-12–14 — rastreabilidade, negação e admissão

- **A-1342-12 — proveniência:** antes de classificar um fato como estruturado, o
  diagnóstico exige `rawInput`, modalidade, `surfaceSpan.sourceRef` e âncoras de
  `evidence`/`normalizationPath` coerentes com o `c1b:<caseId>` e com o span
  UTF-16 original. Uma âncora de outro caso é `invalid-provenance`, não
  cobertura válida nem mera omissão silenciosa. O controle altera cada classe de
  âncora separadamente e prova rejeição por caso.
- **A-1342-13 — negação local:** `sem açúcar` só é `structured` quando o mesmo
  objeto identifica o alimento rotulado como dono; uma negação do café
  atribuída ao pudim, ou vice-versa, recebe `misbound`. O teste preserva um
  controle positivo de cada direção e refuta a troca de proprietário.
- **A-1342-14 — admissão simulada:** `structurallyComplete` mede a presença de
  fatos estruturados, não a resolução da identidade. A simulação de admissão
  rejeita toda observação selecionada com `unresolvedReason` não nulo, mesmo
  com `structured` para todos os fatos. O controle de aprovação usa apenas
  observações **sinteticamente resolvidas** para testar o verificador; não é
  prova de decisão nutricional, autorização de escrita ou comportamento do
  entrypoint público, que permanece responsabilidade da #1308.

A matriz CI inclui `remediationControls`, com resultados negativos de origem,
âncoras, associação da negação e admissão; o Vitest exige resultados
adversariais explícitos, não apenas a presença das linhas no relatório.
Nenhuma mudança foi feita no parser, runtime de produção, flags ou persistência.

## Remediação A-1342-15–16 — completude bidirecional e evidências

**Escopo:** somente o verificador C1b, seus testes e a matriz de diagnóstico;
nenhuma alteração nos parsers, na LCL, no schema de `FoodObservation` ou na
persistência pública. Os fatos rotulados continuam sendo a referência independente.

- **A-1342-15 — observações sem fato:** a matriz agora confere cada observação
  contra os fatos independentes por span e owner, além da checagem tradicional
  fato → observação. Observações extras e observações duplicadas para o mesmo
  fato recebem, respectivamente, `unexpected-observation` e
  `duplicate-observation`; ambas bloqueiam `structurallyComplete` e a admissão
  diagnóstica. Uma seleção que omita observações do lote original também é
  recusada, mesmo que todos os fatos esperados estejam cobertos no subconjunto.
- **A-1342-16 — coerência da evidência:** `invalid-evidence` distingue uma
  observação sem comprovação material de uma origem incorreta
  (`invalid-provenance`). Para fatos estruturáveis, o controle exige evidência
  de identidade compatível com a observação e com o texto de sua âncora,
  quantidade/unidade consistente com `quantityHints`, qualificadores cobertos
  e caminho S1 ancorado no fato. O span da observação e suas evidências
  precisam pertencer ao escopo independente do owner, sem englobar outro
  alimento da mesma frase. A falta de evidência ou de trilha também falha.
  Esses controles não atribuem vínculos de ingrediente ausentes no contrato.

O relatório C1b utiliza `schemaVersion: 3`. `grades` permanece com denominador
**fatos esperados**; a nova seção `observationIssues` e
`casesWithObservationIssues` medem separadamente retornos não justificados,
duplicados, com origem incompatível ou sem prova material. Cada `caseResults`
carrega `observationIssues` por `observationId` e índice. O bloco
`remediationControls.reverseCoverageAndEvidence` registra o controle positivo
sintético e os ataques negativos de alimento fabricado, duplicação, evidência
identitária contraditória, âncora apenas numérica, evidência que engloba o
alimento vizinho, evidência vazia, evidência de quantidade omitida/adulterada
e caminho de normalização incoerente.

A admissão continua uma **simulação de diagnóstico**, sem substituição do gate
de escrita pública da #1308. CI verde comprova execução do detector, e não
aprovação de conservação semântica produtiva nem autorização de S3/cutover.

## Remediação A-1342-17–18 — quantidades repetidas e continuação ambígua

- **A-1342-17:** uma observação representa apenas um `quantityHints` material.
  O diagnóstico agora vincula cada fato de quantidade estruturado a uma
  observação distinta por pareamento máximo determinístico. Duas menções do
  mesmo alimento com a mesma quantidade são fatos separados; uma observação
  ampla que cobre ambas recebe `shared-quantity-observation` e impede
  `structurallyComplete`/admissão. Há dois casos novos no split de calibração (regressões conhecidas; holdout preservado):
  `2 ovos e mais dois ovos` e `2 ovos e mais 3 ovos`. O índice de owner
  escolhe a ocorrência ligada ao span do fato, não a primeira na frase.
- **A-1342-18:** em continuação com alternativas de owner e abstenção, uma
  quantidade explicitamente rotulada mas não capturada recebe
  `unbound-quantity-unobserved`; valor/unidade divergente recebe
  `unbound-quantity-mismatch`. São resultados diagnósticos que não
  inventam owner nem autorizam escrita.
- A matriz `schemaVersion: 4` preserva `remediationControls` anteriores
  e registra `remediationControls.quantityConservation` com negativos
  (uma observação ampla, valor/unidade alterados, quantidade ausente) e
  positivos sintéticos (observações distintas e abstenção explícita).
  As referências do corpus continuam autorais e independentes da saída LCL.
  CI verde comprova apenas o teste do diagnóstico; S3, nutrição e persistência
  pública permanecem não avaliadas.

## Remediação A-1342-19–20 — quantidade sem fonte e ocorrências literais

- **A-1342-19:** um fato `food-mention` rotulado sem quantidade não admite
  `quantityHints.value`, `quantityHints.unit` ou evidência `quantity.value`
  adicionais como prova de conservação. Os controles sintéticos exercitam
  `brigadeiro de colher` sem quantidade (positivo), com `99 g` e `1 colher`
  inventados e com unidade órfã (negativos); a mutação também é comparada
  contra o caso preexistente `measure-word-food-name` sem alterar seu holdout.
  Completude e admissão **diagnóstica** são recusadas para as alegações extras.
- **A-1342-20:** `C1bFact` pode anotar `surfaceStart` e `scopeStart` em
  offsets UTF-16 explícitos quando o literal se repete no input. Sem offset,
  literais ambíguos seguem rejeitados; offsets inválidos, substrings que não
  correspondem à referência e dois fatos da mesma classe no mesmo span
  falham antes de consultar o parser. A fixture de calibração
  `food-repeated-literal` cobre `2 ovos e mais 2 ovos` com spans distintos
  `[0, 6]` e `[14, 20]`. Testes comprovam duas observações independentes
  aceitas, observação ausente rejeitada e uma única observação que tenta
  reivindicar ambas rejeitada. A comparação observacional V1 utiliza os
  offsets rotulados, não `indexOf` da primeira ocorrência.
- A matriz exact-SHA `schemaVersion: 5` preserva os controles existentes e
  acrescenta `remediationControls.postAuditLiteralAndMention`. Não há
  alteração em runtime produtivo, schema, léxico, S3, flags, entrypoints,
  persistência, workflows ou rulesets. O sucesso do diagnóstico não comprova
  conservação semântica da LCL, aprovação independente ou autorização de merge.

## Remediacao A-1342-21/22 - hypotheses and secondary quantity hints

- **A-1342-21:** C1b now checks *every* `FoodObservation.alternatives[]`
  against the independently labelled owner and quantity, including units and
  provenance of an explicit `quantity.value` claim. Unexpected or repeated
  owner hypotheses, unsupported amounts, changed units, and unsourced
  `servingText` fail as `invalid-evidence`, even when the primary observation
  correctly abstains. A benign equivalent hypothesis remains admissible in
  the isolated diagnostic simulation; ambiguity still blocks admission.
- **A-1342-22:** `quantityHints.servingText` must be present within the
  independently labelled fact surface; borrowing a sibling's quantity is
  rejected. `visiblePackageQuantity` and `visiblePackageUnit` are **not**
  consumed-portion facts: they are allowed only when the human-authored
  reference explicitly labels a package value, unit and source surface.
  Missing, invented, orphaned and contradictory package fields fail closed.
  The distinct package calibration control uses the raw input
  `iogurte, embalagem de 170 g`, a source-labelled package claim of `170 g`,
  and no consumed portion. A valid source-backed package is accepted by the
  *diagnostic* oracle; incorrect amounts and units are rejected. The existing
  canonical holdout is not edited or supplied to S2/S3.
- The `C1bFact.packageClaim` annotation belongs only to the test oracle.
  The current production `FoodEvidence` vocabulary has no distinct typed
  package-evidence field, so this test proves source-labelled coverage, **not**
  production package provenance or nutritional intake. No schema, LCL runtime,
  persistence, S3, public entrypoint or flag was changed.
- Exact-SHA diagnostic output uses `schemaVersion: 6` and records
  `remediationControls.postAuditLiteralAndMention.alternativeAndSecondaryQuantities`,
  including positive/negative control outcomes and explicit `not-measured`
  persistence. The per-fact report also exposes secondary quantity hints and
  independently labelled package expectations for later review. CI success
  does not certify V2 semantic conservation or authorize merge/cutover.

## Remediação A-1342-23/24 — prova da ocorrência e das hipóteses alternativas

- **A-1342-23 — `servingText` por ocorrência:** o oráculo localiza cada
  afirmação de porção em offsets UTF-16 do texto original, dentro do
  `surfaceSpan` e das âncoras de prova da observação, além do escopo autoral.
  Uma mesma superfície pode ocorrer em dois fatos, mas não se permite usar a
  ocorrência do irmão como prova; se a afirmação corresponder a qualquer fato
  irmão dentro do span observado, o resultado é `invalid-evidence`. O teste
  `food-repeated-literal` mantém o positivo com duas observações independentes
  de `2 ovos` e refuta a primeira observação alterada para `mais 2 ovos` com
  `structurallyComplete=false` e admissão diagnóstica recusada.
- **A-1342-24 — qualificadores de alternativas:** cada hipótese
  `alternatives[]` que reivindica uma negação deve corresponder a um fato
  `negation` independente do mesmo dono, no seu span original, sustentado por
  evidência vinculada à própria hipótese. Qualificadores sem rótulo semântico
  no C1b não recebem aprovação por coincidência textual; `sem açúcar` e
  `assado` inventados em alternativa de `brigadeiro de colher` são rejeitados.
  O positivo com `sem açúcar` realmente rotulado e evidenciado continua
  `structured`, assim como a hipótese benigna sem novos qualificadores.
- A matriz `schemaVersion: 7` acrescenta
  `remediationControls.postAuditLiteralAndMention.alternativeAndSecondaryQuantities`
  com `sameScopeBorrowedServing`, `supportedNegationAlternative` e as variantes
  `mentionWithInventedNegation`/`mentionWithInventedPreparation` em
  `unsupportedSecondaryFields`. O teste afirma os resultados esperados;
  revisão externa deve confrontar o JSON e o CI no novo SHA exato.
- Esta remediação é exclusiva do **oráculo diagnóstico**, sem editar parser,
  schema `FoodObservation`, fluxo público, banco, flags, S3 ou rulesets.
  Testes verdes e admissão sintética não certificam conservação semântica
  produtiva, nutrição, persistência nem autorização de release ou merge.


## Remediação A-1342-25/26 — atributos de identidade e papel semântico

- O oráculo C1b agora exige **rótulos manuais independentes por fato/owner**
  (`C1bFact.identityClaims`) para marca, variante, preparo, código de barras e
  qualificadores não representados por negação já rotulada. Cada afirmação deve
  corresponder ao valor do rótulo, ao trecho original da ocorrência, à âncora
  e à evidência **do campo específico** (`identity.brand`, `identity.variant`,
  `identity.preparation`, `identity.barcode`). Alternativas precisam referenciar
  a evidência pelo próprio `evidenceIds`. Sem rótulo, o atributo **não** é
  considerado `structured` por coincidência lexical ou por ausência de prova.
- Qualificadores **primários e alternativos** percorrem a mesma verificação de
  `value`, `role`, `attributeCode`, owner e fonte original. Negação rotulada
  `sem açúcar` conserva o papel `sweetening` somente para o alimento dono;
  `de colher` no nome do alimento não autoriza `sweetening`, e alterar o papel
  para `preparation` ou forjar `attributeCode` também é rejeitado.
- O controle positivo independente usa um alimento com marca, variante,
  preparo, código de barras e qualificador explicitamente rotulados e
  evidenciados. Controles negativos incluem os ataques originais do auditor
  (atributos primários/alternativos inventados e falsa classificação de
  `de colher`), mutações de todos os campos rotulados, troca de papel/código,
  ausência de prova em `alternatives.evidenceIds` e campo de evidência errado.
  Todas as negações e quantidades anteriormente rotuladas continuam cobertas.
- `schemaVersion: 8` da matriz do CI expõe os controles em
  `remediationControls.postAuditLiteralAndMention.alternativeAndSecondaryQuantities.identityAndQualifierGrounding`,
  associados ao `sampleSha` exato. A admissão continua **sintética e
  diagnóstica**. Nenhum parser/runtime produtivo, contrato V2, flag, gate de
  persistência, workflow ou ruleset foi alterado. CI verde não comprova
  conservação semântica V2 nem autoriza merge, S3 ou cutover.

## Remediação A-1342-27 — evidências materiais bidirecionais

- A auditoria independente do HEAD `38096db0240012a3b4bcd4448b37a704f1b2972b`
  reproduziu quatro falsos positivos: evidências extras `identity.brand`,
  `identity.qualifiers`, `quantity.unit` e `quantity.grams` não rotuladas eram
  ignoradas mesmo quando o fato principal permanecia `structured`.
- O verificador C1b passa a conferir **toda** `FoodEvidence` contra o fato
  rotulado, seu owner, campo, valor, unidade, span de origem e hipótese que a
  reivindica. Evidências de identidade exigem atributo independente; quantidades
  físicas só são aceitas quando o fato tem valor e unidade exatos, sem conversão
  implícita. Campos de decisão/variante/nutrição não têm rótulo pré-resolução
  no C1b e não podem servir como prova da observação de entrada.
- O novo `semanticConservation1341.evidence.test.ts` executa controles negativos
  dos quatro ataques originais e de campos irmãos, além de positivas com marca,
  qualificador e medidas rotuladas, hipótese alternativa e ocorrência irmã.
  Os testes exigem `invalid-evidence`, incompletude e recusa da admissão
  simulada para provas falsas, sem esconder as falhas reais da LCL.
- O CI publica `c1b-1341-evidence-reversal.json` no mesmo artefato
  `food-v2-c3-calibration-<HEAD>` já existente, com `sampleSha`, resultados
  positivos e negativos, e fronteira explícita de persistência não medida.
- **Recomendação RISK-001:** para uma afirmação textual S1, `ai_estimate` não
  substitui evidência proveniente do texto/transcrição; `verified=false` por si
  só não é falha (a LCL observacional não certifica identidade/nutrição).
  Uma origem `catalog` só é aceita no controle diagnóstico quando vinculada a
  etapa S2 rastreável. Essa regra **não** homologa a confiança de S3/C2 nem
  autoriza decisão de persistência; as issues #1298/#1308 governam tais gates.

A referência independente, a matriz C1b preexistente, o corpus canônico e os
controles A-1342-01…26 permanecem preservados. O CI verde comprova somente a
execução do diagnóstico, nunca a aprovação semântica da LCL produtiva, S3,
shadow, cutover ou gravação real de refeições.

### Correção de compatibilidade com regressões canônicas (CI #43557788103)

- A refutação inversa exige verificar a **totalidade** das evidências, mas não
  deve limitar toda evidência ao fato corrente: uma observação pode ancorar
  duas alegações legitimamente rotuladas do **mesmo proprietário**, mesmo que
  não possa provar dois fatos de quantidade com um único `quantityHints`.
  O pareamento injetivo de fatos e observações permanece obrigatório.
- `identity.foodName` é ancorada na ocorrência original do *proprietário*;
  sua prova não precisa sobrepor a negação que aparece depois do nome.
  Em `um pudim sem açúcar`, a referência manual ganhou a quantidade explícita
  de **um pudim**, distinta da negação local. O texto, a partição holdout e
  as expectativas de outros casos não foram modificados.
- A rodada de CI revelou estes dois contraexemplos e exigiu ajustes positivos
  e negativos adicionais no teste focado, sem remover a validação bidirecional
  nem transformar diagnóstico verde em aprovação da conservação produtiva.

### Verificação da hipótese contra evidência emprestada

- Um identificador de `FoodEvidence` listado em `alternatives[].evidenceIds`
  precisa sustentar **aquela hipótese**; evidência verdadeira apenas para a
  observação primária não basta para a alternativa. O controle sintético usa
  a negação de um pudim com quantidade explícita: uma hipótese que não declara
  a porção pode citar o nome/negação, mas não o ID de prova da porção primária.
- O Vitest compara ambos os controles e publica o resultado no artefato
  `c1b-1341-hypothesis-evidence.json` do HEAD exato. Essa prova continua
  diagnóstica, sem alterar contrato público nem autorizar gravação.

## Remediação A-1342-28–31 — fonte de alegações materiais (14/11/2026)

- **A-1342-28:** a inspeção reversa deixa de usar dicionário literal de modalidade
  e conjuntos literais de classes de fato/qualificador em funções decisórias.
  As condições tipadas permanecem explícitas, preservando seus resultados.
  O gate `pnpm architecture:check` continua obrigatório e não foi alterado.
- **A-1342-29:** `servingText` só pode ser a expressão completa ou prefixo
  de token da superfície `food-quantity` rotulada manualmente, pertencente
  ao mesmo owner, quantidade, unidade e ocorrência original, com span de prova.
  Conectivos como `e mais` são negativos para porções, enquanto `2 ovos`,
  `2` e a porção explícita `um` do pudim são positivos. Menções sem quantidade,
  como `brigadeiro de colher`, podem conservar exatamente o nome autoral em
  `servingText` como rastro textual, nunca como quantidade consumida.
  Isso usa referência independente, sem criar um segundo parser de quantidades.
- **A-1342-30:** hipótese alternativa que reivindica apenas identidade e
  não referencia IDs de evidência quantitativa pode abster-se da contagem
  primária corretamente rotulada. Uma hipótese que reivindica quantidade
  divergente ou toma emprestado o ID de prova da porção continua inválida.
  O caso `um pudim sem açúcar` verifica as duas faces no mesmo harness.
- **A-1342-31:** no recorte C1b com S2 governado vazio, `normalizedInput`
  deve ser uma projeção reversível da entrada íntegra, da superfície de
  observação ou da identidade observada validada por evidência. O teste adversarial
  altera somente esse campo para `ovos sem açúcar` e `banana` e exige
  `invalid-evidence`, enquanto `ovos` e o texto original permanecem válidos.
  Reescritas governadas em S2 e interpretação S3 requerem prova separada
  com o léxico/versionamento autorizado; o teste C1b não as certifica.

O Vitest `semanticConservation1341.evidence.test.ts` executa as regressões
e publica `c1b-1341-material-source-claims.json` no artifact já existente do
runner oficial, além das matrizes C1b anteriores. Os controles são diagnósticos
e a admissão positiva é exclusivamente **sintética**, sem persistência pública.
As métricas de produção, custos, latência, nutrição e S3 permanecem
`not-measured`/`not-evaluated`. A publicação de código e o CI exact-SHA
devem ser confirmados separadamente antes de solicitar nova auditoria;
nenhuma aprovação independente ou autorização de merge é inferida.

### Isolamento dos módulos C1b em tempo de teste

O verificador de fatos, spans e evidências `semanticConservation1341.test.support.fixture.ts`
e seu auxiliar `semanticConservation1341.evidence.fixture.ts` são implementações
**exclusivamente do experimento Vitest**, importadas pelos testes, nunca pelo
runtime alimentar produtivo. Os nomes `.fixture.ts` seguem a classificação
canônica de `isProductionFoodSource` do gate arquitetural: código de teste
isolado não é normalizador nem dicionário lexical governado de produção.
A lógica e seus controles negativos permanecem inalterados nesta mudança
estrutural; módulos importados pelo runtime continuam sujeitos a todos os gates.

## Remediação A-1342-32/33 — procedência S2 e quantidade de hipóteses

- **A-1342-32:** o experimento C1b executa com léxico governado vazio
  (`c1b-empty-s2`). O oráculo rejeita evidência `origin=catalog`, revisão
  incompatível e qualquer passo de normalização S2 inventado nesse recorte,
  mesmo quando o próprio objeto declara `lexiconEntryId`. A presença da etapa
  no payload não comprova que uma entrada de léxico foi realmente carregada.
  O Vitest mantém o positivo de evidência original S1 e refuta catálogo
  com/sem passo S2, passo S2 com fonte textual e revisão fictícia.
  A validação de um **léxico não vazio** exige nova fonte independente
  de `lexiconEntryId`/revisão e teste calibrado próprio; não foi autorizada
  ou simulada como prova real nesta issue.
- **A-1342-33:** toda hipótese alternativa que declara quantidade/unidade deve
  incluir em `evidenceIds` a prova `quantity.value` pertencente ao mesmo
  fato material, valor, unidade e span de origem. A prova da observação
  principal não pode suprir o ID omitido na hipótese. Controles negativos
  cobrem conjunto vazio e somente identidade; positivos preservam a hipótese
  com referência quantitativa e a abstenção explícita (`value/unit=null`)
  com referência apenas de identidade. No caso de continuação ambígua,
  múltiplos owners alternativos podem compartilhar a **mesma** evidência
  da quantidade original, sem inventar atribuição definitiva.
- **Evidências exact-SHA:** o workflow existente publica, junto da matriz
  `c1b-1341-semantic-conservation.json`, os arquivos
  `c1b-1341-audit-escape-32.json` e `c1b-1341-audit-escape-33.json` com
  `sampleSha`, positivos, negativos, `invalid-evidence` e resultado da
  admissão simulada. O teste diagnóstico verde não certifica conservação
  produtiva, IA S3, precisão nutricional, persistência pública ou cutover.

## Remediação A-1342-34 — identidade alimentar integral rotulada

- **Escape reproduzido:** a validação anterior aceitava qualquer `identity.foodName`
  iniciado pelo owner. Em `2 ovos e mais 2 ovos`, a primeira observação podia
  afirmar `ovos e mais`; em `2 ovos e 1 banana`, podia afirmar `ovos e 1 banana`.
  Bastava ancorar esse valor no texto amplo para obter `structured` e admissão
  diagnóstica, embora o nome incorporasse conector ou outro alimento não rotulado.
- **Contrato de refutação:** `hasSupportedIdentityAssertions` agora exige que o
  nome inteiro corresponda ao owner independente, ou que todo material adicional
  esteja contido em rótulos independentes do **mesmo owner e scope**: marca,
  variante, preparo, qualificadores ou negação. Somente espaços entre os trechos
  rotulados são tolerados; substring/prefixo ou evidência autoafirmada não
  tornam uma concatenação válida. Nenhum regex alimentar, alias ou schema
  produtivo foi adicionado.
- **Controles adversariais:** `semanticConservation1341.evidence.test.ts`
  preserva dois positivos com quantidades independentes e rejeita os dois
  falsos positivos, exigindo `invalid-evidence`, `structurallyComplete=false`
  e `attemptDiagnosticBatchAdmission.admitted=false`. Positivos distintos
  asseguram que `brigadeiro de colher` continue como nome integral rotulado,
  `pudim sem açúcar` preserve sua negação local, e `ovos cozidos` permaneça
  aceitável apenas com preparo explicitamente rotulado e evidenciado. O
  controle negativo sem rótulo de preparo também é rejeitado.
- **Evidência da execução:** com `C3_EVIDENCE_OUTPUT_DIR` definido pelo
  workflow existente, o teste exporta `c1b-1341-audit-escape-34.json`,
  contendo `sampleSha` do novo HEAD, positivos, negativos e resultados da
  admissão simulada. Essa prova é do **oráculo diagnóstico**, não de gravação
  pública, S3, nutrição ou aprovação da LCL. Verificar o CI no SHA novo e
  submeter o candidato a auditoria realmente independente antes de encerrar
  #1341, converter a PR em Ready ou liberar integração.


## Remediação A-1342-35 — pontuação não material de preparo rotulado

- **Escape reproduzido:** a prova de `2 ovos cozidos` era `structured`, mas
  `2 ovos (cozidos)` e `2 ovos, cozidos`, com o mesmo preparo independente,
  eram falsamente `invalid-evidence`. O oráculo não reconhecia os delimitadores
  na composição do nome e nas duas conferências da evidência de identidade.
- **Correção limitada:** somente vírgula e parênteses são normalizados como
  separadores não materiais durante a comparação de `identity.foodName`;
  os spans UTF-16, a evidência original, a identidade do owner e a exigência
  de rótulos e provas específicas de preparo continuam intactos. Conectores,
  numerais de outros alimentos e conteúdo não rotulado continuam proibidos;
  essa equivalência não constitui regra alimentar nova nem modifica S1/S2/S3.
- **Provas adversariais:** o Vitest `semanticConservation1341.evidence.test.ts`
  contém quatro positivos equivalentes e quatro negativos (preparo sem rótulo,
  evidência de preparo ausente, conector e alimento irmão). Cada negativo
  exige `invalid-evidence`, incompletude estrutural e admissão simulada
  recusada; os positivos exigem `structured` e admissão apenas diagnóstica.
- **Evidência:** `c1b-1341-audit-escape-35.json` é produzido no artefato
  `food-v2-c3-calibration-<HEAD>` pelo workflow existente, com `sampleSha`
  exato, resultados por variante e limites `not-measured`/`not-evaluated`.
  Nenhum runtime produtivo, schema, endpoint, persistência, flag ou regra de
  CI foi alterado. CI verde e execução desses controles **não substituem**
  auditoria independente nem autorizam merge, S3, migração, canário ou cutover.

## Remediação A-1342-36/37 — identidade pontuada e hipóteses alternativas

- **A-1342-36:** a comparação owner↔`identity.foodName` usa agora a
  mesma equivalência limitada de vírgulas e parênteses empregada pelo
  conferidor de nomes integralmente rotulados. Assim `ovos, cozidos` e
  `ovos (cozidos)` podem manter o owner `ovos` sem dispensar spans,
  preparo autoral nem evidência de origem. Conectores e alimento irmão
  continuam material adicional, nunca normalizados como pontuação.
- **A-1342-37:** hipóteses alternativas de um owner inequívoco podem
  carregar o preparo rotulado completo. A verificação exige origem
  independente do nome e `evidenceIds` para preparo e quantidade;
  nomes com sufixo sem rótulo não são admitidos. Duplicatas que apenas
  variam pontuação continuam representando o mesmo owner e são rejeitadas.
  Para continuidades sem owner (`unbound`), a lista de owners permitidos
  permanece estrita e a admissão ambígua segue bloqueada.
- **Regressões no SHA novo:** o teste `semanticConservation1341.evidence.test.ts`
  exerce quatro versões de `identity.foodName` (simples, parênteses,
  vírgula e ambos), cada qual com e sem hipótese alternativa, e rejeita
  preparo sem evidência, duplicata do mesmo owner, preparo sem rótulo
  e hipótese que incorpora conector/alimento irmão. Cada negativo exige
  `invalid-evidence`, `structurallyComplete=false` e admissão
  diagnóstica recusada.
- **Evidência:** o workflow existente publica
  `c1b-1341-audit-escape-36-37.json` junto à matriz C1b, com SHA
  exact-HEAD, resultados positivos/negativos e limites explícitos.
  Admissão positiva é exclusivamente sintética. Não foram alterados
  runtime alimentar produtivo, schema, IA, persistência ou gates de CI.
  CI verde exige reauditoria realmente independente para eventual merge;
  não comprova conservação semântica produtiva, cutover ou S3.


## Remediação A-1342-38 — autoridade do valor de evidência identitária

O valor de `evidence` com campo `identity.foodName` é também uma afirmação de
identidade material e deve passar pelo **mesmo oráculo independente** aplicado a
`identityHints.foodName`: owner da ocorrência, span original e rótulos
explícitos de preparação, marca, variante, qualificadores ou negação. A
simples presença do `foodName` dentro de uma evidência maior **não** é prova
de que conectores, incrementos ou alimentos irmãos pertençam à identidade.
O verificador exige que a ocorrência rotulada esteja dentro do próprio
`evidence.anchor.span`, evitando obter prova de outro trecho do mesmo escopo.

O controle adversarial altera **somente** `identity.foodName` em `evidence`,
mantendo a identidade e a quantidade tipadas intactas: `ovos e` e
`ovos e mais`, extraídos de `2 ovos e mais 2 ovos`, precisam produzir
`invalid-evidence`, incompletude e admissão diagnóstica recusada. Os
positivos mantêm as duas ocorrências de ovos com quantidades separadas e
aceitam `2 ovos, (cozidos)` com preparação rotulada, inclusive em hipótese
alternativa com `evidenceIds` válidos. A matriz reproduzível é
`c1b-1341-audit-escape-38.json`, exportada no artefato oficial do CI pelo
runner existente e vinculada a `VERIFICATION_HEAD_SHA`.

A mudança é exclusiva do **oráculo de teste** e não modifica LCL produtiva,
`FoodObservation`, parser V1, S3, nutrição, persistência, workflows ou rulesets.
CI verde prova a execução do diagnóstico; **não aprova a conservação semântica
V2 nem substitui revisão independente**.


## Remediação A-1342-39 — menções materiais e negações repetidas

- **Contraexemplos independentes:** `banana e banana` com duas referências
  `food-mention` e apenas uma observação de banana; `café sem açúcar e café sem
  açúcar` com duas referências `negation` e apenas um qualificador evidenciado
  numa observação ampla. Antes da correção, ambos eram falsamente
  `structured`/`structurallyComplete=true` e admitidos no simulador.
- **Regra do oráculo:** cada menção alimentar sem quantidade consome um slot
  distinto de identidade observada; cada negação consome um slot distinto de
  qualificador, acompanhado de prova no span **da própria ocorrência**. Uma
  evidência ampla cobrindo duas negações não equivale a duas provas. Falhas
  ficam em `shared-material-observation` (ou `silent-omission` quando não há
  observação). O pareamento usa fatos humanos rotulados, jamais o retorno
  de outro parser.
- **Compatibilidade:** a observação que representa `um pudim sem açúcar`
  continua podendo conservar a quantidade e a negação do mesmo alimento,
  porque são *tipos diferentes de afirmação*. Duas negações idênticas não
  podem ser representadas pela repetição de um qualificador na mesma observação:
  o próprio schema canônico rejeita duplicatas. Devem ser observadas e
  evidenciadas como ocorrências independentes.
- **Controles:** `semanticConservation1341.evidence.test.ts` exercita os dois
  negativos originais, repetição de evidência ou qualificador, ausência da
  segunda observação e positivos com cobertura independente. O teste escreve
  `c1b-1341-audit-escape-39.json` no artefato oficial já existente quando
  `C3_EVIDENCE_OUTPUT_DIR` está definido, incluindo SHA exato, esperados,
  observados e os limites da admissão diagnóstica.
- **Limites:** nenhuma alteração em parser/runtime produtivo, schema,
  persistência, S3, entrypoints ou CI. A matriz é um diagnóstico da LCL,
  não um gate semântico de produção aprovado; a auditoria independente do
  novo HEAD permanece necessária antes de Ready, merge ou encerramento #1341.

## Remediacao A-1342-40 - incremento material independente

- **Falha anterior:** os controles sinteticos `2 ovos e mais dois ovos`,
  `2 ovos e mais 2 ovos` e `2 ovos e mais 3 ovos` comprovavam duas medidas,
  mas admitiam o lote sem uma referencia ou prova separada do operador
  material `mais`. O texto em `rawInput` por si so nao demonstra a relacao.
- **Oraculo autoral:** a classe `increment` tem span UTF-16 proprio de `mais`,
  scope da segunda ocorrencia e `incrementTargetIndex` apontando para o fato
  independente de quantidade a que o acrescimo se refere. A referencia e
  validada antes de executar o parser. A assinatura metamorfica inclui a
  relacao e seu alvo (owner/valor/unidade), nao apenas as duas quantidades.
- **Classificacao fail-closed:** sem observacao da origem, `silent-omission`;
  com span amplo mas sem pendencia sustentada, `increment-unproven`; com span
  e caminho S1 incluindo a origem do operador, o alvo e
  `unresolvedReason` nao nulo, `traceable-unresolved` (nunca `structured`).
  Mesmo a pendencia correta bloqueia `structurallyComplete` e a admissao
  simulada. O contrato produtivo `FoodObservation` nao representa relacao
  aditiva tipada; nenhuma evidencia textual e promovida a vinculo aprovado.
- **Controles independentes:** duas quantidades com o mesmo alimento e
  sem `mais` (`2 ovos e 2 ovos`) permanecem `structured` e admissiveis
  somente no simulador. O par com `mais` e uma referencia materialmente
  diferente (sem inferir diferenca de macros); falsos positivos com operador
  omitido, apenas capturado no span, ou resolvido sem prova sao rejeitados.
  Testes irmaos cobrem quantidade igual escrita por extenso e quantidade
  distinta, alem de referencia malformada/target errado.
- **Prova CI:** `semanticConservation1341.evidence.test.ts` exporta
  `c1b-1341-audit-escape-40.json` no artifact existente
  `food-v2-c3-calibration-<HEAD>`, incluindo resultados por controle,
  `sampleSha` e limites. A matriz principal passa a contar a relacao como
  fato adicional, mas mantem teste diagnostico verde diferente de aprovacao
  semantica V2. Apenas os casos de calibracao foram estendidos; holdout
  permaneceu intocado. Nao ha alteracao de parser, schema publico, S3,
  persistencia, workflows, flags ou rulesets.

## Remediação A-1342-41 — identidade de ocorrência do alvo aditivo

- **Contraexemplo independente:** `2 ovos e mais 2 ovos e mais 2 ovos`, com
  três quantidades iguais e dois operadores `mais`. Uma referência adulterada
  podia apontar ambos ao terceiro `2 ovos`; o verificador anterior a aceitava
  e emitia assinatura igual à correta, ocultando uma troca de vínculo.
- **Regra:** um incremento só pode referenciar a próxima ocorrência rotulada de
  quantidade alimentar dentro do seu escopo, com correspondência injetiva
  operador–destino. Referências com alvo existente porém saltado, compartilhado
  ou em ordem incompatível falham antes de qualquer observação do parser.
- **Projeção:** a assinatura metamórfica inclui a posição ordinal do operador
  e do alvo entre ocorrências do mesmo alimento; offsets absolutos UTF-16
  continuam usados para validar origem, mas não para comparar reformulações
  equivalentes ou reordenações de alimentos independentes.
- **Controles:** dois casos de calibração, literal e numeral por extenso, são
  equivalentes; dois conjuntos válidos de quatro menções com destinos 2+3
  versus 2+4 precisam ter assinaturas diferentes; mutantes de reutilização,
  salto e inversão de alvos são rejeitados. Três observações estruturadas de
  quantidade sem prova aditiva permanecem com dois `silent-omission`, lote
  diagnóstico incompleto e admissão `false`.
- **Evidência:** o teste `semanticConservation1341.evidence.test.ts` publica
  `c1b-1341-audit-escape-41.json` no artefato do CI exact-SHA existente.
  Todos os controles pertencem ao split de calibração. Holdout, parser,
  contrato público, nutrição, S3, persistência, workflows e rulesets não
  mudaram. O CI verde do experimento não aprova a LCL para cutover.

## Remediation A-1342-42 - complete lexical owner identity

- **Failure class:** the diagnostic reference validator previously accepted
  `owner="ov"` inside the source name `ovos`, even if a forged observation and
  its evidence used the same fragment. That is a false positive for authored
  source material, not a failure of productive LCL extraction.
- **Correction:** `sourceOwnerOccurrences` now requires exact original-text
  matching with Unicode lexical boundaries (letters, combining marks, numbers,
  connectors, hyphens and apostrophes). The same source rule protects declared
  owner alternatives. It does not infer synonyms, nutrition or pluralization.
- **Adversarial controls:** reject prefix, interior, suffix, accented-word and
  hyphenated-name fragments, including a schema-valid forged observation and
  ambiguous owner alternatives; accept complete names, punctuation delimiters,
  and an independent later `ovo` despite an earlier `ovos`.
- **Proof:** the existing Vitest runner writes
  `c1b-1341-audit-escape-42.json` into the C3 calibration artifact with
  exact-HEAD `sampleSha`, positive/negative results, and the boundaries of the
  claim. Mutations are calibration-only; the authored holdout remains intact.
- **Boundaries:** diagnostic oracle only, with no changes to the productive
  parser, `FoodObservation` schema, S3, flags, entrypoints or persistence. A
  green diagnostic is not a V2 semantic approval, independent audit or merge.

## Remediação A-1342-43 — proprietário da quantidade na ocorrência correta

- **Falha demonstrada:** o oráculo podia validar `2 ovos` como quantidade de
  `banana`, ou `1 banana` como quantidade de `ovos`, quando a referência e a
  observação falsificadas usavam um escopo amplo. A identidade localizada em
  outra parte da frase não comprova o vínculo desta quantidade.
- **Invariante do oráculo:** cada `food-quantity` ou `food-mention` precisa
  conter exatamente uma ocorrência lexical íntegra do proprietário no próprio
  `surface` rotulado. Uma referência alimentar não pode englobar o fato
  alimentar independente de um irmão. Modificadores, negações e incrementos
  continuam podendo apontar para o proprietário dentro de `scope` sem exigir
  que o nome apareça no modificador.
- **Refutação:** o Vitest existente `semanticConservation1341.evidence.test.ts`
  rejeita as duas atribuições trocadas, duas superfícies amplas que englobam
  alimento irmão e uma menção emprestada. Confere também
  `validateC1bReference`, `evaluateC1b` e `attemptDiagnosticBatchAdmission`.
  Controles positivos preservam a frase simples com escopo amplo e claims
  locais, ordem inversa, quantidades repetidas e fração escrita por extenso.
- **Evidência exact-SHA:** arquivo `c1b-1341-audit-escape-43.json` no artefato
  já publicado pelo runner existente (`food-v2-c3-calibration-<HEAD>`), com
  casos esperados/observados e `sampleSha`. Sem mudanças no parser, no
  contrato público `FoodObservation`, nutrição, S3, gravação ou workflows.
  Um teste diagnóstico verde não certifica a conservação semântica produtiva;
  manter `adjust-ADR-contract-before-D1-semantic-cutover` e exigir auditoria
  independente no novo HEAD antes de Ready, merge ou fechamento da #1341.
