# Evidências do rollout OpenAI - Fase 7

Issue coordenadora: #20

PR: #21

Branch: `chore/openai-migration-phase-7-rollout`

Data da revisão: 2026-05-18

Executor: Codex no checkout local `/home/ubuntu/projetos/controle_calorias`

Esta página registra somente evidências objetivas disponíveis durante a execução da Fase 7. Itens que não puderam ser validados operacionalmente permanecem marcados como pendentes/bloqueados; nenhuma evidência foi inferida ou fabricada.

## Estado da PR e branch

- [x] Branch local sincronizada com `origin/chore/openai-migration-phase-7-rollout`.
- [x] PR #21 verificada no GitHub.
- [x] PR #21 permanece em draft.
- [x] PR #21 aponta para `head: chore/openai-migration-phase-7-rollout` e `base: main`.

Evidências:

```text
2026-05-18 UTC

git checkout chore/openai-migration-phase-7-rollout:
- Branch configurada para rastrear origin/chore/openai-migration-phase-7-rollout.

git pull --ff-only:
- Already up to date.

GitHub PR #21:
- URL: https://github.com/crgasparoto-br/controle_calorias/pull/21
- State: open
- Draft: true
- Head branch: chore/openai-migration-phase-7-rollout
- Head SHA: e9b111c809b648d2bda62ae72f142fd6a665ffab
- Base branch: main
- Mergeable: true
```

## Gates obrigatórios

- [x] `pnpm install --frozen-lockfile`
- [x] `pnpm check`
- [x] `pnpm test`
- [x] `pnpm architecture:check`
- [x] `pnpm docs:check`
- [x] `pnpm agent:check`
- [ ] `pnpm db:check-integrity` com banco real

Evidências locais:

```text
Ambiente local: /home/ubuntu/projetos/controle_calorias
Data: 2026-05-18 UTC

pnpm install --frozen-lockfile
- Resultado: sucesso
- Saída objetiva: Lockfile is up to date, resolution step is skipped; Already up to date; Done in 1.5s using pnpm v10.4.1.

pnpm check
- Resultado: sucesso
- Saída objetiva: tsc --noEmit terminou com exit code 0.

pnpm test
- Resultado: sucesso
- Saída objetiva: Test Files 20 passed (20); Tests 94 passed (94); Duration 7.64s.

pnpm architecture:check
- Resultado: sucesso
- Saída objetiva: Arquitetura validada com sucesso.

pnpm docs:check
- Resultado: sucesso
- Saída objetiva: docs/generated/db-schema.md está atualizado; docs/generated/trpc-routes.md está atualizado; Documentação validada com sucesso.

pnpm agent:check
- Resultado: sucesso
- Saída objetiva: executou pnpm check, pnpm test, pnpm architecture:check e pnpm docs:check; Test Files 20 passed (20); Tests 94 passed (94); Arquitetura validada com sucesso; Documentação validada com sucesso.

pnpm db:check-integrity
- Resultado: falha objetiva por ausência de banco no ambiente local.
- Saída objetiva: DATABASE_URL é obrigatório para verificar integridade referencial. Defina DATABASE_URL no .env da raiz do projeto ou exporte a variável ao rodar o comando. Também são aceitos aliases: MYSQL_URL, TIDB_DATABASE_URL ou DB_URL.
- Exit code: 1.
- Motivo do skip/pendência: este executor não possui DATABASE_URL, MYSQL_URL, TIDB_DATABASE_URL ou DB_URL.
```

## CI da PR

- [x] Workflow `Agent-first gate` executou no head atual da PR.
- [x] `pnpm agent:check` executou e passou no CI.
- [x] `pnpm db:check-integrity` teve skip objetivo no CI por ausência de `DATABASE_URL`.

Evidências:

```text
Commit head da PR: e9b111c809b648d2bda62ae72f142fd6a665ffab
Workflow: Agent-first gate
Run ID: 26041856462
Run number: 70
Status: completed
Conclusion: success

Job: Agent-first gate
Job ID: 76555360308
Status: completed
Conclusion: success

Steps:
- Set up job: success
- Checkout repository: success
- Setup pnpm: success
- Setup Node.js: success
- Install dependencies: success
- TypeScript check: success
- Tests: success
- Architecture check: success
- Documentation check: success
- Agent check: success
- Database integrity check: skipped
- Database integrity check skipped: success
- Complete job: success

DATABASE_URL no CI:
- O log do job mostra DATABASE_URL vazio no ambiente do runner.
- Mensagem registrada pelo workflow: DATABASE_URL not available; pnpm db:check-integrity skipped.
```

## Smoke tests web

- [ ] Texto
- [ ] Imagem
- [ ] Audio

Evidências:

```text
PENDENTE/BLOQUEADO: não houve acesso autenticado ao ambiente web nem sessão de usuário para executar o fluxo real de registrar e confirmar refeição por texto, imagem e áudio.

Preview Vercel disponível pelo comentário do bot na PR:
- Projeto: controle-calorias
- Deployment: Ready
- Preview: https://controle-calorias-git-chore-ope-2e62fa-crgasparoto-brs-projects.vercel.app
- Atualizado: 2026-05-18 15:04 UTC

Limitação objetiva:
- Sem credenciais/sessão de usuário e sem permissão para alterar autenticação, não foi possível executar smoke real ponta a ponta no preview.

Evidência estática relacionada:
- server/modules/meals/service.ts processa draft de refeição com texto, imagem e áudio e confirma rascunho por confirmMeal.
- server/modules/photoAnalysis/service.ts analisa imagem, registra warning sanitizado se a geração visual auxiliar falhar e permite confirmação posterior da análise.
- server/db.ts calcula dashboard diário por getDashboardSnapshot e relatório semanal por getWeeklyProgress/getWeeklySummary.
```

## Smoke tests WhatsApp

- [ ] Texto
- [ ] Imagem
- [ ] Audio
- [ ] Envio pelo `WHATSAPP_PHONE_NUMBER_ID` oficial
- [ ] Comportamento seguro para telefone sem vínculo

Evidências:

```text
PENDENTE/BLOQUEADO: não houve acesso ao canal WhatsApp oficial, telefone de teste vinculado, webhook produtivo ou logs operacionais para enviar mensagens reais e validar texto, imagem e áudio.

Limitação objetiva:
- Este executor não possui credenciais operacionais do canal oficial nem acesso ao telefone de teste.
- Nenhum payload externo, telefone completo, token, áudio, imagem ou transcrição foi registrado.

Evidência estática relacionada:
- server/whatsappWebhook.test.ts cobre comportamento do webhook em testes automatizados.
- server/whatsappWebhook.smoke.test.ts cobre smoke automatizado do webhook, mas não substitui envio real pelo canal oficial.
- A execução real permanece obrigatória antes do merge.
```

## Auditoria Render/backend

- [ ] `OPENAI_API_KEY` presente apenas no backend Render
- [ ] `OPENAI_MODEL` configurado
- [ ] `OPENAI_TRANSCRIPTION_MODEL` configurado
- [ ] `OPENAI_IMAGE_MODEL` configurado somente se apoio visual opcional estiver habilitado
- [ ] `OPENAI_BASE_URL` vazio ou justificado

Evidências:

```text
PENDENTE/BLOQUEADO: painel/CLI Render não está disponível neste executor.

Verificação local:
- command -v render não retornou binário.
- Não há diretório .render no checkout.
- Nenhuma variável RENDER_* foi encontrada no ambiente local.

Confirmado por código:
- server/_core/env.ts lê process.env.OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_TRANSCRIPTION_MODEL e OPENAI_IMAGE_MODEL no backend.
- server/_core/openaiClient.ts cria cliente OpenAI apenas no backend e exige chave configurada.
- server/_core/aiProvider.ts instancia OpenAiProvider por createOpenAiClient.

Não confirmado operacionalmente:
- Presença real de OPENAI_API_KEY no backend Render.
- Ausência de OPENAI_API_KEY fora do backend Render.
- Valores reais de OPENAI_MODEL, OPENAI_TRANSCRIPTION_MODEL, OPENAI_IMAGE_MODEL e OPENAI_BASE_URL.
```

## Auditoria Vercel/frontend

- [ ] Ausência operacional de `OPENAI_API_KEY` no ambiente Vercel
- [ ] Ausência operacional de `VITE_OPENAI_*` no ambiente Vercel
- [x] Frontend consome backend/tRPC no código
- [x] Busca local não encontrou chamada OpenAI direta no frontend por `import.meta.env.*OPENAI`

Evidências:

```text
PENDENTE/BLOQUEADO para auditoria operacional: painel/CLI Vercel não está disponível neste executor.

Verificação local:
- command -v vercel não retornou binário.
- Não há diretório .vercel no checkout.
- Nenhuma variável VERCEL_* foi encontrada no ambiente local.

Preview Vercel registrado na PR:
- Deployment Ready em 2026-05-18 15:04 UTC.
- A existência do preview não comprova as variáveis do ambiente Vercel.

Frontend/tRPC:
- client/src/main.tsx configura httpBatchLink com url /api/trpc.
- client/src/lib/trpc.ts usa createTRPCReact<AppRouter>().
- Páginas do frontend usam trpc.nutrition.* para operações de nutrição.
```

Buscas locais obrigatórias:

```text
grep -R "VITE_OPENAI" -n . --exclude-dir=node_modules --exclude-dir=.git
- Resultado: ocorrências somente em docs/runbooks/openai-rollout-evidence.md e docs/runbooks/openai-rollout-checklist.md.
- Classificação: permitido, documentação/runbook.

grep -R "OPENAI_API_KEY" -n . --exclude-dir=node_modules --exclude-dir=.git
- Resultado permitido:
  - backend: server/_core/openaiClient.ts, server/_core/env.ts, server/_core/llm.ts
  - testes: server/_core/openaiClient.test.ts, server/_core/aiProvider.test.ts, server/_core/voiceTranscription.test.ts
  - documentação/config exemplo: .env.example, README.md, docs/*
  - build local: dist/index.js
- Resultado bloqueante: nenhum em client/frontend; nenhum valor real de segredo encontrado.

grep -R "import.meta.env.*OPENAI" -n client server shared docs .github --exclude-dir=node_modules --exclude-dir=.git
- Resultado: somente menções documentais neste runbook sobre a própria busca.
- Classificação: permitido, documentação/runbook.
```

## Logs públicos e sanitização

- [x] Logs do GitHub Actions revisados para o workflow da PR.
- [x] Sanitização revisada por código.
- [ ] Logs Render backend revisados.
- [ ] Logs Vercel frontend revisados.
- [ ] Logs webhook WhatsApp revisados.

Evidências:

```text
GitHub Actions:
- Fonte: job logs do workflow Agent-first gate, run 26041856462, job 76555360308.
- Janela: 2026-05-18 15:04:12 UTC a 2026-05-18 15:05:04 UTC.
- Resultado: não foi observado OPENAI_API_KEY, WHATSAPP_ACCESS_TOKEN, prompt cru, texto cru de usuário, áudio, imagem, transcrição completa, payload externo ou URL assinada.
- Observação: o log mostra token do checkout mascarado como *** e DATABASE_URL vazio.

Render/Vercel/WhatsApp:
- PENDENTE/BLOQUEADO: logs operacionais não acessíveis por este executor.
```

Confirmado por código:

```text
- server/privacy.ts redige email, telefone, bearer token e campos sensíveis como token, secret, sourceText, transcript, notes, message, storageUrl, imageUrl e audioUrl.
- server/db.ts aplica safeLogDetail em logInferenceEvent antes de gravar logs administrativos/inferência.
- server/modules/photoAnalysis/service.ts registra food_photo.visual_generation_warning com detalhe controlado e sem payload bruto.
- server/modules/meals/service.ts registra audio.transcription_warning via logInferenceEvent quando transcrição falha.
```

## Restrições de bloqueio

Bloquear o rollout se houver tentativa de:


Resultado da revisão:

```text
Não foi encontrada alteração de autenticação nesta revisão.
Não foi encontrada mistura nova com autenticação externa legada nesta migração; referências históricas permanecem fora do escopo da Fase 7.
Não foi encontrada tentativa de pular fase.
Não foi encontrado segredo OpenAI commitado.
Não foi encontrada evidência estática de VITE_OPENAI_* no frontend.
Não foi encontrada chamada OpenAI direta no frontend por import.meta.env.*OPENAI.

Bloqueio atual não é por violação encontrada, e sim por falta de evidências operacionais obrigatórias: smoke tests reais, auditoria Render/Vercel e logs operacionais Render/Vercel/WhatsApp.
```

## Riscos residuais

- Smoke tests web reais ainda não executados/evidenciados.
- Smoke tests WhatsApp reais ainda não executados/evidenciados pelo `WHATSAPP_PHONE_NUMBER_ID` oficial.
- Variáveis reais do Render ainda não auditadas.
- Variáveis reais da Vercel ainda não auditadas.
- Logs públicos/produção de Render, Vercel e webhook WhatsApp ainda não auditados.
- Integridade referencial do banco não foi validada porque não há `DATABASE_URL` local nem no CI da PR; houve apenas skip objetivo.
- Node.js 20 em Actions tem aviso de depreciação futura no log do runner, sem impacto no resultado atual do gate.

## Decisão final

```text
BLOQUEADO.

A PR #21 deve permanecer em draft e NÃO está pronta para merge em main.

Condições mínimas para desbloqueio:
1. Executar smoke tests reais web: texto, imagem e áudio, com confirmação de refeição e verificação de dashboard/relatório.
2. Executar smoke tests reais WhatsApp: texto, imagem e áudio pelo WHATSAPP_PHONE_NUMBER_ID oficial, incluindo telefone sem vínculo.
3. Auditar Render e registrar que OPENAI_API_KEY existe apenas no backend, sem exibir valores.
4. Auditar Vercel e registrar ausência de OPENAI_API_KEY e de VITE_OPENAI_*.
5. Revisar logs públicos/produção de Render, Vercel e WhatsApp e confirmar ausência de prompt cru, texto cru, áudio, imagem, transcrição, token, payload externo e URL assinada.
6. Executar pnpm db:check-integrity com DATABASE_URL real ou manter skip objetivo documentado se o banco não estiver disponível no CI pretendido.
```
