# Evidências do rollout OpenAI

Este runbook registra evidências operacionais da migração OpenAI. A PR #22 também altera autenticação; por isso, qualquer menção histórica a Manus/OAuth foi substituída por linguagem neutra e o bloqueio foi atualizado para refletir o estado real da branch.

## Logs públicos e sanitização

- [x] Logs do GitHub Actions revisados para o workflow da PR.
- [x] Sanitização revisada por código.
- [ ] Logs Render backend revisados.
- [ ] Logs Vercel frontend revisados.
- [ ] Logs webhook WhatsApp revisados.

Evidências:

```text
GitHub Actions:
- Fonte: workflow Agent-first gate da PR #22.
- Resultado: check, test, architecture:check, docs:check e agent:check passaram antes desta revisão; a branch agora também exige pnpm build no workflow.
- Observação: DATABASE_URL pode estar ausente no CI e, nesse caso, a integridade de banco é pulada de forma explícita.

Render/Vercel/WhatsApp:
- PENDENTE/BLOQUEADO: logs operacionais não acessíveis por este executor.
```

Confirmado por código:

```text
- server/privacy.ts redige email, telefone, bearer token e campos sensíveis como token, secret, sourceText, transcript, notes, message, storageUrl, imageUrl e audioUrl.
- server/db.ts aplica safeLogDetail em logInferenceEvent antes de gravar logs administrativos/inferência.
- server/modules/photoAnalysis/service.ts registra food_photo.visual_generation_warning com detalhe controlado e sem payload bruto.
- server/modules/meals/service.ts registra audio.transcription_warning via logInferenceEvent quando transcrição falha.
- A autenticação web foi migrada para sessão local com e-mail/senha e JWT assinado por JWT_SECRET; não há dependência funcional nova de OAuth externo nesta PR.
```

## Restrições de bloqueio

Bloquear o rollout se houver tentativa de:

- pular fase operacional;
- reintroduzir dependência funcional de autenticação externa legada;
- expor `OPENAI_API_KEY`, `OPENAI_*`, `JWT_SECRET` ou tokens WhatsApp no frontend;
- commitar segredo;
- registrar senha, hash, token, cookie, prompt cru, texto cru, áudio, imagem ou transcrição completa em logs;
- concluir rollout sem smoke tests/gates evidenciados.

Resultado da revisão:

```text
Esta PR altera autenticação intencionalmente: remove o fluxo externo legado e migra para e-mail/senha local.
Não foi encontrada tentativa de reintroduzir o fluxo externo legado.
Não foi encontrada tentativa de pular fase.
Não foi encontrado segredo OpenAI commitado.
Não foi encontrada evidência estática de VITE_OPENAI_* no frontend.
Não foi encontrada chamada OpenAI direta no frontend por import.meta.env.*OPENAI.

Bloqueio operacional remanescente não é por violação encontrada, e sim por falta de evidências de ambiente real: smoke tests reais, auditoria Render/Vercel e logs operacionais Render/Vercel/WhatsApp.
```

## Riscos residuais

- Smoke tests web reais ainda não executados/evidenciados.
- Smoke tests WhatsApp reais ainda não executados/evidenciados pelo `WHATSAPP_PHONE_NUMBER_ID` oficial.
- Variáveis reais do Render ainda não auditadas.
- Variáveis reais da Vercel ainda não auditadas.
- Logs públicos/produção de Render, Vercel e webhook WhatsApp ainda não auditados.
- Integridade referencial do banco não foi validada porque não há `DATABASE_URL` local nem no CI da PR; houve apenas skip objetivo.

## Decisão final

```text
BLOQUEADO PARA ROLLOUT OPERACIONAL COMPLETO.

A PR #22 pode avançar tecnicamente após checks automatizados, revisão humana e validação de ambiente.

Condições mínimas para desbloqueio operacional:
1. Executar smoke tests reais web: texto, imagem e áudio, com confirmação de refeição e verificação de dashboard/relatório.
2. Executar smoke tests reais WhatsApp: texto, imagem e áudio pelo WHATSAPP_PHONE_NUMBER_ID oficial, incluindo telefone sem vínculo.
3. Auditar Render e registrar que OPENAI_API_KEY existe apenas no backend, sem exibir valores.
4. Auditar Vercel e registrar ausência de OPENAI_API_KEY, JWT_SECRET, tokens WhatsApp e VITE_OPENAI_*.
5. Revisar logs públicos/produção de Render, Vercel e WhatsApp e confirmar ausência de prompt cru, texto cru, áudio, imagem, transcrição, senha, hash, token, cookie, payload externo e URL assinada.
6. Executar pnpm db:check-integrity com DATABASE_URL real ou manter skip objetivo documentado se o banco não estiver disponível no CI pretendido.
```
