# Documentação do projeto

Este diretório reúne a documentação canônica do Controle de Calorias. Use este índice antes de criar novos documentos para evitar duplicidade entre plano, especificação e registro técnico.

## Documentos raiz

| Documento | Uso |
|---|---|
| `../README.md` | Visão geral do produto, stack e configuração inicial. |
| `../ARCHITECTURE.md` | Fronteiras de camadas, áreas de experiência, regras de dependência e direção arquitetural. |
| `../AGENTS.md` | Guia obrigatório para agentes e automações. |
| `../CONTRIBUTING.md` | Gates de validação, critérios antes de PR e comandos mínimos por tipo de mudança. |

## Especificações de produto

Use `docs/product-specs/` para regras funcionais, critérios de aceite e comportamento esperado por domínio.

| Área | Documento |
|---|---|
| Modelo do produto e separação dos fluxos | `product-specs/product-experience-model.md` |
| Registro de refeições | `product-specs/meal-registration.md` |
| Metas, Hoje, Registros e Relatórios | `product-specs/goals-and-reports.md` |
| Privacidade, exportação e exclusão | `product-specs/privacy-export-deletion.md` |
| Área Profissional, vínculos e acompanhamento | `product-specs/professionals.md` |
| Integrações de saúde / Strava | `product-specs/health-integrations.md` |

`product-experience-model.md` é a fonte canônica para:

- posicionamento comercial centrado no nutricionista;
- coexistência entre Área do Paciente e Área Profissional;
- preservação da experiência individual já desenvolvida;
- classificação de issues entre experiência atual, plataforma compartilhada, programa profissional e billing.

## Design técnico

Use `docs/design-docs/` para decisões técnicas, contratos internos e detalhes de implementação que complementam as specs de produto.

Exemplos principais:

- `design-docs/nutrition-engine.md`
- `design-docs/database-persistence.md`
- `design-docs/photo-analysis-catalog-integration.md`
- `design-docs/manual-meal-catalog-search.md`
- `design-docs/food-portions-household-measures.md`
- `design-docs/custom-foods.md`
- `design-docs/whatsapp-conversation-context.md`
- `design-docs/whatsapp-ingestion.md`

## Testes e regressão

Use `docs/testing/` para matrizes e roteiros de validação que precisam permanecer reproduzíveis.

- `testing/whatsapp-conversation-context-regression.md` — matriz multicanal, profundidade, reinício, múltiplas instâncias, rollout e rollback do contexto persistente.

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

Novas funcionalidades profissionais devem ser incorporadas a `product-specs/professionals.md` ou a design docs vinculados. Não criar documentos paralelos que misturem a evolução da Área Profissional com correções da Área do Paciente, infraestrutura compartilhada ou billing.