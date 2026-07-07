# Documentação do projeto

Este diretório reúne a documentação canônica do Controle de Calorias. Use este índice antes de criar novos documentos para evitar duplicidade entre plano, especificação e registro técnico.

## Documentos raiz

| Documento | Uso |
|---|---|
| `../README.md` | Visão geral do produto, stack e configuração inicial. |
| `../ARCHITECTURE.md` | Fronteiras de camadas, regras de dependência e direção arquitetural. |
| `../AGENTS.md` | Guia obrigatório para agentes e automações. |
| `../CONTRIBUTING.md` | Gates de validação, critérios antes de PR e comandos mínimos por tipo de mudança. |

## Especificações de produto

Use `docs/product-specs/` para regras funcionais, critérios de aceite e comportamento esperado por domínio.

| Área | Documento |
|---|---|
| Registro de refeições | `product-specs/meal-registration.md` |
| Metas, Hoje, Registros e Relatórios | `product-specs/goals-and-reports.md` |
| Privacidade, exportação e exclusão | `product-specs/privacy-export-deletion.md` |
| Profissionais e pacientes | `product-specs/professionals.md` |
| Integrações de saúde / Strava | `product-specs/health-integrations.md` |

## Design técnico

Use `docs/design-docs/` para decisões técnicas, contratos internos e detalhes de implementação que complementam as specs de produto.

Exemplos principais:

- `design-docs/nutrition-engine.md`
- `design-docs/database-persistence.md`
- `design-docs/photo-analysis-catalog-integration.md`
- `design-docs/manual-meal-catalog-search.md`
- `design-docs/food-portions-household-measures.md`
- `design-docs/custom-foods.md`

## Documentação operacional e sensível

| Documento | Uso |
|---|---|
| `PRIVACY_LGPD.md` | Política técnica canônica para dados pessoais, dados sensíveis, IA, mídia, logs, exportação e exclusão. |
| `SECURITY.md` | Regras de segurança, segredos e hardening. |
| `RELIABILITY.md` | Resiliência, observabilidade e riscos operacionais. |
| `runbooks/` | Checklists e evidências operacionais de rollout. |

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
