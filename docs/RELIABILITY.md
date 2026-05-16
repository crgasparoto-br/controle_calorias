# Confiabilidade

## Objetivo

Garantir que os fluxos criticos possam ser validados por humanos e agentes antes de deploy ou merge.

## Fluxos criticos

- Autenticacao e sessao.
- Registro de refeicao por texto, imagem e audio.
- Confirmacao de rascunho de refeicao.
- Relatorios e dashboard.
- WhatsApp inbound e outbound.
- Exportacao e exclusao de dados.
- Migracoes e integridade referencial.
- Migracao da camada de IA para OpenAI, conforme `docs/exec-plans/active/migrate-ai-to-openai.md`.

## Gates recomendados

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm agent:check
```

Quando houver `DATABASE_URL` disponivel:

```bash
pnpm db:check-integrity
```

## Estrategia de testes

- Testes unitarios para calculos nutricionais e validacao de schemas.
- Testes de servico para confirmacao de refeicao, metas e WhatsApp.
- Smoke tests futuros para web, WhatsApp e banco.
- Checks estruturais para impedir drift de arquitetura e documentacao.
- Para migracao OpenAI, testes de caracterizacao antes da troca de provider e mocks para transcricao, texto, imagem e falha externa.

## Incidentes comuns a prevenir

- Migracao nao aplicada em producao.
- Divergencia entre rascunho e confirmacao.
- Log de dados sensiveis.
- Falha silenciosa no envio WhatsApp.
- Relatorio semanal divergente do dashboard.
- Falha externa de IA corrompendo rascunhos ou bloqueando confirmacao manual.
- Chave ou configuracao de IA exposta no frontend.

## Guardrails para migracao OpenAI

- Implementar em fases pequenas, seguindo `docs/exec-plans/active/migrate-ai-to-openai.md`.
- Nao misturar migracao de autenticacao com migracao de IA.
- Manter fallback seguro ou erro controlado quando a OpenAI estiver indisponivel.
- Confirmacao de refeicao nao deve depender de chamada externa.
- Validar saida de IA com Zod antes de retornar ou persistir.
- Recalcular totais nutricionais no backend a partir dos itens validados.
- Rodar smoke test web e WhatsApp antes de ativar em producao.
