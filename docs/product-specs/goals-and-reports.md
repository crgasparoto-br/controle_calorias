# Especificação de produto: metas e relatórios

## Objetivo

Ajudar o usuário a acompanhar consumo nutricional, progresso semanal e aderência a metas de calorias, proteínas, carboidratos e gorduras.

## Regras de produto

- Metas devem aceitar regra padrão e exceções por janela de tempo.
- A meta geral deve iniciar a configuração de macronutrientes em percentual, exibindo a soma dos percentuais e os gramas derivados a partir da meta calórica informada.
- Valores potencialmente inseguros devem gerar aviso ou bloqueio antes da persistência.
- Relatórios semanais usam semana iniciando na segunda-feira.
- Toda data lógica vinculada a um usuário usa o timezone efetivo do dono dos dados; o timezone do servidor, navegador ou profissional não substitui o perfil.
- Dia, semana e período são convertidos para consultas UTC em intervalo semiaberto `[início inclusivo, fim exclusivo)`, preservando timestamps absolutos.
- O timezone é resolvido uma vez por operação de Hoje/Relatórios e propagado às consultas, sem leitura de perfil por item ou por dia.
- Refeições confirmadas devem exibir itens, porções, macros, calorias e horário.
- Hoje e relatórios devem usar a mesma fonte de totais para evitar divergência.
- Hoje permanece focado no dia selecionado, inicia em hoje e não deve depender de consultas históricas pesadas.
- Hoje deve permitir navegação simples entre dias próximos e oferecer retorno rápido para hoje.
- Registros deve permitir consulta operacional por dia, semana, mês e período configurável.
- Registros deve incluir refeições, hidratação e atividade física no mesmo intervalo ativo para revisão operacional.
- Relatórios deve permitir análise por dia, semana, mês e período configurável com o mesmo padrão visual de seleção.
- Relatórios devem priorizar aderência às metas e evolução, não listagem detalhada de alimentos.
- Relatórios de semana, mês e período devem carregar a primeira leitura usando apenas dados do intervalo ativo, evitando depender de consultas históricas pesadas.
- A carga por intervalo de Relatórios deve emitir métricas estruturadas somente quando `REPORTS_OBSERVABILITY_ENABLED` ou `REPORTS_METRICS_ENABLED` estiver ativa.
- Métricas de Relatórios devem informar etapa, duração, tamanho aproximado de payload, quantidade de itens e indicação de fallback sem incluir identificadores de usuário, textos de refeições ou dados sensíveis.
- A visão semanal de Relatórios deve tentar usar o resumo leve `reports.weekly` quando ele existir e retornar um contrato renderizável completo.
- `reports.weekly` deve retornar exatamente 7 dias para a semana solicitada; semana sem registros deve vir como 7 dias zerados, não como lista vazia.
- A tela deve validar o contrato semanal antes de renderizar o resumo e fazer fallback automático para `reports.bundle` quando o resumo falhar, vier incompleto ou tiver campos obrigatórios incompatíveis.
- O detalhamento completo de dias e refeições deve continuar sob demanda quando o resumo semanal validado for suficiente para a primeira leitura.
- Períodos customizados de relatórios são limitados a 90 dias inclusivos; ranges invertidos ou maiores devem ser bloqueados pelo backend e avisados pela interface quando possível.
- A leitura principal de relatórios deve comparar consumido vs meta ajustada, macros planejados vs realizados, peso, qualidade alimentar, água e exercícios.
- A organização visual de Relatórios deve começar por um resumo do período com cards de decisão antes dos blocos analíticos detalhados.
- Meta efetiva de calorias é a meta base do dia somada às calorias de exercícios registrados no mesmo dia somente quando a configuração do usuário habilita essa compensação. O WhatsApp exibe apenas `Meta`, recebida do domínio, sem recalcular ou distinguir “estimada/ajustada”.
- A distribuição percentual de macronutrientes deve ser calculada por calorias: proteína e carboidrato usam 4 kcal/g, gordura usa 9 kcal/g.
- A qualidade alimentar em Relatórios deve ser agregada por período e não deve listar alimentos individualmente.
- Alimentos sem classificação disponível devem entrar como `não classificados` para não inflar artificialmente percentuais de ultraprocessados ou in natura/minimamente processados.
- O detalhamento alimento por alimento deve permanecer em Refeições registradas; Relatórios pode apontar para essa tela quando o usuário precisar auditar um dia específico.
- O gráfico de evolução de peso deve usar os registros de peso existentes nos dias do período selecionado para demonstrar oscilações, mantendo estado vazio quando não houver peso no intervalo.

## Relatórios orientados a metas

A tela de Relatórios deve responder primeiro se o usuário está evoluindo em relação às metas nutricionais e hábitos de suporte.

A experiência deve conter:

- resumo do período com cards principais de aderência calórica, média consumida, média da meta ajustada, desvio médio, variação de peso, qualidade alimentar, água e exercícios;
- aderência calórica com percentual médio, desvio médio e dias abaixo, dentro e acima da faixa ideal;
- gráfico de consumido vs meta ajustada, mantendo a meta base como referência complementar quando útil;
- comparação de macronutrientes em gramas e em distribuição percentual planejada vs realizada;
- comparação visual entre percentual planejado e percentual realizado por macro;
- macro mais distante da meta;
- contadores de dias com proteína dentro da faixa e gordura acima da meta;
- visão agregada de qualidade alimentar com proteína, fibras, frutas, legumes/verduras, ultraprocessados e regularidade quando houver classificação disponível;
- dias com frutas registradas no período;
- dias com legumes/verduras registrados no período;
- percentual estimado de calorias vindas de ultraprocessados;
- percentual estimado de calorias vindas de alimentos in natura/minimamente processados, quando houver classificação disponível;
- percentual de calorias não classificadas para deixar clara a limitação dos dados (ver pipeline de classificação automática em `docs/product-specs/meal-registration.md`);
- cada categoria de processamento (in natura/minimamente processados, ingredientes culinários processados, processados, ultraprocessados, conhecidos sem nível definido e não classificados) é clicável e abre um pop-up com a lista dos alimentos que compõem aquelas calorias no período (nome, calorias totais e nº de ocorrências), para investigação sob demanda sem poluir a visão padrão;
- índice simples de qualidade alimentar calculado apenas sobre calorias classificadas, sem linguagem moralizante;
- evolução de peso como sinal de apoio, usando os registros reais do período para mostrar oscilações quando houver mais de um peso registrado;
- água como contexto da meta, incluindo consumo vs meta de água, média diária, percentual médio de aderência e dias com meta batida;
- exercícios como contexto da meta, incluindo frequência de dias ativos, gasto estimado e comparação da meta ajustada média entre dias com e sem exercício;
- comparação de aderência calórica entre dias com exercício e dias sem exercício, para explicar o efeito do gasto estimado na leitura da meta ajustada;
- detalhamento diário com consumo, meta ajustada, diferença em kcal e percentual de aderência como bloco secundário, depois dos principais sinais de decisão.

Quando faltarem dados de peso, qualidade alimentar, água ou exercícios, a tela deve exibir estado vazio claro sem bloquear a leitura das demais métricas.

Quando não houver meta de macronutrientes configurada, a seção de macros deve exibir fallback claro sem tentar inferir meta a partir dos alimentos registrados.

## Critérios de aceite

- Alteração de meta atualiza dashboard e relatórios.
- Relatório semanal não inclui rascunhos não confirmados.
- Eventos analíticos não contêm dados sensíveis de saúde ou refeição crua.
- Hoje deixa claro qual dia está ativo e permite voltar para hoje.
- Registros e Relatórios deixam claro qual período está ativo e qual intervalo está sendo analisado.
- Relatórios exibem comparação entre meta ajustada e realizado sempre que houver meta disponível.
- Relatórios recalculam a meta ajustada e a aderência quando o usuário altera o período selecionado.
- Relatórios deixam claro no primeiro bloco se o usuário está aderindo, desviando ou sem dados suficientes para os principais sinais.
- Relatórios exibem, por dia, consumo, meta ajustada, diferença em kcal e percentual de aderência.
- Relatórios permitem entender se o usuário bateu calorias, mas errou a composição de macronutrientes.
- Relatórios exibem comparação visual entre percentual planejado e percentual realizado de macros.
- Relatórios exibem comparação em gramas por macro para evitar distorção de leitura.
- Relatórios recalculam médias e percentuais de macros quando o período selecionado muda.
- Relatórios exibem qualidade alimentar agregada por período, sem detalhar alimentos individualmente.
- Relatórios separam calorias classificadas e não classificadas nos indicadores de qualidade alimentar.
- Relatórios exibem água e exercícios como indicadores de apoio às metas, sem transformar Reports em dashboard detalhado de treinos ou hidratação.
- Relatórios usam registros reais de peso do período selecionado no gráfico de evolução de peso quando houver dados no intervalo.
- Relatórios não duplicam a experiência operacional de Refeições registradas.
- Relatórios semanais usam `reports.weekly` somente quando o retorno tem 7 dias completos e campos mínimos renderizáveis.
- Relatórios semanais fazem fallback para `reports.bundle` quando `reports.weekly` falha ou não cumpre o contrato mínimo.
- Períodos customizados acima de 90 dias inclusivos são rejeitados antes de consultas pesadas.
- Métricas estruturadas de Relatórios são emitidas apenas quando a flag de observabilidade está ativa e não contêm dados sensíveis.
- A visão de dia/mês/período (`reports.periodBundle`) e a visão semanal (`reports.weekly`/`reports.bundle`) devem retornar exatamente o mesmo formato de qualidade alimentar por dia (`daily[].quality`) e agregado (`quality`), para que a seção de qualidade alimentar não fique zerada fora do escopo "semana".

## Notas de implementação (backend)

- A camada tRPC resolve `userProfiles.timezone` uma vez antes de chamar Hoje ou Relatórios. Em acesso profissional, a resolução usa o `patientUserId`, nunca o profissional autenticado.
- `server/modules/insights/rangeData.ts` exige timezone explícito e constrói os limites do calendário local com `getUtcRangeForInclusiveLocalDateRange`; leituras vazias legítimas permanecem vazias, enquanto falhas continuam sendo propagadas/observadas em vez de mascaradas como sucesso.
- `server/modules/insights/service.ts` monta os relatórios de semana (`buildWeeklyReportSummary`) e de dia/mês/período (`getPeriodReportBundle`) a partir das funções de intervalo em `server/modules/insights/rangeData.ts` (`listReportMealsByDateRange`, `listReportExercisesByDateRange`, `listReportWaterLogsByDateRange`), que buscam refeições, exercícios e água do intervalo inteiro em **uma única consulta por tipo de dado** (não mais uma consulta por dia do período) e agrupam os resultados em memória por data lógica (`getDateKeyInTimeZone`).
- As metas diárias (`getNutritionGoalForDate`) ainda são buscadas dia a dia dentro do período; como a tabela de metas é pequena por usuário, isso não gera impacto de performance relevante hoje, mas é candidato a lote caso o período de análise cresça muito (ex.: relatórios anuais).
- Tabelas usadas pelos relatórios (`meals`, `exercises`, `waterLogs`, `mealItems`) devem ter índices por `userId` (+ `status` e/ou `occurredAt` conforme o predicado usado). Ao alterar consultas de relatório, confirme que o predicado usado bate com um índice existente (`drizzle/schema.ts`) antes de assumir que a lentidão é só de código.
- **Causa raiz real do incidente "Relatórios não carrega" (2026-07-03):** `server/repositories/mealsRepository.ts` (`findItemsWithMealDates`) buscava TODAS as refeições do usuário e, para cada uma, disparava uma query extra para os itens (N+1 sobre o histórico de vida inteiro do usuário, não só o período do relatório). Essa função é chamada em todo carregamento de Relatórios (via `searchFoods` → "uso recente" no lookup de qualidade alimentar), então crescia com o histórico total de refeições confirmadas, não com o tamanho do período selecionado. Para uma conta com ~350 refeições isso levava >2 minutos por requisição, e a tela parecia "vazia" porque a query nunca chegava a resolver a tempo do usuário perceber dado carregado. Reescrito para um único `INNER JOIN` entre `mealItems` e `meals`; tempo de resposta caiu de ~2min20s para ~2-3s no mesmo ambiente. Produção também estava sem os índices declarados em `drizzle/schema.ts` para `meals`, `exercises`, `waterLogs` e `mealItems` (só havia chave primária) — os índices foram recriados via migration; ao investigar lentidão futura, confira sempre se os índices do schema realmente existem no banco (drift de migration é possível).
- **Regressão pós-merge do PR #650 em `develop` (2026-07-03):** após o merge, exercícios pararam de aparecer nos relatórios e a seção "Qualidade alimentar" voltou a ficar sempre vazia na visão semanal padrão. Duas causas distintas:
  1. A migration `0018_loud_human_robot.sql` adiciona `externalProvider`/`externalId` a `exercises` (parte do trabalho paralelo de integração Strava, já em `develop`), mas só a parte de classificação de alimentos dessa migration havia sido aplicada em produção antes do merge — o `ALTER TABLE` de `exercises` nunca rodou. Toda leitura de `exercises` falhava silenciosamente (erro capturado e tratado como fallback vazio em `rangeData.ts`), então nenhum exercício aparecia em nenhum escopo. Corrigido aplicando os `ALTER TABLE`/`CREATE INDEX` faltantes diretamente em produção; confira sempre `SHOW COLUMNS` contra o schema declarado ao investigar sintomas parecidos ("dado simplesmente não aparece, sem erro visível na tela").
  2. `getWeeklyReport` (usado por `reports.weekly`, o resumo leve preferencial da visão semanal) chamava `buildWeeklyReportSummary` sem `includeFoodQualityDetails`, então cada dia vinha com `quality.foodQualityItems: []` e o retorno não tinha nenhum campo `quality` agregado. O frontend (`ReportsExperience.tsx`) lê `bundleData?.quality?.foodQuality`; como esse campo não existia no resumo leve, caía para um agregado calculado no cliente a partir dos itens vazios — sempre "sem classificação suficiente", mesmo com dados reais no banco. Corrigido fazendo `getWeeklyReport` usar `includeFoodQualityDetails: true` e retornar `quality: buildAggregateQuality(weekly)`, no mesmo formato que `reports.bundle`/`reports.periodBundle` já usavam.
- **Drill-down por categoria de processamento (2026-07-03):** `shared/reportsGoalAnalytics.ts` (`calculateFoodQualitySummary`) agora agrupa os `FoodQualityItem` de cada dia por nome normalizado (mesma técnica já usada para `unclassifiedItems`) dentro de cada categoria de processamento, expondo `distribution[].items: FoodQualityCategoryItem[]` (nome, calorias totais, ocorrências, primeira/última data). O frontend (`FoodQualitySection` em `client/src/features/reports/ReportsExperience.tsx`) transforma cada card de categoria em um botão que abre um `Dialog` com essa lista. Isso exigiu também popular `foodName`/`canonicalName`/`portionText`/`foodCatalogId` nos itens **classificados** em `server/modules/insights/foodQuality.ts` (`calculateQualityIndicators`) — antes só os itens não classificados carregavam esses campos, então o agrupamento por categoria classificada caía todo num único "alimento sem identificação".
