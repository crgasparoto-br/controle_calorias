# Plano: Agent harness para Controle de Calorias

## Objetivo

Transformar o repositório em uma base mais legível e validável por agentes, reduzindo dependência de contexto solto em prompts e aumentando segurança de mudanças futuras.

## Escopo

- Criar `AGENTS.md` como mapa operacional curto.
- Criar `ARCHITECTURE.md` com fronteiras e regras de camadas.
- Criar specs de produto para refeição, WhatsApp, metas/relatórios, profissionais e privacidade.
- Criar design docs para motor nutricional, WhatsApp e persistência.
- Criar documentação gerada/manualizada de schema e rotas tRPC.
- Criar checks mecânicos de arquitetura e documentação.
- Criar `pnpm agent:check`.

## Fora de escopo

- Refatorar módulos de produto.
- Alterar comportamento de usuário final.
- Alterar schema do banco.
- Trocar stack ou dividir em microserviços.

## Critérios de aceite

- `AGENTS.md` aponta para os documentos corretos.
- `pnpm agent:check` existe em `package.json`.
- `pnpm architecture:check` valida convenções mínimas.
- `pnpm docs:check` valida presença e sincronização mínima de docs críticas.
- Docs de privacidade, segurança e confiabilidade existem.

## Próximas etapas recomendadas

1. Automatizar geração real de `docs/generated/db-schema.md` a partir de `drizzle/schema.ts`.
2. Automatizar geração real de `docs/generated/trpc-routes.md` a partir de `server/nutritionRouter.ts`.
3. Adicionar smoke test de WhatsApp inbound com payloads mockados.
4. Adicionar smoke test web com Playwright ou alternativa leve.
5. Adicionar check específico para logs de dados sensíveis.
