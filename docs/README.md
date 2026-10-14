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
  - Gates da onda 1 (#1300): `pnpm architecture:check` **reprova violações novas** de código produtivo em relação ao SHA pré-migração registrado; conserva achados legados como avisos de triagem, sem autoexceção. `pnpm food-architecture:report` gera inventário por SHA, comparação `develop`, classes §9.3 e dívida vigente. O inventário inicial de owners está em `design-docs/food-architecture-owners-1300.json` (8 fontes revisadas, 7 confirmadas, incluindo o catálogo JSON TACO por SHA; o restante é candidato heurístico sem dívida automática) e o livro versionado em `architecture-debt.json` (owner, issue, prazo máximo de 90 dias, sem renovação; vencida/órfã falha). O relatório por HEAD classifica individualmente todos os achados e vincula somente dívidas nominais confirmadas. O item 25 da ADR foi decidido em 2026-10-12: testes, fixtures isoladas, código gerado inerte e documentação não bloqueiam, mas artefatos carregados em runtime não estão isentos. O item 26 regula **somente os gates de runtime 6/8/15**: sete dias completos de observação sem violações, evidência, rollback testado e aprovação explícita antes de habilitar cada bloqueio. Os controles adversariais incluem constantes numéricas e objetos alimentares inline (inclusive `foodId` com porção/macros), decisões de materialidade em handlers sem depender do nome do arquivo, imports/reexports estáticos ou dinâmicos de módulos TS/JS gerados e fixtures efetivamente carregados e comparação multiconjunto de fingerprints (duas ocorrências idênticas não equivalem a uma). O JSON do relatório inclui `triage.pending`, fila por fingerprint e SHA dos candidatos legados que exigem evidência individual, sem aprovação automática de dívida. Catálogos nutricionais `.json` em áreas produtivas (inclusive fixtures/gerados importados em runtime) também passam pelos gates 17/5, com fingerprint do conteúdo normalizado; alterações de dados são novas violações. Objetos TS/JS com identidade alimentar dinâmica e macros literais são analisados; strings de UI meramente apresentacionais não são conhecimento alimentar. Arquivos JSON alimentares carregados via caminhos construídos a partir de `process.cwd()` também são escaneados. Os gates 17/5 detectam mapas numéricos exportados por default e por reexportação nomeada/alias, inclusive barrels transitivos, quando usados em decisão alimentar. Mapas numéricos em JSON com nome neutro (por exemplo, `server/weights.json`) também são classificados como conhecimento alimentar quando o import default, inclusive por alias local, é efetivamente indexado por identidade alimentar (`weights[foodName]`); import somente de tipo, mapeamento não consumido e acesso por status/conta/exercício não sustentam essa classificação. O gate 17 bloqueia retornos de porção/macros numéricos diretos, condicionais e aritméticos. Dívidas legadas confirmadas pelo inventário de fonte imutável não podem ser retiradas antes da remoção da violação, ainda que o primeiro livro não exista na `develop`. A fila R1300-05 de candidatos heurísticos permanece rastreável por fingerprint e exige revisão comportamental individual, sem aprovação automática de owner ou dívida.
  - Endurecimento de deteccao da Issue #1300 (A1300-42/43/44): dicionarios lexicais aplicados por iteracao `Object.entries/keys/values` e substituicao de texto tambem sao candidatos de regra produtiva, mesmo com nome de variavel generico; catalogos JSON consumidos por identidade alimentar e carregados de `node:fs/promises`, `fs/promises` ou `fs.promises.readFile` entram no inventario quando o caminho e estaticamente demonstravel. A associacao de mapas importados e feita por escopo lexical para que parametros, valores de banco e aliases homonimos nao herdem equivocadamente a origem de um import. Caminhos dinamicos ou sem prova de origem exigem revisao complementar; o silencio do detector nao equivale a autorizacao de hardcode. Testes adversariais positivos e negativos acompanham os tres controles.
  - Remediação #1300 (A1300-45/46/47): os gates estáticos incluem decisões lexicais alimentares por `String.includes/startsWith/endsWith`, arrays JSON de aliases de alimentos em fontes produtivas ou alcançadas pelo runtime, e restringem a isenção de owner ao contrato existente `server/foodItemResolution.ts#resolveCanonicalFoodQuantity`. Um novo resolvedor em outro arquivo, inclusive `foodIntelligenceV2/`, não recebe autorização implícita. Os verificadores mantêm negativos de conta, status, apresentação e fixtures isoladas. A fila comportamental R1300-05 continua exigindo evidência independente por candidato; o inventário por SHA não certifica comportamento.
  - Remediação A1300-52/53/54: retornos de apenas um macronutriente/caloria literal em funções de decisão alimentar entram no gate 17; propriedades de classe e objetos que declaram resolvedores alternativos entram nos gates 1/2 (delegação pura para o import canônico é permitida). Leitura de JSON por `node:fs` com caminho opaco e `import()` dinâmico no contexto decisório alimentar produzem finding de gate 17, sem isentar fixture/gerado consumido em runtime; configurações e dados administrativos não alimentares continuam fora do bloqueio. R1300-06: `triage.pending` exige revisão de cada fingerprint, com evidência de decisão em runtime e comparação ao owner canônico; `triage.pendingByFailureClass` permite priorizar A/B/C/E/I, sem promover heurísticas para dívida automaticamente. O `sourceSha` e o hash da linha são somente âncoras de fonte, não aprovação comportamental.
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
