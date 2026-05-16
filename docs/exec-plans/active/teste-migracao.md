# Plano de migracao: IA do sistema para OpenAI

Status: ativo.

Este documento registra a estrategia para migrar a camada de IA do sistema para OpenAI de forma incremental e segura. O Codex deve ler este arquivo antes de implementar qualquer etapa da migracao.

## Leitura obrigatoria

1. `AGENTS.md`
2. `ARCHITECTURE.md`
3. `docs/product-specs/meal-registration.md`
4. `docs/design-docs/nutrition-engine.md`
5. `docs/product-specs/whatsapp-flow.md`
6. `docs/design-docs/whatsapp-ingestion.md`
7. `docs/PRIVACY_LGPD.md`
8. `docs/SECURITY.md`
9. `docs/RELIABILITY.md`
10. `docs/generated/db-schema.md`
11. `docs/generated/trpc-routes.md`

## Escopo

Migrar transcricao, analise de imagem, inferencia nutricional e geracao visual auxiliar para um provider OpenAI isolado no backend.

Fora de escopo: autenticacao Manus OAuth, troca de banco, troca de frontend, criacao de microservicos e alteracao de schema sem necessidade comprovada.

## Invariantes

- Preservar o monolito React, Express, tRPC e Drizzle.
- Manter regra de negocio no backend.
- Manter o router fino.
- Validar respostas de IA com Zod.
- Preservar rascunho revisavel antes da confirmacao.
- Nao registrar conteudo sensivel em logs.
- Manter credenciais apenas no ambiente de backend.
- Nao expor credenciais no navegador.
- Garantir erro controlado quando o provider externo falhar.

## Arquitetura alvo

Criar uma camada de provider no backend:

```text
server/_core/openaiClient.ts
server/_core/aiProvider.ts
server/_core/voiceTranscription.ts
server/_core/imageGeneration.ts
```

Servicos de dominio devem depender da interface interna do provider, nao do SDK diretamente.

## Fases

### Fase 1 - Inventario e testes

Mapear usos atuais de IA interna, transcricao, geracao de imagem, analise de foto e processamento de rascunho. Adicionar testes de caracterizacao sem chamadas externas reais.

### Fase 2 - Provider OpenAI isolado

Adicionar SDK oficial, cliente backend, interface de provider, configuracao de ambiente e documentacao. O build nao deve exigir configuracao real quando testes usam mocks.

### Fase 3 - Transcricao

Migrar `voiceTranscription` para o provider. Validar formato e tamanho do arquivo antes de envio. Manter retorno compativel.

### Fase 4 - Inferencia nutricional

Migrar texto e imagem para a Responses API com JSON estruturado validado por Zod. Recalcular totais no backend a partir dos itens validados.

### Fase 5 - Geracao visual auxiliar

Migrar imagem anotada ou geracao visual se ainda for necessaria. Falha nesse recurso nao deve bloquear registro ou confirmacao de refeicao.

### Fase 6 - Remocao do legado

Remover dependencias antigas da camada de IA, atualizar documentacao e garantir que a busca no repositorio nao encontre usos restantes para transcricao ou inferencia nutricional.

### Fase 7 - Rollout

Ativar em producao com variaveis no Render, validar web e WhatsApp, monitorar erros sanitizados e confirmar que dashboard e relatorios continuam corretos.

## Gates

Cada fase deve rodar:

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm agent:check
```

Quando houver banco disponivel, rodar tambem:

```bash
pnpm db:check-integrity
```

## Criterios finais

- Texto, imagem e audio criam rascunhos revisaveis.
- Confirmacao manual persiste dados consistentes.
- Web e WhatsApp usam o mesmo nucleo.
- Falhas externas sao tratadas sem corromper dados.
- Credenciais ficam apenas no backend.
- Documentacao e testes estao atualizados.
- `pnpm agent:check` passa.

## Instrucao para Codex

Leia AGENTS.md, ARCHITECTURE.md e este plano. Implemente somente a proxima fase pendente. Nao pule fases. Nao misture autenticacao com esta migracao. Preserve o monolito atual. Valide toda saida de IA com Zod. Nao registre conteudo sensivel em logs. Atualize documentacao e testes. Rode pnpm agent:check.
