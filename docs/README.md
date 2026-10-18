# Documentação do projeto

Este diretório reúne a documentação canônica do Controle de Calorias. Use este índice antes de criar novos documentos para evitar duplicidade entre plano, especificação e registro técnico.

## Documentos raiz

| Documento            | Uso                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `../README.md`       | Visão geral do produto, stack e configuração inicial.                                      |
| `../ARCHITECTURE.md` | Fronteiras de camadas, áreas de experiência, regras de dependência e direção arquitetural. |
| `../AGENTS.md`       | Guia obrigatório para agentes e automações.                                                |
| `../CONTRIBUTING.md` | Gates de validação, critérios antes de PR e comandos mínimos por tipo de mudança.          |

## Especificações de produto

Use `docs/product-specs/` para regras funcionais, critérios de aceite e comportamento esperado por domínio.

| Área                                         | Documento                                          |
| -------------------------------------------- | -------------------------------------------------- |
| Modelo do produto e separação dos fluxos     | `product-specs/product-experience-model.md`        |
| Decisões comerciais de billing               | `product-specs/billing-commercial-decisions.md`    |
| Registro de refeições                        | `product-specs/meal-registration.md`               |
| Metas, Hoje, Registros e Relatórios          | `product-specs/goals-and-reports.md`               |
| Privacidade, exportação e exclusão           | `product-specs/privacy-export-deletion.md`         |
| Área Profissional, vínculos e acompanhamento | `product-specs/professionals.md`                   |
| Integrações de saúde / Strava                | `product-specs/health-integrations.md`             |

`product-experience-model.md` é a fonte canônica para:

- posicionamento comercial centrado no nutricionista;
- coexistência entre Área do Paciente e Área Profissional;
- preservação da experiência individual já desenvolvida;
- classificação de issues entre experiência atual, plataforma compartilhada, programa profissional e billing.

`billing-commercial-decisions.md` registra as decisões vinculantes consolidadas pela #145. Preços, capacidades, ciclos, meios de pagamento e matriz inicial são implementados pelo catálogo versionado da #891; provider real, cobrança e ativação de `BILLING_ACCESS_MODE=enforced` continuam condicionados às subissues e gates correspondentes.

## Design técnico

Use `docs/design-docs/` para decisões técnicas, contratos internos e detalhes de implementação que complementam as specs de produto.

Exemplos principais:

- `design-docs/nutrition-engine.md`
- `design-docs/adr-food-intelligence-resolver-v2.md` — ADR em evolução para a arquitetura alvo de resolução alimentar multimodal, governança e aprendizado.
  - Para implementação atual, leia também `design-docs/nutrition-engine.md`; o ADR define a arquitetura alvo e não reescreve retroativamente o baseline produtivo.
  - Gates da onda 1 (#1300): `pnpm architecture:check` **reprova violações novas** de código produtivo em relação ao SHA pré-migração registrado; conserva candidatos heurísticos legados como avisos de triagem, enquanto violações legadas confirmadas sem dívida nominal falham o gate. Sem autoexceção. `pnpm food-architecture:report` gera inventário por SHA, comparação `develop`, classes §9.3 e dívida vigente. O inventário inicial de owners está em `design-docs/food-architecture-owners-1300.json` (9 fontes revisadas, 8 confirmadas, incluindo o catálogo JSON TACO por SHA; o restante é candidato heurístico sem dívida automática) e o livro versionado em `architecture-debt.json` (owner, issue, prazo máximo de 90 dias, sem renovação; vencida/órfã falha). O relatório por HEAD classifica individualmente todos os achados e vincula somente dívidas nominais confirmadas. Na correção AUD1300-20261017-F40, `SAFE_TYPO_REPLACEMENTS` (WhatsApp) foi confirmado por fluxo de fonte no SHA legado, associado à migração #1304 e retirada #1313, com vencimento nominal em 2027-01-15; a confirmação estática não certifica a equivalência comportamental do resolvedor. O item 25 da ADR foi decidido em 2026-10-12: testes, fixtures isoladas, código gerado inerte e documentação não bloqueiam, mas artefatos carregados em runtime não estão isentos. O item 26 regula **somente os gates de runtime 6/8/15**: sete dias completos de observação sem violações, evidência, rollback testado e aprovação explícita antes de habilitar cada bloqueio. Os gates lexicais identificam regex decisórias via `test/exec/match/search/matchAll` e vocabulários literais compartilhados/importados quando consumidos por decisões alimentares (sem bloquear listas administrativas ou fixtures isoladas). Os controles adversariais incluem constantes numéricas e objetos alimentares inline (inclusive `foodId` com porção/macros), decisões de materialidade em handlers sem depender do nome do arquivo, imports/reexports estáticos ou dinâmicos de módulos TS/JS gerados e fixtures efetivamente carregados e comparação multiconjunto de fingerprints (duas ocorrências idênticas não equivalem a uma). O JSON do relatório inclui `triage.pending`, fila por fingerprint e SHA dos candidatos legados que exigem evidência individual, sem aprovação automática de dívida. Catálogos nutricionais `.json` em áreas produtivas (inclusive fixtures/gerados importados em runtime) também passam pelos gates 17/5, com fingerprint do conteúdo normalizado; alterações de dados são novas violações. Objetos TS/JS com identidade alimentar dinâmica e macros literais são analisados; strings de UI meramente apresentacionais não são conhecimento alimentar. Arquivos JSON alimentares carregados via caminhos construídos a partir de `process.cwd()` também são escaneados. Os gates 17/5 detectam mapas numéricos exportados por default e por reexportação nomeada/alias, inclusive barrels transitivos, quando usados em decisão alimentar. Mapas numéricos em JSON com nome neutro (por exemplo, `server/weights.json`) também são classificados como conhecimento alimentar quando o import default, inclusive por alias local, é efetivamente indexado por identidade alimentar (`weights[foodName]`); import somente de tipo, mapeamento não consumido e acesso por status/conta/exercício não sustentam essa classificação. O gate 17 bloqueia retornos de porção/macros numéricos diretos, condicionais e aritméticos. Dívidas legadas confirmadas pelo inventário de fonte imutável não podem ser retiradas antes da remoção da violação, ainda que o primeiro livro não exista na `develop`. A fila R1300-05 de candidatos heurísticos permanece rastreável por fingerprint e exige revisão comportamental individual, sem aprovação automática de owner ou dívida.
  - Remediação AUD1300-20261017-F42 (gate 17): chaves de contexto computadas (`["brunch"]`, template literal e chave dinâmica) em catálogos literais de sugestões alimentares também são detectadas pelo pré-filtro e AST quando consumidas por recomendações produtivas, inclusive via import/alias. Preservados os controles negativos de ações de UI, status administrativo e catálogos não consumidos; regressões verificam findings e bloqueio em `evaluateFoodArchitectureGate`.
  - Remediação AUD1300-20261017-F45 (gate 17): o pré-filtro de catálogos alimentares usa somente tokens necessários (`:` e `[`) para não excluir arrays literais separados da chave por parênteses, comentários, `as const` ou chaves computadas; a classificação continua baseada no AST e no consumo produtivo, sem bloquear menus de status, ações de UI ou fontes inertes. Os controles positivos e negativos estão em `scripts/food-architecture-meal-choice-catalog.test.ts`.
  - Remediação AUD1300-20261017-F43/F44 (gate 17): catálogos de sugestões alimentares com campos dinâmicos e `...spread` (inclusive spread literal aninhado) não ocultam as opções literais que alcançam um consumidor produtivo; listas exclusivamente dinâmicas e ações de UI não se tornam violações por inferência. O pré-filtro de chaves computadas agora aceita expressões multilinha e sem limite arbitrário de 80 caracteres, inclusive quando o catálogo é importado por alias; o AST e o consumo produtivo continuam sendo a prova de domínio. Cenários adversariais positivos e negativos estão em `scripts/food-architecture-meal-choice-catalog.test.ts` e cobrem detecção e bloqueio por `evaluateFoodArchitectureGate`. A triagem de dívida, o SHA legado e os gates de runtime permanecem inalterados.
  - Remediação AUD1300-F41 (gate 17): catálogos estáticos de sugestões alimentares usam a forma dos dados e a evidência do consumidor produtivo; novos nomes de contexto (por exemplo, `brunch` e `merenda`) não isentam um menu fixo. O rastreamento de imports, acesso por propriedade/colchetes e desestruturação usa as chaves efetivamente declaradas, sem limitar a identificação a uma lista fechada de refeições. Testes negativos preservam UI, status administrativos e catálogos não consumidos. A triagem de legado continua vinculada ao SHA imutável e não é certificação comportamental.
  - Remediação AUD1300-20261017-F36 (gate 17): catálogos estáticos de sugestões por refeição são rastreados pelo consumo em recomendações produtivas, inclusive quando declarados no módulo, acessados por aliases imutáveis, delegados a helpers ou importados/reexportados. O finding pertence à declaração de origem e falha para novo hardcode no baseline; menus de ações de UI, catálogos não consumidos, imports apenas de tipos e dados administrativos permanecem controles negativos. As regressões exercitam `findFoodStaticCandidates` e `evaluateFoodArchitectureGate`, e a revisão independente continua obrigatória após CI do SHA material.
  - Remediação AUD1300-20261017-F37/F38/F39 (gate 17): o detector de catálogos estáticos por contexto acompanha acesso a propriedade/colchetes, destructuring `const`, aliases, `Object.values` nativo e projeções que preservam sugestões até a saída produtiva. O consumidor não depende de prefixos de verbos: funções do domínio alimentar e entradas exportadas do servidor são avaliadas pelo fluxo real de dados. Uma única sugestão literal já constitui hardcode bloqueante; listas vazias, ações de UI, status/atividades administrativos, `Object` sombreado, importações somente de tipos e catálogos não consumidos não geram finding espúrio. Regressões positivas e negativas em `scripts/food-architecture-meal-provenance-remediation.test.ts` e reprodutor original da auditoria; não altera `architecture-debt.json`, baseline, nem gates de runtime.
  - Remediação da auditoria AUD1300-F01/F02/F03: dicionários lexicais importados e reexportados percorridos por `Object.entries/keys/values` ou `reduce` são rastreados até decisões alimentares; catálogos JSON genéricos seguem aliases locais e transformações `map/reduce` até predicados de identidade alimentar; fontes executáveis importadas de `dist/` e `build/` permanecem elegíveis para a varredura, embora artefatos inertes não bloqueiem. Testes adversariais incluem controles negativos de conta, exercício, arquivo isolado e tabela de dívida. A revisão R1300-01 continua por fingerprint em `triage.pending`: uma âncora de fonte não é certificação comportamental nem aprovação automática de dívida.
  - Endurecimento de deteccao da Issue #1300 (A1300-42/43/44): dicionarios lexicais aplicados por iteracao `Object.entries/keys/values` e substituicao de texto tambem sao candidatos de regra produtiva, mesmo com nome de variavel generico; catalogos JSON consumidos por identidade alimentar e carregados de `node:fs/promises`, `fs/promises` ou `fs.promises.readFile` entram no inventario quando o caminho e estaticamente demonstravel. A associacao de mapas importados e feita por escopo lexical para que parametros, valores de banco e aliases homonimos nao herdem equivocadamente a origem de um import. Caminhos dinamicos ou sem prova de origem exigem revisao complementar; o silencio do detector nao equivale a autorizacao de hardcode. Testes adversariais positivos e negativos acompanham os tres controles.
  - Remediação #1300 (A1300-45/46/47): os gates estáticos incluem decisões lexicais alimentares por `String.includes/startsWith/endsWith`, arrays JSON de aliases de alimentos em fontes produtivas ou alcançadas pelo runtime, e restringem a isenção de owner ao contrato existente `server/foodItemResolution.ts#resolveCanonicalFoodQuantity`. Um novo resolvedor em outro arquivo, inclusive `foodIntelligenceV2/`, não recebe autorização implícita. Os verificadores mantêm negativos de conta, status, apresentação e fixtures isoladas. A fila comportamental R1300-05 continua exigindo evidência independente por candidato; o inventário por SHA não certifica comportamento.
  - Remediação A1300-52/53/54: retornos de apenas um macronutriente/caloria literal em funções de decisão alimentar entram no gate 17; propriedades de classe e objetos que declaram resolvedores alternativos entram nos gates 1/2 (delegação pura para o import canônico é permitida). Leitura de JSON por `node:fs` com caminho opaco e `import()` dinâmico no contexto decisório alimentar produzem finding de gate 17, sem isentar fixture/gerado consumido em runtime; configurações e dados administrativos não alimentares continuam fora do bloqueio. R1300-06: `triage.pending` exige revisão de cada fingerprint, com evidência de decisão em runtime e comparação ao owner canônico; `triage.pendingByFailureClass` permite priorizar A/B/C/E/I, sem promover heurísticas para dívida automaticamente. O `sourceSha` e o hash da linha são somente âncoras de fonte, não aprovação comportamental.
  - Remediação AUD1300-20261014-F04: o gate estático 17 acompanha comparações e `switch/case` de identidade alimentar através de normalizações transparentes de string (`trim`, caixa, Unicode e substituições literais) e normalizadores nomeados de identidade; funções arbitrárias não são tratadas como transformações transparentes. Testes positivos verificam falha para novos hardcodes de alimento/porção; negativos preservam status, contas, exercício e UI não decisória.
  - Remediação AUD1300-20261015-F05/F06: catálogos JSON de identidade/nutrição passam pelos gates 17/5 quando o código produtivo extrai campos de identidade com `map/flatMap` (inclusive `filter/slice` intermediários, aliases locais e normalizações transparentes) e efetivamente os usa em uma decisão por `includes/indexOf/find/some/every/filter` ou `for...of`. Projeção exclusivamente apresentacional, atributo não identificador e módulo não alimentar continuam fora do bloqueio. Aliases mutáveis com `if/else` exaustivo que substitui a fonte em todos os ramos deixam de atribuir procedência ao JSON original; ramos opcionais ou que conservam a fonte continuam rastreados. Testes adversariais positivos e negativos verificam `findFoodStaticCandidates` e `evaluateFoodArchitectureGate`.
  - Remediação AUD1300-20261015-F09/F10: projeções `map/flatMap` de identidade alimentar preservam origem de catálogos JSON ao retornar aliases locais `const` (inclusive aliases encadeados com normalizadores transparentes), sem marcar projeções numéricas, funções opacas ou apresentação inerte. JSON carregado por `JSON.parse` de `node:fs`/`node:fs/promises` em caminho estático, inclusive a partir de variável `raw`, é tratado como import quando consumido por decisão alimentar; caminhos sem prova estática permanecem sob detecção opaca e dados de conta, status e exercício não são automaticamente classificados como alimento. Testes positivos/negativos exigem findings 17/5 e falha do gate para novos catálogos.
  - Remediação AUD1300-20261015-F11/F12: ao reconstruir registros alimentares por `map/flatMap`, aliases locais imutáveis de `row.name` (inclusive encadeados e com normalizadores transparentes) mantêm a proveniência do catálogo JSON até a decisão; aliases mutáveis, projeções por fonte alheia, dados administrativos e uso apenas de apresentação não criam bloqueios. Nas leituras `JSON.parse` via Node `fs`, o detector resolve a identidade lexical do provedor no ponto de uso, preservando imports/aliases reais e evitando atribuir leitura do catálogo a parâmetros, variáveis locais, funções homônimas ou provedores não-Node. Regressões F11/F12 cobrem positivos e negativos nos gates 17/5 e no resultado de `evaluateFoodArchitectureGate`.
  - Remediação AUD1300-20261015-F13/F14 e R1300-02: `Object.values(catalogo)` preserva registros alimentares para fins de gates 17/5 apenas quando o consumidor realmente decide por identidade; `Object.keys`, `Object.entries`, índices numéricos, `Object` sombreado por declaração local/parâmetro/import, projeção de calorias, renderização, exercício e importações inertes não implicam automaticamente conhecimento alimentar. Objetos reconstruídos por `map/flatMap` consideram a ordem de spreads e propriedades: `{ ...row, name: outraFonte }` abandona a identidade original, enquanto `{ name: outraFonte, ...row }` ou `{ ...row, name: row.name }` preservam; spreads posteriores de fonte desconhecida não provam conservação. A matriz adversarial em `scripts/food-intelligence-architecture.test.ts` cruza fonte JSON, transformação, aliases, propriedades computadas literais, acessores, sobrescritas e decisão, testando tanto `findFoodStaticCandidates` quanto `evaluateFoodArchitectureGate`. Hardcode nutricional introduzido independentemente continua bloqueante mesmo sem proveniência do catálogo.
  - Remediação AUD1300-F18/F19: a análise de procedência de catálogos JSON considera o predicado consumidor mesmo quando declarado como função nomeada, callback `const` ou alias imutável; parâmetros homônimos não herdam predicados externos. Quando uma projeção `map/flatMap` altera somente parte das identidades (`name`, `label` etc.), basta que um campo identitário comprovadamente originário do catálogo participe da comparação para preservar a proveniência. A substituição de todos os campos efetivamente usados não justifica bloqueio do JSON original. Regressões positivas e negativas exercitam `findFoodStaticCandidates` e `evaluateFoodArchitectureGate` e controlam decisões administrativas/exercícios e imports meramente inertes.
  - Remediação AUD1300-F15/F16/F17: as projeções de registros mantêm proveniência somente para a propriedade identificadora efetivamente consultada, respeitando sobrescritas independentes; chaves computadas por `const` lexical são resolvidas antes de decidir se houve substituição e chaves desconhecidas não provam preservação; `Object["values"]` e `Object.values` são equivalentes quando a função global real é usada. Regressões positivas e negativas exercitam gates 17/5 e o bloqueio de novas violações.
- `design-docs/database-persistence.md`
- `design-docs/timezone.md`
- `design-docs/timezone-backend-reports.md`
- `design-docs/timezone-frontend.md`
- `design-docs/quick-edit-timezone.md`
- `design-docs/timezone-architecture-guard.md`
- `design-docs/manual-meal-catalog-search.md`
- `design-docs/food-portions-household-measures.md`
- `design-docs/custom-foods.md`
- `design-docs/open-food-facts-provider.md`
- `design-docs/whatsapp-conversation-context.md`
- `design-docs/whatsapp-ingestion.md`
- `design-docs/ai-observability-pricing.md`
- `design-docs/whatsapp-onboarding.md`
- `design-docs/professional-ai-assistance.md`
- `design-docs/billing-foundation.md`
- `design-docs/billing-admin-operations.md`
- `design-docs/billing-subscription-lifecycle.md`
- `design-docs/billing-professional-coverage.md`
- `design-docs/billing-asaas-adapter.md`

## Testes e regressão

Use `docs/testing/` para matrizes e roteiros de validação que precisam permanecer reproduzíveis.

- `testing/whatsapp-conversation-context-regression.md` — matriz multicanal, profundidade, reinício, múltiplas instâncias, rollout e rollback do contexto persistente.
- `testing/whatsapp-response-contract-regression.md` — inventário dos pontos de resposta/envio do WhatsApp e baseline de caracterização da migração para o contrato único (epic #779).
- `testing/professional-legacy-retirement-regression.md` — inventário completo, substituições e matriz reproduzível da regressão final da Área Profissional (#815).
- `testing/open-food-facts-sample-2026-09-28.md` — amostra sanitizada de EANs brasileiros e decisão de não habilitar o rollout (#1204).

## Documentação operacional e sensível

| Documento         | Uso                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRIVACY_LGPD.md` | Política técnica canônica para dados pessoais, dados sensíveis, IA, mídia, logs, exportação e exclusão.                                                                                                                                                                                                                                                   |
| `SECURITY.md`     | Regras de segurança, segredos e hardening.                                                                                                                                                                                                                                                                                                                |
| `RELIABILITY.md`  | Resiliência, observabilidade e riscos operacionais.                                                                                                                                                                                                                                                                                                       |
| `runbooks/`       | Runbooks operacionais e técnicos. O controle técnico do rollout comercial de billing está em `runbooks/billing-commercial-rollout.md`; a execução operacional real é rastreada pela #1024. Billing Asaas está em `runbooks/billing-asaas.md`; o rollout de IA por capacidade foi executado na #962 e mudanças futuras continuam governadas por `runbooks/multi-provider-rollout.md`; a aposentadoria do legado profissional está em `runbooks/professional-legacy-retirement.md`. `runbooks/openai-rollout-checklist.md` e `runbooks/openai-rollout-evidence.md` são histórico deprecado (issue #927) e não devem ser usados para rollout vigente. |

O template de evidência sanitizada da execução operacional da #1024 está em `history/billing-commercial-rollout-evidence-template.md`. Ele referencia a #898 como contrato técnico; copie-o para um registro datado por janela. O template não é evidência de execução nem autorização de produção.

### IA multi-provider e benchmark

- `benchmarks/multi-provider/README.md` — contrato, fixtures, métricas e critérios de promoção da #927.
- `benchmarks/multi-provider/fixtures/manifest.json` — cenários sintéticos e sem PII.
- `benchmarks/question-latency/README.md` — coorte, protocolo before/after, métricas e gate de latência da capacidade `QUESTION` (#989).
- `runbooks/multi-provider-rollout.md` — promoção e rollback por capacidade; registra a conclusão operacional da #962 e governa futuras janelas.
- `history/ai-multi-provider-rollout-2026-09-01.md` — registro sanitizado da confirmação de que as configurações por capacidade estão implantadas e funcionando em produção.
- `design-docs/ai-observability-pricing.md` — usage normalizado e catálogo de preços versionado.

## Documentação gerada

`docs/generated/` é derivada de scripts e deve ser atualizada quando houver mudança em schema, rotas ou contratos.

- `generated/db-schema.md`
- `generated/trpc-routes.md`

## Planos de execução

Use `docs/exec-plans/active/` apenas para trabalhos em andamento, com escopo claro e prazo curto.

Quando um plano for implementado:

1. mova regras permanentes para `product-specs/`, `design-docs/`, `runbooks/` ou documentos raiz;
2. remova o plano antigo ou arquive somente se ainda tiver valor histórico real;
3. atualize este índice e `AGENTS.md` quando a rota de leitura mudar.

## Regra para novos documentos

Antes de criar um novo `.md`, verifique se a informação cabe em uma documentação canônica existente. Prefira atualizar o documento de domínio em vez de criar revisão pontual, plano solto ou duplicação de checklist.

Novas funcionalidades profissionais devem ser incorporadas a `product-specs/professionals.md` ou a design docs vinculados. Não criar documentos paralelos que misturem a evolução da Área Profissional com correções da Área do Paciente, infraestrutura compartilhada ou billing.

A remediação A1300-21/22/23 amplia os gates para mapas numéricos alimentares `new Map(...).get(foodName)` (inclusive expressões inline), resolvedores concorrentes em canais novos independentemente do nome do módulo (preservando o owner canônico) e reinferência que recebe alias local de uma decisão estruturada. Os testes separam dados alimentares de mapas administrativos, resolução canônica e texto bruto de entrada. Os detectores seguem estáticos: importações dinâmicas não literais e equivalência comportamental de owners ainda exigem revisão específica.

Os controles da onda estática detectam também decisões `switch/case` por identidade/porção, mapas JSON numéricos indexados por identidade alimentar (ex.: `foodPortions.json`) e testes lexicais de materialidade em funções com nomes genéricos quando houver evidência de domínio. São mantidos controles negativos para status, exercícios, regex de formato numérico e fixtures inertes; artefatos importados em runtime continuam sujeitos aos gates.

Na remediação A1300-48/49/50/51, os gates verificam também chaves de identidade alimentar derivadas por normalização local, dicionários lexicais consumidos por comparação ou `includes` com termo iterado e porções/macros compostas exclusivamente de aritmética constante, sem bloquear valores provenientes de fonte dinâmica ou dicionários administrativos. Para R1300-05, cada candidato heurístico pendente ganha, no artefato exact-SHA, prova por linha (`sourceSha`, `lineSha256`, local verificado) e decisão explícita `behavioralDecisionCertified=false`; essa inspeção completa de localização não equivale a auditoria semântica em runtime e jamais libera exceção automática.

A revisão nominal de owners agora possui `behavioralReview` por fonte legada no inventário congelado, contendo responsabilidade, trecho verificável (`sourceAnchor`), conclusão e limite de evidência. `food-architecture:report` confere os anchors no SHA imutável e publica `ownerInventory.reviewedLegacyResponsibilities` e `reviewTotals`. **Rastreio estático de responsabilidades não certifica equivalência de comportamento em runtime entre owners concorrentes**: essa comparação depende de evidência específica e permanece `requires-behavioral-review`, sem aprovação implícita.

A auditoria de owners da Issue #1300 em `pnpm food-architecture:report` publica também `ownerInventory.byDecisionFunction`: candidatos agrupados por função de domínio, superfície (`channel`, `client`, `shared`, `server-domain`) e ocorrência. Os grupos e os pares `suspectedCompetingPairs` são heurísticos, reproduzíveis pelo `sourceSha`, e exigem revisão de comportamento antes de certificar owners concorrentes. Léxicos JSON produtivos são abrangidos; dados ambíguos de exercícios não são presumidos conhecimento alimentar somente por conter `name` e `calories`.


### Gates alimentares — detecção adversarial (Issue #1300)

Os gates estáticos da onda 1 analisam também retornos nutricionais sem identidade explícita,
mapas numéricos JSON consumidos pelo resolvedor alimentar, decisões com templates literais,
dicionários lexicais anônimos e imports indiretos de resolvedores alternativos.
Listas de filtro exclusivamente visuais em componentes JSX/TSX não são regras alimentares;
se usadas para decidir domínio, seguem bloqueantes. A análise de owners concorrentes
continua conservadora: o relatório diferencia candidatos estáticos de provas de comportamento.


**Correções A1300-19/20:** mapas numéricos de porção com identificador genérico
(indexados por identidade alimentar) e constantes de gramas fixas dentro de
resolução alimentar são verificados com controles negativos para status,
exercício e conversões de unidade. A saída `ownerInventory.pendingBehavioralReviews`
enumera individualmente os candidatos legados por fingerprint/linha/SHA-base;
esses candidatos exigem evidência discriminante antes de qualquer certificação
de owner ou inclusão no livro de dívida. Nenhuma pendência é aprovada por omissão.

**Correções A1300-24/25/26/27:** o gate acompanha mapas numéricos exportados e consumidos por outro módulo em decisões de porção; considera fixtures/JSON carregados em runtime por leituras estáticas de filesystem (`readFileSync`, `fs.readFileSync`, `readFile`, `fs.promises.readFile`, `new URL(..., import.meta.url)` e `path.join(__dirname, ...)`); e diferencia coleções de navegação exclusivamente visual de coleções usadas em decisões. A varredura e a base SHA agora enumeram arquivos fonte de outros diretórios potencialmente produtivos e alcançam os que forem importados a partir dos entrypoints de `server/`, `shared/` e `client/src/`. Caminhos computados dinamicamente sem valor estático e runtime entrypoints inteiramente externos continuam exigindo revisão específica — não são certificados pelo detector AST. Alterações apenas em catálogos JSON produtivos, `architecture-debt.json` e no inventário nominal `food-architecture-owners-1300.json` também obrigam `architecture:check` no CI, sem exceção automática.


**Importação CommonJS na onda 1 (#1300):** mapas JSON numéricos com nomes
genéricos, como `weights.json`, são alcançados tanto por import ES quanto por
`const weights = require('./weights.json')` e
`import weights = require('./weights.json')`. O verificador associa o objeto
carregado ao binding consultado por identidade alimentar, incluindo aliases
locais; bloqueia os gates 17/5 somente quando há uso decisório comprovado.
Imports somente de tipos, dados não consultados, status/conta/exercício e
fixtures isoladas permanecem fora da classificação de conhecimento alimentar.

**Correção A1300-36 — JSON por leitura estática de filesystem:** o detector
reconhece mapas numéricos genéricos atribuídos por
`JSON.parse(readFileSync(...))` e `JSON.parse(fs.readFileSync(...))`, com
caminhos estáticos relativos, `new URL(..., import.meta.url)`,
`path.join(__dirname, ...)` ou `path.resolve(process.cwd(), ...)`.
Somente quando a variável carregada (inclusive alias ou variável local de função)
participa de consulta por identidade alimentar os gates 17/5 bloqueiam.
Conta, status, exercício, mapas não consultados, caminhos dinâmicos e fixtures
isoladas permanecem controles negativos; I/O dinâmico não é certificado por AST. A correção A1300-37 rastreia aliases da API
`readFileSync` (imports nomeados renomeados, namespaces ES/CommonJS,
destruturing CommonJS e acesso estático por colchetes) antes de aprovar um mapa
JSON produtivo: somente a consulta por identidade alimentar ativa 17/5;
caminho dinâmico, dado não consumido, status, conta, exercício e fixture isolada
continuam fora do bloqueio. A análise estática não certifica aliases criados
por mutação ou reflexão em runtime. A suíte adversarial da arquitetura alimentar passa
agora a integrar explicitamente o `vitest.config.ts` e o gate `Full tests` do
CI, evitando que alterações no detector recebam CI verde sem executar seus
controles negativos e positivos. As regressões A1300-08/30/33, antes não exercitadas pelo padrão do Vitest,
foram reparadas: léxicos JSON reconhecem chaves ancestrais com contexto
alimentar (`foodAliases`) e filtros negativos de retornos numéricos operam sobre
achados, não sobre arquivos de entrada.

**Correção A1300-38 — CommonJS sem namespace intermediário:** chamadas
`JSON.parse(require('fs').readFileSync('./weights.json'))`, acesso estático
`require('node:fs')['readFileSync']` e aliases diretos de método (`const load =
require('fs').readFileSync`) mantêm a mesma detecção dos gates 17/5, se o
JSON numérico for consumido em uma decisão por identidade alimentar. Somente
módulos `fs`/`node:fs` literais são seguidos; módulos terceiros, caminhos de
`require()` dinâmicos e leituras voltadas a contas/status não são aprovados
como violação por essa regra. Os testes positivos e negativos fazem parte da
suíte Vitest executada na CI; análise dinâmica exige revisão separada.


**Correção A1300-39 — verificação da origem do leitor `fs`:** os gates
17/5 reconhecem apenas APIs provindas de `fs`/`node:fs` por import,
`import = require` ou `require` literal. Um helper local homônimo
(`readFileSync`), objeto `fs` falso, import de biblioteca terceira ou wrapper
não comprovado não é um leitor do filesystem Node para fins do detector
estático. Chamada CommonJS direta e alias legítimo permanecem bloqueados
quando o JSON é usado como mapa alimentar. Isso evita falsos positivos sem
certificar leitores dinâmicos nem dispensar a revisão de comportamento.

**Correções da auditoria de 2026-10-14 (Issue #1300):** os gates 17/5 detectam mapas de alimentos indexados por identidade com valores numéricos aninhados (por exemplo, porções e calorias), incluindo catálogos JSON importados; consultas não alimentares de exercícios permanecem fora do bloqueio. Em componentes de interface, um rótulo é isento somente quando usado para apresentação, não quando participa de comparação/decisão de identidade alimentar. O gate 18 também identifica expressões regulares de qualificadores de materialidade em handlers genéricos por pistas declarativas de sintaxe, sem transformar essas pistas em política nutricional de runtime. Testes adversariais positivos e negativos sustentam os três casos; reconhecimentos estáticos não constituem certificação de comportamento dinâmico.

**Regressão A1300-12 preservada:** a pista lexical do gate 18, quando isolada de nomes de domínio, somente promove uma regex a achado em superfícies de entrada declaradas no catálogo (handlers, routes, controllers, adapters e API). Um helper genérico de conta com a mesma regex não é tratado automaticamente como materialidade alimentar. As duas situações têm testes discriminantes; o limite continua sendo análise estática, não inferência funcional completa.

**Remediação AUD1300-01/02:** constantes de interface usadas em calls de decisão alimentar, alias locais, propriedades de identidade ou retornos decisórios não são dispensadas pelo gate 17 como mero texto visual. O gate 2 procura novos resolvedores alimentares também fora de diretórios de canal, mantendo a exclusão de funções genéricas não alimentares e de delegações puras ao import canônico comprovado. Testes adversariais incluem controles negativos de apresentação, shadowing e serviços administrativos. A descoberta é estática; aprovação comportamental segue a auditoria independente.


**Remediação AUD1300-03/04/05:** o gate estático segue aliases numéricos locais imutáveis até o consumo em macros/porções alimentares, mesmo em retornos anônimos. Mapas de porção parcialmente dinâmicos (TypeScript, `Map` e JSON importado) geram finding quando ao menos uma entrada é um valor nutricional estático e existe evidência de indexação por identidade alimentar; valores dinâmicos, mapas administrativos e exercícios permanecem controles negativos. O gate 2 detecta resolvedores concorrentes com parâmetros genéricos a partir do acesso a catálogo alimentar no corpo, sem depender exclusivamente do nome da função ou da pasta. Esses detectores são heurísticos: não substituem a verificação de comportamento de owners concorrentes.

**R1300-07 — continuidade da revisão de owners:** o inventário `ownerInventory.pendingBehavioralReviews` permanece como fila integral por fingerprint e SHA, com `behavioralDecisionCertified=false` até prova discriminante individual em runtime. A CI só verifica estrutura e proveniência estática, não certifica equivalência funcional de candidatos ou autoriza dívida automaticamente. A revisão comportamental pendente não deve ser apresentada como concluída pela implementação destes gates.

**AUD1300-FS-PATH / AUD1300-REGEX-ALIAS (onda 1):** leituras Node `readFileSync('./data/...')` e `path.join('data', ...)` resolvem no `process.cwd()`, enquanto `new URL('./...', import.meta.url)` e `path.join(__dirname, ...)` permanecem relativos ao módulo; o grafo estático usa essa distinção para governar catálogos produtivos mesmo fora de `server/`. Regex decisórias alimentares com aliases `const` transitivos também geram achados nos gates 17/18; bindings mutáveis, parâmetros sombreados e decisões de status permanecem controles negativos. Limites de análise dinâmica continuam explícitos.

**R1300-01 — baixa do legado:** cada entrada de `architecture-debt.json` preserva `issue: 1300` como origem auditável do gate e acrescenta `migrationIssue` para a substituição de conhecimento (catálogos em #1302, porções em #1305, léxico de canal em #1304, materialidade em #1306) e `retirementIssue: 1313` para a retirada após cutover. As ligações não autorizam prorrogação da dívida nem remoção antes de comprovar o pagamento; o CI rejeita dívida sem follow-up explícito.

**Auditoria AUD1300-JSON-01/02 (2026-10-15):** a detecção de catálogos JSON de
`name`/`label`/`slug`/`nome` e calorias segue decisões alimentares em
`.find()` e iterações `for...of`, inclusive aliases locais e transformações
transparentes de coleção. Catálogos isolados ou usados apenas para exercícios
não recebem bloqueio por esse formato ambíguo. Gates 17/5 exigem testes
positivos e negativos no HEAD publicado; a auditoria final permanece independente.

**AUD1300-LEX-ITER:** listas lexicais importadas são inspecionadas também
quando `Object.entries`, `Object.keys` ou `Object.values` abastecem
`.find`, `.some`, `.filter` ou `.every` com comparações decisórias no domínio
alimentar. Casos administrativos e apresentação são controles negativos.

**AUD1300-JSON-03:** bindings de identidade desestruturados em callbacks e
iterações (`{ label }`, `{ label: alias }`) mantêm a proveniência de catálogo
JSON produtivo, mesmo sem acesso `.label` explícito na comparação. Parâmetros
sombreados e consumidores de exercícios não herdam conhecimento alimentar.

**AUD1300-LEX-ITER-LOCAL:** o mesmo gate cobre comparações sobre
`Object.entries/keys/values` de tabelas definidas no próprio módulo; a
localização do dado não isenta decisão lexical alimentar produtiva.

**AUD1300-NS-01/FROZEN-02/NS-NUMERIC-03/JSON-CALLBACK-04:** os verificadores da onda estática seguem importações `import * as`, aliases locais, coleções de léxico congeladas com `Object.freeze`, mapas numéricos importados por namespace e callbacks alimentares por referência em catálogos JSON. Escopos sombreados, contas, status e exercícios permanecem controles negativos; a auditoria independente deve ser repetida no novo HEAD após CI exato.

**AUD1300-20261015-F01/F02 (gates JSON, Issue #1300):** uma decisão de identidade alimentar em `account/` continua sujeita aos gates 17/5 quando há evidência no consumidor; o nome do diretório não é uma isenção para todo o módulo. Decisões administrativas/de exercício e apresentação sem consumo alimentar permanecem controles negativos. Na análise de aliases locais mutáveis de catálogos JSON, o verificador usa a última atribuição linear incondicional anterior ao consumo; substituir o alias por outra fonte não implica que o JSON importado ainda governe a decisão. Essa análise estática limitada não certifica fluxos condicionais/dinâmicos e não autoriza novas exceções ou rebaseline da dívida.

**AUD1300-20261015-F03/F04 — remediação da auditoria (#1300):** os gates 17/5 acompanham a proveniência de catálogos JSON genéricos por consultas encadeadas `filter`/`slice` e transformações `map`/`flatMap` que preservem a identidade alimentar, até o consumo decisório `find`/`some` ou `for...of`. Transformações que substituem a identidade por dados independentes não comprovam uso do catálogo de origem. Em aliases mutáveis, reatribuições anteriores dentro de blocos também são analisadas; escritas condicionais preservam a procedência possível quando algum ramo ainda utiliza o catálogo, enquanto uma reatribuição incondicional comprovada descarta a origem anterior. Os controles distinguem sombreamento, funções não executadas, decisões de exercícios e usos somente de apresentação. Testes adversariais: `AUD1300-20261015-F03/F04` em `scripts/food-intelligence-architecture.test.ts`.

**AUD1300-20261015-F07/F08 — reforço dos gates JSON (#1300):** projeções `map`/`flatMap` de identidade alimentar agora preservam procedência quando o callback desestrutura `name`, `label` ou outro campo identificador, inclusive com renomeação e normalização textual transparente. Inicializações, reatribuições e consumidores diretos de expressões condicionais (`?:`) ou seleções lógicas (`||`, `&&`, `??`) conservam todas as origens possíveis do catálogo até uma decisão alimentar; apenas substituições comprovadamente definitivas retiram a fonte anterior. Regressões positivas/negativas cobrem decisões alimentares, projeções não consumidas, exercícios, atributos não identificadores e alternativas sem catálogo. Este rastreamento é estático e limitado: não certifica semântica dinâmica de funções arbitrárias nem revisão comportamental do legado.

**Remediação AUD1300-F20–F23 (Issue #1300):** projeções de catálogos JSON
usadas em decisões alimentares seguem funções nomeadas e aliases locais
imutáveis, observando shadowing e mutabilidade. Decisões com parâmetro
desestruturado (`{ label }` ou `{ label: key }`) preservam a
proveniência do campo realmente consumido, mesmo quando outro identificador
foi sobrescrito. Imports CommonJS com múltiplos declaradores e métodos de
coleção por chave computada literal, como `rows["find"](...)`,
passam pelo mesmo gate 17/5 das formas convencionais. Os testes distinguem
consumo alimentar de exercícios, apresentação, aliases mutáveis/sombreados,
métodos computados dinâmicos e campos substituídos independentemente. A
cobertura AST não certifica transformações dinâmicas arbitrárias e não substitui
a auditoria independente no SHA final.


**Remediação AUD1300-F24–F27 (Issue #1300):** a análise de catálogos JSON
considera `import = require`, carregamento CommonJS direto e declaradores
intermediários no mesmo contrato dos imports ESM. O `require` Node precisa
ser comprovado no escopo da chamada: variáveis locais, parâmetros e
sombreamento não tornam fixtures produtivas nem concedem procedência de
`node:fs` a leitores falsos. Catálogos com registros aninhados (por exemplo
`data.rows`) são rastreados por propriedades estáticas, colchetes literais e
desestruturação; a propriedade selecionada deve existir e conter registros
alimentares, enquanto logs, dados de exercício e projeções apenas visuais
permanecem fora do bloqueio. Regressões executam `findFoodStaticCandidates`
e `evaluateFoodArchitectureGate`, com positivos e negativos separados.

**Remediação AUD1300-F28/F29 (Issue #1300):** o detector AST rastreia
identidades de registros alimentares extraídos por desestruturação imutável de
arrays, inclusive aliases locais, identidades desestruturadas e normalizações
transparentes usadas em comparações ou decisões `switch`. A extração destinada
apenas à apresentação, a fonte não alimentar e o parâmetro homônimo não
autorizam imputar consumo produtivo ao catálogo. Na leitura JSON via `node:fs`,
reatribuições incondicionais do conteúdo bruto antes de `JSON.parse` passam
a substituir a fonte anterior na prova de proveniência; reatribuições
condicionais preservam a origem possível, enquanto alterações depois do parse
não alteram a origem já consumida. As regressões cobrem ambos os APIs
`findFoodStaticCandidates` e `evaluateFoodArchitectureGate` com casos
positivos e negativos. Esta verificação estática não equivale a certificação
comportamental de owners nem autoriza exceções novas no livro de dívida.

**Remediação AUD1300-F30/F31/F32 (Issue #1300):** os gates estáticos
17/5 rastreiam a identidade decisória de registros JSON alimentares extraídos
por `const`/`let`/`var` sem substituição definitiva, índice literal (`rows[0]`,
`rows["0"]`), `rows.at(0)` e desestruturação numérica, sem confundir uma
origem descartada, parâmetros homônimos, consumo de apresentação ou exercício
com uma decisão alimentar. O rastreamento de JSON lido por `node:fs` distingue
o `JSON.parse` nativo de objetos/argumentos locais chamados `JSON` ou `parse`
e reconhece as formas equivalentes `JSON["parse"]` e aliases `const`
encadeados. Casos positivos e negativos são exercitados pelos dois entrypoints
`findFoodStaticCandidates` e `evaluateFoodArchitectureGate`. A identificação
continua sendo estática: caminhos dinâmicos ou efeitos de mutação não provados
exigem inspeção específica, sem permitir dívida automática.

**Remediação AUD1300-20261017-F33/F34/F35 (Issue #1300):** o gate 17
reconhece catálogos de sugestões em decisões de refeição pelo consumidor
produtivo, sem depender dos nomes específicos dos alimentos. Os gates 17/5
acompanham mapas nutricionais literais que atravessam spreads e aliases
`const` com escopo léxico demonstrável, sem imputar origem estática a aliases
mutáveis ou parâmetros homônimos. Os gates 17/18 também verificam
substituições lexicais por `replace`/`replaceAll` com regex, `RegExp`
estático ou texto literal em normalizadores alimentares. Testes positivos,
negativos administrativos e de apresentação verificam detecção e bloqueio;
esses controles não certificam dinamicamente os owners legados.

**Remediação AUD1300-20261018-F43/F44/F45 (Issue #1300):** consultas
nutricionais de mapas numéricos por `Object.keys`/`Object.entries` seguidas
por `find`, `filter`, `some`, `every`, `includes` ou `indexOf` conservam a
procedência do mapa na decisão por identidade alimentar, inclusive com
projeção `const`, transformações transparentes e importações produtivas entre
módulos. Comparações lexicais por `indexOf`/`localeCompare` entram nos gates
17/18 quando utilizadas como predicados alimentares, incluindo qualificadores
de materialidade. O construtor `RegExp` resolve aliases `const` imutáveis de
padrões literais respeitando escopo, mutabilidade e sombreamento. Listagem
inerte, dados administrativos, `Object` sombreado e aliases dinâmicos não
recebem bloqueio por mera semelhança textual. A matriz de regressão em
`scripts/food-architecture-f43-f45-remediation.test.ts` valida os gates
estáticos; equivalência comportamental de owners continua sujeita à
certificação independente prevista na ADR.
