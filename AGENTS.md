# Guia para agentes

Este repositorio deve ser tratado como uma base de produto versionada para humanos e agentes. Antes de alterar codigo, leia os documentos de dominio correspondentes e mantenha documentacao, testes e checks sincronizados com a mudanca.

## Fluxo obrigatorio

1. Leia `ARCHITECTURE.md` para entender camadas, fronteiras e convencoes.
2. Leia a especificacao de produto afetada em `docs/product-specs/`.
3. Leia o design tecnico afetado em `docs/design-docs/` quando a mudanca tocar backend, banco, IA, WhatsApp, privacidade ou persistencia.
4. Implemente a menor mudanca coerente com a arquitetura atual.
5. Atualize docs geradas/manualizadas em `docs/generated/` quando alterar schema, router ou contratos.
6. Rode `pnpm agent:check` antes de propor merge.
7. Certifique-se de que o banco de dados de teste está sincronizado com `pnpm db:migrate`.

## Mapas rapidos

| Mudanca | Leia primeiro |
|---|---|
| Registro de refeicao, rascunho ou confirmacao | `docs/product-specs/meal-registration.md`, `docs/design-docs/nutrition-engine.md` |
| WhatsApp, webhook ou resposta conversacional | `docs/product-specs/whatsapp-flow.md`, `docs/design-docs/whatsapp-ingestion.md` |
| Migracao da IA para OpenAI | `docs/exec-plans/active/migrate-ai-to-openai.md`, `docs/design-docs/nutrition-engine.md`, `docs/PRIVACY_LGPD.md`, `docs/SECURITY.md` |
| Metas, dashboard ou relatorios | `docs/product-specs/goals-and-reports.md` |
| Profissionais, pacientes e comentarios | `docs/product-specs/professionals.md` |
| Exportacao, exclusao, logs, midia ou IA | `docs/product-specs/privacy-export-deletion.md`, `docs/PRIVACY_LGPD.md`, `docs/SECURITY.md` |
| Schema, migrations ou persistencia | `docs/design-docs/database-persistence.md`, `docs/generated/db-schema.md` |
| tRPC e contratos de API | `docs/generated/trpc-routes.md` |

## Regras de implementacao

- Preserve o monolito React + Express + tRPC + Drizzle; nao introduza microservicos sem plano aprovado em `docs/exec-plans/active/`.
- Nao coloque regra de negocio em paginas React. Regra de negocio deve viver em `server/modules/<dominio>/service.ts` ou em helpers compartilhados.
- Validacao de entrada deve ficar em `server/modules/<dominio>/schemas.ts`.
- O router tRPC deve apenas compor autenticacao, schema, chamada de servico e eventos analiticos seguros.
- Dados de saude, textos crus, transcricoes, midia e prompts sao sensiveis. Nao registrar valores crus em logs, analytics ou mensagens de erro.
- Toda alteracao em IA, WhatsApp, storage, privacidade, banco ou autenticacao deve atualizar documentacao e avaliar riscos em `docs/RELIABILITY.md`, `docs/SECURITY.md` ou `docs/PRIVACY_LGPD.md`.

## Comando de validacao para agentes

```bash
pnpm agent:check
```

Esse comando combina TypeScript, testes, checks de arquitetura e checks de documentacao. Se ele falhar, corrija a causa antes de abrir PR.
