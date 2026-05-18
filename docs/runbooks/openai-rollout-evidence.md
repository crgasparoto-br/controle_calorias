# Evidências do rollout OpenAI — Fase 7

Issue coordenadora: #20

Branch: `chore/openai-migration-phase-7-rollout`

Data da revisão: 2026-05-18

Esta página registra somente evidências objetivas disponíveis durante a execução da Fase 7. Itens que não puderam ser validados operacionalmente permanecem marcados como pendentes/bloqueados; nenhuma evidência foi inferida ou fabricada.

## Checklist operacional

- [x] `docs/runbooks/openai-rollout-checklist.md` revisado e executado parcialmente.
- [ ] Render validado com `OPENAI_API_KEY` apenas no backend.
- [ ] Vercel/frontend validado sem `OPENAI_API_KEY`.
- [x] Repositório/frontend revisado sem ocorrência de `VITE_OPENAI_*` fora do próprio checklist/documentação de rollout.
- [ ] Logs públicos de produção revisados e sanitizados.

### Evidências objetivas

- PR #21 está aberta, em draft, com base `main` e branch `chore/openai-migration-phase-7-rollout`.
- O checklist operacional exige configuração de OpenAI somente no backend Render e ausência de `OPENAI_API_KEY`/`VITE_OPENAI_*` no frontend/Vercel.
- O código de ambiente lê `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_TRANSCRIPTION_MODEL` e `OPENAI_IMAGE_MODEL` em `server/_core/env.ts`, isto é, em módulo de backend.
- O cliente OpenAI é criado em `server/_core/openaiClient.ts` e lança erro quando `OPENAI_API_KEY` não está configurada.
- A busca no repositório encontrou `OPENAI_API_KEY` apenas em documentação, `.env.example`, testes e arquivos de backend; não foi encontrada ocorrência de `import.meta.env OPENAI`.
- A busca por `VITE_OPENAI` retornou somente o checklist/documentação de rollout, sem uso no código do frontend.
- `.env.example` documenta explicitamente: `Never expose OPENAI_* values through VITE_* variables or client-side code.`
- A PR recebeu deploy preview Vercel marcado como Ready pelo bot em 2026-05-18 14:25 UTC, mas o conteúdo do preview e as variáveis Vercel não puderam ser auditados por este executor.

## Smoke tests web

- [ ] Texto
- [ ] Imagem
- [ ] Áudio

Evidências:

```text
PENDENTE/BLOQUEADO: não houve acesso autenticado ao ambiente web nem sessão de usuário para executar o fluxo real de registrar e confirmar refeição por texto, imagem e áudio.

Evidência estática relacionada:
- server/modules/meals/service.ts processa draft de refeição com texto, imagem e áudio e confirma rascunho por confirmMeal.
- server/modules/photoAnalysis/service.ts analisa imagem, registra warning sanitizado se a geração visual auxiliar falhar e permite confirmação posterior da análise.
- server/db.ts calcula dashboard diário por getDashboardSnapshot e relatório semanal por getWeeklyProgress/getWeeklySummary.
```

## Smoke tests WhatsApp

- [ ] Texto
- [ ] Imagem
- [ ] Áudio

Evidências:

```text
PENDENTE/BLOQUEADO: não houve acesso ao canal WhatsApp oficial, telefone de teste vinculado, webhook produtivo ou logs operacionais para enviar mensagens reais e validar texto, imagem e áudio.

Evidência estática relacionada:
- A issue #20 exige envio/resposta pelo número oficial e validação de telefone sem vínculo.
- A execução real permanece obrigatória antes do merge.
```

## Gates obrigatórios

- [x] `pnpm check`
- [x] `pnpm test`
- [x] `pnpm architecture:check`
- [x] `pnpm docs:check`
- [ ] `pnpm agent:check`
- [ ] `pnpm db:check-integrity` quando houver banco disponível

Evidências:

```text
CI anterior da PR, commit 5252345b4f760155c228e01bb80c5005f4876cf0:
- Workflow: Agent-first gate
- Run: 26039698607
- Status: completed / success
- Steps concluídos com sucesso: TypeScript check, Tests, Architecture check, Documentation check.

Pendência encontrada:
- O workflow anterior não executava `pnpm agent:check` explicitamente.

Correção aplicada nesta branch:
- `.github/workflows/agent-check.yml` atualizado para incluir:
  - pnpm agent:check
  - pnpm db:check-integrity quando DATABASE_URL estiver disponível
  - skip explícito e objetivo quando DATABASE_URL não estiver disponível

Estado atual:
- Após o commit b5fa1b43c65f10c02aa0cc5f256d766094d71a6a, ainda não havia workflow run retornado pelo conector para esse novo head SHA durante esta revisão.
- Como não houve checkout local possível e não há DATABASE_URL disponível neste executor, `pnpm agent:check` e `pnpm db:check-integrity` ainda precisam ser evidenciados pelo CI ou por execução local autenticada.
```

## Segurança e segregação de credenciais

- [ ] `OPENAI_API_KEY` validada apenas no backend Render.
- [x] Código de backend isola leitura/configuração OpenAI em módulos de servidor.
- [x] Busca estática não encontrou uso de `VITE_OPENAI_*` no frontend.
- [x] Busca estática não encontrou chamada OpenAI direta no frontend por `import.meta.env OPENAI`.
- [ ] Variáveis reais do projeto Vercel auditadas sem `OPENAI_API_KEY` e sem `VITE_OPENAI_*`.
- [ ] Variáveis reais do backend Render auditadas com `OPENAI_API_KEY` configurada somente no backend.

Evidências:

```text
Confirmado por código:
- server/_core/env.ts usa process.env.OPENAI_* no backend.
- server/_core/openaiClient.ts cria cliente OpenAI apenas no backend e exige chave configurada.
- server/_core/aiProvider.ts instancia OpenAiProvider por createOpenAiClient.
- README.md reforça que OPENAI_API_KEY deve existir apenas no backend e não deve ser exposta via VITE_*.

Não confirmado operacionalmente:
- Painel Render não foi acessado para listar variáveis reais.
- Painel Vercel não foi acessado para listar variáveis reais.
```

## Logs e sanitização

- [x] Sanitização revisada por código.
- [ ] Logs públicos/produção revisados.

Evidências:

```text
Confirmado por código:
- server/privacy.ts redige email, telefone, bearer token e campos sensíveis como token, secret, sourceText, transcript, notes, message, storageUrl, imageUrl e audioUrl.
- server/db.ts aplica safeLogDetail em logInferenceEvent antes de gravar logs administrativos/inferência.
- server/modules/photoAnalysis/service.ts registra food_photo.visual_generation_warning com detalhe controlado e sem payload bruto.
- server/modules/meals/service.ts registra audio.transcription_warning via logInferenceEvent quando transcrição falha.

Não confirmado operacionalmente:
- Logs públicos de Render/Vercel/WhatsApp não foram acessados durante esta execução.
```

## Restrições de bloqueio

Bloquear o rollout se houver tentativa de:

- pular fase;
- alterar autenticação;
- expor `OPENAI_API_KEY`, `OPENAI_*` ou `VITE_OPENAI_*` no frontend;
- commitar segredos;
- concluir rollout sem evidência objetiva.

Resultado da revisão:

```text
Não foi encontrada alteração de autenticação.
Não foi encontrada tentativa de pular fase.
Não foi encontrado segredo OpenAI commitado.
Não foi encontrada evidência estática de VITE_OPENAI_* no frontend.

Bloqueio atual não é por violação encontrada, e sim por falta de evidências operacionais obrigatórias e por gates ainda sem execução registrada no novo head da PR.
```

## Riscos residuais

- Smoke tests web reais ainda não executados/evidenciados.
- Smoke tests WhatsApp reais ainda não executados/evidenciados.
- Variáveis reais do Render ainda não auditadas.
- Variáveis reais da Vercel ainda não auditadas.
- Logs públicos/produção ainda não auditados.
- `pnpm agent:check` ainda precisa de evidência no novo head da PR.
- `pnpm db:check-integrity` depende de `DATABASE_URL`; se não houver banco disponível no CI/execução local, registrar skip objetivo.

## Decisão final

```text
BLOQUEADO.

A PR #21 deve permanecer em draft e NÃO está pronta para merge em main.

Condições mínimas para desbloqueio:
1. Executar smoke tests reais web: texto, imagem e áudio, com confirmação de refeição e verificação de dashboard/relatório.
2. Executar smoke tests reais WhatsApp: texto, imagem e áudio pelo WHATSAPP_PHONE_NUMBER_ID oficial, incluindo telefone sem vínculo.
3. Auditar Render e registrar que OPENAI_API_KEY existe apenas no backend.
4. Auditar Vercel e registrar ausência de OPENAI_API_KEY e de VITE_OPENAI_*.
5. Revisar logs públicos/produção e confirmar ausência de prompt cru, texto cru, áudio, imagem, transcrição, token e payload externo.
6. Evidenciar CI/execução do novo workflow com pnpm agent:check.
7. Executar pnpm db:check-integrity com DATABASE_URL ou registrar skip objetivo quando o banco não estiver disponível.
```
