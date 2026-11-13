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
`semanticConservation1341.test.support.ts`.

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
  e caminho S1 ancorado no fato. A falta de evidência ou de trilha também falha.
  Esses controles não atribuem vínculos de ingrediente ausentes no contrato.

O relatório C1b utiliza `schemaVersion: 3`. `grades` permanece com denominador
**fatos esperados**; a nova seção `observationIssues` e
`casesWithObservationIssues` medem separadamente retornos não justificados,
duplicados, com origem incompatível ou sem prova material. Cada `caseResults`
carrega `observationIssues` por `observationId` e índice. O bloco
`remediationControls.reverseCoverageAndEvidence` registra o controle positivo
sintético e os ataques negativos de alimento fabricado, duplicação, evidência
identitária contraditória, âncora apenas numérica, evidência vazia, evidência
de quantidade omitida/adulterada e caminho de normalização incoerente.

A admissão continua uma **simulação de diagnóstico**, sem substituição do gate
de escrita pública da #1308. CI verde comprova execução do detector, e não
aprovação de conservação semântica produtiva nem autorização de S3/cutover.
