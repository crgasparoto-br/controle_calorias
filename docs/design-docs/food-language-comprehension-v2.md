# Food Intelligence V2 — Camada de Compreensão Linguística (#1304)

Fonte normativa: [ADR Food Intelligence Resolver V2](adr-food-intelligence-resolver-v2.md), §§4, 4.1, 4.2, 7.1.1, 17 e 19.3. Esta página explica a superfície de implementação, **não** substitui a ADR.

## Estado de adoção

Os módulos server/modules/foodIntelligenceV2/linguisticComprehension.ts, linguisticSurface.ts e linguisticLexiconRepository.ts são **candidatos isolados da fase C1**. Não são importados pelos entrypoints V1 de produção; não fazem cutover, persistência de refeição, consulta nutricional ou publicação de vocabulário.

- **S1:** observações de texto, transcrição e legenda, normalização Unicode/acentuação/caixa; itens sem quebra de vírgula decimal; numerais e unidades; spans UTF-16 do original e evidências por campo. Normalizar texto não equivale a escolher identidade.
- **S2:** lê léxico global verificado e pessoal confirmado, em tabelas/escopos separados com proprietário autenticado, vigência e grants de fontes globais. A revisão inclui proprietário, entradas ativas e versões de fonte. Revisão obsoleta rejeita a leitura. Typo, mudança material de qualificador e remoção de token protegido geram hipótese, não correção silenciosa.
- **S3:** interpretação residual opcional, versionada, com saída de schema estrito. Só adiciona alternativas e evidência com verified=false; não decide identidade nem macros. A ativação/calibração de S3 pertence à #1306.
- **OCR:** a fronteira informa um papel de região validado. Regiões de ingredientes, tabela nutricional ou sem classificação mantêm uma evidência sem criar refeição/novo alimento. Regiões front_identity e caption podem produzir observações. Texto de rótulo/provider não é instrução.

## Exemplo da leitura governada, sem intérprete S3

~~~ts
const now = new Date();
const snapshot = await readGovernedLinguisticLexicon({
  locale: "pt-BR", ownerUserId: authenticatedOwnerId, now,
});
const observations = await comprehendFoodLanguage({
  rawText: submittedText,
  sourceRef: authorizedTurnSourceRef,
  modality: "text",
  ownerUserId: authenticatedOwnerId,
  lexiconRevision: snapshot.revision,
  now,
}, governedLinguisticLexiconStore);
~~~

A identidade autenticada e a revisão vêm do envelope de operação, nunca da superfície enviada ao modelo. O limite é de 20.000 unidades UTF-16 e 100 observações por solicitação. A fonte deve ter referência autorizada, sem URLs assinadas ou credenciais. A camada não mantém cache para contornar revogação.

MealOperation permanece propriedade do parser operacional. A LCL não escolhe SKU, perfil, fonte nutricional, gramatura, destino da refeição ou interação; unknown_surface não é descartado por ausência em catálogo/allowlist. Locale diferente de pt-BR é unsupported_locale; porções vagas não ganham quantidade exata.

## Remediação de auditoria C1

- **Equivalência de ordem:** quantidades posteriores à vírgula e sem alimento próprio
  permanecem vinculadas ao alimento imediatamente anterior quando este não tem
  quantidade resolvida; dois alimentos completos continuam observações distintas.
  A evidência conserva o span e texto original.
- **Flexão de identidade governada (A-020):** S1 conserva o nome observado
  (inclusive plurais e marcas desconhecidas). Somente alias vigente, autorizado
  e sem conflito no S2 pode mapear a forma plural para um termo canônico.
  Uma terminação `-os/-as` ou concordância entre palavras não prova por si só
  que o texto não é uma marca; equivalência de termos conhecidos é coberta
  por fixtures de léxico governado e controles sem léxico.
- **S3 por campo:** a saída residual estrita pode propor marca, variante,
  preparo e qualificadores com papel semântico, criando evidência individual
  `ai_estimate` não verificada para cada atributo. As propostas não alteram
  identidade selecionada nem invertem qualificador explícito. S3 permanece
  inativo por padrão até a política calibrada de #1306.

## Remediação AUD1304 A-004–A-007

- S2 preserva as polaridades explícitas de lactose, glúten, sal, gordura e cafeína,
  além do açúcar: alias que altera atributo material gera hipótese.
- S3 confronta o nome sugerido e os qualificadores estruturados com a superfície
  observada; uma contradição degrada explicitamente a interpretação residual.
- S1 preserva plurais sem evidência governada independentemente da caixa;
  S2 pode harmonizar formas equivalentes quando o alias é válido. Proteção
  de identidade não depende da terminação de uma marca específica.
- Enquadramento de refeição, inclusive destino ao fim sem verbo inicial, não
  integra o nome alimentar. O parser canônico continua único dono de MealOperation.

## Remediação AUD1304 A-008–A-009

- Enquadramento inicial `No almoço 2 ovos`, mesmo sem verbo, deixa somente `2 ovos` na superfície alimentar quando há quantidade e alimento verificáveis. O contexto original e offsets UTF-16 permanecem intactos; sem frase alimentar reconhecível, não se descarta texto.
- A proteção inicial de `-itos/-itas` foi generalizada em A-020: qualquer
  plural sem evidência governada pode ser uma identidade comercial. S1 preserva
  a grafia normalizada independentemente da caixa; S2 decide apenas quando
  existe correspondência autorizada e não ambígua.

## Remediação AUD1304-NEW-001–003

- Numerais físicos com unidade contígua (`100g`, `250ml`) convergem com a grafia espaçada, sem consumir prefixos de marcas nem números com separadores ambíguos; a superfície e os spans originais permanecem intactos.
- A conjunção `e` separa itens alimentares completos mesmo quando o segundo não tem numeral. Construtos de quantidade como `uma fatia e meia` e `um e meio` não são divididos.
- Léxico governado `unit_term` / `portion_term` atua no slot da unidade e não no nome do alimento: só termo ativo, escopo autorizado e unidade canônica conhecida podem converter; há registro S2 por ID e evidência por campo. Conflito de significados produz alternativas sem conversão silenciosa. Grants, revogação e revisão são validados pela leitura governada existente.

## Remediação AUD1304 A-010–A-012

- **A-010 / A-020:** caixa alta, baixa e título convergem para o mesmo alias
  S2 governado; sem o alias, todas preservam o plural potencialmente comercial.
- **A-011:** `zero/sem/com` com lactose, açúcar, glúten, sal, gordura e
  cafeína recebe papel do atributo composto; `zero` isolado permanece
  qualificador de adoçamento e `UHT` é classificado como processamento.
- **A-012:** qualificadores extraídos do nome de hipótese S3 também são
  atributos e evidências `ai_estimate` da alternativa; valores repetidos
  em `qualifiers[]` são deduplicados, preservando bloqueio de contradições.

A entrega mantém S3 desabilitado por padrão, sem cutover, seleção nutricional
ou novo parser de operação.

## Remediação AUD1304 A-013–A-016

- **A-013 — conjunção de qualificadores:** `e sem/com/zero <atributo>` e atributos de preparo já reconhecidos não geram observação alimentar adicional. Uma conjunção com segundo alimento independente continua separando itens; offsets UTF-16 e a evidência original são preservados.
- **A-014 — destino separado por vírgula:** `No almoço, 2 ovos` ou `2 ovos, no almoço` preserva apenas o span alimentar quando existe quantidade e nome interpretáveis. Sem alimento inequívoco, nenhuma superfície é descartada e `MealOperation` continua exclusiva do parser canônico.
- **A-015 — plural com modificador invariável:** `bananas prata` converge para
  `banana prata` quando um alias S2 governado comprova a equivalência; sem essa
  evidência, S1 mantém a forma original, inclusive marcas potencialmente plurais.
- **A-016 — fração após o alimento:** `dois ovos e meio` e `duas fatias de pão e meia` representam 2,5 unidades da mesma medida. `2 ovos e meio copo de leite` permanece uma lista de dois alimentos, sem inferir densidade ou macros.

Os quatro controles foram acrescentados à suíte linguística existente com casos positivos, negativos, rastreabilidade e proteção comercial; não há cutover de produção nem alteração de política S3 ou thresholds.

## Remediação AUD1304 A-017–A-018

- **A-017 — fração e lista:** `duas fatias de pão e meia e uma banana` separa
  duas observações (2,5 fatias de pão e 1 banana); a conjunção interna da
  fração permanece no primeiro span UTF-16. `2 ovos e meio copo de leite`
  permanece dois alimentos porque `meio` qualifica a quantidade de copo.
- **A-018 — numerais e frações:** dezenas de 20 a 99, com unidade ou contagem
  implícita, combinam-se com unidades (`vinte unidades`, `vinte e duas fatias`)
  sem dividir o numeral em observações. Frações `1/2`, `¼`, `½` e `¾`
  preservam a forma original e convergem à quantidade numérica equivalente.
  Denominadores zero, frações incompatíveis com uma porção inequívoca e
  separadores de milhar ambíguos não criam quantidades silenciosamente.

## Remediação AUD1304 A-019–A-020 (23/10/2026)

- **A-019 — qualificador com vírgula:** S1 agrupa somente continuações de
  qualificadores materiais reconhecidos (`sem/com/zero açúcar, lactose, glúten,
  sal, gordura, cafeína`; preparo e atributos explícitos reconhecidos) no
  alimento imediatamente anterior. A vírgula permanece no span UTF-16 e nas
  evidências originais, mas não no nome normalizado. Um segundo alimento real,
  vírgula de lista, ponto e vírgula ou seção operacional não são consumidos;
  combinações de qualificadores não criam alimentos fantasmas.
- **A-020 — marca vs. plural:** S1 não transforma identidade desconhecida por
  sufixo ou caixa. `Cheetos`, `Fandangos`, `Havaianas`, `Doritos`, assim como
  plurais comuns ainda não governados, permanecem rastreáveis em superfície.
  S2 usa somente alias revisado/autorizado com proveniência para mapear
  equivalências (`ovos` → `ovo`, `bananas` → `banana`); entradas revogadas,
  pendentes ou conflitantes não autorizam singularização. Estes exemplos
  representam dados **apenas de teste**, não listas codificadas no runtime.
- Testes adversariais: equivalência com/sem pontuação, vírgulas em listas
  válidas, span Unicode, marcas desconhecidas em várias caixas, aliases
  governados, revogação e negativos. O cutover segue proibido até fases futuras.

## Gates

~~~bash
pnpm check
pnpm exec vitest run server/modules/foodIntelligenceV2/linguisticComprehension.test.ts server/modules/foodIntelligenceV2/foodArchitectureSemanticBoundaries.test.ts
pnpm architecture:check
~~~

Os testes devem distinguir casos positivos de controles negativos (marca explícita, açúcar, typo, plural sem evidência, reuso de revisão revogada, ingredientes OCR, owner cruzado, falha de banco e S3 sem política). O gate arquitetural admite gramática somente no owner canônico e continua barrando catálogo fixo de macros ou normalizador concorrente.

Permanecem fora desta entrega o cutover, a calibração #1306, homologação no entrypoint público, rollout e parecer independente do último SHA. CI verde não dispensa auditoria e não autoriza merge.

## Remediação AUD1304 A-021–A-022

- **A-021 — quantidade vaga / unidade não governada:** expressões genéricas de quantidade imprecisa ou porções sem unidade S1 reconhecida (por exemplo, `um pouco`, `uma pitada`, `2 canecas`) não são convertidas em `un`. A camada conserva o texto original, o span UTF-16, `servingText` e quantidade/unidade nulas para não inventar precisão. Unidades canônicas de S1, contagens inequívocas e aliases S2 autorizados permanecem válidos.
- **A-022 — intervalos / alternativas:** `2 ou 3 ovos`, `2 a 3 ovos`, `2-3 ovos` e `entre 2 e 3 ovos` permanecem uma observação incerta com a expressão quantitativa preservada, sem escolher o primeiro limite. O parser distingue composição numérica (`vinte e dois`) de intervalo e mantém listas de alimentos distintos separadas. Sem política de clarificação nem cutover nesta etapa C1.

## Remediação AUD1304 A-023–A-025 (24/10/2026)

- **A-023 — concordância de unidade:** a gramática reconhece `colher` e `colheres`
  como a mesma unidade S1, inclusive `uma colher e meia`. A quantidade não
  depende de correção lexical do alimento, sem assumir massa ou volume.
- **A-024 — limites contíguos:** intervalos com unidade física adjacente ao
  último número (`30 a 40g`, `30-40g`, `entre 30 e 40g`) permanecem
  explicitamente incertos; um intervalo não autoriza selecionar seu limite
  inferior ou registrar evidência de quantidade pontual. Separações por lista
  e unidades exatas (`40g`) continuam distintas.
- **A-025 — recipientes não governados:** `prato`, `marmita`, `pote`, `garrafa`
  e demais termos genéricos de recipiente/porção sem mapeamento S1 ou S2
  autorizado preservam a superfície e quantidade/unidade nulas, em vez de
  inventar contagem `un` do alimento. Contagens inequívocas de alimentos
  (`1 ovo de codorna`) e aliases S2 aprovados são preservados.

Os três controles ampliam a suíte linguística existente com positivos,
negativos, equivalência/metamorfismo, evidências e spans originais. Sem cutover,
sem thresholds arbitrários e sem mudanças na política de nutrição.

## Remediação AUD1304 A-026–A-027 (24/10/2026)

- **A-026 — proteção de conjunções:** a divisão por `e` considera termos `protected_token` do snapshot S2 autorizado antes de segmentar, inclusive grafia Unicode e caixa divergente. A proteção é por palavras inteiras e escopo/revisão válidos, não por substring; conjunções externas ainda separam alimentos independentes. Sem léxico, ou com token revogado/pendente/de outro usuário, a gramática não presume uma marca. Os spans continuam referindo-se à entrada original.
- **A-027 — unicidade de evidências residuais:** os IDs S3 incluem índice da observação, índice da hipótese e índice do campo. IDs de hipóteses S3 também distinguem observações. Referências `evidenceIds` continuam resolvendo exatamente uma evidência por observação e não se repetem no envelope. Nenhuma hipótese altera a identidade selecionada, nem promove `verified` ou nutrição.

Controles Vitest acrescentados à suíte linguística existente; sem ativação de S3, thresholds, novo parser operacional ou cutover produtivo.

## Remediação AUD1304 A-029–A-030 (25/10/2026)

- **A-029 — unidades com preposição e medida composta:** "3/4 de xícara de leite"
  preserva o alimento `leite` e a medida `xícara`, convergindo com
  "3/4 xícara de leite". Medidas "colher de sopa/chá/sobremesa/café
  de <alimento>" conservam o subtipo como unidade distinta e a evidência bruta,
  sem inventar gramas ou mililitros. Recipientes não governados, inclusive
  com preposição ("3/4 de caneca"), seguem incertos, sem valor/unit exatos.
  "1 colher de sopa" continua sendo
  uma colher do alimento sopa, sem criar outro alimento.
- **A-030 — isolamento S2 por papel:** `unit_term` e `portion_term` participam
  somente do slot de unidade; não substituem `identityHints.foodName`
  mesmo que sua superfície coincida literalmente com um nome de alimento.
  Aliases alimentares aprovados e precedência pessoal permanecem válidos.
- Controles positivos, negativos e metamórficos foram adicionados à suíte
  linguística existente, com verificação de spans UTF-16. Sem cutover, escolha
  de nutrientes, mudança de thresholds S3 ou novo parser operacional.
