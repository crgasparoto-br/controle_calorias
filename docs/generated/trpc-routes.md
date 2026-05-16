# Documentação gerada: rotas tRPC

> Arquivo gerado automaticamente por `pnpm docs:generate:trpc`. Não edite manualmente.

Fonte: `server/nutritionRouter.ts`.

## Grupos

| Grupo | Procedures | Queries | Mutations | Escopo predominante | Responsabilidade |
|---|---:|---:|---:|---|---|
| `privacy` | 2 | 1 | 1 | protected | Exportação de dados e solicitação de exclusão |
| `assistant` | 1 | 0 | 1 | protected | Sugestões alimentares assistidas |
| `foodPhotoAnalysis` | 4 | 1 | 3 | protected | Análise, consulta, rejeição e confirmação de fotos |
| `healthIntegrations` | 4 | 1 | 3 | protected | Conexão, desconexão e sincronização de integrações de saúde |
| `professionals` | 11 | 5 | 6 | protected | Perfil profissional, acessos, pacientes, comentários e sugestões |
| `onboarding` | 1 | 0 | 1 | protected | Conclusão de onboarding nutricional |
| `dashboard` | 1 | 1 | 0 | protected | Visão consolidada diária |
| `goals` | 2 | 1 | 1 | protected | Leitura e atualização de metas |
| `gamification` | 2 | 1 | 1 | protected | Configurações e estado de gamificação |
| `foods` | 5 | 2 | 3 | protected | Catálogo, favoritos e busca de alimentos |
| `meals` | 11 | 3 | 8 | protected | CRUD, rascunho, confirmação, favoritos e totais de refeições |
| `exercises` | 4 | 1 | 3 | protected | Registro de exercícios |
| `water` | 5 | 2 | 3 | protected | Meta e registros de água |
| `reports` | 3 | 3 | 0 | protected | Relatórios semanais e insights |
| `admin` | 3 | 2 | 1 | admin | Visão operacional administrativa |
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
| `history` | query | protected |

### onboarding

| Procedure | Operação | Escopo |
|---|---|---|
| `complete` | mutation | protected |

### dashboard

| Procedure | Operação | Escopo |
|---|---|---|
| `overview` | query | protected |

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
| `copy` | mutation | protected |
| `favorites` | query | protected |
| `saveFavorite` | mutation | protected |
| `reuseFavorite` | mutation | protected |
| `remove` | mutation | protected |
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
| `weekly` | query | protected |
| `weeklyProgress` | query | protected |
| `weeklyInsights` | query | protected |

### admin

| Procedure | Operação | Escopo |
|---|---|---|
| `overview` | query | admin |
| `whatsappTokenStatus` | query | admin |
| `updateWhatsappToken` | mutation | admin |

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
