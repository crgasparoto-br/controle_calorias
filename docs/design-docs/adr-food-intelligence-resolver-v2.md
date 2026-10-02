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

O modelo físico exato ainda poderá ser refinado, mas a separação de responsabilidades abaixo passa a ser decisão arquitetural.

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
2. nomes físicos finais/índices/check constraints das tabelas V2;
3. detalhes de versionamento e vigência de `food_nutrition_profiles`;
4. thresholds de confiança;
5. regras automáticas de promoção global;
6. papéis/permissões dos revisores;
7. desenho da tela administrativa;
8. fórmula de prioridade;
9. política exata para estimativa provisória por categoria;
10. estratégia de embeddings/fuzzy matching;
11. retenção de evidências visuais e impacto LGPD;
12. rollout/canário e métricas de sucesso;
13. compatibilidade/migração de `semanticContract`;
14. momento exato de remoção dos owners/bridges atuais.

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
