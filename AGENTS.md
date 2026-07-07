# Guia para agentes

Este repositorio deve ser tratado como uma base de produto versionada para humanos e agentes. Antes de alterar codigo, leia os documentos de dominio correspondentes e mantenha documentacao, testes e checks sincronizados com a mudanca.

## Fluxo obrigatorio

1. Leia `docs/README.md` para identificar a documentacao canonica da area afetada.
2. Leia `ARCHITECTURE.md` para entender camadas, fronteiras e convencoes.
3. Leia a especificacao de produto afetada em `docs/product-specs/`.
4. Leia o design tecnico afetado em `docs/design-docs/` quando a mudanca tocar backend, banco, IA, WhatsApp, privacidade ou persistencia.
5. Implemente a menor mudanca coerente com a arquitetura atual.
6. Atualize docs geradas/manualizadas em `docs/generated/` quando alterar schema, router ou contratos.
7. Siga o gate minimo por tipo de mudanca definido em `CONTRIBUTING.md`.
8. Rode `pnpm agent:check` antes de propor merge quando a alteracao tocar area sensivel, documentacao operacional ou instrucoes usadas por agentes.
9. Quando a mudanca depender de banco, migration ou dados, aplique o fluxo do projeto com `pnpm db:push` quando necessario e valide integridade com `pnpm db:check-integrity` quando houver `DATABASE_URL` disponivel.

## Mapas rapidos

| Mudanca | Leia primeiro |
|---|---|
| Registro de refeicao, rascunho ou confirmacao | `docs/product-specs/meal-registration.md`, `docs/design-docs/nutrition-engine.md` |
| WhatsApp, webhook ou resposta conversacional | `docs/product-specs/whatsapp-flow.md`, `docs/design-docs/whatsapp-ingestion.md` |
| Migracao da IA para OpenAI | `docs/exec-plans/active/migrate-ai-to-openai.md`, `docs/design-docs/nutrition-engine.md`, `docs/PRIVACY_LGPD.md`, `docs/SECURITY.md` |
| Metas, dashboard ou relatorios | `docs/product-specs/goals-and-reports.md` |
| Profissionais, pacientes e comentarios | `docs/product-specs/professionals.md` |
| Exportacao, exclusao, logs, midia ou IA | `docs/product-specs/privacy-export-deletion.md`, `docs/PRIVACY_LGPD.md`, `docs/SECURITY.md` |
| Strava, OAuth ou integracoes de saude | `docs/product-specs/health-integrations.md`, `docs/PRIVACY_LGPD.md`, `docs/SECURITY.md` |
| Schema, migrations ou persistencia | `docs/design-docs/database-persistence.md`, `docs/generated/db-schema.md` |
| tRPC e contratos de API | `docs/generated/trpc-routes.md` |

## Regras de implementacao

- Preserve o monolito React + Express + tRPC + Drizzle; nao introduza microservicos sem plano aprovado em `docs/exec-plans/active/`.
- Nao coloque regra de negocio em paginas React. Regra de negocio deve viver em `server/modules/<dominio>/service.ts` ou em helpers compartilhados.
- Validacao de entrada deve ficar em `server/modules/<dominio>/schemas.ts`.
- O router tRPC deve apenas compor autenticacao, schema, chamada de servico e eventos analiticos seguros.
- Dados de saude, textos crus, transcricoes, midia e prompts sao sensiveis. Nao registrar valores crus em logs, analytics ou mensagens de erro.
- Toda alteracao em IA, WhatsApp, storage, privacidade, banco ou autenticacao deve atualizar documentacao e avaliar riscos em `docs/RELIABILITY.md`, `docs/SECURITY.md` ou `docs/PRIVACY_LGPD.md`.
- Nao crie documentos paralelos de planejamento quando a informacao puder ser incorporada a uma especificacao canonica, design doc, runbook ou plano ativo existente. Planos temporarios devem ser removidos ou arquivados quando forem implementados.

## Comando de validacao para agentes

```bash
pnpm agent:check
```

Esse comando combina TypeScript, testes, checks de arquitetura e checks de documentacao. Ele e obrigatorio para areas sensiveis e para mudancas que alterem documentacao operacional usada por agentes. Para os demais tipos de mudanca, use o gate minimo por tipo descrito em `CONTRIBUTING.md` e registre na PR os comandos executados, validacoes manuais e limitacoes de ambiente.
