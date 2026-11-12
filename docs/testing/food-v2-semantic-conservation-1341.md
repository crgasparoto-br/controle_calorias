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
**determinístico** (`c1b-cartesian-v1`): 2 grafias × 3 delimitadores × 2
ordens. Não usa aleatoriedade; semente: `not-applicable`. O contraexemplo
mínimo deve ser identificado pelo `caseId` e pelo fato da matriz, sem copiar
texto pessoal para telemetria.

A coleta em CI imprime `C1B_1341_AGGREGATE=` seguido de JSON com o SHA de
`VERIFICATION_HEAD_SHA`, contagens por tipo, partição e modalidade, revisão de
léxico, classificação de vínculo, comparação **parcial** V1, e decisão.
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
