# Documentação gerada/manualizada: rotas tRPC

Este arquivo resume os grupos expostos por `server/nutritionRouter.ts`. Atualize quando adicionar, remover ou renomear procedures.

## Grupos principais

| Grupo | Responsabilidade |
|---|---|
| `privacy` | Exportação de dados e solicitação de exclusão |
| `assistant` | Sugestões alimentares assistidas |
| `foodPhotoAnalysis` | Análise, consulta, rejeição e confirmação de fotos |
| `healthIntegrations` | Conexão, desconexão e sincronização de integrações de saúde |
| `professionals` | Perfil profissional, acessos, pacientes, comentários e sugestões |
| `onboarding` | Conclusão de onboarding nutricional |
| `dashboard` | Visão consolidada diária |
| `goals` | Leitura e atualização de metas |
| `gamification` | Configurações e estado de gamificação |
| `foods` | Catálogo, favoritos e busca de alimentos |
| `meals` | CRUD, rascunho, confirmação, favoritos e totais de refeições |
| `exercises` | Registro de exercícios |
| `water` | Meta e registros de água |
| `reports` | Relatórios semanais e insights |
| `admin` | Visão operacional e token WhatsApp |
| `whatsapp` | Status, vínculo e simulação inbound |

## Regras para novas procedures

- Use `protectedProcedure` por padrão.
- Use `adminProcedure` apenas para operação administrativa real.
- Use procedure pública somente quando estritamente necessário para webhook ou saúde operacional.
- Toda input deve ter schema Zod em `server/modules/<dominio>/schemas.ts`.
- Errors conhecidos devem ser traduzidos para `TRPCError` com mensagem segura.
- Eventos de analytics devem conter categorias e contadores, nunca dados crus de saúde.
