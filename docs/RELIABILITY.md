# Confiabilidade

## Objetivo

Garantir que os fluxos críticos possam ser validados por humanos e agentes antes de deploy ou merge.

## Fluxos críticos

- Autenticação e sessão.
- Registro de refeição por texto, imagem e áudio.
- Confirmação de rascunho de refeição.
- Relatórios e dashboard.
- Integrações de saúde, incluindo OAuth e sincronização automática do Strava.
- WhatsApp inbound e outbound.
- Exportação e exclusão de dados.
- Migrações e integridade referencial.
- Migração da camada de IA para OpenAI, conforme `docs/exec-plans/active/migrate-ai-to-openai.md`.

## Gates recomendados

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm agent:check
```

Quando houver `DATABASE_URL` disponível:

```bash
pnpm db:check-integrity
```

## Estratégia de testes

- Testes unitários para cálculos nutricionais e validação de schemas.
- Testes de serviço para confirmação de refeição, metas e WhatsApp.
- Testes de serviço para integrações de saúde devem cobrir paginação, idempotência e falhas externas controladas.
- Smoke tests futuros para web, WhatsApp e banco.
- Checks estruturais para impedir drift de arquitetura e documentação.
- Para migração OpenAI, testes de caracterização antes da troca de provider e mocks para transcrição, texto, imagem e falha externa.
- Para visual auxiliar opcional, testes devem provar que falhas do provider não bloqueiam análise nem confirmação da refeição.

## Incidentes comuns a prevenir

- Migração não aplicada em produção.
- Divergência entre rascunho e confirmação.
- Log de dados sensíveis.
- Falha silenciosa no envio WhatsApp.
- Relatório semanal divergente do dashboard.
- Integração do Strava limitada à primeira página de atividades recentes.
- Usuário com Strava conectado depender de sync manual para registrar exercícios.
- Falha externa de IA corrompendo rascunhos ou bloqueando confirmação manual.
- Falha de imagem auxiliar bloqueando um fluxo que deveria continuar sem ela.
- Chave ou configuração de IA exposta no frontend.

## Guardrails para integração Strava

- Tokens OAuth ficam criptografados em `appSecrets` e nunca devem ser logados.
- Sincronização automática deve ser idempotente, usando a referência externa `strava:<activityId>` nas notas do exercício.
- A busca de atividades recentes deve paginar o período de lookback configurado para evitar perda de treinos além da primeira página.
- Falhas na sincronização automática devem ser registradas de forma segura e não podem impedir o servidor de iniciar.
- `STRAVA_AUTO_SYNC_INTERVAL_MINUTES` controla o intervalo da rotina; `STRAVA_AUTO_SYNC_DISABLED=true` desativa o agendamento.

## Guardrails para migração OpenAI

- Implementar em fases pequenas, seguindo `docs/exec-plans/active/migrate-ai-to-openai.md`.
- Não misturar migração de autenticação com migração de IA.
- Manter fallback seguro ou erro controlado quando a OpenAI estiver indisponível.
- Confirmação de refeição não deve depender de chamada externa.
- Validar saída de IA com Zod antes de retornar ou persistir.
- Recalcular totais nutricionais no backend a partir dos itens validados.
- Falha de visual auxiliar deve degradar para ausência de imagem, nunca para falha de refeição.
- Rodar smoke test web e WhatsApp antes de ativar em produção.
