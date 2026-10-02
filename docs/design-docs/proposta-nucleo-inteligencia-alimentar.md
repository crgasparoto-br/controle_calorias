# Proposta: Núcleo de Inteligência Alimentar (NIA)

> **Status:** proposta para decisão do dono do produto.
> **Data-base da análise:** 2026-10-02, `develop` = `c30c8f85`.
> **Escopo:** reconhecimento e resolução de alimentos em texto, áudio e imagem, no web e no WhatsApp.
> **Base da implementação, quando aprovada:** branch `develop` de `crgasparoto-br/controle_calorias`, com implementação e auditoria independente pelo processo do repositório `crgasparoto-br/skill`.

---

## 1. Sumário executivo

O sistema não é "burro" por falta de IA. Ele é burro porque **não existe uma identidade de alimento**: existem seis bases de alimentos, treze módulos de comparação textual e um conjunto crescente de listas e constantes embutidas no código. Cada alimento novo que aparece na sua vida encontra uma lacuna nessas listas — e a correção é sempre "acrescentar mais um caso".

A prova disso está no próprio histórico: nas últimas três semanas foram mescladas **180 PRs**, e uma parte relevante delas corrige **um único alimento**: `#1269` (mozarela e mortadela), `#1265` (pêra Packans), `#1216` (Coca-Cola Original), `#1230` (descritores de fritura), `#1233` (ovo e melão), `#1261` (nutrição canônica em contáveis). Nenhuma dessas correções fecha a *classe* de falha: elas fecham o *caso*.

A proposta é substituir a lógica "lista de exceções" por três coisas:

1. **Uma ontologia de alimentos** (conceito → produto → referência nutricional) como fonte única de verdade.
2. **Um único pipeline de resolução**, com a LLM apenas normalizando a linguagem e o código decidindo sobre dados.
3. **Um laço de aprendizado** que transforma cada correção em dado persistente e em caso de regressão — não em `if` novo.

O resultado esperado não é "reconhecer melhor" de forma vaga. É atingir a propriedade que hoje não existe: **a mesma intenção produz a mesma resolução, corrigida uma vez, válida para sempre e para todos os canais**.

---

## 2. Como esta análise foi feita

1. Leitura das issues e PRs mesclados entre **2026-09-11 e 2026-10-02** (`gh issue list`, `gh pr list`).
2. Leitura dos corpos das épicas arquiteturais `#1051`, `#1090`, `#1199` e `#1244`.
3. Leitura do código real: `server/nutritionEngine.ts`, `server/foodItemResolution.ts`, `server/catalogMatching.ts`, `server/mealAiExtraction.ts`, `server/tacoLookup.ts`, `server/foodCatalogReference.ts`, `server/commercialFoodIdentityPreflight.ts`, `server/countableFoodQuantity.ts`, `server/householdMeasureResolution.ts`, módulo `server/modules/whatsapp/*`.
4. Leitura do schema (`drizzle/schema.ts`), dos importadores (`scripts/import-foods/*`) e dos seeds.
5. Leitura das especificações canônicas (`docs/design-docs/nutrition-engine.md`, `global-food-catalog.md`, `docs/product-specs/*`).

---

## 3. Evidência quantitativa

| Métrica | Valor | Leitura |
| --- | --- | --- |
| PRs mescladas em 21 dias | **180** | ~8,6 PRs/dia de churn |
| LOC de produção (`server/` + `shared/`, sem testes) | **139.335** | superfície enorme para o problema de "identificar alimento" |
| LOC de teste | **121.021** (676 arquivos) | testes acompanham a superfície, não a invariante |
| Arquivos de teste com número de issue no nome | **132** | a regressão é organizada por caso, não por classe |
| Arquivos no módulo `whatsapp` (sem testes) | **399** / 44.354 LOC | canal reimplementa domínio |
| Módulos de clarificação/gate/persistência/interação/registry | **66 arquivos** | a pendência é uma máquina de estados por caso |
| Fontes de referência nutricional paralelas | **6** | ver §4.1 |
| Itens no catálogo governado (`foods`, seeds) | **19** (10 + 9) | a governança da `#1199` não abastece o motor |
| Itens em `foodCatalogReference.ts` (array TS estático) | **33** | é o que o motor realmente usa |
| Itens em `tacoCatalog.json` (JSON embarcado) | **616** | terceira fonte, fora do banco |

O dado mais grave é a penúltima e a última linha juntas: a épica de governança da base de alimentos foi mesclada em **28/09**, mas o motor continua resolvendo por um **array de 33 itens** e por um **JSON de 616 itens**. A governança melhorou a curadoria; ela **não chegou ao caminho de resolução**.

---

## 4. Diagnóstico: por que cada correção é pontual

### 4.1 Não existe identidade canônica de alimento — existem seis bases

Hoje "que alimento é este?" é respondido, em paralelo, por:

| # | Fonte | Onde vive | Conteúdo |
| --- | --- | --- | --- |
| 1 | `FOOD_CATALOG_REFERENCE` | `server/foodCatalogReference.ts` (código) | 33 itens curados |
| 2 | TACO | `server/tacoCatalog.json` (código/JSON) | 616 itens |
| 3 | `foodCatalog` | banco | catálogo operacional + cache de pesquisa + itens de usuário |
| 4 | `foods` / `food_aliases` / `food_portions` | banco | catálogo global governado (`#1199`) — praticamente vazio |
| 5 | Constantes curadas | `server/foodItemResolution.ts`, `coffeeSugarNutrition.ts`, etc. | mussarela, presunto, mortadela, linguiça, café, açúcar, ovo (regex) |
| 6 | Aliases e medidas pessoais | `whatsappLearningArtifacts` | por usuário, chaveados por **texto** |

Cada base tem seu próprio matcher, seu próprio formato e sua própria semântica de "marca". Não há uma chave comum entre elas.

### 4.2 A extração não entrega uma identidade resolvível

`mealAiExtraction.ts` devolve `foodName` como **texto livre**, `brand` opcional e uma classificação NOVA. Não devolve:

- um **conceito** (o que é o alimento) nem uma **categoria** de vocabulário controlado;
- **qualificadores estruturados** (preparo: frito/cozido; cultivar: dino/pérola; linha: zero/light; sabor);
- o **papel semântico** de cada token (o que é marca, o que é cultivar, o que é adjetivo culinário).

Sem isso, o código downstream precisa **adivinhar** o papel de cada token. É exatamente o que fazem `identityTokens`, `categoryTokens`, `BROAD_COMMERCIAL_CATEGORY_TOKENS`, `NUTRITIONALLY_NEUTRAL_PACKAGING_TOKENS` e o regex de ovo. O sintoma aparece nas issues `#1224` (descritores culinários tratados como marca), `#1194` (cultivar tratado como marca) e `#1214` (variante de refrigerante).

### 4.3 As decisões de domínio foram escritas como regras léxicas, não como política sobre dados

Exemplos reais do código de produção:

- `BROAD_COMMERCIAL_CATEGORY_TOKENS` — lista fixa de categorias "amplas" (biscoito, cerveja, chocolate, leite, pão…);
- `NUTRITIONALLY_NEUTRAL_PACKAGING_TOKENS` — lista fixa de descritores neutros (uht, lata, garrafa…);
- `CURATED_COMMON_COUNTABLE_PORTIONS` — porções fixas de mussarela, presunto, mortadela e linguiça embutidas no resolvedor canônico;
- regex de ovo (`/^ovos?(?: (?:frit[oa]s?|cozid[oa]s?|mexid[oa]s?))?$/`);
- médias operacionais de café e açúcar em constantes.

Cada item dessas listas é uma **exceção aprendida em produção e congelada no código**. Toda vez que um alimento fora da lista aparece, o sistema erra — e a correção é acrescentar mais um item. Este é o motor do ciclo que você descreve.

### 4.4 A política fail-closed está na camada errada

A `#1244` documenta o sintoma: `6g creatina growth` e a foto de `Leite UHT Integral Itambé` (com marca, variante e volume legíveis) entram em clarificação **embora a informação já exista**. Ao mesmo tempo, itens reconhecidos caíram no placeholder genérico (`150 kcal / 6 g / 15 g / 5 g`) nas issues `#1194`, `#1198` e `#1256`.

Ou seja: o sistema **pergunta quando poderia responder** e **responde quando deveria perguntar**. Isso acontece porque a decisão "tenho informação suficiente?" está espalhada em `decideCommercialNutritionPolicy`, `commercialFoodIdentityPreflight`, `countableFoodRegistrationGate` e mais gates do WhatsApp — cada um com sua própria noção de suficiência.

### 4.5 Semântica duplicada por canal

`#1051`, `#1090` e `#1244` foram três tentativas de unificar o fluxo. Foram entregues como **consolidação de ownership** (um módulo passa a ser dono da decisão), mas o **dado** continuou fragmentado. Resultado: as regressões voltam por outro canal. Exemplos: `#1256` (placeholder reaparece no caminho canônico), `#1271` (adição datada não cria a refeição no caminho de produção), `#1278` (adição com destino antes dos itens), `#1291` (adição sem data grava em outro dia).

Os 66 arquivos de clarificação/gate/persistência/interação no módulo WhatsApp são a medida desse acoplamento.

### 4.6 O aprendizado não compõe

Três problemas concretos:

1. **Chave errada.** O alias pessoal é chaveado por texto (`aliasText` → `canonicalName`). Se você digita, fala ou fotografa o mesmo alimento de outra forma, o aprendizado não é encontrado.
2. **Sem promoção.** `#1153` criou governança de aprendizado, mas não existe caminho operacional fechado de *correção → candidato agregado → revisão → promoção → caso de regressão*. Sem isso, a mesma correção volta.
3. **Aprendizado não gera proteção.** Nenhuma correção sua gera automaticamente um caso no dataset de regressão. Por isso `#1225` reabre `#1059` (café e preferência), `#1196` reabre `#1181` (frutas contáveis) e `#1256` reabre `#1194` (placeholder).

### 4.7 A governança de dados não alimenta a resolução

A épica `#1199` entregou `food_sources`, `food_source_imports`, versionamento, proveniência, fila de revisão de rótulos e a aba administrativa. É trabalho bom e necessário — mas ele alimenta a tabela `foods`, que **o motor não consulta**. O motor consulta o array de 33 itens, o JSON de 616 itens e as constantes. O esforço de governança e o esforço de reconhecimento ainda são universos separados.

---

## 5. Mapa das últimas três semanas: cada issue → sua causa-raiz

| Issue | Sintoma | Causa-raiz |
| --- | --- | --- |
| `#1051` | unificar compreensão adaptativa e aprendizado | CR1, CR2, CR6 |
| `#1054` | fatias com marca no gate de medidas contáveis | CR3 |
| `#1057` | quantidade/unidade perdidas na clarificação | CR5 |
| `#1059` | preferência pessoal de café ignorada | CR6 |
| `#1061` | ACK e resposta após falha/restart | CR5 |
| `#1072` | produto comercial contável rejeitado de forma persistente | CR3 |
| `#1088` | identidade comercial perdida, fallback genérico aceito | CR4 |
| `#1090` | auditoria/simplificação do fluxo end-to-end | CR5 |
| `#1153` | memória pessoal e governança de aprendizado | CR6 |
| `#1158` | comerciais provisórios e promoção de rótulos | CR7 |
| `#1174` | rótulo posterior associado ao item errado | CR5 |
| `#1177` | refeição multi-item perdida com imagem ambígua | CR2 |
| `#1181` | clarificação indevida de peso em fruta contável | CR3 |
| `#1194` | fallback genérico de 150 kcal | CR4 |
| `#1196` | fruta natural contável reabre `#1181` | CR3, CR6 |
| `#1198` | genérico visual exigindo identidade comercial | CR4 |
| `#1199`–`#1206` | governança da base de alimentos | CR7 |
| `#1209` | pendência não retomada após "sim" | CR5 |
| `#1214` | Coca-Cola Original e variantes | CR3 |
| `#1215` | identidade comercial visual perdida | CR2 |
| `#1224` | descritores culinários tratados como marca | CR2, CR3 |
| `#1225` | café volta a ignorar preferência (regressão) | CR6 |
| `#1235` | pendência de rótulo vs. clarificação visual | CR5 |
| `#1243` | leite de marca com identidade visual clara → provisório | CR3, CR4 |
| `#1244` | unificar resolução canônica entre fluxos | CR1, CR5 |
| `#1251` | associação de foto por alimento | apresentação |
| `#1256` | placeholder reaparece após resolução canônica | CR4 |
| `#1257` | picos de memória no WhatsApp | CR5 |
| `#1271` | adição datada não cria refeição configurada | CR5 |
| `#1278` | adição com destino, pontuação, porção de fruta | CR2, CR3 |
| `#1282` | falha do motor deixa mensagem sem resposta | CR5 |
| `#1287` | alimento real do catálogo descartado como ruído | CR2, CR3 |
| `#1291` | adição sem data, medida dependente do motor, cerveja bloqueada | CR3, CR5 |

Legenda — CR1: ausência de identidade canônica · CR2: extração sem identidade resolvível · CR3: regra léxica no lugar de política sobre dados · CR4: fail-closed na camada errada · CR5: semântica duplicada por canal · CR6: aprendizado que não compõe · CR7: governança desconectada do motor.

**Leitura do mapa:** a esmagadora maioria é CR1–CR4 e CR6. Nenhuma quantidade de correções pontuais fecha esses buracos, porque **os buracos não estão nos alimentos; estão na ausência de um modelo**.

---

## 6. Proposta: Núcleo de Inteligência Alimentar (NIA)

### 6.0 Princípios

1. **Dado, não regra.** Nenhuma lista de marcas, alimentos, descritores ou porções dentro do código de produção. Toda exceção vira dado governado.
2. **A LLM normaliza; o código decide.** A LLM traduz linguagem e imagem para um contrato estruturado. Aceitação, porção e composição são decisões determinísticas sobre dados.
3. **Uma identidade para todos os canais.** Texto, áudio, imagem e web produzem o mesmo `FoodInterpretation` e consomem o mesmo resolvedor.
4. **Fail-closed estreito, fail-open informado.** Bloqueia apenas composição **comercial** sem referência compatível; para alimento genérico, estima de forma transparente em vez de perguntar.
5. **Perguntar é exceção, não default.** No máximo uma pergunta por dimensão realmente ausente, sempre com as alternativas vindas do dado.
6. **Aprender é persistir.** Toda correção confirmada vira dado (pessoal) e candidato (global); toda correção vira caso de regressão.
7. **Versionar e desfazer.** Toda fase entra atrás de feature flag, com caminho de rollback.

### 6.1 Modelo de dados: conceito → produto → referência

O coração da proposta. Hoje não existe a hierarquia; tudo é misturado em `foodCatalog`/`foodCatalogReference`.

```text
food_concepts           — O QUE é o alimento (identidade canônica)
  id, slug, canonical_name, category_code (taxonomia controlada)
  variant_axes            (JSON) ex.: ["linha","sabor"] | ["sabor"] | []  <- quando a variante é materialmente necessária
  default_unit, default_portion_grams, density_g_per_ml
  accepts_generic_reference (bool)  <- pode usar referência genérica do próprio conceito?
  parent_concept_id       ex.: "pera pérola" -> "pera"
  is_branded_family (bool) ex.: "refrigerante de cola" é família de marca
  status, created_at, updated_at

food_products           — O PRODUTO comercial (SKU)
  id, concept_id, brand_id, variant_values (JSON), barcode, package_size_g,
  status, provenance

food_references         — A COMPOSIÇÃO nutricional (versionada, com proveniência)
  id, concept_id | product_id, basis (per_100g | per_serving),
  kcal, protein, carbs, fat, fiber, sugar, sodium, nutrients_json,
  portion_label, portion_grams, is_default,
  source_id (TACO | TBCA | rótulo | curadoria | pesquisa web | OFF),
  evidence, source_url, content_hash,
  verified_by, verified_at, valid_from, valid_until, status

food_portions           — MEDIDAS caseiras por conceito/produto
  id, concept_id | product_id, unit_label, quantity, grams, kind
  kind ∈ {canonical, researched_exact, usual_average, contextual_estimate, user_learned}
  user_id (null = global), source_id, provenance

food_aliases            — NOMES alternativos → conceito/produto
  id, concept_id | product_id, alias, normalized_alias,
  scope ∈ {global, user}, user_id, origin ∈ {seed, imported, label, learned, reviewed},
  confidence, hit_count, status

food_resolution_events  — DECISÕES (telemetria + replay + corpus)
  id, user_id, input_type, interpretation_json, resolution_json,
  outcome ∈ {resolved, clarified, estimated, rejected}, latencies, cost, prompt/model versions

food_learning_candidates — APRENDIZADO agregado
  id, key (concept_id/product_id + slot + value), occurrences, distinct_users,
  conflicts, status ∈ {collecting, ready_for_review, promoted, rejected}

food_clarification_slots — PENDÊNCIA genérica
  id, user_id, target_ref, slot ∈ {identity, variant, quantity, nutrition},
  candidates_json, created_at, resolved_at
```

**Migração das fontes atuais para a ontologia:**

| Origem | Destino |
| --- | --- |
| `tacoCatalog.json` (616) | `food_references` com `source = TACO` + `food_concepts` |
| `foodCatalogReference.ts` (33) | `food_concepts` + `food_references` com `source = curadoria` |
| `foodCatalog` (banco) | `food_concepts`/`food_products`/`food_references`; manter apenas como cache de pesquisa versionado |
| `foods` + seeds (19) | idem, preservando proveniência da `#1199` |
| `CURATED_COMMON_COUNTABLE_PORTIONS` | `food_portions` com `kind = canonical` |
| Constantes de café/açúcar/ovo | `food_concepts` + `food_portions` (nenhuma constante em código) |

A tabela `foods` da `#1199` não é descartada: ela é a **origem governada** que passa a alimentar a ontologia. O trabalho da épica é preservado e passa a ter efeito no reconhecimento.

### 6.2 Pipeline único

```text
entrada (texto | áudio | imagem | web)
  │
  ├─ 1. ADAPTAÇÃO DE CANAL            transcrição, OCR, anotação, normalização
  │
  ├─ 2. INTERPRETAÇÃO SEMÂNTICA       LLM, contrato v2  →  FoodInterpretation[]
  │
  ├─ 3. RESOLUÇÃO CANÔNICA            código, owner único → FoodResolution
  │       3a. candidatos    barcode │ alias exato │ produto │ vetor (conceito) │ referência │ rótulo OCR │ pesquisa web
  │       3b. aceitação     score + política de suficiência (§6.4)
  │       3c. quantidade    massa/volume > porção canônica > medida do conceito > memória > média curada > clarificação
  │       3d. composição    referência específica > referência genérica do conceito > estimativa marcada
  │       3e. pendências    no máximo 1 pergunta por slot (§6.5)
  │
  ├─ 4. APRESENTAÇÃO E CONFIRMAÇÃO    resposta única, com procedência
  │
  └─ 5. PERSISTÊNCIA                  snapshot nutricional + food_resolution_events
                                      + (se correção) food_learning_candidates
```

Nada além desse caminho decide identidade, quantidade ou composição. Os gates do WhatsApp viram **adaptadores de entrada/saída** — exatamente o limite já declarado na `#1244`, mas agora sustentado por um **dado único**.

### 6.3 Contrato de interpretação semântica v2 (o que a LLM deve devolver)

Substitui o `LlmItem` atual. A diferença essencial: a LLM devolve **estrutura**, não texto livre.

```jsonc
{
  "mentions": [
    {
      "surface": "1 pêra packans",
      "conceptCandidate": "pera",          // o que o alimento É
      "category": "fruta",                 // taxonomia controlada
      "qualifiers": {                      // papel semântico explícito de cada token
        "preparation": null,
        "cultivar": null,
        "line": null,
        "flavor": null
      },
      "brand": "Packans",                  // marca, quando houver
      "productFamily": null,
      "quantity": 1,
      "unit": "un",
      "portionText": "1 unidade",
      "processingLevel": "natural_or_minimally_processed",
      "searchTerm": "pera",                // termo normalizado para busca no conceito
      "alternatives": [                    // quando a LLM hesita, ela lista — não chuta
        { "conceptCandidate": "pera", "confidence": 0.7 },
        { "conceptCandidate": "maçã", "confidence": 0.2 }
      ],
      "evidence": { "concept": "text", "quantity": "text", "brand": "text" },
      "confidence": 0.9
    }
  ]
}
```

Ganhos diretos:

- **`qualifiers` com papel explícito** elimina `BROAD_COMMERCIAL_CATEGORY_TOKENS`, `NUTRITIONALLY_NEUTRAL_PACKAGING_TOKENS` e a regex de ovo — ninguém precisa mais adivinhar se "frito" é marca ou preparo.
- **`category` de vocabulário controlado** elimina o "é fruta? é vegetal? é processado?" decidido por heurística.
- **`alternatives`** torna a ambiguidade um dado, não um erro — a clarificação passa a ser escolha entre candidatos reais.
- **`searchTerm`** separa "o que o usuário disse" de "o que devo buscar", fechando a classe de bug de `#1287` (texto virando ruído) e `#1224` (descritor virando marca).
- **`evidence` por campo** preserva a procedência exigida pela `#1051` e pela `#1090`.

### 6.4 Política de suficiência — sobre dados, não sobre listas

Esta é a substituição direta de `decideCommercialNutritionPolicy` e seu batalhão de token sets.

```text
resolve(interpretation):
  concept = matchConcept(interpretation)            # alias exato → vetor → fuzzy controlado

  se concept == null:
      → pendência: identity (candidatos = vetor top-N)

  se interpretation.brand == null:
      ref = specificReference(concept) ?? genericReference(concept)
      se ref == null → pendência: nutrition
      senão → RESOLVIDO (composição = ref, procedência explícita)

  # produto comercial
  product = matchProduct(concept, brand, qualifiers)
  se product != null:
      ref = specificReference(product)
      senão → pendência: nutrition (nunca macro genérico apresentado como oficial)

  # marca sem produto exato
  eixos = concept.variant_axes
  se eixos está vazio:                       # a marca não muda a composição de forma material
      ref = genericReference(concept)
      ref == null ? pendência: nutrition : RESOLVIDO(provisional_marked = false, genérico)
  senão:
      variantes = variantsOf(concept)  existentes no dado
      se variantes == 1 → RESOLVIDO(provisional_marked = true)
      senão → pendência: variant (candidatos = variantes do dado, nunca inventadas)
```

Compare com o código atual: as 6 regras numeradas dentro de `decideCommercialNutritionPolicy` (com `hasSpecificCommercialProductName`, `findCompatibleGenericReferenceForCommercialIdentity`, listas de categoria ampla e descritores neutros) colapsam em **uma política sobre `variant_axes` e `accepts_generic_reference`** — dois campos de dado.

Resolve diretamente: `#1243` e `#1244` (identidade visual clara deixa de virar pendência), `#1214` (variante de refrigerante é dado), `#1198` e `#1194` (genérico estima em vez de pedir), `#1088` (comercial sem referência continua fail-closed, agora por dado).

### 6.5 Clarificação unificada por slot

Hoje há dezenas de fluxos de clarificação. Proposta: **um único mecanismo**, com quatro slots.

| Slot | Quando | O que a mensagem pergunta |
| --- | --- | --- |
| `identity` | conceito não reconhecido | "Não reconheci. É um destes?" com candidatos reais |
| `variant` | marca existe, `variant_axes` não resolvido | "Qual destes?" com as variantes que existem no dado |
| `quantity` | unidade presente, gramatura não resolvível | "Quantos gramas / qual medida?" com as medidas suportadas |
| `nutrition` | identidade certa, composição indisponível | "Envie a foto do rótulo" ou aceitar estimativa marcada |

Uma pendência por vez, persistida por `(user, target_ref, slot)`, retomável por "sim" (`#1209`) e por foto posterior (`#1235`, `#1174`). Isso substitui os 66 arquivos de clarificação/gate por **um** mecanismo com quatro variações de apresentação.

### 6.6 Resolução de quantidade

Mantém a precedência já documentada, mas **com a fonte vindo da ontologia**:

```text
massa/volume explícitos
  → porção canônica do conceito (food_portions.kind = canonical)
  → referência exata da medida (researched_exact)
  → medida pessoal aprendida (user_learned, por user + conceito + unidade)
  → média usual curada do conceito (usual_average)
  → estimativa contextual (contextual_estimate, marcada)
  → clarificação de quantity
```

`#1043`, `#1054`, `#1072`, `#1181`, `#1196`, `#1278` e `#1269` pertencem todos a esta única precedência. Com a porção no dado, o mesmo `1 ovo frito = 50 g` vale para web, WhatsApp, adição, imagem e simulador — porque **não há mais de onde tirar outro valor**.

### 6.7 Aprendizado que compõe

```text
usuário corrige/confirma
  → food_resolution_events (sempre)
  → memória pessoal chaveada por (user_id, concept_id | product_id, slot)
      alias:   texto → conceito
      porção:  unidade → gramas
  → food_learning_candidates (agregação por chave, com distinct_users e conflitos)
  → fila de revisão administrativa (a que já existe desde #1206)
  → promoção global (alias, porção, conceito)
  → corpus golden de regressão (caso criado automaticamente)
```

Mudanças essenciais em relação ao estado atual:

1. **Chave por identidade, não por texto** — o mesmo aprendizado vale para texto, áudio e imagem.
2. **Uma ocorrência nunca promove** (mantido da `#1153`), mas agora existe o caminho operacional completo até a promoção.
3. **Toda correção vira teste** — fecha a classe, não o caso. É isso que impede `#1225` de reabrir `#1059`.

### 6.8 Observabilidade e métricas de inteligência

O sistema precisa medir a própria inteligência para parar de depender de relato de bug. Métricas mínimas:

| Métrica | Meta |
| --- | --- |
| Taxa de resolução direta (sem clarificação) | ≥ 90 % dos registros |
| Clarificação por slot (identity / variant / quantity / nutrition) | queda monotônica por release |
| Acurácia de conceito (amostragem auditada + correções) | ≥ 95 % |
| Perda de marca / contaminação de variante | 0 casos confirmados por release |
| Uso de estimativa marcada | estável e rastreável |
| Latência p95 e custo por registro | orçamento definido, sem regressão |
| Regressões reabertas da mesma classe | **0** |

Tudo isso já existe parcialmente (`qualityMetrics.ts`, `feedbackLoop.ts`, `inferenceLogs`, `whatsappAnalysis`); a mudança é **usar as métricas como critério de release**, não como relatório.

---

## 7. Por que isso encerra o ciclo

| Classe de bug (exemplos) | Hoje | Com o NIA |
| --- | --- | --- |
| Descritor tratado como marca (`#1224`, `#1194`) | token sets + regex | `qualifiers` estruturados; deixa de existir a adivinhação |
| Variante comercial escolhida errada (`#1214`, `#1088`) | lista de categorias amplas | `variant_axes` do conceito |
| Identidade clara virando pendência (`#1243`, `#1244`) | gates paralelos | política única sobre dado |
| Placeholder genérico (`#1194`, `#1256`) | fallback heurístico | composição vem de referência; estimativa é marcada, nunca silenciosa |
| Porção de fruta/ovo/mortadela (`#1181`, `#1196`, `#1269`) | constantes curadas | `food_portions` no dado |
| Mesmo bug volta por outro canal (`#1225`, `#1256`, `#1271`, `#1278`) | semântica por canal | interpretação + resolução únicas |
| Alimento real descartado (`#1287`) | prompt gigante + filtro léxico | `mentions` estruturadas; `searchTerm` separado do texto |
| Governança sem efeito (`#1199`–`#1206`) | catálogo governado vazio | ontologia é a fonte do motor |

A propriedade-chave: **uma correção feita uma vez passa a valer para todos os alimentos daquela classe, em todos os canais, permanentemente** — porque a correção altera *dado* (um conceito, um eixo de variante, uma porção, um alias), e não um `if`.

---

## 8. Plano de migração por fases

Todas as fases: implementação → **auditoria independente** (skill `auditar-issue` do repositório `crgasparoto-br/skill`) → correção até aprovação → merge em `develop`. Ao final, PR de `develop` → `main`. Cada fase é uma issue rastreável com critérios de aceite próprios; nenhuma fase altera comportamento visível sem feature flag.

| Fase | Entrega | Issues propostas | Critério de saída |
| --- | --- | --- | --- |
| **F0 — Fundação** | corpus golden replayável, telemetria baseline, feature flags, matriz canal×capacidade | 4 | baseline medido; corpus com ≥ 200 turnos reais anonimizados |
| **F1 — Ontologia** | tabelas `food_concepts/products/references/portions/aliases`; ETL TACO/TBCA/curadoria/industrializados/rótulos; backfill de `foods` e `foodCatalog`; taxonomia de categorias; API de busca por conceito | 5 | 100 % das fontes migradas; paridade de resultado com o motor atual em modo sombra |
| **F2 — Interpretação v2** | contrato `FoodInterpretation`; prompt/schema v2; modo sombra comparando com v1 | 3 | divergência v1×v2 medida e explicada; nenhuma regressão no corpus |
| **F3 — Resolvedor único** | resolução candidato→score→aceitação; política de suficiência; adaptadores por canal consumindo o mesmo resolvedor | 5 | paridade entre web/WhatsApp/adição/imagem/simulador nos golden flows; `#1244`, `#1243`, `#1214`, `#1224`, `#1287` fechados por design |
| **F4 — Clarificação unificada** | 4 slots; pendência persistida; retomada por "sim" e por foto | 3 | `#1209`, `#1235`, `#1174`, `#1291` cobertos; queda mensurável de clarificações |
| **F5 — Aprendizado e curadoria** | memória por identidade; candidatos agregados; fila de revisão; promoção; geração automática de casos de regressão | 4 | correção → promoção ponta a ponta; `#1153`, `#1205`, `#1206` integrados |
| **F6 — Remoção do legado** | exclusão de token sets, constantes curadas, gates paralelos, stores duplicados e código morto | 3 | −X k LOC; nenhum consumidor órfão; todos os testes verdes |

**Ordem recomendada:** F0 → F1 → F2 → F3 (F0–F3 são o núcleo; F4–F6 fecham a dívida).

**Esforço estimado:** F0–F1 são fundação (peso maior); F2–F3 são o coração; F4–F6 são conclusão. A granularidade fina deve sair do refinamento de cada issue, não desta proposta.

---

## 9. Riscos e como tratá-los

| Risco | Mitigação |
| --- | --- |
| Custo e latência de LLM aumentam | interpretação única por turno (já é o caso); cachê de conceito por `searchTerm`; modo sombra antes de trocar |
| Qualidade da ontologia (categorias, eixos de variante) definida errado | curadoria com revisão administrativa (já existe desde `#1199`); eixos ajustáveis por dado, sem deploy |
| Migração de registros históricos | snapshot nutricional dos `mealItems` é intocável; ontologia só resolve novos registros |
| Perda de cobertura durante a transição | sombra de F2/F3 com paridade obrigatória no corpus golden antes de ativar a flag |
| Regressão silenciosa em produção | feature flag por canal, rollback imediato, métricas de §6.8 como gate de release |
| Divergência entre web e WhatsApp | proibição explícita de reinventar decisão em handler; teste de paridade no corpus por canal |

---

## 10. Decisões que precisam de você (dono do produto)

1. **Escopo inicial da ontologia:** cobrir tudo (TACO + TBCA + industrializados) logo na F1, ou começar por um recorte (frutas, ovos, pães, bebidas, cafés) e expandir?
2. **Estimativa marcada:** pode aparecer no registro do dia a dia (com indicação clara de aproximação) ou você prefere que o sistema sempre pergunte quando não tiver referência?
3. **Open Food Facts:** entra como fonte de referência da ontologia (opt-in, atrás de revisão) ou fica fora nesta rodada?
4. **Quem revisa a fila de aprendizado/curadoria:** você mesmo, ou ela deve ficar apenas como sinal automático?
5. **Meta de qualidade:** concorda com a meta de ≥ 90 % de resolução direta e 0 regressões reabertas da mesma classe como critério de release?

---

## 11. Critérios de sucesso (Definition of Done da transformação)

- [ ] Existe **uma** fonte de verdade para identidade de alimento; nenhum array, JSON ou constante de alimento no código de produção.
- [ ] A mesma intenção produz a mesma resolução em texto, áudio, imagem, web, WhatsApp, adição, edição e simulador.
- [ ] Nenhuma lista de marcas, alimentos, descritores ou porções no código.
- [ ] Toda correção confirmada vira dado persistente e caso de regressão automático.
- [ ] Nenhuma regressão reaberta da mesma classe em um ciclo de release.
- [ ] ≥ 90 % dos registros resolvidos sem clarificação.
- [ ] Comercial sem referência compatível permanece fail-closed; genérico estima de forma marcada.
- [ ] Proveniência (fonte, evidência, data, verificação) rastreável para toda composição usada.
- [ ] Queda mensurável de LOC de produção e de arquivos de clarificação/gate.

---

## Apêndice A — Inventário do que deve desaparecer ou ser absorvido

**Absorvido pela ontologia (dado):**

- `server/foodCatalogReference.ts` (array de 33)
- `server/tacoCatalog.json` (616) → `food_references` (TACO)
- `CURATED_COMMON_COUNTABLE_PORTIONS` (mussarela, presunto, mortadela, linguiça)
- constantes de café/açúcar (`coffeeSugarNutrition.ts`) e regex de ovo
- seeds `common_brazil_foods.seed.json` e `alimentos_industrializados_brasil.json`

**Absorvido pela política de suficiência (lógica):**

- `BROAD_COMMERCIAL_CATEGORY_TOKENS`, `NUTRITIONALLY_NEUTRAL_PACKAGING_TOKENS`, `identityTokens`, `categoryTokens`, `hasSpecificCommercialProductName`, `findCompatibleGenericReferenceForCommercialIdentity`
- `server/commercialFoodIdentityPreflight.ts` (152 LOC)
- parte de `server/foodSemanticCompatibility.ts` (248 LOC)

**Absorvido pelo resolvedor por candidatos:**

- duplicação de matchers entre `catalogMatching.ts` (859), `tacoLookup.ts`, `catalogSemanticSearchCore.ts` (692)
- `countableFoodRegistrationGate.ts` e suas 6 suítes `issueXXXX.test.ts` → um único gate
- os 66 arquivos de clarificação/gate/persistência/interação/registry → 1 mecanismo com 4 slots

**Absorvido pela interpretação v2:**

- o bloco de ~40 instruções ad-hoc do prompt em `mealAiExtraction.ts` (incluindo o "Exemplo obrigatório: PÃO DE CENOURA")
- filtros léxicos downstream (`shouldConstrainAiItemsToText`, `filterAiItemsBySourceText`, `sourceSegmentOnlyAddsStructuredBrand`, `preserveSpecificSourceFoodNames`)

---

## Apêndice B — Referências internas

- `docs/design-docs/nutrition-engine.md` — contrato atual do motor nutricional e fronteira canônica `#1244`
- `docs/design-docs/global-food-catalog.md` — modelo de `foods`/`food_aliases`/`food_portions`
- `docs/product-specs/meal-registration.md` — contrato semântico multimodal
- `docs/product-specs/whatsapp-flow.md` — fluxo do canal
- Issues-base: `#1051`, `#1090`, `#1199`, `#1244`