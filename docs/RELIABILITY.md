# Confiabilidade

## Objetivo

Garantir que os fluxos críticos possam ser validados por humanos e agentes antes de deploy ou merge.

## Fluxos críticos

- Autenticação e sessão.
- Registro de refeição por texto, imagem e áudio.
- Confirmação de rascunho de refeição.
- Relatórios e dashboard.
- Integrações de saúde, incluindo OAuth, sincronização automática do Strava e exibição de métricas detalhadas de atividades.
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
- Testes de serviço para integrações de saúde devem cobrir paginação, idempotência, atividade sem calorias no resumo, fallback estimado para treino de força, metadados detalhados do Strava e falhas externas controladas.
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
- Meta profissional divergente entre Hoje, Metas, Relatórios, WhatsApp e prontuário.
- Falha de notificação revertendo ou duplicando a ativação de uma meta profissional já persistida.
- Falha ou inconsistência na resolução de meta profissional degradando silenciosamente para meta pessoal; consumidores da meta efetiva devem falhar de forma controlada para preservar a precedência clínica.
- Integração do Strava limitada à primeira página de atividades recentes.
- Atividade do Strava ignorada porque o resumo não inclui gasto calórico.
- Treino de força do Strava ignorado porque a API não retornou calorias.
- Detalhes do Strava exibidos como obrigatórios quando a API não retorna a métrica.
- Usuário com Strava conectado depender de sync manual para registrar exercícios.
- Falha externa de IA corrompendo rascunhos ou bloqueando confirmação manual.
- Falha de imagem auxiliar bloqueando um fluxo que deveria continuar sem ela.
- Chave ou configuração de IA exposta no frontend.

## Metas profissionais oficiais

- Ativação e revisão usam transação para versão, encerramento da janela anterior, histórico, resolução de pedido e criação da entrega.
- Concorrência usa versão esperada e chave ativa única por paciente; conflito nunca sobrescreve silenciosamente.
- A notificação acontece depois do commit. Falha fica em `failed`/`skipped`, não reverte a meta e pode ser reclamada por uma única instância para retry.
- O serviço de metas resolve a origem por paciente e data; relatórios continuam consultando o mesmo contrato diário usado por Hoje e WhatsApp.
- Rollout exige aplicar `0032_professional_official_goals.sql` antes de liberar as novas procedures e interfaces.

## Guardrails para integração Strava

- Tokens OAuth ficam criptografados em `appSecrets` e nunca devem ser logados.
- Sincronização automática deve ser idempotente, usando a referência externa `strava:<activityId>` nas notas do exercício.
- A busca de atividades recentes deve paginar o período de lookback configurado para evitar perda de treinos além da primeira página.
- Quando o resumo da atividade não trouxer gasto calórico, buscar o detalhe da atividade antes de decidir pular o exercício.
- O OAuth deve solicitar `activity:read_all` para que atividades privadas ou marcadas como Only Me possam ser importadas após reconexão do usuário.
- Métricas detalhadas do Strava, como distância, duração, elevação, frequência cardíaca, cadência e potência, devem ser tratadas como opcionais na UI e preservadas apenas quando a API retornar esses campos.
- Quando treino de força, HIIT, CrossFit ou workout não retornar calorias, o backend pode estimar o gasto por MET e deve marcar o valor como estimado em metadados, nota do exercício e UI.
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
- Falha de leitura da preferência de imagem anotada deve degradar para o estado desabilitado, com diagnóstico sanitizado e sem impedir análise, persistência da foto original, registro ou resposta textual.
- Rodar smoke test web e WhatsApp antes de ativar em produção.

## Mutações multirrefeição pelo WhatsApp

Solicitações compostas de ajuste ou substituição usam uma unidade lógica compensável:

- tentativas persistem refeição e snapshots sem incrementar hábitos ou uso de catálogo;
- somente a última escrita do lote reconstrói hábitos de forma idempotente a partir das refeições atuais;
- falha intermediária restaura todas as refeições tentadas em ordem inversa e reconstrói novamente o estado derivado;
- falha durante a restauração nunca comunica sucesso ou restauração completa ao usuário;
- a resposta funcional só é enviada depois do sucesso integral pelo transporte lógico central.
