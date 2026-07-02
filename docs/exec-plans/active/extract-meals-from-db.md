# Plano de extracao: meals de server/db.ts

Status: ativo.
Issue de origem: #586.

Este documento registra o plano tecnico para extrair o dominio `meals` de `server/db.ts` em PRs pequenos, com testes de regressao definidos antes de qualquer refatoracao ampla. A implementacao futura deve preservar comportamento observavel, formatos de retorno e compatibilidade temporaria via fachadas exportadas por `server/db.ts`.

## Leitura obrigatoria

1. `AGENTS.md`
2. `README.md`
3. `ARCHITECTURE.md`
4. `CONTRIBUTING.md`
5. `server/db.ts`
6. `server/modules/meals/service.ts`
7. `server/modules/meals/groupOperations.ts`
8. `server/modules/meals/schemas.ts`
9. `server/repositories/mealsRepository.ts`
10. `server/modules/photoAnalysis/service.ts`
11. `server/modules/whatsapp/service.ts`
12. `server/modules/whatsapp/intentActions.ts`
13. `server/modules/whatsapp/llmIntentActions.ts`
14. `server/modules/insights/service.ts`
15. `server/nutritionEngine.ts`

## Escopo desta issue

- Inventariar as funcoes exportadas por `server/db.ts` relacionadas a refeicoes.
- Mapear consumidores diretos e riscos por dominio.
- Definir sublotes pequenos para futura extracao.
- Identificar fachadas publicas que devem permanecer temporariamente em `server/db.ts`.
- Definir testes e validacoes obrigatorias antes de mover codigo.

## Fora de escopo

- Extrair todo `meals` em um unico PR.
- Alterar parser do WhatsApp, regras de IA, prompt, calculo nutricional, schema de banco ou contrato tRPC.
- Corrigir bugs funcionais encontrados durante o inventario, salvo bloqueador documentado em issue propria.
- Reorganizar dominios nao relacionados.

## Invariantes

- `server/db.ts` deve continuar exportando as assinaturas publicas atuais ate todos os consumidores migrarem.
- Web, WhatsApp, foto, relatorios, gamificacao, privacidade e admin devem continuar recebendo o mesmo formato de retorno.
- A confirmacao de refeicao nao pode depender de chamada externa.
- Falha de upload/storage, imagem auxiliar, transcricao ou inferencia deve continuar controlada e sem vazar texto cru, transcricao, midia, telefone, token ou detalhe sensivel.
- Fluxos sem `DATABASE_URL` devem manter o fallback em memoria quando o comportamento atual ja oferece esse caminho.
- Qualquer diferenca entre memoria e banco deve virar decisao explicita antes de mover codigo.

## Mapa de funcoes exportadas de meals em server/db.ts

| Export | Categoria | Consumidores diretos conhecidos | Banco vs memoria | Observacoes para extracao |
|---|---|---|---|---|
| `buildSavedMedia` | Midia | `server/modules/meals/service.ts`, `server/modules/photoAnalysis/service.ts` | Memoria, sem acesso direto a banco | Deve ir junto do sublote de inferencias/midia para preservar sequencia de IDs em fallback. |
| `createPendingMealInference` | Inferencia pendente, midia, integracao IA/WhatsApp | `meals/service.ts`, `photoAnalysis/service.ts` | Grava em `inferenceStore` e tenta `mealInferences` via `mealsRepository.insertInference` quando ha banco | Fachada obrigatoria ate `processMealDraft` e foto migrarem para o servico extraido. |
| `getPendingInference` | Inferencia pendente | `meals/service.ts` (`confirmMeal`) | Le apenas `inferenceStore` | Deve permanecer sincrona ou manter retorno compativel enquanto `confirmMeal` usa fallback duplo. |
| `getPendingInferenceFromDb` | Inferencia pendente, banco | `meals/service.ts` (`confirmMeal`) | Exige `DATABASE_URL`; retorna `undefined` sem banco ou quando reidratacao falha | Manter parse de `itemsJson`, `totalsJson`, `mediaJson` e fallback de label. |
| `confirmPendingMeal` | Refeicao confirmada, inferencia pendente, habito derivado, integracao WhatsApp | `meals/service.ts`, indiretamente `photoAnalysis/service.ts` | Consome `inferenceStore`; persiste em `meals`, `mealItems`, `mealMedia`; atualiza `habitStore`/`habits` | Alto risco: remove draft, salva meal, aprende alias pessoal no WhatsApp e atualiza habitos. |
| `listUserMeals` | Refeicao confirmada, total/agregacao | `meals/service.ts`, `insights/service.ts`, `gamification/store.ts`, `privacy/service.ts`, intents WhatsApp | Le banco via `findConfirmedByUserId`; fallback `mealStore`; recalcula `totals` por item | Deve preservar ordenacao decrescente e retorno com `totals`. |
| `listUserMealsByDate` | Refeicao confirmada, total/agregacao | `insights/service.ts`, relatorios, dashboard atual | Usa janela ampliada de banco e filtra por `getDateKeyInTimeZone`; fallback `mealStore` | Regressao critica para fuso horario e dias sem refeicao. |
| `getUserDayMealTotals` | Total/agregacao | `meals/service.ts` (`getDayTotals`) e tRPC `meals.dayTotals` | Depende de `listUserMealsByDate`; funciona em memoria | Deve preservar `{ date, meals, totals }` com zero, uma ou varias refeicoes. |
| `createUserManualMeal` | Refeicao confirmada, habito derivado | `meals/service.ts`, WhatsApp intents de adicao estruturada | Cria em `mealStore`, tenta persistir em banco e atualiza habitos | Preservar `source: "web"`, `confidence: 1`, `sourceText` e log sanitizado. |
| `copyUserMeal` | Refeicao confirmada | `meals/service.ts`, tRPC `meals.copy` | Depende de `listUserMeals` e `createUserManualMeal` | Pode ser extraido junto de confirmadas por depender do mesmo contrato de itens. |
| `updateUserMeal` | Refeicao confirmada, total/agregacao, habito derivado | `meals/service.ts`, WhatsApp ajustes, grupos | Atualiza memoria, troca itens no banco e recalcula habitos | Alto risco para totais apos edicao e para comandos WhatsApp de gramas/substituicao. |
| `relabelUserMeals` | Refeicao confirmada, habito derivado, integracao externa | Consumidores a confirmar antes do sublote; fluxo WhatsApp pode depender de reclassificacao | Atualiza memoria/banco e sincroniza label em habitos | Manter como fachada ate todos os consumidores serem localizados por busca no checkout. |
| `removeUserMeal` | Refeicao confirmada | `meals/service.ts`, `groupOperations.ts` via wrapper | Remove de `mealStore`, apaga `mealItems`, `mealMedia` e `meals` | Validar que delecao nao deixa midia ou itens orfaos no banco. |
| `listFavoriteMeals` | Favorito, total/agregacao | `meals/service.ts`, `gamification/store.ts`, `privacy/service.ts` | Le `mealFavorites`; fallback `favoriteMealStore`; retorna `totals` | Deve preservar ordenacao e calculo de totais. |
| `saveFavoriteMeal` | Favorito | `meals/service.ts`, tRPC `meals.saveFavorite` | Usa refeicao confirmada atual; upsert no banco; fallback memoria | Preservar dedupe por nome no fallback e upsert por usuario/nome no banco. |
| `reuseFavoriteMeal` | Favorito, refeicao confirmada | `meals/service.ts`, tRPC `meals.reuseFavorite` | Depende de `listFavoriteMeals` e cria refeicao manual | Deve continuar criando refeicao confirmada com copia defensiva dos itens. |
| `getHabitSnapshots` | Habito derivado, integracao IA | `meals/service.ts`, `photoAnalysis/service.ts`, `insights/service.ts` | Le `habits`; fallback `habitStore`; limita top 8 | Entrada direta para `processMealInput`; regressao afeta inferencia nutricional. |
| `getWeeklySummary` | Total/agregacao, habito/qualidade, gamificacao | `gamification/store.ts`, `getWeeklyProgress`, legado `getDashboardSnapshot` | Agrega meals, exercicios, agua, metas e qualidade | Pode ficar fora do primeiro modulo de meals se `insights/service.ts` ja centralizar relatorios. |
| `getWeeklyProgress` | Total/agregacao, relatorio | `insights/service.ts`, `privacy/service.ts` | Depende de `getWeeklySummary`, pesos e metas | Fachada temporaria ate relatorios e privacidade migrarem para servicos dedicados. |
| `getDashboardSnapshot` | Total/agregacao, dashboard legado | Consumidores a confirmar antes de remover; `insights/service.ts` usa caminho proprio | Agrega meals, exercicios, agua, gamificacao e habitos | Nao mover junto do primeiro sublote; tratar como cleanup de agregadores legados. |
| `getAdminSnapshot` | Admin, total/agregacao, inferencia pendente | `server/modules/admin/service.ts` | Conta `mealsRepository.countConfirmed` com banco; fallback `mealStore` e `inferenceStore.size` | Depende do estado de meals e logs; manter fachada ate admin receber dependencia explicita. |

`logInferenceEvent` e `getDb` nao sao dominio exclusivo de `meals`, mas aparecem em `meals/service.ts`, `groupOperations.ts`, WhatsApp, foto e admin. Eles nao devem ser movidos no sublote de meals; o novo modulo deve recebe-los por dependencia ou continuar importando a fachada existente.

## Consumidores por fluxo

| Fluxo | Arquivos principais | Dependencias de meals |
|---|---|---|
| Web/tRPC de refeicoes | `server/nutritionRouter.ts`, `server/modules/meals/service.ts`, `server/modules/meals/groupOperations.ts` | Listar, totais do dia, criar manual, editar, remover, copiar, favoritos, rascunho IA e confirmar. |
| Foto de alimento | `server/modules/photoAnalysis/service.ts` | Usa habitos, cria inferencia pendente, cria midia e confirma refeicao. Falha de imagem auxiliar nao pode bloquear confirmacao. |
| WhatsApp pipeline | `server/modules/whatsapp/service.ts` | Usa `processMealDraft` para fallback nutricional e intents para criar/editar/listar refeicoes. |
| WhatsApp ajustes | `recordAdjustmentIntent.ts`, `gramsAdjustmentIntent.ts`, `gramsIncrementIntent.ts`, `datedFoodAdditionIntent.ts`, `intentActions.ts`, `llmIntentActions.ts` | Le ultimas refeicoes, cria refeicao manual, atualiza itens, substitui alimentos e lista registros. |
| Dashboard e relatorios | `server/modules/insights/service.ts`, export legado `getDashboardSnapshot` | Usa meals por dia, totais, qualidade alimentar, progresso semanal e agrupamento por data. |
| Gamificacao | `server/modules/gamification/store.ts` | Usa resumo semanal, favoritos e refeicoes planejadas. |
| Privacidade | `server/modules/privacy/service.ts` via injecoes em `server/db.ts` | Exporta refeicoes/favoritos e limpa `mealStore`, `favoriteMealStore`, `habitStore` e `inferenceStore`. |
| Foods | `server/modules/foods/catalog.ts` | Usa itens de refeicao para ranking de alimentos recentes, com fallback em memoria. |
| Admin | `server/modules/admin/service.ts` via `getAdminSnapshot` | Conta refeicoes confirmadas e inferencias pendentes. |

## Fachadas temporarias obrigatorias em server/db.ts

Enquanto houver consumidor fora do novo modulo, `server/db.ts` deve manter estas assinaturas e delegar para o servico extraido:

```ts
buildSavedMedia
createPendingMealInference
getPendingInference
getPendingInferenceFromDb
confirmPendingMeal
listUserMeals
listUserMealsByDate
getUserDayMealTotals
createUserManualMeal
copyUserMeal
updateUserMeal
relabelUserMeals
removeUserMeal
listFavoriteMeals
saveFavoriteMeal
reuseFavoriteMeal
getHabitSnapshots
getWeeklySummary
getWeeklyProgress
getDashboardSnapshot
getAdminSnapshot
```

Fachadas que agregam outros dominios (`getWeeklySummary`, `getWeeklyProgress`, `getDashboardSnapshot`, `getAdminSnapshot`) podem continuar em `server/db.ts` por mais tempo, desde que passem a depender do modulo de meals extraido em vez de acessar stores internos diretamente.

## Ordem recomendada de sublotes

### Sublote 0 - Planejamento documentado

Status: esta issue.

Escopo: criar este plano, manter `ARCHITECTURE.md` apontando para ele e nao mover codigo de producao.

Validacao esperada: revisao documental. Como nao ha mudanca de comportamento, os gates automatizados completos ficam planejados para os sublotes de implementacao.

### Sublote 1 permitido - Favoritos de refeicao

Motivo: menor acoplamento relativo, contratos pequenos e risco mais baixo que inferencia/confirmacao.

Escopo:

- Extrair `FavoriteMeal`, `favoriteMealStore`, `favoriteMealIdSequence`, `listFavoriteMeals`, `saveFavoriteMeal` e `reuseFavoriteMeal` para `server/modules/meals/favoritesStore.ts` ou modulo equivalente.
- Remover a escrita direta de `mealFavorites` de `groupOperations.ts`, criando uma fachada de favorito de grupo no mesmo servico quando necessario.
- Manter fachadas em `server/db.ts`.

Fora de escopo: alterar schema, contrato tRPC, UI de favoritos ou regra de dedupe por nome.

Riscos:

- Divergencia entre upsert em banco e dedupe em memoria.
- Favorito de grupo continuar escrevendo por caminho paralelo.
- Gamificacao deixar de reconhecer `created_favorite_meal`.

Testes minimos antes/depois:

- Criar favorito a partir de refeicao confirmada, listar ordenado e com totais.
- Reutilizar favorito criando nova refeicao com copia defensiva dos itens.
- Salvar favorito de grupo quando houver mais de uma refeicao selecionada.
- Validar isolamento por usuario.
- Rodar casos com `DATABASE_URL` e sem `DATABASE_URL`.

Validacoes obrigatorias:

```bash
pnpm agent:check
pnpm build
```

Smoke manual: criar, listar, reutilizar e remover visualmente uma refeicao favorita pela web quando o fluxo de UI for tocado.

### Sublote 2 - Inferencias pendentes e midia

Escopo:

- Extrair `SavedMedia`, `PendingInference`, `inferenceStore`, `mediaIdSequence`, `buildSavedMedia`, `createPendingMealInference`, `getPendingInference`, `getPendingInferenceFromDb` e `persistInferenceToDb`.
- Manter `processMealDraft`, `analyzeFoodPhoto` e `confirmMeal` consumindo as fachadas de `server/db.ts` ate a migracao dos imports.
- Preservar fallback de upload: imagem/audio inline deve continuar alimentando IA quando storage falhar.

Fora de escopo: mudar prompt, provider de IA, schema de `mealInferences`, parser WhatsApp ou contrato de rascunho.

Riscos:

- Confirmacao perder draft em memoria antes de reidratar do banco.
- Midia ficar sem ID consistente no fallback.
- Erro de storage bloquear rascunho ou vazar detalhe sensivel em log.
- Dados de usuarios diferentes se misturarem por `draftId` ou por fallback global.

Testes minimos antes/depois:

- Criar inferencia pendente web e WhatsApp e recuperar por `draftId`.
- Confirmar tentativa com `draftId` de outro usuario deve falhar.
- Reidratar inferencia do banco com `itemsJson`, `totalsJson` e `mediaJson`.
- Falha de storage deve manter processamento por midia inline.
- Foto analisada deve criar midia sem depender da imagem auxiliar.
- Sem `DATABASE_URL`, todo fluxo deve funcionar com `inferenceStore`.

Validacoes obrigatorias:

```bash
pnpm agent:check
pnpm build
```

Smoke manual: gerar rascunho pela web com texto/imagem, gerar rascunho via WhatsApp simulado, confirmar ambos e conferir logs sanitizados.

### Sublote 3 - Refeicoes confirmadas e totais

Escopo:

- Extrair `SavedMeal`, `mealStore`, `mealIdSequence`, `confirmPendingMeal`, `listUserMeals`, `listUserMealsByDate`, `getUserDayMealTotals`, `createUserManualMeal`, `copyUserMeal`, `updateUserMeal`, `relabelUserMeals` e `removeUserMeal`.
- Mover helpers de persistencia: `persistMealToDb`, `updateMealInDb`, `deleteMealFromDb`, `loadMealsFromDb`, `buildOccurredAtRange`, `sumMealItems` e `sumMeals` quando forem exclusivos de meals.
- Manter `server/db.ts` como fachada e manter `mealsRepository` como dependencia explicita.

Fora de escopo: alterar `drizzle/schema.ts`, formato dos itens, calculo de `shared/mealTotals` ou router tRPC.

Riscos:

- Regressao em totais diarios com fuso horario.
- Edicao/remocao nao refletir em relatorios, dashboard ou WhatsApp.
- Itens/midia orfaos no banco apos delete.
- Aprendizado silencioso de alias WhatsApp deixar de rodar apos confirmacao.
- Ranking de alimentos recentes perder acesso a meals em memoria.

Testes minimos antes/depois:

- Dia sem refeicoes retorna totais zerados.
- Dia com uma e varias refeicoes soma calorias, proteina, carboidrato e gordura corretamente.
- Criar manual, copiar, editar, reclassificar e remover refeicao preserva formatos de retorno.
- Edicao de quantidade via WhatsApp recalcula macros e nao duplica refeicao.
- Confirmacao de draft WhatsApp cria alias pessoal quando aplicavel.
- Multiusuario: listagem, totais, edicao e remocao nao cruzam dados.
- Rodar suite sem `DATABASE_URL` e suite com banco quando disponivel.

Validacoes obrigatorias:

```bash
pnpm agent:check
pnpm build
```

Smoke manual: criar refeicao pela web, editar itens, conferir dashboard/totais; simular WhatsApp adicionando e ajustando gramas; conferir relatorio do dia.

### Sublote 4 - Habitos derivados

Escopo:

- Extrair `HabitMemoryState`, `habitStore`, `getHabitSnapshots`, `updateHabitsFromMeal`, `syncHabitsMealLabelFromMeals`, `persistHabitsToDb` e `loadHabitsFromDb`.
- Deixar confirmacao, criacao manual, edicao e relabel chamando o servico de habitos por dependencia.
- Preservar limite de 8 snapshots e ordenacao por frequencia/recencia.

Fora de escopo: alterar algoritmo de IA, prompt, schema de habitos ou UI de insights.

Riscos:

- IA perder contexto de habitos e piorar inferencias.
- Habito ser atualizado quando nao ha dados suficientes.
- Reclassificacao de refeicao nao sincronizar `typicalMealLabel`.
- Dados de banco duplicados agregarem contagem incorreta.

Testes minimos antes/depois:

- Confirmar refeicao nova cria habito derivado.
- Editar refeicao atualiza porcao e recencia sem duplicacao indevida.
- Reclassificar refeicao sincroniza label do habito.
- Sem refeicoes/habitos retorna lista vazia sem erro.
- Banco com linhas duplicadas agrega por alimento mantendo maior `lastSeenAt`.
- Multiusuario preserva isolamento.

Validacoes obrigatorias:

```bash
pnpm agent:check
pnpm build
```

Smoke manual: registrar duas refeicoes semelhantes, gerar novo rascunho e conferir que a inferencia continua recebendo habitos; validar dashboard/insights.

### Sublote 5 - Agregadores, admin, privacidade e cleanup final

Escopo:

- Reduzir ou remover acesso direto de agregadores legados (`getWeeklySummary`, `getWeeklyProgress`, `getDashboardSnapshot`, `getAdminSnapshot`) aos stores internos de meals.
- Ajustar `privacyService`, `gamificationService` e `foodsService` para receber dependencias do modulo extraido.
- Atualizar `ARCHITECTURE.md` marcando o checklist de `meals` apenas quando todos os consumidores estiverem migrados.

Fora de escopo: reescrever relatorios ou gamificacao fora do necessario para desacoplar `server/db.ts`.

Riscos:

- Exportacao LGPD perder refeicoes/favoritos.
- Exclusao de conta nao limpar stores de meals em memoria.
- Admin contar pendencias/refeicoes diferente entre banco e memoria.
- Gamificacao deixar de reconhecer dias com refeicoes ou favoritos.

Testes minimos antes/depois:

- Exportacao de privacidade contem refeicoes, favoritos e peso/progresso esperado.
- Exclusao de conta limpa `mealStore`, `favoriteMealStore`, `habitStore` e drafts pendentes.
- Admin snapshot conta refeicoes e inferencias pendentes em memoria e banco.
- Gamificacao reconhece favoritos, refeicoes planejadas e dias registrados.
- Foods recentes continuam ordenando por uso em refeicoes.

Validacoes obrigatorias:

```bash
pnpm agent:check
pnpm build
pnpm docs:check
```

Smoke manual: dashboard semanal, relatorio semanal, exportacao de privacidade e painel admin.

## Cobertura de cenarios obrigatorios

| Cenario | Sublote responsavel | Teste/validacao esperada |
|---|---|---|
| Inferencia pendente criada por IA/WhatsApp e depois confirmada | 2 e 3 | Draft web/WhatsApp, confirmacao, rejeicao de usuario diferente e reidratacao do banco. |
| Refeicao com midia anexada e fallback quando upload/storage ou imagem auxiliar falha | 2 | Mock de falha de storage e smoke com imagem; confirmacao nao bloqueada. |
| Totais diarios com zero, uma ou varias refeicoes | 3 | Testes de `getUserDayMealTotals` e `listUserMealsByDate`. |
| Ajuste/edicao de refeicao confirmada sem alterar totais indevidamente | 3 | Testes de `updateUserMeal` e intents WhatsApp de gramas/substituicao. |
| Favorito criado, listado, reutilizado e removido | 1 | Testes de favorito simples e grupo; se remocao nao existir no contrato atual, documentar antes de criar contrato novo. |
| Habito derivado atualizado e preservado quando nao houver dados suficientes | 4 | Testes de criacao, edicao, relabel e lista vazia. |
| Fluxos sem banco configurado usam comportamento em memoria | 1 a 5 | Rodar suite com `DATABASE_URL` ausente ou `ALLOW_MEMORY_PERSISTENCE=true` conforme ambiente. |
| Dados de usuarios diferentes nao se misturam | 1 a 5 | Casos multiusuario para drafts, meals, favoritos e habitos. |

## Matriz DATABASE_URL vs memoria

| Area | Com DATABASE_URL | Sem DATABASE_URL |
|---|---|---|
| Inferencias pendentes | `mealInferences` com reidratacao por `draftId`; memoria tambem recebe o draft atual | `inferenceStore` e confirmacao apenas enquanto processo esta vivo |
| Midia | `mealMedia` apos confirmacao quando upload gerou URL; fallback inline usado antes da persistencia | `SavedMedia` em memoria quando upload funcionar; inline quando storage falhar |
| Refeicoes confirmadas | `meals`, `mealItems`, `mealMedia`; fallback para memoria quando leitura/persistencia falha de forma controlada | `mealStore` por usuario |
| Favoritos | `mealFavorites` com upsert por usuario/nome | `favoriteMealStore` com dedupe por nome |
| Habitos derivados | `habits` agregado por alimento | `habitStore` por usuario |
| Totais/relatorios | Dados do banco filtrados por data/fuso, com agregacao em servicos | Dados de memoria filtrados e agregados no mesmo formato |
| Admin/privacidade | Contagens e exportacao via repositorios e servicos | Contagens e exportacao a partir dos stores em memoria |

## Gates por PR futuro

Todos os sublotes que movem codigo de meals tocam area sensivel de fluxo nutricional. A validacao minima por PR e:

```bash
pnpm agent:check
pnpm build
```

Quando houver mudanca de documentacao gerada, contrato tRPC, schema ou docs operacionais, incluir:

```bash
pnpm docs:check
```

Quando houver banco disponivel para validacao:

```bash
pnpm db:check-integrity
```

Se `DATABASE_URL` nao estiver disponivel, a PR deve registrar que a validacao de banco ficou pendente e qual cobertura em memoria foi executada.

## Criterios para encerrar a extracao de meals

- `server/db.ts` contem apenas fachadas delegando para modulos de meals ou agregadores intencionais.
- Nenhum store de meals permanece acessado diretamente fora do modulo extraido.
- Web, WhatsApp, foto, relatorios, gamificacao, privacidade, foods e admin usam dependencias explicitas.
- Testes cobrem banco e memoria para drafts, meals, favoritos, habitos e totais.
- `ARCHITECTURE.md` esta atualizado com a conclusao do item `meals`.
- `pnpm agent:check` e `pnpm build` passam no PR final.
