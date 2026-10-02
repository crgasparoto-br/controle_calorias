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

### 8.12. Gate de corte do banco

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

## 10. Política de incerteza

Princípio:

> Nunca perguntar o que o sistema já sabe, nunca inventar o que não sabe e perguntar somente o campo realmente faltante.

Exemplos:

- identidade conhecida + quantidade ausente -> perguntar quantidade;
- produto e quantidade conhecidos + nutrição comercial ausente -> solicitar rótulo ou usar estimativa provisória somente quando a política permitir;
- duas variantes plausíveis -> perguntar variante;
- três itens na imagem, dois resolvidos e um ambíguo -> preservar os dois e perguntar somente o terceiro;
- imagem ilegível -> não inventar alimento.

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

### 12.1. Provisório não significa inutilizável

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

## 25. Questões abertas

Permanecem `OPEN` e devem ser decididas nas próximas conversas/etapas antes da implementação correspondente:

1. nomes e schema finais de `FoodObservation` e `FoodResolutionDecision`;
2. thresholds de confiança;
3. regras automáticas de promoção global;
4. papéis/permissões dos revisores;
5. desenho da tela administrativa;
6. fórmula de prioridade;
7. política exata para estimativa provisória por categoria;
8. estratégia de embeddings/fuzzy matching;
9. retenção de evidências visuais e impacto LGPD;
10. rollout/canário e métricas de sucesso;
11. compatibilidade/migração de `semanticContract`;
12. momento exato de remoção dos owners/bridges atuais.

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
