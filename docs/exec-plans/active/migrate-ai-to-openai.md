# Plano de migracao: IA do sistema para OpenAI

Status: ativo.

Este documento registra a estratégia para migrar a camada de IA do sistema para OpenAI de forma incremental e segura. O Codex deve ler este arquivo antes de implementar qualquer etapa da migração.

## Leitura obrigatória

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

Migrar transcrição, análise de imagem, inferência nutricional e geração visual auxiliar para um provider OpenAI isolado no backend.

Fora de escopo: autenticação Manus OAuth, troca de banco, troca de frontend, criação de microserviços e alteração de schema sem necessidade comprovada.

## Invariantes

- Preservar o monólito React, Express, tRPC e Drizzle.
- Manter regra de negócio no backend.
- Manter o router fino.
- Validar respostas de IA com Zod.
- Preservar rascunho revisável antes da confirmação.
- Não registrar conteúdo sensível em logs.
- Manter credenciais apenas no ambiente de backend.
- Não expor credenciais no navegador.
- Garantir erro controlado quando o provider externo falhar.

## Arquitetura alvo

Criar e manter uma camada de provider no backend:

```text
server/_core/openaiClient.ts
server/_core/aiProvider.ts
server/_core/voiceTranscription.ts
server/_core/imageGeneration.ts
```

Serviços de domínio devem depender da interface interna do provider, não do SDK diretamente.

## Andamento atual

- Fase 1 concluída: inventário e testes de caracterização adicionados.
- Fase 2 concluída: SDK oficial, cliente backend e interface interna de provider foram isolados no backend.
- Fase 3 concluída: `server/_core/voiceTranscription.ts` usa o provider interno da OpenAI com validação de formato e tamanho.
- Fase 4 concluída: texto e imagem no núcleo nutricional usam a Responses API com JSON estruturado validado por Zod e totais recalculados no backend.
- Fase 5 concluída: a geração visual auxiliar foi migrada para helper OpenAI opcional e não bloqueante.
- Fase 6 concluída: transcrição e inferência nutricional ficaram livres do provider legado; o único uso legado remanescente ficou documentado no assistente educativo.
- Fase 7 está preparada: checklist operacional e smoke tests foram organizados para Render, Vercel e validação de canais.

## Fases

### Fase 1 - Inventário e testes

Mapear usos atuais de IA interna, transcrição, geração de imagem, análise de foto e processamento de rascunho. Adicionar testes de caracterização sem chamadas externas reais.

### Fase 2 - Provider OpenAI isolado

Adicionar SDK oficial, cliente backend, interface de provider, configuração de ambiente e documentação. O build não deve exigir configuração real quando testes usam mocks.

### Fase 3 - Transcrição

Migrar `voiceTranscription` para o provider. Validar formato e tamanho do arquivo antes do envio. Manter retorno compatível.

### Fase 4 - Inferência nutricional

Migrar texto e imagem para a Responses API com JSON estruturado validado por Zod. Recalcular totais no backend a partir dos itens validados.

### Fase 5 - Geração visual auxiliar

Status: concluída.

- `server/_core/imageGeneration.ts` passou a usar o provider OpenAI.
- O helper visual é opcional. Se a OpenAI não estiver configurada ou falhar, o fluxo continua sem bloquear refeição.
- `server/modules/photoAnalysis/service.ts` agora registra aviso sanitizado quando o visual auxiliar falha e segue com a análise principal.

### Fase 6 - Remoção do legado

Status: concluída no fluxo principal.

- Transcrição e inferência nutricional não dependem mais da camada legada.
- O helper visual auxiliar também saiu do Forge.
- O legado remanescente está restrito ao assistente educativo em `server/modules/assistant/service.ts` via `server/_core/llm.ts`, fora do fluxo principal de refeição.

### Fase 7 - Rollout

Status: preparado para execução operacional.

Checklist em `docs/runbooks/openai-rollout-checklist.md`.

Objetivos do rollout:

- configurar `OPENAI_*` apenas no backend do Render;
- manter frontend/Vercel sem `OPENAI_API_KEY`;
- validar web e WhatsApp com smoke tests;
- monitorar somente erros sanitizados;
- confirmar que dashboard e relatórios permanecem consistentes.

## Gates

Cada fase deve rodar:

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm agent:check
```

Quando houver banco disponível, rodar também:

```bash
pnpm db:check-integrity
```

## Critérios finais

- Texto, imagem e áudio criam rascunhos revisáveis.
- Confirmação manual persiste dados consistentes.
- Web e WhatsApp usam o mesmo núcleo.
- Falhas externas são tratadas sem corromper dados.
- Credenciais ficam apenas no backend.
- Documentação e testes estão atualizados.
- `pnpm agent:check` passa.

## Instrução para Codex

Leia AGENTS.md, ARCHITECTURE.md e este plano. Implemente somente a próxima fase pendente. Não pule fases. Não misture autenticação com esta migração. Preserve o monólito atual. Valide toda saída de IA com Zod. Não registre conteúdo sensível em logs. Atualize documentação e testes. Rode `pnpm agent:check`.
