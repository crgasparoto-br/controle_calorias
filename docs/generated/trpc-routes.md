# Documentação gerada: rotas tRPC

> Arquivo gerado automaticamente por `pnpm docs:generate:trpc`. Não edite manualmente.

Fonte: `server/nutritionRouter.ts`.

## Grupos

| Grupo | Procedures | Queries | Mutations | Escopo predominante | Responsabilidade |
|---|---:|---:|---:|---|---|
| `privacy` | 2 | 1 | 1 | protected | Exportação de dados e solicitação de exclusão |
| `assistant` | 1 | 0 | 1 | protected | Sugestões alimentares assistidas |
| `foodPhotoAnalysis` | 4 | 1 | 3 | protected | Análise, consulta, rejeição e confirmação de fotos |
| `healthIntegrations` | 5 | 2 | 3 | protected | Conexão, desconexão e sincronização de integrações de saúde |
| `professionals` | 13 | 5 | 8 | protected | Perfil profissional, acessos, pacientes, comentários, sugestões e perguntas com IA |
| `onboarding` | 2 | 1 | 1 | protected | Conclusão de onboarding nutricional |
| `mealSchedules` | 3 | 2 | 1 | protected | Grupo de procedures tRPC |
| `dashboard` | 2 | 2 | 0 | protected | Visão consolidada diária |
| `goals` | 2 | 1 | 1 | protected | Leitura e atualização de metas |
| `gamification` | 2 | 1 | 1 | protected | Configurações e estado de gamificação |
| `foods` | 12 | 5 | 7 | protected | Catálogo, favoritos e busca de alimentos |
| `meals` | 15 | 3 | 12 | protected | CRUD, rascunho, confirmação, favoritos e totais de refeições |
| `exercises` | 4 | 1 | 3 | protected | Registro de exercícios |
| `water` | 5 | 2 | 3 | protected | Meta e registros de água |
| `reports` | 6 | 6 | 0 | protected | Relatórios semanais e insights |
| `admin` | 4 | 2 | 2 | admin | Visão operacional administrativa |
| `whatsapp` | 3 | 1 | 2 | protected | Status, vínculo e simulação inbound |

## Procedures por grupo

### privacy

| Procedure | Operação | Escopo |
|---|---|---|
| `exportData` | query | protected |
| `requestAccountDeletion` | mutation | protected |

### assistant

| Procedure | Operação | Escopo |
|---|---|---|
| `suggest` | mutation | protected |

### foodPhotoAnalysis

| Procedure | Operação | Escopo |
|---|---|---|
| `analyze` | mutation | protected |
| `get` | query | protected |
| `reject` | mutation | protected |
| `confirm` | mutation | protected |

### healthIntegrations

| Procedure | Operação | Escopo |
|---|---|---|
| `status` | query | protected |
| `syncedRecords` | query | protected |
| `connect` | mutation | protected |
| `disconnect` | mutation | protected |
| `sync` | mutation | protected |

### professionals

| Procedure | Operação | Escopo |
|---|---|---|
| `profile` | query | protected |
| `upsertProfile` | mutation | protected |
| `requestAccess` | mutation | protected |
| `myAccesses` | query | protected |
| `patientRequests` | query | protected |
| `approveAccess` | mutation | protected |
| `revokeAccess` | mutation | protected |
| `patientDashboard` | query | protected |
| `addComment` | mutation | protected |
| `suggestGoalAdjustment` | mutation | protected |
| `suggestMealPlan` | mutation | protected |
| `askPatientQuestion` | mutation | protected |
| `history` | query | protected |

### onboarding

| Procedure | Operação | Escopo |
|---|---|---|
| `profile` | query | protected |
| `complete` | mutation | protected |

### mealSchedules

| Procedure | Operação | Escopo |
|---|---|---|
| `list` | query | protected |
| `update` | mutation | protected |
| `suggest` | query | protected |

### dashboard

| Procedure | Operação | Escopo |
|---|---|---|
| `overview` | query | protected |
| `today` | query | protected |

### goals

| Procedure | Operação | Escopo |
|---|---|---|
| `get` | query | protected |
| `update` | mutation | protected |

### gamification

| Procedure | Operação | Escopo |
|---|---|---|
| `get` | query | protected |
| `updateSettings` | mutation | protected |

### foods

| Procedure | Operação | Escopo |
|---|---|---|
| `search` | query | protected |
| `catalogSearch` | query | protected |
| `catalogGet` | query | protected |
| `catalogRecent` | query | protected |
| `catalogFavorite` | mutation | protected |
| `customCreate` | mutation | protected |
| `customUpdate` | mutation | protected |
| `customDelete` | mutation | protected |
| `recent` | query | protected |
| `favorite` | mutation | protected |
| `create` | mutation | protected |
| `update` | mutation | protected |

### meals

| Procedure | Operação | Escopo |
|---|---|---|
| `list` | query | protected |
| `dayTotals` | query | protected |
| `createManual` | mutation | protected |
| `update` | mutation | protected |
| `updateGroup` | mutation | protected |
| `copy` | mutation | protected |
| `copyGroup` | mutation | protected |
| `favorites` | query | protected |
| `saveFavorite` | mutation | protected |
| `saveFavoriteGroup` | mutation | protected |
| `reuseFavorite` | mutation | protected |
| `remove` | mutation | protected |
| `removeGroup` | mutation | protected |
| `processDraft` | mutation | protected |
| `confirm` | mutation | protected |

### exercises

| Procedure | Operação | Escopo |
|---|---|---|
| `list` | query | protected |
| `create` | mutation | protected |
| `update` | mutation | protected |
| `remove` | mutation | protected |

### water

| Procedure | Operação | Escopo |
|---|---|---|
| `goal` | query | protected |
| `updateGoal` | mutation | protected |
| `list` | query | protected |
| `create` | mutation | protected |
| `remove` | mutation | protected |

### reports

| Procedure | Operação | Escopo |
|---|---|---|
| `periodBundle` | query | protected |
| `habitAnalytics` | query | protected |
| `bundle` | query | protected |
| `weekly` | query | protected |
| `weeklyProgress` | query | protected |
| `weeklyInsights` | query | protected |

### admin

| Procedure | Operação | Escopo |
|---|---|---|
| `overview` | query | admin |
| `whatsappTokenStatus` | query | admin |
| `updateWhatsappToken` | mutation | admin |
| `curateGlobalFood` | mutation | admin |

### whatsapp

| Procedure | Operação | Escopo |
|---|---|---|
| `status` | query | protected |
| `upsertConnection` | mutation | protected |
| `simulateInbound` | mutation | protected |

## Regras para novas procedures

- Use `protectedProcedure` por padrão.
- Use `adminProcedure` apenas para operação administrativa real.
- Toda input deve ter schema Zod em `server/modules/<dominio>/schemas.ts`.
- Erros conhecidos devem ser traduzidos para `TRPCError` com mensagem segura.
- Eventos de analytics devem conter categorias e contadores, nunca dados crus de saúde.

