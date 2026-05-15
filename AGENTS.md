# Guia para agentes

Este repositório deve ser tratado como uma base de produto versionada para humanos e agentes. Antes de alterar código, leia os documentos de domínio correspondentes e mantenha documentação, testes e checks sincronizados com a mudança.

## Fluxo obrigatório

1. Leia `ARCHITECTURE.md` para entender camadas, fronteiras e convenções.
2. Leia a especificação de produto afetada em `docs/product-specs/`.
3. Leia o design técnico afetado em `docs/design-docs/` quando a mudança tocar backend, banco, IA, WhatsApp, privacidade ou persistência.
4. Implemente a menor mudança coerente com a arquitetura atual.
5. Atualize docs geradas/manualizadas em `docs/generated/` quando alterar schema, router ou contratos.
6. Rode `pnpm agent:check` antes de propor merge.

## Mapas rápidos

| Mudança | Leia primeiro |
|---|---|
| Registro de refeição, rascunho ou confirmação | `docs/product-specs/meal-registration.md`, `docs/design-docs/nutrition-engine.md` |
| WhatsApp, webhook ou resposta conversacional | `docs/product-specs/whatsapp-flow.md`, `docs/design-docs/whatsapp-ingestion.md` |
| Metas, dashboard ou relatórios | `docs/product-specs/goals-and-reports.md` |
| Profissionais, pacientes e comentários | `docs/product-specs/professionals.md` |
| Exportação, exclusão, logs, mídia ou IA | `docs/product-specs/privacy-export-deletion.md`, `docs/PRIVACY_LGPD.md`, `docs/SECURITY.md` |
| Schema, migrations ou persistência | `docs/design-docs/database-persistence.md`, `docs/generated/db-schema.md` |
| tRPC e contratos de API | `docs/generated/trpc-routes.md` |

## Regras de implementação

- Preserve o monólito React + Express + tRPC + Drizzle; não introduza microserviços sem plano aprovado em `docs/exec-plans/active/`.
- Não coloque regra de negócio em páginas React. Regra de negócio deve viver em `server/modules/<dominio>/service.ts` ou em helpers compartilhados.
- Validação de entrada deve ficar em `server/modules/<dominio>/schemas.ts`.
- O router tRPC deve apenas compor autenticação, schema, chamada de serviço e eventos analíticos seguros.
- Dados de saúde, textos crus, transcrições, mídia e prompts são sensíveis. Não registrar valores crus em logs, analytics ou mensagens de erro.
- Toda alteração em IA, WhatsApp, storage, privacidade, banco ou autenticação deve atualizar documentação e avaliar riscos em `docs/RELIABILITY.md`, `docs/SECURITY.md` ou `docs/PRIVACY_LGPD.md`.

## Comando de validação para agentes

```bash
pnpm agent:check
```

Esse comando combina TypeScript, testes, checks de arquitetura e checks de documentação. Se ele falhar, corrija a causa antes de abrir PR.
