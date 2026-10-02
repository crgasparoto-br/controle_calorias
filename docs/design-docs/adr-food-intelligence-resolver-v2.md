# ADR — Food Intelligence Resolver V2

- **Status:** PROPOSED / EM EVOLUÇÃO
- **Data inicial:** 2026-10-02
- **Branch de discussão:** `docs/food-intelligence-v2-adr`
- **Base:** `develop`
- **Escopo:** reconhecimento, resolução e governança de alimentos em entradas textuais, áudio/transcrição, imagem/OCR, rótulo nutricional e fluxos multimodais
- **Implementação:** este ADR descreve a arquitetura alvo; sua existência **não significa que o código atual já esteja aderente**
- **Evolução:** decisões ainda abertas ficam explicitamente marcadas como `OPEN`; mudanças materiais devem atualizar este ADR antes ou junto da implementação

## 1. Contexto

Nas últimas semanas o sistema acumulou correções para casos específicos de reconhecimento de alimentos, quantidade, marca, variante, imagem, rótulo nutricional, memória e fallback.

Embora existam contratos e componentes reutilizáveis, o comportamento ainda pode divergir entre texto, áudio, imagem, adição a refeição existente, continuação de rótulo e outros entrypoints. Partes diferentes do sistema ainda podem interpretar novamente identidade, quantidade, marca, variante ou nutrição, o que permite que uma decisão estruturada seja degradada por uma etapa posterior.

O problema arquitetural que este ADR pretende resolver é:

> diferentes canais estão funcionando como inteligências parciais, quando deveriam apenas coletar evidências para uma única inteligência de domínio responsável pela decisão alimentar.

O objetivo não é tornar uma LLM a fonte de verdade. O objetivo é construir um resolvedor central que combine evidências, banco de conhecimento, memória, rótulos, fontes externas e regras de confiança de forma auditável.

## 2. Decisão principal

Adotar uma arquitetura de **Food Intelligence Resolver V2** com um único owner de domínio para resolver:

1. identidade do alimento;
2. marca e variante;
3. preparação e qualificadores nutricionais;
4. quantidade e unidade;
5. gramatura/volume efetivo;
6. perfil nutricional;
7. proveniência e evidência;
8. confiança e campos ainda não resolvidos;
9. necessidade de clarificação;
10. aprendizado pessoal;
11. candidatura a conhecimento global.

Texto, transcrição, áudio, imagem, OCR, código de barras, rótulo nutricional e outros canais devem produzir **evidências estruturadas**. Eles não devem possuir resolvedores nutricionais independentes.

## 3. Arquitetura alvo

```text
Texto -------------------┐
Áudio / transcrição -----|
Imagem / visão ----------|--> adapters de evidência
OCR / rótulo ------------|
Código de barras --------┘
                              |
                              v
                       FoodObservation[]
                              |
                              v
                  FOOD INTELLIGENCE RESOLVER
                    1. normalização
                    2. geração de candidatos
                    3. ranking/compatibilidade
                    4. quantidade
                    5. seleção nutricional
                    6. política de incerteza
                    7. proveniência
                              |
                              v
                   FoodResolutionDecision
                              |
             +----------------+----------------+
             |                |                |
             v                v                v
          registrar      perguntar só      revisão/
                         o que falta        governança
```

A IA pode participar da extração de evidências, geração de candidatos, normalização e interpretação semântica, mas **não é a autoridade final isolada**.

## 4. Contrato pré-resolução

A arquitetura alvo deve introduzir um contrato equivalente a `FoodObservation` **antes** da decisão nutricional.

Exemplo conceitual:

```ts
type FoodObservation = {
  observationId: string;
  modality: "text" | "audio" | "image" | "multimodal";
  rawInput: string | null;
  normalizedInput: string | null;

  identityHints: {
    foodName: string | null;
    brand: string | null;
    variant: string | null;
    preparation: string[];
    qualifiers: Array<{
      value: string;
      role:
        | "preparation"
        | "cultivar"
        | "line"
        | "flavor"
        | "packaging"
        | "other";
      confidence: number;
    }>;
    barcode: string | null;
  };

  quantityHints: {
    value: number | null;
    unit: string | null;
    servingText: string | null;
    visiblePackageQuantity: number | null;
  };

  evidence: Array<{
    field: string;
    origin:
      | "text"
      | "transcription"
      | "ocr"
      | "vision"
      | "nutrition_label"
      | "barcode";
    value: unknown;
    confidence: number;
    regionOrSpan?: unknown;
  }>;
};
```

O contrato deve representar **o que foi observado**, não uma decisão final já tomada.
Além do valor textual, qualificadores relevantes devem carregar **papel semântico explícito** quando a evidência permitir. Termos como `frito`, `integral`, `Packans`, `zero`, `UHT`, cultivar, linha, sabor ou embalagem não devem ser reinterpretados downstream por listas léxicas ad hoc para decidir se são marca, preparo, variante ou ruído.

O contrato final pode alterar nomes/campos, mas deve preservar a separação entre superfície observada e papel semântico inferido, com confiança/evidência por campo.

### 4.1. Camada de Compreensão Linguística

A entrada do sistema é linguagem humana: texto digitado, transcrição de áudio, OCR de rótulo, legenda de imagem. A mesma intenção alimentar chega em formas muito diferentes — acento ausente, abreviação, gíria, regionalismo, erro de digitação, erro de transcrição, ordem variável, plural/singular, vírgula ou ponto decimal, numerais escritos, apelido pessoal.

Este ADR decide que canais produzem **evidências** e que existe **um único resolvedor**. Falta explicitar a camada que transforma linguagem em observação. Sem ela, a normalização linguística volta a ser uma inteligência parcial de canal — e o padrão que este ADR pretende eliminar reaparece dentro dela.

Evidência histórica dessa classe: `#120`, `#168`, `#311`, `#332`, `#427`, `#522`, `#717`, `#719`, `#720`, `#742`, `#769`, `#1224`, `#1287`.

#### 4.1.1. Responsabilidade e não-responsabilidade

A Camada de Compreensão Linguística (LCL):

- **produz** `FoodObservation[]` rastreáveis a partir de texto, transcrição, OCR, legendas e código de barras;
- **preserva** a superfície original como âncora de evidência;
- **atribui** papel semântico a qualificadores (preparo, cultivar, linha, sabor, embalagem, açúcar, gordura, lactose, processamento);
- **marca** ambiguidade, termos incertos e necessidade de clarificação como **estado**, não como pergunta.

A LCL **não**:

- escolhe alimento, marca, variante ou perfil nutricional;
- escolhe fonte nutricional ou calcula macros;
- calcula gramatura final;
- persiste refeição;
- cria conhecimento global;
- pergunta ao usuário.

A decisão de interação pertence à política de incerteza (§10). A LCL apenas declara **o que não ficou resolvido e por quê**.

#### 4.1.2. Princípio anti-lossy (proibição de round-trip)

A LCL não pode ter como contrato de saída apenas um texto normalizado que será reinferido downstream. O contrato é **observação estruturada com spans**; o texto normalizado, quando existir, é derivado e observável, nunca a entrada de uma nova inferência.

```text
PROIBIDO
entrada -> normalizedText -> nova inferência de identidade/quantidade

OBRIGATÓRIO
entrada (preservada) -> FoodObservation[] com spans e papel semântico -> resolvedor
```

Esta regra é a aplicação direta da invariante de monotonicidade (§6) à camada de linguagem.

#### 4.1.3. Estágios

```text
S1 — normalização determinística
S2 — léxico governado (dado)
S3 — interpretação semântica residual (IA)
```

**S1 — determinístico.** Normalização Unicode/acentuação/caixa; segmentação de itens e conectores; plural/singular; vírgula e ponto decimal; numerais escritos (`meia`, `um e meio`, `duas`); abreviações de unidade conhecidas; identificação de fragmentos de comando/operação; proteção de tokens protegidos (marca, cultivar, termo de linha).

**S2 — léxico governado.** Substituições rastreáveis de gíria, abreviação, regionalismo, apelido e erro recorrente, aplicadas conforme escopo, confiança e validade (§4.1.4). Cada substituição é registrada com origem e span.

**S3 — interpretação semântica residual.** Recebe somente o que S1 e S2 não resolveram com segurança e devolve observações com qualificadores e papel semântico, **alternativas ranqueadas** e evidência por campo. A IA não é autoridade final (§3) e não inventa identidade.

Um item que S1/S2 resolvem com segurança **não deve** consumir chamada de IA. Isso é requisito de custo (§19.3) e de reprodutibilidade.

#### 4.1.4. Regras obrigatórias

1. **Preservação da superfície.** `rawInput` é imutável e permanece como evidência do turno; spans referenciam o original.
2. **Integridade semântica.** Nenhum estágio pode remover, inverter ou inventar qualificador nutricional (`zero`, `light`, `diet`, `sem açúcar`, `integral`, `desnatado`, `frito`, `cozido`). Reescrita de superfície não altera semântica nutricional.
3. **Papel semântico explícito.** Qualificador relevante carrega seu papel; termos como `frito`, `integral`, `Packans`, `zero`, `UHT`, cultivar, linha, sabor ou embalagem não podem ser reclassificados downstream por listas léxicas ad hoc (`#1224`, `#1194`).
4. **Ambiguidade é dado.** Havendo mais de uma interpretação plausível, a LCL devolve alternativas com confiança — nunca escolhe.
5. **Correção silenciosa proibida.** Erro de digitação ou de transcrição que altere identidade (`banco` → `branco`/`Panco`, `pêra`/`pera` em contexto de marca) pode ser **sugerido**, nunca aplicado silenciosamente (`#1051`).
6. **Numerais e unidades.** Expressão numérica escrita, decimal com vírgula ou ponto e abreviação de unidade convergem para a mesma observação de quantidade; a unidade física e sua proveniência permanecem explícitas (`#684`, `#1037`, `#1273`).
7. **Termos incertos de porção.** `tiquinho`, `punhado`, `pratão`, `prato grande`, `bastante` são mantidos rastreáveis e **não** são convertidos em quantidade exata; podem exigir clarificação de quantidade.
8. **Locale.** Toda entrada de léxico e toda regra linguística possui `locale`. Suporte a mais de um idioma e a política de fallback de locale permanecem `OPEN` (§25).
9. **Determinismo e reprodutibilidade.** S1 é determinístico; S2 é determinístico dado o conjunto de entradas ativas; S3 é versionado. A LCL é reproduzível a partir de `(entrada, revisão do léxico, versão do interpretador)`.
10. **Ausência de owner concorrente.** Nenhum handler, adapter ou módulo de canal pode manter normalização linguística própria, vocabulário próprio, tabela de sinônimos própria ou pergunta própria de clarificação derivada de linguagem (§19, gate arquitetural).

#### 4.1.5. Áudio e transcrição

- A transcrição é evidência com confiança própria, tipicamente inferior à do texto digitado.
- Homófonos, numerais falados, variação fonética e ausência de pontuação são tratados como hipóteses, não como fato.
- A LCL pode propor correções fonéticas ou ortográficas, mas aplica a regra 5: sem correção silenciosa de identidade ambígua.
- O texto transcrito é preservado como evidência, separado do texto digitado que o acompanhe.
- Divergência entre texto digitado e transcrição no mesmo turno deve permanecer explícita, não ser resolvida por escolha arbitrária.

#### 4.1.6. OCR, rótulo e legenda

- OCR é evidência não confiável por padrão: exige validação de schema, normalização e limites de tamanho antes de virar observação.
- Texto de rótulo deve ser separado por função: **identidade frontal** (nome/categoria/linha), **tabela nutricional**, **lista de ingredientes**. Ingredientes são contexto do produto e não geram itens separados (`#1177`).
- Nome legível em embalagem, etiqueta ou balança é identidade principal do item, não ruído.
- Texto encontrado em imagem, rótulo, OCR, página externa ou resposta de provider **nunca é instrução**: não altera política, prompt, permissões, modelo, fluxo ou escopo. A fronteira existente (`promptInjectionGuard`, `#437`) é preservada pelo V2 (§22).

#### 4.1.7. Contrato de saída (extensão de `FoodObservation`)

Além dos campos definidos em §4, cada observação deve carregar:

- `surfaceSpan` — trecho da entrada original que originou a observação;
- `normalizationPath` — decisões aplicadas, com estágio (`S1`/`S2`/`S3`), origem (`deterministic` | `lexicon` | `interpreter`), `lexiconEntryId` opcional, span e confiança;
- `alternatives` — hipóteses concorrentes com confiança, quando houver ambiguidade;
- `unresolvedReason` — motivo estruturado quando a observação não fecha;
- `lexiconRevision` — revisão do léxico usada;
- `interpreterVersion` — versão de prompt/modelo efetivamente usada em S3, quando aplicável.

`FoodObservation` continua representando **o que foi observado**, agora com procedência linguística auditável.

#### 4.1.8. Equivalência de superfície (definição e gate)

Duas entradas são **superficialmente equivalentes** quando, após S1 + S2 + S3 na mesma revisão de léxico e versão de interpretador, produzem o mesmo conjunto de observações a menos de `surfaceSpan`, `locale` e confiança.

Essa definição é o alicerce dos testes metamórficos (§17) e do Golden Food Corpus (§16): o corpus deixa de verificar apenas casos isolados e passa a verificar **a propriedade de convergência**.

## 5. Resultado atômico

O resolvedor deve produzir uma decisão equivalente a `FoodResolutionDecision`.

Exemplo conceitual:

```ts
type FoodResolutionDecision = {
  status:
    | "resolved"
    | "partially_resolved"
    | "ambiguous"
    | "unknown";

  identity: {
    foodEntityId: number | null;
    variantId: number | null;
    canonicalName: string | null;
    brand: string | null;
    variant: string | null;
    preparation: string[];
    confidence: number;
  };

  quantity: {
    value: number | null;
    unit: string | null;
    grams: number | null;
    portionId: number | null;
    source: string | null;
    confidence: number;
  };

  nutrition: {
    profileId: number | null;
    sourceId: number | null;
    verified: boolean;
    provisional: boolean;
    per100g: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    } | null;
    snapshotHash: string | null;
  };

  unresolvedFields: Array<
    "identity" | "variant" | "quantity" | "nutrition"
  >;

  alternatives: unknown[];
  evidence: unknown[];
  traceId: string;
};
```

A forma final exata dos tipos permanece `OPEN`, mas as propriedades arquiteturais acima são obrigatórias.

## 6. Invariante de monotonicidade

Uma informação estruturada e aceita não pode ser reaberta ou degradada por uma etapa posterior sem nova evidência conflitante.

Consequências obrigatórias:

- uma quantidade resolvida não pode ser transformada em texto para outro pipeline tentar inferi-la novamente;
- uma marca/variante confirmada não pode ser descartada por normalização posterior;
- um código de barras exato não pode perder precedência para fuzzy matching;
- macros provenientes de rótulo comprovado não podem ser substituídos silenciosamente por fallback;
- uma correção explícita do usuário não pode ser anulada por memória antiga;
- itens resolvidos em uma entrada multi-item não podem ser descartados porque outro item permanece ambíguo.

## 7. Separação entre operação da refeição e alimento

O sistema deve separar:

```ts
MealOperation {
  action;
  targetMeal;
  date;
}
```

de:

```ts
FoodObservation[]
```

Destino da refeição, data, comando e intenção operacional não devem ser tratados como identidade alimentar.

Exemplos semanticamente equivalentes do ponto de vista do alimento:

- `Adicionar ao café da manhã 1,5 fatias de mortadela`;
- `Adicionar 1,5 fatias de mortadela ao café da manhã`;
- `No café da manhã comi uma fatia e meia de mortadela`.

O parser de operação pode produzir resultados diferentes de posição/comando, mas a observação alimentar deve convergir.

### 7.1. Operação da refeição também possui owner único

A separação de §7 não basta para preservar decisões de produto: destino da refeição, data explícita, comando e intenção operacional também precisam de um owner único, pela mesma razão que identidade e quantidade.

Evidência histórica desta classe: `#421`, `#512`, `#541`, `#721`, `#856`, `#899`, `#1006`, `#1271`, `#1278`, `#1291` — a mesma adição falha por posição do destino, por data, por refeição configurada ou por caminho de produção diferente, sem que o alimento esteja errado.

Regras:

- o parser de operação é o único autor de `MealOperation`;
- nenhum handler de canal reconstitui data, destino ou comando por conta própria;
- posição do destino na frase não altera a operação;
- data explícita sempre prevalece sobre padrão temporal;
- refeição configurada do usuário é conhecimento operacional, não identidade alimentar;
- a operação resolvida é monotônica: uma etapa posterior não a reescreve;
- a operação entra no corpus e nos gates com o mesmo peso que a resolução alimentar.

### 7.2. Persistência em lote

Um turno pode conter vários itens alimentares com qualidade de evidência diferente. A política é:

- **item resolvido é registrado**; item inconsistente é excluído **apenas ele**, com motivo estruturado e explicação ao usuário;
- a operação só é considerada concluída com relatório explícito de itens registrados e não registrados;
- um item ambíguo **nunca** invalida itens resolvidos do mesmo turno (`#1177`, `#1287`);
- o usuário não deve receber erro genérico quando parte do lote é válida (`#1282`);
- cada exclusão deve referenciar o `unresolvedReason` da observação que a originou;
- nenhum item do lote pode ser registrado sem procedência nutricional declarada (§9.2).

## 8. Banco de conhecimento único

A direção arquitetural é possuir **uma única base governada de conhecimento alimentar**.

Ela deve representar, sem exigir alteração de código por alimento:

- entidades alimentares canônicas;
- variantes comerciais;
- marcas e linhas;
- aliases globais;
- aliases pessoais;
- porções;
- gramaturas;
- códigos de barras;
- perfis nutricionais;
- fontes;
- validade/versionamento;
- evidências;
- correções;
- eventos de resolução;
- sessões de continuidade;
- estado de revisão/governança.

### 8.1. Regra obrigatória

Cadastrar um novo alimento, alias, porção, marca, variante ou rótulo **não deve exigir mudança em arrays/constantes TypeScript ou novo deploy de aplicação**.

Cadastrar um novo significado linguístico (gíria, abreviação, regionalismo, erro recorrente, apelido pessoal) ou ajustar uma regra de interpretação segue a mesma regra: é dado governado, não código de canal.

Exceções emergenciais podem existir apenas como mitigação temporária explicitamente rastreada e com plano de migração para dados governados.

### 8.2. Decisão: remodelar o domínio alimentar agora

Como a base de usuários ainda é pequena e a duplicidade estrutural já está visível, a direção escolhida é **refatorar o modelo alimentar antes de consolidar o Food Intelligence V2**, em vez de prolongar a coexistência entre `foods` e `foodCatalog`.

A migração deve preservar dados e histórico, mas pode alterar schema, FKs e ownership quando isso simplificar o domínio.

Princípios:

- não criar um terceiro catálogo;
- usar a base relacional atual como ponto de partida, mas sem obrigação de preservar o desenho físico atual;
- retirar de `foods` a responsabilidade de armazenar simultaneamente identidade e valores nutricionais mutáveis;
- extinguir `foodCatalog` e `portions` como fontes paralelas após a migração;
- migrar conhecimento WhatsApp genérico/pessoal para estruturas de domínio explícitas quando ele representar alimento, alias, porção, evidência ou revisão;
- manter snapshots históricos de refeições imutáveis;
- preferir uma migração estrutural agora a bridges permanentes difíceis de remover depois.

### 8.3. Modelo lógico alvo

A separação de responsabilidades abaixo passa a ser decisão arquitetural. O modelo físico base foi fechado na seção 8.7; ajustes futuros podem alterar detalhes de implementação sem reintroduzir fontes paralelas ou misturar identidade, nutrição e memória pessoal.

#### `foods` — identidade alimentar canônica

Representa a família conceitual do alimento.

Exemplos:

- pão de forma;
- amendoim;
- leite;
- ovo;
- refrigerante.

Não deve ser fonte de macros diretamente.

Campos conceituais mínimos:

- identidade canônica;
- nome/normalização;
- categoria;
- escopo `global | user`;
- `ownerUserId` quando privado;
- estado estrutural `active | deprecated | merged`;
- relação de merge quando aplicável.

#### `food_variants` — identidade efetivamente resolvível

Representa a forma concreta que o resolver pode escolher.

Exemplos:

- pão de forma genérico integral;
- Panco Premium 100% Integral;
- amendoim torrado sem sal;
- leite Itambé Integral UHT;
- ovo frito.

Toda resolução final de identidade deve apontar para uma variante. Alimentos genéricos também possuem variante genérica explícita; isso evita regras especiais entre alimento “comum” e produto comercial.

Responsabilidades:

- marca;
- linha/produto;
- variante;
- preparo;
- qualificadores como `zero`, `light`, `integral`, `sem açúcar`;
- chave canônica de identidade;
- estado de publicação;
- vínculo com `foods`.

#### `food_nutrition_profiles` — nutrição versionada

Os valores nutricionais deixam de morar na identidade.

Cada perfil deve ser versionável e guardar:

- `foodVariantId`;
- fonte;
- base nutricional;
- valores por 100 g/ml;
- valores por porção quando fornecidos pela fonte;
- unidade/base original;
- validade;
- versão;
- status `provisional | pending_review | verified | rejected | revoked`;
- hash/snapshot do conteúdo normalizado;
- timestamps de coleta/verificação.

Uma correção de nutrição publicada deve criar nova versão ou novo perfil; não reescrever silenciosamente a evidência histórica.

#### `food_aliases` — aliases globais

Alias global aponta para a identidade/variante governada e possui:

- texto original;
- texto normalizado;
- origem;
- confiança/estado;
- validade;
- evidência.

Aliases pessoais não devem compartilhar o mesmo escopo lógico.

#### `user_food_aliases` — aprendizado pessoal

Mapeia expressão pessoal para uma variante canônica.

Exemplos:

- `meu pão` -> variante Panco específica;
- `café` -> café sem açúcar para aquele usuário, quando isso tiver sido explicitamente confirmado.

Deve registrar origem, data, confiança e revogação.

Entrada explícita incompatível no turno atual sempre vence esse aprendizado.

#### `food_lexicon_entries` — conhecimento linguístico global

Representa como uma superfície chega ao sistema: gíria, abreviação, regionalismo, erro recorrente, termo de porção, termo de unidade e token protegido.

Campos conceituais mínimos:

- termo e termo normalizado;
- `kind` (`slang | abbreviation | regionalism | typo | alias_surface | portion_term | unit_term | protected_token`);
- alvo (`canonical_term | food_variant | none`) e referência opcional;
- `locale`;
- escopo `global | user`;
- origem, evidência e confiança;
- marcação de termo que exige clarificação de quantidade;
- estado de governança e validade.

Léxico e alias alimentar têm responsabilidades distintas: o alias aponta para uma variante resolvida; o léxico descreve a superfície de entrada. Não devem ser fundidos em uma única tabela.

#### `user_food_lexicon_entries` — vocabulário pessoal

Equivalente pessoal do léxico, sempre com `user_id`, origem da confirmação, confiança, validade e revogação. É isolado por usuário e nunca eleva a confiança do conhecimento global.

#### `food_attributes` — vocabulário de atributos

Vocabulário controlado dos **tipos** de atributo que podem qualificar uma variante ou uma observação. Não guarda valores e não decide materialidade.

Tipos iniciais previstos: `preparation`, `fat_level`, `sweetening`, `cultivar`, `line`, `flavor`, `processing`, `packaging`, `portion_form`, `fortification`.

Campos conceituais mínimos: `code` estável, rótulo, natureza do valor (`enumerated | free_text`) e estado. Cadastrar um novo tipo de atributo é dado, não código (§8.1).

#### `food_variant_attributes` — valores de atributo por variante

Resolve a lacuna de `qualifiers_json`: qualificador relevante para busca, ranking ou identidade precisa ser **indexado**, não apenas guardado em JSON (§8.10).

Campos conceituais mínimos: `food_variant_id`, `attribute_id`, `value`, `normalized_value`, origem/evidência opcionais, confiança e estado. `qualifiers_json` permanece restrito a cauda longa e a qualificadores não indexados.

#### `food_attribute_materiality` — materialidade por família

Responde a pergunta que hoje é resolvida por lista lexical em código: **para esta família, este atributo muda a resposta?**

```text
materiality = identity | nutrition | both | informational
```

A materialidade **não é opinião curada; é derivada**:

- **identidade é derivada por construção** — se a ontologia possui variantes da mesma família que diferem por um atributo, esse atributo é material para identidade naquela família, por definição; se nenhum par de variantes difere apenas por ele, é informacional;
- **nutrição é medida** — comparar os perfis por 100 g das variantes da família que diferem apenas por esse atributo; delta acima da tolerância implica materialidade nutricional, dentro da tolerância implica informacional.

A derivação é reproduzível, versionada e auditável. A tolerância numérica permanece `OPEN` para calibração por corpus (§25).

Campos mínimos: `food_id`, `attribute_id`, `materiality`, `derivation` (`from_variants | from_profile_divergence | override`), referência de evidência opcional, `confidence`, `status = provisional | pending_review | verified | rejected | revoked`, `supersedes_id` opcional e timestamps.

#### `food_attribute_materiality_overrides` — curadoria explícita

Único lugar onde existe julgamento humano sobre materialidade, e ele fica auditável: `food_id`, `attribute_id`, `materiality`, `justification`, `evidence_id` opcional, autor, estado e timestamps.

#### Regra de composição da `identity_key`

A `identity_key` da variante é composta **apenas** por atributos com `materiality = identity | both` na família correspondente, mais a identidade da família e a marca/linha quando elas forem materiais naquela família.

Consequências:

- uma superfície nova não cria variante por acidente: ela mapeia para variante existente ou vira candidato/review case;
- a chave deixa de ser um palpite lexical e passa a ser consequência da política governada;
- a explosão de variantes por sinônimo, embalagem ou descritor irrelevante é estruturalmente impedida.

#### Assimetria do estado provisório

Materialidade `provisional` pode declarar um atributo como **material**, nunca como **imaterial**.

- declarar material sem revisão, no pior caso, produz uma pergunta a mais;
- declarar imaterial sem revisão, no pior caso, produz macro errado ao usar perfil do valor default como se fosse o valor observado (`#1088`, `#1158`).

Enquanto não houver estado `verified` para a conclusão de imaterialidade, o atributo é tratado como potencialmente material (fail-closed).

#### `food_portions` — medidas e gramaturas

Porção é conhecimento associado à variante, não ao handler.

Deve representar:

- unidade;
- quantidade;
- gramatura/volume;
- natureza `exact | usual_average | contextual_estimate`;
- fonte/evidência;
- validade;
- status de governança.

#### `food_barcodes` — identidade comercial exata

Código de barras deve ser entidade própria e apontar para `food_variants`.

Isso permite:

- unicidade;
- histórico/reatribuição controlada;
- mais de um código para uma mesma variante/embalagem quando necessário;
- auditoria sem poluir a tabela de identidade.

#### `food_evidence` — evidências normalizadas

Representa evidência usada para criar, corrigir ou verificar conhecimento.

Tipos possíveis:

- rótulo nutricional/OCR;
- código de barras;
- site do fabricante;
- fonte oficial;
- fonte externa verificável;
- correção explícita do usuário;
- imagem/visão quando aplicável.

A evidência deve guardar somente o necessário para auditoria e respeitar as regras de retenção/LGPD. Imagem bruta não deve ser copiada indiscriminadamente para essa tabela.

#### `food_review_cases` e `food_review_events` — governança global

`food_review_cases` agrega ocorrências equivalentes numa única pendência de conhecimento.

Deve permitir target de revisão como:

- nova variante;
- novo alias global;
- novo perfil nutricional;
- nova porção;
- conflito/correção de conhecimento existente.

`food_review_events` mantém histórico append-only de:

- abertura;
- aprovação;
- correção + aprovação;
- rejeição;
- revogação;
- reabertura.

O review case não é o conhecimento em si; ele governa a publicação do conhecimento nas tabelas canônicas.

#### `food_resolution_events` — rastreabilidade do resolvedor

Registra de forma sanitizada e com política de retenção:

- `traceId`;
- entrypoint/modalidade;
- candidatos relevantes;
- decisão;
- fonte/perfil escolhido;
- campos não resolvidos;
- necessidade de clarificação;
- razão de fallback;
- versão do resolvedor/política.

Não deve copiar mídia bruta ou texto sensível sem necessidade.

### 8.4. Persistência de refeição

`mealItems` deve apontar, quando aplicável, para:

- `foodVariantId`;
- `nutritionProfileId`;
- porção utilizada.

Além das referências, deve manter snapshot imutável da identidade e dos valores efetivamente usados no cálculo.

Correções futuras do catálogo não recalculam refeições históricas automaticamente.

### 8.5. O que será aposentado

A migração deverá retirar da rota canônica, com validação de cobertura antes da remoção:

- `foodCatalog`;
- `portions` ligado a `foodCatalog`;
- duplicidade nutricional dentro de `foods`;
- catálogos estáticos/hardcodes alimentares;
- aliases alimentares escondidos em estruturas genéricas de preferência;
- uso de `whatsappLearningArtifacts` como storage permanente de conhecimento alimentar que possua modelo de domínio próprio.

Estruturas genéricas podem permanecer para outros usos do WhatsApp que não sejam conhecimento alimentar.

- `server/modules/whatsapp/informalLanguageNormalizer.ts` e a parte linguística de `server/modules/whatsapp/inboundNormalizer.ts` (issue `#427`) — normalização de gíria, abreviação, regionalismo e erro de digitação presa ao canal WhatsApp, com substituições embutidas em código;
- regras de forma linguística embutidas em `server/mealTextParsing.ts` que não sejam gramática operacional (quantidade, unidade, comando, data);
- qualquer vocabulário, sinônimo, tabela de apelido ou pergunta de clarificação derivada de linguagem que resida em handler de canal.

#### Inventário mínimo de legado a absorver ou remover

A migração deve manter um inventário reproduzível, atualizado por busca repository-wide, dos owners e atalhos que deixam de ser fonte de decisão. O inventário inicial inclui, quando ainda existirem no código no momento da implementação:

- `server/foodCatalogReference.ts` e outros arrays estáticos de alimentos;
- `server/tacoCatalog.json` como catálogo embarcado de produção — o conteúdo válido deve migrar para fonte governada/versionada;
- `CURATED_COMMON_COUNTABLE_PORTIONS` e equivalentes de porções específicas em código;
- constantes/regra específica de café, açúcar, ovo ou qualquer alimento individual usada como autoridade produtiva;
- token sets/listas léxicas como `BROAD_COMMERCIAL_CATEGORY_TOKENS`, `NUTRITIONALLY_NEUTRAL_PACKAGING_TOKENS` e equivalentes que decidam identidade/suficiência;

- listas de materialidade em código: a decisão "este descritor altera a resposta?" passa a ser derivada em `food_attribute_materiality` (§8.3), com evidência e vigência, e não uma lista de palavras;
- matchers concorrentes que respondam à mesma pergunta de identidade sem atravessar o resolver público;
- gates de clarificação/registro por canal que reimplementem `identity`, `variant`, `quantity` ou `nutrition`;
- stores ou caches que tenham se tornado fonte concorrente de conhecimento em vez de cache de dado governado.

Um nome desta lista pode mudar ou desaparecer antes da issue de remoção. O critério não é o arquivo histórico em si: é não permanecer nenhum owner concorrente equivalente após o cutover. Fixtures e dados exclusivamente de teste podem continuar quando estiverem claramente classificados como tal.

### 8.6. Estratégia de migração

A preferência é por uma migração controlada e curta, aproveitando o volume atual reduzido.

Ordem alvo:

1. criar estruturas V2;
2. migrar `foods`, `foodCatalog`, aliases, porções, códigos e evidências;
3. gerar relatório de reconciliação com contagens e conflitos;
4. migrar referências de `mealItems` preservando snapshots;
5. rodar Golden Food Corpus e replay de dados reais sanitizados;
6. ativar leitura V2;
7. impedir novas escritas no legado;
8. observar canário;
9. remover bridges e tabelas legadas somente após comprovação;
10. manter rollback por backup/migration reversível até o corte ser aceito.

Não manter dual-write indefinido.


### 8.7. Modelo físico V2 fechado nesta revisão

A revisão do schema atual encontrou quatro duplicidades estruturais que o V2 deve eliminar:

- `foods` e `foodCatalog` respondem parcialmente à mesma pergunta de identidade/nutrição;
- `food_portions` e `portions` modelam porções em catálogos diferentes;
- `user_food_favorites` e `foodFavorites` modelam favoritos contra identidades diferentes;
- `mealItems` pode apontar simultaneamente para `foods`, `foodCatalog` e `portions`, além de manter dois conjuntos de colunas nutricionais.

Também foi confirmado que classificação de alimentos (`processingLevel`, fruta, vegetal e ultraprocessado) é usada por relatórios e não pode ser perdida durante a migração.

O modelo físico alvo passa a ser o seguinte.

#### Tabelas preservadas e reposicionadas

- `foodBrands`: permanece como cadastro de marcas. Não deve ser renomeada apenas por estética.
- `food_sources`: permanece como cadastro de origem/versionamento de fontes. A origem de identidade e a origem nutricional passam a ser referenciadas pelas tabelas V2 apropriadas.
- `foods`: permanece com o mesmo nome físico, mas passa a representar somente a família/identidade canônica.

#### `foods`

Campos obrigatórios do alvo:

- `id`;
- `scope = global | user`;
- `owner_user_id` quando `scope=user`;
- `canonical_name`;
- `normalized_name`;
- `canonical_key` estável e único;
- `category`;
- `description`;
- `status = active | deprecated | merged`;
- `merged_into_food_id`;
- timestamps.

Deixarão de pertencer a `foods` após a migração:

- `source_id` e `source_food_code`;
- marca comercial;
- calorias/macros;
- nutrientes de cauda longa.

Regra: uma família alimentar não é uma versão nutricional.

#### `food_variants`

Identidade concreta resolvível.

Campos mínimos:

- `id`;
- `food_id`;
- `brand_id` opcional;
- `variant_type = generic | branded | custom`;
- `display_name`;
- `normalized_name`;
- `variant_name` opcional;
- `preparation` opcional;
- `qualifiers_json` somente para qualificadores não indexados;
- `identity_key` determinística e única;
- `status = draft | active | deprecated | merged`;
- `merged_into_variant_id`;
- timestamps.

Cada `food` utilizável deve possuir ao menos uma variante. Alimento genérico também usa uma variante genérica explícita.

#### `food_variant_sources`

Mapeia a identidade de uma variante nas fontes externas sem acoplar a fonte à família ou ao perfil nutricional.

Campos mínimos:

- `id`;
- `food_variant_id`;
- `source_id`;
- `source_item_code` opcional;
- `source_identity_key` determinística e única;
- `source_url` opcional;
- `status = active | deprecated`;
- `first_seen_at`;
- `last_seen_at`.

Quando a fonte possuir código estável, a combinação `source_id + source_item_code` deve ser única.

#### `food_nutrition_profiles`

Única fonte persistente de valores nutricionais canônicos por variante.

Campos mínimos:

- `id`;
- `food_variant_id`;
- `source_id`;
- `food_variant_source_id` opcional;
- `profile_key`;
- `version` inteiro crescente por `profile_key`;
- `status = provisional | pending_review | verified | rejected | revoked`;
- `basis_quantity`;
- `basis_unit = g | ml | serving`;
- `calories_kcal`;
- `protein_g`;
- `carb_g`;
- `fat_g`;
- `fiber_g`, `sugar_g`, `sodium_mg` opcionais;
- `nutrients_json` apenas para nutrientes de cauda longa;
- dados de porção original da fonte quando existirem;
- `content_hash`;
- `supersedes_profile_id` opcional;
- `valid_from` e `valid_to` opcionais;
- `collected_at`, `verified_at` e timestamps.

Regras de versão:

- `profile_key + version` é único;
- perfil `verified` não é sobrescrito silenciosamente;
- correção material cria nova versão/perfil e referencia a versão substituída;
- `rejected` e `revoked` permanecem auditáveis;
- seleção do perfil aplicável considera status, vigência, fonte e política do resolvedor.

#### `food_variant_classifications`

Classificação usada por relatórios e qualidade alimentar fica separada de identidade e nutrição.

Campos mínimos:

- `id`;
- `food_variant_id`;
- `version`;
- `processing_level`;
- `is_fruit`;
- `is_vegetable`;
- `is_ultra_processed`;
- `source_id` opcional;
- `source_kind`;
- `confidence`;
- `status = provisional | pending_review | verified | rejected | revoked`;
- `supersedes_classification_id` opcional;
- timestamps.

O snapshot histórico da refeição deve preservar a classificação efetivamente usada quando ela afetar relatórios.

#### `food_aliases`

Alias global deve apontar para `food_variants`, não para uma família ambígua.

Campos mínimos:

- `id`;
- `food_variant_id`;
- `alias`;
- `normalized_alias`;
- `locale` opcional;
- `source_id` opcional;
- `confidence`;
- `status = active | deprecated | rejected`;
- timestamps.

Índice principal de busca: `normalized_alias + status`.
A unicidade deve impedir duplicação do mesmo alias normalizado para a mesma variante, sem impedir que um alias ambíguo possua candidatos diferentes.

#### `user_food_aliases`

Memória pessoal isolada.

Campos mínimos:

- `id`;
- `user_id`;
- `food_variant_id`;
- `alias`;
- `normalized_alias`;
- `source = user_confirmed | imported | system_suggested`;
- `confidence`;
- `status = active | revoked`;
- `confirmed_at`;
- `revoked_at`;
- timestamps.

Deve existir no máximo um mapeamento corrente por `user_id + normalized_alias`. A entrada explícita atual continua prevalecendo.

#### `food_portions`

Será a única tabela canônica de porções, substituindo tanto o significado atual de `food_portions` ligado a `foods` quanto `portions` ligado a `foodCatalog`.

Campos mínimos:

- `id`;
- `food_variant_id`;
- `label`;
- `normalized_label`;
- `unit`;
- `quantity`;
- `grams` opcional;
- `milliliters` opcional;
- `measure_kind = exact | usual_average | contextual_estimate`;
- `source_id` opcional;
- `evidence_id` opcional;
- `confidence`;
- `status = provisional | pending_review | verified | rejected | revoked`;
- `is_default`;
- `valid_from` e `valid_to` opcionais;
- timestamps.

Valores estimados não podem ser promovidos silenciosamente a `exact`.

#### `food_barcodes`

Campos mínimos:

- `id`;
- `food_variant_id`;
- `barcode` único;
- quantidade/unidade da embalagem quando conhecidas;
- `source_id` opcional;
- `evidence_id` opcional;
- `status = active | revoked`;
- timestamps.

Reatribuição de barcode exige evento de revisão; não deve ocorrer por fuzzy matching.

#### `food_evidence`

Evidência normalizada e sanitizada.

Campos mínimos:

- `id`;
- `subject_key` determinística;
- `food_variant_id` opcional enquanto o candidato ainda não foi publicado;
- `evidence_type = nutrition_label | ocr | barcode | manufacturer | official_source | external_source | user_correction | image`;
- `source_id` opcional;
- `source_reference`/URL opcional;
- `content_hash`;
- `payload_json` sanitizado;
- `confidence`;
- `captured_at`;
- `retention_until` opcional;
- timestamps.

Mídia bruta deve permanecer no storage apropriado com política de retenção; esta tabela guarda referência e conteúdo mínimo necessário para auditoria.

#### `food_review_cases` e `food_review_events`

`food_review_cases`:

- `case_key` única para agrupar ocorrências equivalentes;
- `case_type`;
- `status = open | approved | rejected | revoked | superseded`;
- `priority_score`;
- `occurrence_count`;
- `distinct_user_count` agregado;
- `first_seen_at`/`last_seen_at`;
- referências/candidato proposto quando já existirem;
- `proposed_payload_json` sanitizado;
- timestamps.

`food_review_events` é append-only e registra ator, ação, motivo/payload e data.

#### `food_resolution_events`

Tabela de alto volume para rastreabilidade sanitizada.

Campos mínimos:

- `id` de alta capacidade;
- `trace_id` único;
- `user_id` opcional conforme política de privacidade;
- modalidade/entrypoint;
- status da resolução;
- `food_variant_id`, `nutrition_profile_id` e `food_portion_id` opcionais;
- razão de fallback/clarificação;
- versão do resolvedor e da política;
- hash sanitizado da entrada;
- `decision_json` com o mínimo necessário;
- `created_at`;
- `expires_at` conforme retenção.

Não usar esta tabela como catálogo nem como memória pessoal.

#### `food_lexicon_entries` e `user_food_lexicon_entries`

Campos mínimos de `food_lexicon_entries`:

- `id`;
- `term` e `normalized_term`;
- `kind = slang | abbreviation | regionalism | typo | alias_surface | portion_term | unit_term | protected_token`;
- `target_type = canonical_term | food_variant | none`;
- `target_ref` opcional;
- `scope = global | user`;
- `locale`;
- `source_id` e `evidence_id` opcionais;
- `confidence`;
- `requires_clarification`;
- `status = provisional | pending_review | verified | rejected | revoked`;
- `supersedes_id` opcional;
- `valid_from` e `valid_to` opcionais;
- timestamps.

Campos mínimos de `user_food_lexicon_entries`:

- `id`;
- `user_id`;
- `term` e `normalized_term`;
- `kind`;
- `target_type` e `target_ref`;
- `locale`;
- `source = user_confirmed | imported | system_suggested`;
- `confidence`;
- `status = active | revoked`;
- `confirmed_at`, `revoked_at` e timestamps.

Invariantes: no máximo um mapeamento corrente por `scope + user_id + locale + normalized_term + kind`; busca principal por `normalized_term + status`; nenhum termo de léxico pode alterar ou suprimir qualificador nutricional (§4.1.4, regra 2).

#### `food_attributes` e `food_variant_attributes`

Campos mínimos de `food_attributes`:

- `id`;
- `code` estável e único;
- `label`;
- `value_kind = enumerated | free_text`;
- `is_indexed`;
- `status = active | deprecated | merged`;
- timestamps.

Campos mínimos de `food_variant_attributes`:

- `id`;
- `food_variant_id`;
- `attribute_id`;
- `value` e `normalized_value`;
- `source_id` e `evidence_id` opcionais;
- `confidence`;
- `status = provisional | pending_review | verified | rejected | revoked`;
- `supersedes_id` opcional;
- timestamps.

Índice principal: `food_variant_id + attribute_id + normalized_value + status`. Unicidade do valor corrente por variante e atributo.

#### `food_attribute_materiality` e `food_attribute_materiality_overrides`

Campos mínimos de `food_attribute_materiality`:

- `id`;
- `food_id`;
- `attribute_id`;
- `materiality = identity | nutrition | both | informational`;
- `derivation = from_variants | from_profile_divergence | override`;
- referência de evidência opcional;
- `confidence`;
- `status = provisional | pending_review | verified | rejected | revoked`;
- `supersedes_id` opcional;
- `valid_from` e `valid_to` opcionais;
- timestamps.

Campos mínimos de `food_attribute_materiality_overrides`:

- `id`;
- `food_id`;
- `attribute_id`;
- `materiality`;
- `justification`;
- `evidence_id` opcional;
- `author`;
- `status = active | revoked`;
- timestamps.

Invariantes: unicidade corrente por `food_id + attribute_id`; toda variação material precisa de vigência e auditoria; a materialidade efetiva é o override ativo quando existir, senão a derivação; conclusão de imaterialidade só é vinculante com `status = verified`.

### 8.8. Consolidação de favoritos e sinais

A tabela `foodFavorites` ligada a `foodCatalog` será aposentada.

`user_food_favorites` passa a ser a única tabela de favoritos e deve referenciar `food_variants`.

`user_food_usage_stats` também deve migrar de `food_id` para `food_variant_id`, porque frequência de uso de uma variante comercial ou preparo específico não deve ser colapsada na família.

### 8.9. Forma final de `mealItems`

Para itens de tipo `food`, o alvo é:

- `food_variant_id` opcional;
- `nutrition_profile_id` opcional;
- `food_portion_id` opcional;
- snapshot de nome exibido/canônico;
- `quantity`, `unit`, `portion_text`;
- `grams`;
- um único conjunto de nutrientes calculados: `calories_kcal`, `protein_g`, `carb_g`, `fat_g`, `fiber_g`, `sodium_mg`;
- `food_snapshot_json` sanitizado para identidade, versão de nutrição, classificação e proveniência efetivamente usadas;
- referência de mídia somente quando necessária.

Após backfill e cutover, devem ser removidos de `mealItems`:

- `foodId`;
- `foodCatalogId`;
- `portionId`;
- `estimatedGrams` quando `grams` já for a fonte canônica;
- o conjunto duplicado `calories/protein/carbs/fat`.

Itens `recipe` e `free_text` mantêm seus contratos próprios; a migração não deve forçá-los a apontar para variante alimentar.

Correções futuras de catálogo, nutrição ou classificação não recalculam automaticamente snapshots históricos.

### 8.10. Índices e invariantes mínimos

O schema V2 deve, no mínimo, sustentar:

- busca de `foods` por escopo, owner, nome normalizado e status;
- `food_variants.identity_key` única;

- valores de atributo indexados por `food_variant_id + attribute_id + normalized_value + status`, com valor corrente único por variante e atributo;
- materialidade corrente única por `food_id + attribute_id`, consultável por família e atributo para decidir suficiência;
- `identity_key` composta apenas por atributos com materialidade `identity | both` na família (§8.3);
- busca de variante por `food_id + status` e `brand_id + normalized_name + status`;
- `food_variant_sources.source_identity_key` única e, quando houver código, unicidade de fonte + código;
- `food_nutrition_profiles(profile_key, version)` único e índice por variante + status + vigência;
- aliases globais por `normalized_alias + status`;
- alias pessoal único corrente por usuário + alias normalizado;
- porções por variante + label normalizado + unidade + status;
- barcode único;
- fila de revisão por status + prioridade + última ocorrência;
- eventos de resolução por usuário/data, variante/data, `trace_id` e expiração.

Campos usados para busca, join, status, ranking ou integridade devem ser colunas tipadas. JSON fica restrito a cauda longa, payload de auditoria e qualificadores não indexados.

Conhecimento governado referenciado deve ser depreciado, mesclado, revogado ou versionado; hard delete não é o mecanismo normal de correção.

### 8.11. Mapeamento de migração V1 -> V2

A migração deve produzir relatório reproduzível de contagens, mapeamentos e conflitos.

Mapeamento obrigatório:

1. `foods`
   - criar/manter família em `foods`;
   - criar variante genérica correspondente;
   - mover `source_id/source_food_code` para `food_variant_sources`;
   - mover macros/nutrientes para `food_nutrition_profiles`;
   - reatribuir `food_aliases` e `food_portions` à variante.

2. `foodCatalog`
   - localizar/criar família canônica;
   - criar variante genérica ou comercial;
   - preservar `foodBrands`;
   - transformar `researchIdentityKey`, origem e URLs em `food_variant_sources`/evidência;
   - transformar macros em perfil nutricional;
   - transformar classificação em `food_variant_classifications`;
   - transformar barcode em `food_barcodes`;
   - migrar `portions` para `food_portions`.

3. Favoritos e uso
   - migrar `foodFavorites` e `user_food_favorites` para uma única `user_food_favorites` por variante, deduplicando pares equivalentes;
   - migrar `user_food_usage_stats` para variante.

4. `mealItems`
   - resolver primeiro `foodCatalogId`, depois `foodId`, para a variante/perfil correspondentes;
   - preservar o snapshot já gravado como autoridade histórica;
   - preencher as novas FKs quando o mapeamento for determinístico;
   - manter FK nula e snapshot intacto quando a origem histórica não puder ser mapeada com segurança;
   - consolidar os dois conjuntos atuais de macros em um conjunto canônico sem alterar o valor histórico efetivamente registrado.

5. `whatsappLearningArtifacts`
   - migrar somente artefatos que representem alias pessoal, candidato alimentar, rótulo/evidência ou revisão para as tabelas de domínio;
   - manter artefatos WhatsApp não alimentares na estrutura genérica;
   - impedir novas escritas alimentares nessa tabela depois do cutover.

6. hardcodes/catálogos estáticos
   - importar conhecimento válido para tabelas governadas;
   - manter apenas fixtures/test data explicitamente identificados;
   - remover arrays de produção como fonte de identidade, macro, porção ou classificação.

7. normalização linguística (`#427`)
   - importar `BUILT_IN_REPLACEMENTS` e `UNCERTAIN_PORTION_PATTERNS` como entradas de `food_lexicon_entries`, preservando origem e confiança;
   - converter `replacements[]` em `normalizationPath` da observação;
   - converter `uncertainTerms[]` em léxico com `kind = portion_term` e `requires_clarification = true`;
   - converter `candidateGlobalAliases[]` em `food_review_cases`;
   - remover `clarificationQuestion` do normalizador: perguntar é decisão da política de incerteza (§10);
   - preservar a cobertura de `informalLanguageNormalizer.test.ts` e `inboundNormalizer.test.ts` como casos do Golden Food Corpus quando representarem comportamento válido;
   - impedir nova escrita linguística dentro de módulo de canal depois do cutover.

8. materialidade de atributos (`server/foodItemResolution.ts`)
   - importar o vocabulário de tipos de atributo para `food_attributes`;
   - semear `food_attribute_materiality` pela derivação de §8.3 e comparar o resultado com `BROAD_COMMERCIAL_CATEGORY_TOKENS` e `NUTRITIONALLY_NEUTRAL_PACKAGING_TOKENS`; cada divergência é um caso de revisão, e o diff inicial é a lista priorizada das falhas hoje corrigidas uma a uma;
   - tratar `NUTRITIONALLY_NEUTRAL_PACKAGING_TOKENS` como materialidade `informational` por família, não global;
   - tratar `BROAD_COMMERCIAL_CATEGORY_TOKENS` como consequência da existência de variantes comerciais cujo `brand`/`line` é material naquela família;
   - registrar toda conclusão derivada como `provisional` e respeitar a assimetria de §8.3: provisório pode declarar material, nunca imaterial;
   - remover as listas de produção depois do cutover, sem owner concorrente equivalente;

### 8.12. Gate de aceite da base inicial

A migração pode produzir uma base **estruturalmente limpa e funcionalmente inútil**. Este gate existe para impedir que isso passe por aceite.

Evidência do risco: o catálogo TACO embarcado possui 616 itens nomeados na gramática da fonte (`Carne, bovina, acém, moído, cozido`). Quebrados pela primeira vírgula, produzem 255 "famílias" ingênuas, das quais 144 têm uma única entrada. Se a estrutura da base V2 for derivada dessa gramática, o vocabulário nasce na língua do produtor, não na língua de quem registra — e toda superfície do usuário vira alias de um conceito que ela nunca nomeia assim.

#### 8.12.1. Inversão de origem

- **estrutura nasce do consumo** — as famílias e variantes que precisam existir são determinadas pelo histórico real de refeições, pelas superfícies registradas nos canais e pelo Golden Food Corpus;
- **perfil nasce da fonte** — TACO, TBCA, Open Food Facts, fabricante e rótulo entram como fonte de perfil e evidência para as variantes que o consumo definiu;
- **cauda longa entra em quarentena governada**, não em produção, e é promovida por consumo ou curadoria.

#### 8.12.2. Dois gates

| Gate | Momento | Comportamento |
| --- | --- | --- |
| **A — base mínima viável** | antes do shadow mode (§20, Fase C) | **bloqueia** nos critérios de cobertura do consumo real e de corpus; **reporta** os demais |
| **B — base completa** | antes da remoção do legado (§8.13, Fase F) | bloqueia todos os critérios |

A assimetria é deliberada: sem cobertura do consumo real e sem passar o corpus, o shadow mode mediria a base e não o resolvedor, produzindo conclusão errada sobre o V2. Por outro lado, exigir pureza total antes do shadow mode paralisa o programa por um problema que só os dados do shadow mode resolvem.

#### 8.12.3. Critérios bloqueantes do Gate A

- cobertura do consumo real: percentual mínimo do histórico recente mapeado a família/variante canônica;
- Golden Food Corpus (§16) sem falha sobre a base inicial;
- matriz de não-recorrência (§9.3) sem falha sobre a base inicial;
- nenhum item do corpus encerrando por placeholder ou fallback oculto (§9.2).

Os números exatos de cobertura, janela e amostragem permanecem `OPEN` para calibração por baseline (§25).

#### 8.12.4. Critérios reportados no Gate A e bloqueantes no Gate B

- nenhuma família com duas variantes que difiram **apenas** por atributo `informational`;
- nenhuma variante com atributo material não modelado;
- nenhuma variante sem perfil nutricional de fonte declarada;
- distribuição de perfis `verified` versus `provisional`, sem exigir pureza no Gate A;
- quarentena com motivo estruturado e plano, sem exigir zero no Gate A;
- reconciliação de origem fechada.

#### 8.12.5. Validador derivado da materialidade

O aceite da base é verificável, e não opinativo, porque reutiliza a materialidade de §8.3 como validador da própria ontologia:

- variante cujo único diferencial é um atributo `informational` → duplicata ilegítima, deve ser mesclada;
- variante com atributo material não modelado → variante subespecificada;
- `identity_key` de toda variante precisa ser derivável da materialidade da família.

Rodar esse validador sobre a base migrada produz, automaticamente, a lista de famílias malformadas.

#### 8.12.6. Quarentena

Linha de origem que não mapeia com segurança não entra em produção. Ela vai para quarentena com motivo estruturado, no mínimo:

```text
familia_ambigua
atributo_nao_modelado
perfil_insuficiente
duplicata_potencial
nome_fora_da_gramatica_de_consumo
```

A quarentena é visível na console administrativa (§19.2), não bloqueia o cutover por si só, e sua promoção exige o mesmo caminho de governança de qualquer conhecimento novo (§11.3).

#### 8.12.7. Reconciliação obrigatória

```text
linhas de origem = mapeadas + mescladas + quarentenadas
```

Nenhuma perda silenciosa. Toda linha não mapeada possui motivo auditável, o que permite afirmar que a migração está correta sem inspeção manual item a item.

#### 8.12.8. Implementação e evidência

O gate é um script versionado executado no caminho de verificação, produzindo relatório reproduzível. Esse relatório não serve apenas à migração: ele é o **baseline de qualidade** que o critério de rollout e canário (§19.9) usa como referência para decidir avanço ou rollback.

### 8.13. Gate de corte do banco

O legado só pode ser removido quando todos os itens abaixo forem verdadeiros:

- reconciliação de contagens e amostras sem perda silenciosa;
- conflitos explicitamente classificados;
- `mealItems` históricos preservados;
- favoritos/uso reconciliados;
- classificação usada em relatórios preservada;
- Golden Food Corpus verde;
- replay sanitizado de dados reais verde;
- nenhum runtime ativo escreve em `foodCatalog`, `portions` ou conhecimento alimentar de `whatsappLearningArtifacts`;
- busca repository-wide não encontra owner nutricional concorrente não classificado;
- rollback comprovado até o ponto de corte.

- gate de aceite da base inicial (§8.12) aprovado no nível B;

Depois do aceite do cutover, remover bridges e tabelas legadas numa migration separada. Não manter dual-write como estado final.

## 9. Geração e ranking de candidatos

O resolvedor deve poder combinar estratégias como:

1. código de barras exato;
2. alias pessoal confirmado;
3. identidade comercial exata;
4. busca textual normalizada;
5. busca tolerante a erro;
6. busca semântica;
7. catálogo genérico;
8. OCR/rótulo;
9. pesquisa externa verificável;
10. estimativa apenas quando a política permitir.

O ranking deve considerar, entre outros sinais:

- marca;
- variante;
- preparo;
- quantidade/unidade;
- código de barras;
- texto visível;
- rótulo;
- memória do usuário;
- qualificadores como `zero`, `light`, `integral`, `sem açúcar`;
- confiabilidade da fonte;
- atualidade da fonte;
- conflitos explícitos.

Correspondência aproximada nunca deve suplantar evidência exata mais forte.
### 9.1. Política de suficiência baseada em dados

A decisão `tenho informação suficiente para resolver?` pertence ao resolvedor e deve ser calculada sobre **dados estruturados e evidência**, não sobre listas de palavras específicas mantidas em handlers.

A política deve considerar, conforme o campo:

- identidade/variante candidatas e seus qualificadores semânticos;
- existência de variante genérica ou comercial compatível;
- eixos/atributos materialmente necessários para distinguir composição quando modelados no conhecimento governado;
- disponibilidade e status do perfil nutricional aplicável;
- porção/quantidade resolvida e natureza da medida;
- força, atualidade e conflito da evidência;
- regra da categoria para permitir ou proibir estimativa provisória.

Consequências:

- ausência de marca não implica automaticamente insuficiência quando existe variante genérica compatível e perfil aplicável;
- presença de marca não autoriza usar perfil genérico como se fosse composição específica de produto;
- embalagem, preparo, cultivar, linha e sabor só alteram a decisão quando o conhecimento/política indicar que são materialmente relevantes;
- candidatos e alternativas devem vir do conhecimento/evidência disponível, não ser inventados por token sets;
- handlers de canal não podem possuir uma segunda política de suficiência.

### 9.1.1. Suficiência operacionalizada pela materialidade governada

A pergunta "tenho informação suficiente para resolver?" passa a ter resposta executável, obtida do conhecimento governado (§8.3) e nunca de lista lexical em código:

1. localizar a família candidata;
2. consultar `food_attribute_materiality` para cada qualificador observado;
3. atributo com materialidade `identity` e sem variante correspondente → identidade insuficiente → gerar candidatos de variante ou clarificar;
4. atributo com materialidade `nutrition` → exigir perfil que reflita o atributo observado e **não** usar o perfil do valor default como se fosse o valor observado (fail-closed);
5. atributo com materialidade `informational` → ignorado para identidade e nutrição, mas preservado no snapshot e na exibição.

Consequências:

- a lista de descritores nutricionalmente neutros e a lista de categorias comerciais amplas deixam de existir como código (§8.5) e passam a ser **resultado derivado** da base governada;
- a mesma consulta serve para texto, áudio, imagem e rótulo, porque o conhecimento é o mesmo;
- nenhum handler pode responder essa pergunta por conta própria (§19);
- a composição da `identity_key` segue a mesma política, o que impede criação acidental de variantes.

O desenho físico está fechado em §8.7. A única grandeza deixada `OPEN` é a tolerância numérica da divergência de perfis, calibrada por corpus (§25).

### 9.2. Invariante de cobertura nutricional (totalidade)

O resolvedor é uma **função total** sobre observações de alimento consumível: toda observação encerra em uma decisão com **procedência nutricional declarada**. Não existe caminho silencioso para "sem macros".

Ordem de encerramento:

1. perfil verificado da variante exata (rótulo, código de barras, fonte oficial);
2. perfil de variante comercial equivalente comprovada;
3. perfil da variante genérica governada do alimento;
4. perfil herdado da família/preparo com classificação aplicável;
5. estimativa provisória pela política da categoria, marcada como provisória;
6. clarificação do campo realmente faltante, preservando tudo o que já foi resolvido;
7. falha explícita controlada, somente quando registrar implicaria inventar identidade ou composição.

Regras:

- todo encerramento declara fonte, estado e provisoriedade;
- estimativa nunca é apresentada como verificada e nunca substitui perfil verificado (§19.4);
- ausência de marca não impede resolução por variante genérica; presença de marca nunca autoriza perfil genérico como se fosse composição específica do produto (`#1088`, `#1158`);
- o item 7 é exceção auditável, não caminho comum, e deve ser observável por métrica;
- placeholder numérico fixo (por exemplo 150/6/15/5) deixa de ser mecanismo de encerramento (`#1194`, `#1256`);
- a cobertura é propriedade do resolvedor: não depende de o alimento estar previamente cadastrado.

Isso responde ao requisito de produto: independentemente de 1, 2 ou 10 alimentos no mesmo turno, o sistema entrega a proposta de macronutrientes com procedência declarada — ou explica exatamente o que falta.

### 9.3. Matriz de não-recorrência

O histórico do domínio alimentar acumulou classes de falha que se repetem. Esta matriz é o compromisso explícito de que cada classe possui uma garantia arquitetural e um gate que a impede de voltar.

| Classe de falha | Evidência histórica | Garantia arquitetural | Gate de prevenção |
| --- | --- | --- | --- |
| A. Interpretação de linguagem livre | `#120`, `#168`, `#311`, `#332`, `#427`, `#522`, `#717`, `#719`, `#720`, `#742`, `#769`, `#1224`, `#1287` | LCL única com S1/S2/S3, léxico governado e papel semântico (§4.1) | Gate de normalizador por canal; equivalência de superfície no corpus |
| B. Identidade comercial e marca | `#401`, `#407`, `#660`, `#661`, `#742`, `#903`, `#987`, `#1072`, `#1088`, `#1158`, `#1214`, `#1215`, `#1243` | Variante como identidade resolvível; fail-closed comercial; pesquisa por marca com evidência (§8.3, §19.4) | Casos de marca no corpus; proibição de fallback genérico para produto de marca |
| C. Quantidade, medida caseira e porção | `#182`–`#187`, `#332`, `#544`, `#684`, `#1016`, `#1037`, `#1043`, `#1047`, `#1054`, `#1057`, `#1181`, `#1196`, `#1269`, `#1273`, `#1278` | Porção como conhecimento da variante/família com precedência formal e conversão física explícita (§8.3) | Matriz de medidas caseiras e metamórficos de quantidade |
| D. Fallback genérico e nutrição inventada | `#307`, `#402`, `#903`, `#956`, `#982`, `#997`, `#1194`, `#1195`, `#1256`, `#1282` | Invariante de cobertura com procedência declarada (§9.2) | Proibição de placeholder numérico; divergência V1×V2 no shadow mode |
| E. Imagem, rótulo e associação de mídia | `#159`, `#250`, `#346`, `#357`, `#367`, `#496`, `#758`, `#874`, `#986`, `#1174`, `#1177`, `#1191`, `#1210`, `#1215`, `#1235`, `#1243`, `#1251` | Adapters produzem evidência; identidade visual e rótulo entram no mesmo resolvedor (§3) | Casos de visão/rótulo no corpus; multimodal obrigado a atravessar a API pública |
| F. Operação: data, destino e comando | `#421`, `#512`, `#541`, `#721`, `#856`, `#899`, `#1006`, `#1271`, `#1278`, `#1291` | Owner único de `MealOperation` (§7.1) | Corpus de operação; gate que impede handler reconstituir data/destino |
| G. Multi-item, lote e multi-ação | `#169`, `#189`, `#247`, `#271`, `#422`, `#559`, `#578`, `#918`, `#1177`, `#1287` | Persistência em lote com exclusão apenas do item inconsistente (§7.2) | Casos de lote no corpus; proibição de erro genérico com item válido |
| H. Memória pessoal e promoção | `#403`, `#524`, `#1051`, `#1059`, `#1153`, `#1225` | Memória pessoal durável isolada; entrada explícita prevalece; promoção com governança (§11, §12.2, §15) | Regressão de memória após restart e conflito no mesmo turno |
| I. Ownership concorrente entre canais | `#732`, `#769`, `#1051`, `#1090`, `#1095`, `#1244`, `#1256`, `#1271` | Resolvedor único; canais só produzem evidência (§2, §3) | `architecture:check` repository-wide contra owners concorrentes |
| J. Classificação e relatórios | `#266`, `#590`, `#591`, `#592`, `#593`, `#595`, `#1245` | Classificação separada de identidade e nutrição, versionada e preservada no snapshot (§8.7) | Casos de classificação no corpus; inventário de consumidores downstream |
| K. Resiliência e runtime | `#873`, `#1061`, `#1191`, `#1257`, `#1282` | Atomicidade, idempotência, modo degradado e orçamento (§19.5, §19.6) | Testes de retry, concorrência e indisponibilidade |
| L. Privacidade e segurança | `#437`, `#736`, `#737` | Minimização, retenção e fronteira de instrução (§4.1.6, §19.8) | Casos adversariais no corpus; revisão de privacidade no gate de rollout |

Se uma issue futura propuser resolver novamente uma dessas classes fora da garantia correspondente, ela deve ser rejeitada ou o ADR revisado explicitamente (§26).

### 9.4. Nenhum alimento exige código

A capacidade de resolver **1, 2 ou 10 alimentos arbitrários** não pode depender de cadastro prévio nem de alteração de código. A regra operacional é:

1. a primeira ocorrência de um alimento desconhecido **já encerra** pela escada de §9.2 (tipicamente variante genérica, herança de família/preparo ou estimativa provisória marcada);
2. a recorrência gera `food_review_cases` agrupado, sem exigir ação humana imediata;
3. a promoção publica conhecimento governado;
4. nenhuma dessas etapas altera código, constante ou array de produção.

Consequência de produto: o usuário não espera por correção de código para registrar um alimento. A qualidade melhora por **dado**, de forma incremental e auditável.

Gate: `architecture:check` deve falhar quando houver alimento, macro, porção, classificação ou termo linguístico cadastrado em array/constante de produção.

## 10. Política de incerteza

Princípio:

> Nunca perguntar o que o sistema já sabe, nunca inventar o que não sabe e perguntar somente o campo realmente faltante.

Exemplos:

- identidade conhecida + quantidade ausente -> perguntar quantidade;
- produto e quantidade conhecidos + nutrição comercial ausente -> solicitar rótulo ou usar estimativa provisória somente quando a política permitir;
- duas variantes plausíveis -> perguntar variante;
- três itens na imagem, dois resolvidos e um ambíguo -> preservar os dois e perguntar somente o terceiro;
- imagem ilegível -> não inventar alimento.

Uma entrada com vários itens segue §7.2: os itens resolvidos são registrados, os inconsistentes são excluídos individualmente com motivo estruturado, e o usuário recebe explicação do que entrou e do que não entrou. A política de incerteza nunca é motivo para descartar o lote inteiro nem para silenciar a ausência de um item.

A política também não pode produzir ausência silenciosa de nutrição: se o item foi registrado, ele possui procedência nutricional declarada conforme §9.2.

Os thresholds numéricos de confiança permanecem `OPEN` e devem ser calibrados por corpus/replay, não escolhidos arbitrariamente.

## 11. Governança e aprovação humana

A aprovação deve ser uma camada de governança de dados, não uma correção de código.

### 11.1. Nível 1 — aprovação automática

O sistema pode registrar automaticamente quando:

- a identidade está suficientemente comprovada;
- não há conflito material de marca/variante/preparo;
- quantidade é resolvida ou explicitamente fornecida;
- a fonte nutricional atende à política aplicável;
- não há evidência conflitante relevante.

Critérios e thresholds exatos permanecem `OPEN` e devem ser validados pelo Golden Food Corpus e telemetria.

### 11.2. Nível 2 — confirmação do próprio usuário

Quando a dúvida for específica ao registro ou ao contexto pessoal, o sistema deve perguntar somente o campo faltante.

A confirmação pode gerar memória pessoal, por exemplo:

- `café` -> `café sem açúcar` para aquele usuário;
- um alias pessoal recorrente -> alimento/variante confirmados;
- porção habitual -> referência pessoal quando permitido.

A confirmação pessoal:

- vale apenas no escopo autorizado daquele usuário;
- não vira regra global automaticamente;
- deve manter evidência da confirmação;
- deve poder ser revogada;
- nunca prevalece sobre informação explícita conflitante no turno atual.

### 11.3. Nível 3 — revisão humana administrativa

Conhecimento candidato a uso global deve passar por governança quando não puder ser promovido automaticamente com segurança.

A fila de revisão deve agrupar ocorrências equivalentes. Mil registros equivalentes não devem gerar mil tarefas administrativas.

Uma pendência deve apresentar, quando disponível:

- entidade candidata;
- marca/variante;
- aliases observados;
- código de barras;
- imagem/OCR/rótulo;
- porção e gramatura;
- macros por 100 g e/ou porção;
- fontes encontradas;
- conflitos;
- quantidade de ocorrências/usuários de forma agregada e segura;
- confiança;
- recomendação do resolvedor;
- histórico de alterações.

Ações mínimas do revisor:

1. **aprovar**;
2. **corrigir e aprovar**;
3. **rejeitar**;
4. **revogar** aprovação anterior quando houver nova evidência.

Tipos de caso esperados incluem, além dos já citados: nova variante comercial, novo alias global, nova entrada de léxico linguístico (§4.1.4), nova porção, conflito/correção de conhecimento existente e recorrência de superfície não coberta.

Papéis exatos, permissões administrativas e interface permanecem `OPEN`.

## 12. Estados de governança

A governança deve separar **publicação global** de **confirmação pessoal**.

### 12.1. Estado do conhecimento global

Variantes, perfis nutricionais, aliases e porções governadas devem poder distinguir:

```text
provisional
pending_review
verified
rejected
revoked
```

O estado pertence ao artefato de conhecimento correspondente e pode ser refletido/derivado pelo review case, conforme o desenho físico final.

### 12.2. Confirmação pessoal não é estado global

`confirmed_personal` deixa de ser tratado como estado da mesma máquina global.

Confirmação pessoal pertence a estruturas como `user_food_aliases`, preferências ou memórias pessoais, sempre com:

- `userId`;
- alvo canônico;
- origem da confirmação;
- data;
- validade quando aplicável;
- revogação.

Isso impede que uma única correção pessoal seja promovida implicitamente para todos os usuários.

### 12.3. Provisório não significa inutilizável

Se um usuário enviar uma embalagem nova com rótulo legível e o sistema comprovar a associação entre produto e tabela, a informação pode ser usada para aquele registro com estado provisório, quando a política permitir.

A aprovação administrativa posterior determina se o conhecimento pode se tornar referência global; ela não deve bloquear desnecessariamente o registro individual seguro.

## 13. Promoção para conhecimento global

Uma correção individual não deve se transformar automaticamente em regra global.

A promoção global deve considerar:

- múltiplas evidências independentes quando necessário;
- ausência de conflitos materiais;
- fonte nutricional suficiente;
- replay do corpus;
- testes positivos e negativos;
- revisão humana quando exigida pela política;
- possibilidade de rollback/revogação.

Os números mínimos de ocorrências/evidências permanecem `OPEN`.

## 14. Priorização da fila de revisão

A revisão humana não deve ser FIFO cego.

A prioridade pode considerar:

- frequência recente;
- número de usuários afetados;
- repetição de clarificações;
- impacto nutricional;
- conflito entre fontes;
- taxa de fallback;
- risco de propagação de informação errada;
- existência de rótulo/código de barras que torne a revisão rápida.

A fórmula exata permanece `OPEN`.

## 15. Aprendizado pessoal

Aprendizado pessoal deve ser persistente, auditável e isolado por usuário.

Cada aprendizado deve poder manter:

- alias;
- alimento/variante;
- contexto;
- porção quando aplicável;
- confiança;
- origem da confirmação;
- data;
- validade;
- histórico;
- revogação.

Memória em processo não é fonte de verdade.

Entrada explícita no turno atual sempre prevalece sobre memória anterior incompatível.

## 16. Golden Food Corpus

Toda regressão alimentar relevante deve virar caso versionado em um corpus canônico.

Cada caso deve registrar, conforme aplicável:

- entrada original;
- modalidade;
- operação pretendida;
- observações esperadas;
- identidade esperada;
- quantidade esperada;
- fonte nutricional permitida;
- fontes proibidas;
- campo que pode exigir clarificação;
- decisão final esperada.

Casos iniciais obrigatórios incluem os incidentes recentes já conhecidos, como:

- Panco/Wickbold e variantes;
- pão com marca + número de fatias;
- amendoim/produto seguido de foto de rótulo;
- cerveja por imagem;
- leite UHT comercial;
- pera/maçã e cultivares;
- mortadela com `1,5`, `1.5` e linguagem natural;
- ovo/preparo;
- melão/cultivar;
- Coca-Cola/Cerveja Original;
- café sem açúcar como memória pessoal;
- múltiplos alimentos com apenas um ambíguo;
- posição variável do destino da refeição;
- erro de transcrição;
- produto reconhecido sem nutrição comprovada;
- indisponibilidade de provider.

Casos adicionais obrigatórios de linguagem e lote:

- convergência de superfície (`1,5 fatias`, `1.5 fatias`, `uma fatia e meia`, ordem invertida, pontuação variável, transcrição equivalente);
- acento ausente, plural/singular, abreviação, gíria, regionalismo e erro de digitação recorrente;
- apelido pessoal e sua revogação;
- termo incerto de porção (`tiquinho`, `punhado`, `pratão`) exigindo quantidade, nunca virando gramas;
- identidade ambígua por erro de digitação (`banco` em contexto de pão) produzindo alternativas, sem correção silenciosa;
- lote com itens válidos e um inconsistente: registrar os válidos, excluir apenas o inconsistente e explicar cada exclusão;
- lote em que um item permanece ambíguo sem invalidar os demais;
- operação com data explícita, refeição configurada e destino em posição variável;
- negativos: não alimento (`óleo de motor`, `pasta de dente`, `água sanitária`, cosmético); rótulo não alimentar; ingredientes de rótulo que não podem virar itens; OCR contendo instrução; imagem ilegível;
- produto comercial de marca sem perfil comprovado: encerrar em provisório declarado, nunca em placeholder fixo nem em perfil genérico apresentado como específico.

Casos de materialidade de atributos (§8.3):

- `leite integral` e `leite desnatado`: atributo material para identidade e nutrição — não pode colapsar em uma única variante;
- `leite UHT` e `leite`: atributo informacional para a família — não pode gerar clarificação nem variante nova;
- `iogurte de morango` e `iogurte natural`: sabor material;
- `pêra packham` e `pêra williams`: cultivar com materialidade medida por divergência de perfis;
- `refrigerante zero` e `refrigerante`: atributo de açúcar material, com fail-closed — perfil do valor default não pode ser apresentado como composição do valor observado;
- `arroz` com descritor de embalagem: atributo informacional, sem clarificação;
- `leite` de marca com atributo informacional: ainda assim proibido usar perfil genérico como composição específica do produto (`#1088`);
- superfície nova da mesma família: deve mapear para variante existente ou virar candidato, nunca criar variante por acidente.

## 17. Testes metamórficos

A mesma intenção alimentar deve convergir sob variações como:

- `1,5 fatias de mortadela`;
- `uma fatia e meia de mortadela`;
- `adicionar mortadela, uma fatia e meia`;
- transcrição de áudio equivalente;
- imagem + legenda equivalente.

Também devem existir variações de:

- acentos;
- singular/plural;
- ordem;
- pontuação;
- vírgula/ponto decimal;
- abreviações;
- erros de transcrição;
- qualificador antes/depois da marca.

A propriedade formal a testar é a **equivalência de superfície** definida em §4.1.8. Cada classe de variação deve gerar um caso de propriedade, e não apenas casos isolados por incidente.

## 18. Regra para mocks

Testes end-to-end e de golden flow devem mockar somente boundaries externos quando necessário, por exemplo:

- provider de IA;
- OCR/visão;
- pesquisa externa;
- serviços de terceiros.

Eles não devem mockar o próprio resolvedor nem entregar ao entrypoint a decisão final que o teste pretende provar.

## 19. Gates arquiteturais esperados

A implementação da epic deve evoluir `architecture:check` para impedir regressões como:

1. handler de canal decidir identidade/nutrição independentemente;
2. novo resolver paralelo;
3. reconstrução de decisão estruturada como texto para reinferência;
4. adapter escolher fonte nutricional;
5. alimento específico adicionado em lista TypeScript;
6. placeholder oculto quando existe fonte compatível;
7. decisão resolvida ser modificada sem nova evidência;
8. persistência sem proveniência ou estado provisório explícito;
9. bypass da memória durável;
10. fluxo multimodal que não atravesse a API pública do resolvedor.

11. normalizador linguístico, vocabulário, sinônimo ou tabela de apelido dentro de módulo de canal (§4.1.4, regra 10);
12. pergunta de clarificação originada na camada de linguagem em vez da política de incerteza;
13. encerramento de item registrado sem procedência nutricional declarada (§9.2);
14. placeholder numérico fixo usado como nutrição de encerramento;
15. handler de canal reconstituindo data, destino de refeição ou comando (§7.1);
16. descarte do lote inteiro quando apenas um item é inconsistente (§7.2);
17. alimento, macro, porção, classificação ou termo linguístico cadastrado em array/constante de produção (§9.4).

18. materialidade de atributo decidida por lista lexical, conjunto de tokens ou regra por alimento em código, em vez de conhecimento governado (§9.1.1);

## 19.1. Estratégia de testes e redução da suíte

A implementação do Food Intelligence Resolver V2 **não deve carregar automaticamente toda a suíte histórica existente**.

O programa deve incluir uma revisão explícita de testes para reduzir tempo de execução sem reduzir a proteção real contra regressões.

Cada teste relacionado ao domínio alimentar deve ser classificado em uma destas ações:

1. **manter** — protege contrato, regressão ou integração que continua relevante no V2;
2. **consolidar** — cobre o mesmo comportamento de outros testes e deve virar uma matriz/caso único mais representativo;
3. **reescrever** — testa comportamento válido, mas está acoplado à arquitetura V1, a mocks excessivos ou a detalhes internos que deixarão de existir;
4. **remover** — cobre implementação aposentada, repete cobertura sem sinal adicional ou possui custo desproporcional ao risco protegido.

Princípios obrigatórios:

- preferir testes de contrato, Golden Food Corpus e testes metamórficos a múltiplos testes quase idênticos por incidente;
- evitar testes nomeados por issue como mecanismo permanente quando o comportamento já puder ser representado por uma suíte de domínio;
- um bug histórico relevante deve sobreviver como caso do corpus/regressão, não necessariamente como arquivo ou fluxo de teste separado;
- testes unitários devem proteger lógica determinística e rápida;
- testes de integração devem provar fronteiras reais importantes sem repetir todas as combinações dos testes unitários;
- testes end-to-end e smokes devem ser poucos, orientados a jornadas críticas e não duplicar o que já foi comprovado em camadas inferiores;
- chamadas reais a providers externos, banco remoto, mídia ou serviços de terceiros não devem fazer parte do caminho rápido quando um boundary controlado comprovar o mesmo contrato;
- testes lentos ou dependentes de ambiente devem ser executados somente no perfil/gate que corresponda ao risco da mudança;
- o gate da PR deve continuar escolhendo o menor conjunto suficiente para o diff, enquanto a regressão completa da branch protege integração sistêmica;
- métricas de duração, flakiness e cobertura de risco devem orientar a remoção/consolidação; quantidade de testes não é objetivo por si só;
- nenhum teste deve ser mantido apenas porque existia antes da migração.

A revisão da suíte deve produzir um inventário reproduzível com, no mínimo:

- arquivo/suite atual;
- comportamento protegido;
- custo aproximado de execução;
- dependências externas;
- sobreposição com outros testes;
- ação `keep | consolidate | rewrite | remove`;
- destino no V2;
- justificativa.

O corte do V2 não é considerado concluído enquanto a suíte do domínio alimentar continuar dependendo de testes redundantes da arquitetura antiga ou de checks históricos que não protejam contrato vigente.

## 19.2. Interfaces de manutenção alinhadas ao V2

A reformulação do domínio alimentar inclui as duas superfícies existentes de manutenção de alimentos. Elas devem usar os mesmos serviços e contratos V2, mas com responsabilidades distintas por audiência.

### Tela do usuário — `FoodsPage` / Minha base alimentar

A tela do usuário administra **conhecimento pessoal e sinais pessoais**, não o catálogo global.

Responsabilidades alvo:

- buscar alimentos globais e pessoais resolvíveis pela base V2;
- favoritar e consultar recentes sem duplicar identidade alimentar;
- criar e editar apenas variantes/alimentos de escopo pessoal autorizados;
- manter aliases pessoais, porções pessoais e preferências explicitamente confirmadas;
- anexar rótulo/evidência ou propor correção quando a informação global parecer incorreta, sem alterar conhecimento global diretamente;
- exibir de forma compreensível a identidade/variante, porção, perfil nutricional aplicado, origem e estado de confiança quando isso for relevante para a decisão do usuário;
- preservar histórico: editar alimento pessoal não recalcula refeições antigas;
- permitir desativação/revogação segura do conhecimento pessoal sem apagar evidência histórica necessária.

A interface não deve expor o schema físico como formulário bruto. O fluxo deve ser orientado à intenção do usuário: nome/identidade -> marca/variante -> porção -> nutrição/evidência -> revisão antes de salvar.

Alimentos globais podem ser consultados e usados, mas não editados diretamente por usuário comum. Quando houver divergência, a ação correta é **sugerir correção/enviar evidência**, gerando candidato/review case conforme a política do V2.

### Tela administrativa — `AdminPage` / Base de alimentos

A área administrativa passa a ser uma **console de governança do conhecimento alimentar**, e não apenas uma tabela de catálogo/importação.

Responsabilidades alvo:

- pesquisar famílias e variantes globais e inspecionar relacionamentos entre elas;
- visualizar e comparar perfis nutricionais versionados, classificações, porções, aliases, barcodes, fontes e evidências;
- operar a fila agrupada de `food_review_cases`;
- aprovar, corrigir e aprovar, rejeitar, revogar, depreciar ou mesclar conhecimento conforme permissão;
- identificar conflitos entre fontes e versões sem sobrescrever silenciosamente conhecimento verificado;
- revisar candidatos originados de rótulo, OCR, código de barras, pesquisa externa e correções dos usuários;
- acompanhar impacto e frequência agregada para priorização, sem expor dados pessoais desnecessários;
- administrar/importar fontes em fluxo com prévia, reconciliação e publicação controlada;
- acessar histórico de `food_review_events` e proveniência suficiente para auditoria;
- distinguir claramente conhecimento `provisional`, `pending_review`, `verified`, `rejected`, `revoked`, `deprecated` e `merged`.

A administração não deve possuir regras próprias de resolução alimentar. Ela governa os mesmos artefatos que o Food Intelligence Resolver consome.

### Componentes e navegação

As duas telas podem compartilhar componentes de apresentação de identidade, variante, porção, nutrição, fonte e status, mas devem preservar semântica de audiência:

- usuário: foco em uso pessoal, clareza e correção do próprio conhecimento;
- administrador: foco em governança, evidência, conflito, versionamento e publicação global.

No desktop, formulários longos de alimento/variante devem usar área de detalhe própria ou drawer/página suficientemente ampla, em vez de concentrar todo o modelo V2 em uma coluna lateral estreita. No mobile, ações essenciais devem continuar acessíveis sem esmagar tabelas de governança.

Estados obrigatórios para ambas as superfícies: carregando, vazio, erro, sem permissão, item inativo/revogado, conflito e sucesso. Ações destrutivas ou de publicação global exigem confirmação proporcional ao risco.

### Regra de migração das telas

As telas atuais são baseline V1 e não devem ser expandidas com novos campos do modelo antigo durante a migração.

A migração de interface deve ocorrer depois que os contratos/repositórios V2 necessários estiverem disponíveis e deve remover dependências de `foodCatalog`, `portions`, favoritos duplicados e macros armazenados diretamente na identidade.

Não manter dois formulários independentes representando o mesmo conhecimento em estruturas V1 e V2.

## 19.3. Orçamento de desempenho e custo

O resolvedor V2 deve operar com **orçamento explícito por resolução**, evitando que qualidade seja buscada por chamadas externas ilimitadas.

Regras obrigatórias:

- resolver primeiro com conhecimento local governado, evidência exata e memória pessoal compatível;
- código de barras, alias pessoal confirmado, variante exata e rótulo suficientemente comprovado não devem acionar pesquisa externa desnecessária;
- chamadas de IA, OCR, embeddings e pesquisa externa devem ser tratadas como recursos com custo, latência e disponibilidade finitos;
- cada etapa externa deve possuir timeout e política de retry limitada, reutilizando a fundação multi-provider quando aplicável;
- o resolvedor deve impedir loops de pesquisa/fallback e limitar o número de tentativas por resolução;
- cache só pode reutilizar resultado quando identidade da consulta, versão/política, validade e escopo permitirem; cache nunca transforma evidência provisória em verificada;
- uma mesma evidência ou pesquisa equivalente dentro da mesma resolução não deve ser executada repetidamente;
- degradação de custo nunca pode substituir uma fonte comprovada por informação nutricional menos confiável sem marcar a decisão e aplicar a política de incerteza.

Os valores exatos de SLO, timeout, quantidade máxima de chamadas e orçamento econômico permanecem `OPEN` até medição do shadow mode e corpus.

O ciclo padrão de resolução é **cache-through**: consultar primeiro o conhecimento governado e a evidência exata; recorrer à IA ou à pesquisa externa somente no miss; persistir o resultado como conhecimento provisório com evidência; e não repetir a mesma consulta dentro da mesma resolução nem nas seguintes enquanto ela for válida.

Consequências:

- a segunda ocorrência do mesmo alimento não deve custar o mesmo que a primeira;
- resultado de IA persistido entra como provisório e candidato a revisão, nunca como verificado;
- cache nunca transforma evidência provisória em verificada e nunca sobrevive a mudança de versão, validade ou escopo que o invalidem;
- a camada de linguagem segue a mesma disciplina: S1/S2 antes de S3 (§4.1.3).

## 19.4. Hierarquia, validade e ciclo de vida das fontes

O V2 deve distinguir **força de identidade**, **força nutricional**, **atualidade** e **escopo** da evidência. Não existe uma ordem única e cega que sirva para todos os campos.

Princípios:

- evidência exata do próprio produto, como código de barras compatível e rótulo associado de forma comprovada, prevalece sobre fuzzy matching ou estimativa;
- fonte oficial/fabricante pode sustentar identidade ou nutrição somente para a variante compatível;
- bases estruturadas como TBCA/TACO podem ser referências fortes para alimentos genéricos, sem provar automaticamente um produto comercial específico;
- fonte externa colaborativa, como Open Food Facts, é candidata/evidência e não publicação automática;
- pesquisa web ou IA não vira fonte de verdade por si só; deve preservar URL/origem/evidência verificável quando usada para conhecimento governado;
- memória pessoal pode resolver preferência/alias do próprio usuário, mas não eleva a confiança do conhecimento global;
- estimativa heurística ou por IA é sempre explicitamente provisória e não pode substituir silenciosamente perfil verificado;
- conflito material entre fontes fortes deve abrir clarificação ou revisão, não ser resolvido por 'última escrita vence';
- perfis, classificações, porções e evidências devem suportar validade, supersessão, revogação e revalidação quando a fonte mudar ou envelhecer.

A matriz final de confiança por tipo de fonte, tempos de validade/revalidação e thresholds permanecem `OPEN` para calibração e decisão de produto.

## 19.5. Concorrência, deduplicação e idempotência

O resolvedor e a governança devem ser seguros em múltiplas instâncias e sob retries.

Regras obrigatórias:

- uma resolução possui `traceId` estável para correlação, mas persistências idempotentes devem usar chaves de negócio apropriadas e não depender apenas do trace;
- criar a mesma variante, perfil, barcode, alias ou review case de forma concorrente deve convergir para um único conhecimento corrente quando semanticamente equivalente;
- `identity_key`, `profile_key + version`, barcode, `case_key` e demais invariantes definidos no schema devem ser reforçados por constraints/transactions, não apenas por checagem em memória;
- retries não podem duplicar review cases, eventos de promoção, perfis nutricionais ou mutações de refeição;
- confirmação/revogação administrativa deve revalidar estado e autoridade dentro da transação antes do commit;
- concorrência entre duas evidências incompatíveis não escolhe silenciosamente a última gravação; o conflito permanece explícito e governável;
- callbacks ou mensagens duplicadas continuam sujeitos aos contratos idempotentes existentes antes de produzir nova resolução ou mutação.

## 19.6. Modo degradado e indisponibilidade

O resolvedor deve possuir comportamento determinístico quando uma capacidade externa estiver indisponível.

Ordem de princípio:

1. usar conhecimento local governado e evidência já disponível;
2. aplicar memória pessoal somente quando compatível com a entrada explícita;
3. usar caminhos determinísticos locais permitidos para quantidade/normalização;
4. usar estimativa provisória somente quando a categoria e a política permitirem;
5. pedir apenas o campo/evidência que falta;
6. falhar de forma controlada quando registrar implicaria inventar identidade, variante ou nutrição.

Regras:

- indisponibilidade de provider não autoriza fallback oculto para macros genéricos de produto comercial;
- timeout externo não deve reiniciar etapas já resolvidas nem degradar evidência forte;
- modo degradado deve ser observável por razão estruturada;
- queda de uma capacidade opcional não deve bloquear resolução que já esteja suficientemente comprovada localmente;
- fallback cross-provider continua obedecendo à política central de IA, segurança e LGPD; o Food Intelligence V2 não cria uma política paralela.

## 19.7. Observabilidade funcional, SLOs e custo

A telemetria do V2 deve medir a qualidade do **resultado de domínio**, além da saúde técnica dos providers.

Métricas mínimas, sempre sanitizadas:

- volume de resoluções por modalidade/entrypoint;
- latência total e por estágio;
- taxa de `resolved`, `partially_resolved`, `ambiguous` e `unknown`;
- taxa e motivo de clarificação;
- taxa e motivo de fallback/estimativa provisória;
- uso de fonte local, rótulo, fonte externa e IA;
- divergência V1 x V2 durante shadow mode;
- quantidade de chamadas externas, retries e custo estimado por resolução/capacidade;
- taxa de conflitos entre fontes;
- criação, aprovação, rejeição, revogação e tempo de fila de review cases;
- incidência de reabertura/correção de conhecimento previamente verificado;
- regressões do Golden Food Corpus e taxa de erro por classe de cenário.

Telemetria não deve conter texto cru, transcrição, imagem, rótulo integral, prompt, resposta de provider, telefone, URL assinada ou dado pessoal desnecessário. Correlação deve usar IDs internos, hashes sanitizados ou agregados conforme `PRIVACY_LGPD.md` e `SECURITY.md`.

Os SLOs e limites que bloqueiam rollout permanecem `OPEN`; devem ser definidos com baseline do fluxo atual e dados do shadow mode.

Métricas adicionais obrigatórias:

- percentual de observações encerradas em S1, S2 e S3 da camada de linguagem;
- taxa de encerramento por degrau da escada de §9.2, incluindo o degrau de falha explícita;
- taxa de item registrado sem procedência nutricional declarada (deve ser zero);
- taxa de uso de placeholder numérico fixo (deve ser zero);
- taxa de alimento novo resolvido **sem alteração de código**;
- taxa de exclusão individual em lotes e distribuição de `unresolvedReason`;
- incidência de correção silenciosa indevida (deve ser zero);
- top N de superfícies não cobertas pelo léxico, alimentando curadoria por dado;
- reincidência por classe da matriz de §9.3.

## 19.8. Privacidade, retenção e minimização de evidências

O Food Intelligence V2 não cria exceção às regras existentes de LGPD, segurança e exclusão.

Regras obrigatórias:

- `food_evidence` guarda somente fatos estruturados, referência e conteúdo mínimo necessário para auditoria;
- mídia bruta permanece no storage apropriado e não é duplicada no banco para conveniência;
- OCR/texto bruto só pode ser retido quando houver finalidade explícita e período definido;
- fila administrativa deve preferir evidência sanitizada e agregada, sem expor identidade do usuário quando ela não for necessária para a decisão;
- `food_resolution_events` deve ter retenção finita e não pode virar histórico permanente de texto alimentar;
- exclusão/exportação da conta deve considerar memória pessoal, evidências vinculadas ao usuário e eventos de resolução conforme a finalidade e obrigações aplicáveis;
- promoção para conhecimento global deve remover dependência de dado pessoal identificável sempre que possível;
- qualquer novo compartilhamento com provider externo continua dependendo das políticas por capacidade já documentadas.

Os períodos exatos de retenção de evidência visual/OCR e a política de anonimização para candidatos promovidos permanecem `OPEN` antes da implementação correspondente.

## 19.9. Critério de rollout, canário e rollback

O V2 deve ser promovido por evidência, não apenas por conclusão de código.

Cada avanço de rollout deve verificar pelo menos:

- Golden Food Corpus e testes metamórficos verdes;
- divergência V1 x V2 dentro do limite aceito por classe de cenário;
- ausência de regressão relevante em clarificação, fallback e erro nutricional;
- latência e custo dentro do orçamento aprovado;
- nenhuma regressão de privacidade, idempotência ou integridade;
- fila de revisão sem crescimento incompatível com a capacidade operacional;
- rollback funcional e de leitura comprovado sem destruir dados V2 já coletados.

- baseline de qualidade da base inicial (§8.12) como referência de comparação e de bloqueio.

O rollout pode usar shadow mode, feature flag e percentuais/cortes progressivos por entrypoint. O rollback deve preferir retornar leitura/decisão ao caminho anterior preservando dados e evidências V2, em vez de executar downgrade destrutivo.

Percentuais, janelas, limites de divergência e métricas exatas de promoção/bloqueio permanecem `OPEN` até existirem dados do shadow mode.

## 20. Migração

A migração deve ser incremental e observável.

### Fase A — contrato e corpus

- consolidar este ADR;
- definir contratos finais;
- construir Golden Food Corpus;
- instrumentar traceId e métricas.

### Fase B — conhecimento governado

- consolidar catálogos, aliases, variantes, porções e perfis;
- migrar hardcodes;
- criar compatibilidade temporária quando necessário.

### Fase C — resolver em shadow mode

Processar a mesma entrada com o fluxo atual e o novo resolver sem mudar a persistência produtiva.

- exigir a aprovação do Gate A de §8.12 antes de iniciar a comparação;

Comparar:

- identidade;
- quantidade;
- nutrição;
- fonte;
- confiança;
- clarificação;
- divergências.

### Fase D — migração de entrypoints

Migrar progressivamente:

1. registro textual;
2. áudio/transcrição;
3. adição;
4. edição/substituição;
5. imagem de prato;
6. embalagem;
7. rótulo;
8. continuidade multi-turn;
9. simulador.

### Fase E — governança e aprendizado

- memória pessoal;
- correções;
- fila de revisão;
- promoção global;
- revogação/rollback.

### Fase F — remoção do legado

Somente depois do corpus/gates aprovados:

- remover reinterpretações concorrentes;
- remover resolvers paralelos;
- remover catálogos/hardcodes duplicados;
- remover bridges que deixaram de ser necessários.

## 21. Relação com a arquitetura atual

Este ADR **não declara que a arquitetura alvo já existe**.

O código/documentação atual ainda possui estruturas históricas como `processMealInput`, `semanticContract`, resolução contável, preflights comerciais, materialização e wrappers de canal.

Até a migração:

- comportamento produtivo atual continua sendo descrito pelos design docs existentes;
- este ADR governa **novas decisões de direção arquitetural** para o programa Food Intelligence V2;
- uma issue não pode declarar a arquitetura alvo concluída apenas por reutilizar nomes como "canônico", "owner único" ou "semantic contract";
- cada etapa precisa provar, por código + golden flows + gates, que eliminou ou isolou o ownership concorrente correspondente.

## 22. Compatibilidade com contratos existentes

Contratos atuais que já preservam fatos estruturados, proveniência, fail-closed comercial, atomicidade, idempotência, privacidade e continuidade devem ser reutilizados sempre que forem compatíveis.

Este ADR não autoriza regressão de:

- privacidade/LGPD;
- idempotência;
- source grounding;
- isolamento por usuário;
- atomicidade de persistência;
- segurança;
- lifecycle do WhatsApp;
- compatibilidade pública necessária durante migração.

## 23. Critérios para considerar a arquitetura concluída

O programa só pode ser considerado concluído quando houver evidência de que:

- texto, áudio e imagem equivalentes convergem para a mesma identidade/perfil quando a evidência é equivalente;
- todos os incidentes representativos do Golden Food Corpus passam pelo entrypoint público;
- nenhum item conhecido recebe fallback oculto incompatível;
- números isolados não viram alimentos;
- itens resolvidos são preservados quando outro item é ambíguo;
- correções pessoais sobrevivem a restart/múltiplas instâncias;
- rótulo posterior atualiza o item correto;
- identidade, quantidade e nutrição são transportadas como decisão estruturada;
- handlers não reinterpretam decisões resolvidas;
- alimento novo não exige código;
- gate arquitetural impede caminhos paralelos;
- toda decisão é auditável por evidência, fonte e versão;
- revisão humana global não vira gargalo do registro individual.
- resolução respeita orçamento aprovado de latência/custo e não executa pesquisa externa redundante;
- retries/concorrência não criam conhecimento ou review cases duplicados;
- indisponibilidade externa produz degradação explícita e nunca fallback nutricional oculto;
- métricas sanitizadas demonstram qualidade funcional, custo e operação do resolver;
- critérios de rollout e rollback foram exercitados antes da remoção do legado.

## 24. Decisões já acordadas

As seguintes decisões são consideradas parte estável deste ADR, salvo revisão explícita:

- existir um único resolvedor alimentar de domínio;
- canais multimodais produzem evidência e não resoluções concorrentes;
- banco de conhecimento é único e governado;
- o domínio alimentar será remodelado agora, antes da consolidação do V2, eliminando a coexistência permanente `foods`/ `foodCatalog`;
- identidade, variante e perfil nutricional são conceitos separados;
- refeições preservam snapshot histórico e referências à variante/perfil usados;
- conhecimento alimentar novo deve ser dado, não hardcode;
- memória pessoal é separada de conhecimento global;
- aprovação tem três níveis: automática, confirmação pessoal e revisão administrativa global;
- informação provisória segura pode ser usada no registro individual;
- promoção global exige governança;
- ocorrências equivalentes devem ser agrupadas para revisão;
- fila administrativa deve priorizar impacto;
- decisão estruturada é monotônica;
- Golden Food Corpus é gate de aceite;
- mocks não podem esconder a etapa que o teste pretende validar.
- a suíte de testes do domínio alimentar será auditada e reduzida no V2, preservando somente cobertura efetiva de contrato, regressão e integração.
- as telas de manutenção do usuário e da administração serão migradas para os mesmos contratos V2, com escopo pessoal separado de governança global.
- o resolver operará sob orçamento explícito de latência, tentativas e custo, priorizando conhecimento local e evitando chamadas externas redundantes;
- força e validade de fonte serão avaliadas por campo/identidade, sem política cega de última escrita ou confiança única;
- persistência e governança serão idempotentes e seguras sob concorrência/múltiplas instâncias;
- indisponibilidade externa terá modo degradado determinístico e fail-closed quando registrar exigiria inventar fatos;
- observabilidade funcional e econômica do V2 será sanitizada e fará parte do gate de rollout;
- evidências seguirão minimização e retenção intencional, sem duplicação indiscriminada de mídia ou texto bruto;
- rollout será progressivo, mensurável e reversível sem downgrade destrutivo.
- qualificadores alimentares relevantes devem preservar papel semântico estruturado, evitando reclassificação downstream por listas léxicas específicas;
- suficiência de identidade/nutrição é política do resolvedor sobre dados/evidências governados, não regra lexical por canal;
- a remoção do legado será guiada por inventário repository-wide de owners concorrentes, não apenas por uma lista fixa de arquivos.

- existe uma única camada de compreensão linguística, com léxico governado como dado e papel semântico explícito, sem owner concorrente por canal;
- a linguagem é normalizada para **observação estruturada**, nunca por round-trip texto -> estrutura -> nova inferência;
- o resolvedor é uma função total: todo item registrado possui procedência nutricional declarada, e ausência silenciosa de macros é proibida;
- nenhum alimento, macro, porção, classificação ou termo linguístico exige cadastro em código para ser resolvido;
- operação da refeição (data, destino, comando) possui owner único, com a mesma disciplina da identidade alimentar;
- em lote, itens válidos são registrados e apenas os inconsistentes são excluídos, com explicação estruturada;
- o ciclo de resolução é cache-through, e conhecimento obtido por IA ou pesquisa externa só é persistido como provisório com evidência;
- o histórico do domínio alimentar é tratado como matriz de não-recorrência (§9.3), e cada classe de falha possui garantia e gate.

- a materialidade de um atributo alimentar é conhecimento governado e derivado por família, nunca lista lexical, token set ou regra por alimento em código;
- a materialidade é derivada por construção para identidade e medida por divergência de perfis para nutrição, com override humano auditável como única exceção;
- a `identity_key` da variante é composta apenas por atributos com materialidade `identity | both` na família, impedindo criação acidental de variantes;
- materialidade provisória pode declarar um atributo como material, nunca como imaterial, enquanto a imaterialidade não for verificada.

- a base inicial passa por gate de aceite próprio: estrutura derivada do consumo real, perfil derivado de fonte, cauda longa em quarentena governada;
- o Gate A bloqueia apenas cobertura do consumo real e corpus, e reporta os demais critérios; o Gate B, antes da remoção do legado, bloqueia todos.

## 25. Questões abertas

Permanecem `OPEN` e devem ser decididas nas próximas conversas/etapas antes da implementação correspondente:

1. nomes e schema finais de `FoodObservation` e `FoodResolutionDecision`;
2. thresholds numéricos de confiança e matriz final por tipo de fonte/campo;
3. regras e números mínimos para promoção automática de conhecimento global;
4. papéis/permissões dos revisores;
5. desenho visual detalhado, navegação e composição responsiva da console administrativa, mantendo as responsabilidades definidas na seção 19.2;
6. fórmula numérica de prioridade da fila;
7. política exata para estimativa provisória por categoria;
8. estratégia de embeddings/fuzzy matching e seus thresholds;
9. períodos exatos de retenção de evidências visuais/OCR e política de anonimização na promoção global;
10. SLOs de latência, timeout, número máximo de chamadas e orçamento econômico por resolução/capacidade;
11. percentuais, janelas e limites de divergência/qualidade para avanço ou rollback do canário;
12. compatibilidade/migração de `semanticContract`;
13. momento exato de remoção dos owners/bridges atuais.

14. locale inicial da camada de linguagem e política de fallback entre locales;
15. política de revisão do léxico global e limiar para promoção automática;
16. tratamento de superfície totalmente desconhecida: observação marcada para curadoria ou descarte;
17. limiares de S1/S2 para escalar a S3 e meta de redução de custo de IA;
18. se comandos de operação fazem parte da camada de linguagem ou apenas do parser de operação (§7.1);
19. regra numérica da escada de §9.2 por categoria, especialmente quando a estimativa provisória é permitida;
20. inventário de consumidores downstream de `foodCatalog`, `portions`, favoritos duplicados e macros de identidade antes do cutover;
21. licenciamento, atribuição e permissão de redistribuição por fonte em `food_sources`.

22. tolerância numérica de divergência de perfis por 100 g para derivar materialidade nutricional de um atributo, e tratamento de famílias com poucas variantes para derivar materialidade de identidade.

23. percentual mínimo de cobertura do consumo real, janela de histórico e amostragem usados como critério bloqueante do Gate A;
24. política de promoção de itens em quarentena e prazo para esvaziamento antes do Gate B.

## 26. Regra de evolução deste ADR

Durante a discussão:

- novas decisões devem ser adicionadas aqui;
- pontos ainda debatidos ficam em `OPEN`;
- uma decisão só sai de `OPEN` quando houver consenso explícito ou evidência suficiente;
- nenhuma issue de implementação deve preencher silenciosamente uma questão `OPEN` com escolha arbitrária;
- se a implementação descobrir uma restrição real do repositório, o ADR deve ser atualizado antes de consolidar uma alternativa incompatível.

## 27. Estado de adoção

**Ainda não implementado como arquitetura completa.**

Este ADR começa como contrato de direção. A futura Epic Food Intelligence Resolver V2 e suas subissues deverão referenciar este documento como fonte arquitetural, sem substituir os design docs que descrevem o comportamento produtivo atual até cada migração ser efetivamente concluída.
