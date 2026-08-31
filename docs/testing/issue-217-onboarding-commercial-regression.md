# Issue #217 - regressao de onboarding e ativacao comercial

Este gate consolida provas automatizadas ja existentes para onboarding via WhatsApp e integracao comercial. Ele nao replica regras de produto: referencia suites comportamentais e mantem uma matriz explicita de cenarios obrigatorios por ID, arquivo e titulo de teste. A remocao de um unico cenario rastreado reprova o contrato mesmo quando a mesma suite ainda contem outros testes.

## Execucao local

Regressao focada sem banco externo:

```bash
pnpm exec tsx scripts/test-issue-217-regression.ts
```

Somente o contrato estrutural da matriz, incluindo a proibicao de `skip`/`todo` e a verificacao individual de cada cenario rastreado:

```bash
pnpm exec tsx scripts/test-issue-217-regression.ts --contract-only
```

Regressao TiDB, com `DATABASE_URL` apontando para um servidor TiDB de teste. O agregador cria bancos scratch isolados para onboarding/migracao e billing:

```bash
pnpm exec tsx scripts/test-issue-217-regression.ts --tidb-only
```

Para executar Vitest e TiDB no mesmo comando:

```bash
pnpm exec tsx scripts/test-issue-217-regression.ts --with-tidb
```

## Contrato por cenario

A fonte de verdade do gate e `requiredScenarioProofs` em `scripts/test-issue-217-regression.ts`. Cada entrada possui:

- ID estavel do cenario;
- arquivo de teste responsavel;
- titulo executavel exato (`it`/`test`).

O gate falha se o arquivo desaparecer, se o titulo rastreado desaparecer, se houver IDs/provas duplicados ou se uma suite obrigatoria usar `skip`/`todo`. O proprio agregador executa um controle negativo sintetico que remove um de dois cenarios do mesmo arquivo e exige que apenas o cenario removido seja reportado como ausente.

## Matriz consolidada

| Grupo | Prova principal |
| --- | --- |
| WhatsApp: conflito publico, posse, vinculo e retomada | `server/auth.whatsappOnboarding.test.ts`, `server/modules/onboarding/whatsappLeadService.test.ts`, `server/modules/onboarding/whatsappOnboardingErrors.test.ts` |
| Ativacao, reconciliacao e saudacao | `server/modules/onboarding/whatsappActivationReconciler.test.ts`, `server/modules/onboarding/webGreetingService.test.ts` |
| Catalogo, cupom e politica comercial | `server/modules/billing/catalogPolicy.test.ts`, `server/modules/billing/catalogService.test.ts` |
| Checkout web, multitab e fronteira publica | `server/modules/billing/billingWebCheckoutAttempt.test.ts`, `server/modules/billing/webPublic*.test.ts` |
| Provider fake/Asaas, agenda e idempotencia | `server/modules/billing/asaas/adapter*.test.ts`, `server/modules/billing/asaas/lifecycleHooks.test.ts`, `server/modules/billing/asaas/mutationGuard.test.ts`, `server/modules/billing/asaas/operationStore.test.ts` |
| Elegibilidade, precedencia e ciclo de assinatura | `server/modules/billing/accessPolicy.test.ts`, `server/modules/billing/subscriptionLifecycle*.test.ts` |
| Identidade comercial e antifraude | `server/modules/billing/commercialIdentity.auditRemediation.test.ts` |
| Cobertura profissional e capacidade | `server/modules/billing/professionalCoveragePolicy.test.ts`, `server/modules/billing/professionalCoverageService.test.ts`, `server/modules/billing/professionalCapacityRead.test.ts` |
| Rollout tecnico #898: corte, snapshot, transicao, comunicacoes e retry | `server/modules/billing/billingCommercialTransition.test.ts`, `scripts/test-billing-commercial-transition-tidb.ts` |
| Rollout tecnico #898: coorte, gate manual, pausa, retomada e rollback | `server/modules/billing/billingRolloutAdmin.test.ts`, `server/modules/billing/billingRolloutAdminAuthorization.test.ts`, `server/modules/billing/billingRolloutAdminSchemas.test.ts` |
| Persistencia interna antes do canal externo | `server/modules/billing/billingNotificationCenter.test.ts` |
| Persistencia/concorrencia/uniqueness | `db:test:whatsapp-onboarding-activation`, `db:test:whatsapp-active-phone-migration`, `db:test:billing`, `scripts/test-billing-commercial-transition-tidb.ts` |
| Suite completa, frontend e regressao transversal | `pnpm test`, `pnpm check`, `pnpm architecture:check`, `pnpm docs:check`, `pnpm build`, executados pelo `Agent-first gate` |

## Fronteira atual #898 / #1024

A implementacao tecnica da #898 foi integrada a `develop` pelo PR #1023. Por isso, este gate nao trata mais a #898 como implementacao ausente: os contratos tecnicos de corte, snapshot congelado, transicao de 30 dias, comunicacoes, coorte deterministica, decisao manual, pausa e rollback fazem parte da regressao desta PR.

A #1024 e a fonte canonica para a execucao operacional real do rollout: tres ciclos completos com provider fake como evidencia operacional, sandbox por janela/duracao minima, coortes internas e pilotos reais, observacao por dias, metricas reais e progressao `enforced` 10%/25%/50%/100% com aprovacoes. Esses itens nao sao declarados concluidos por este gate e nao podem ser substituidos por placeholders ou por simples repeticao das constantes da especificacao.

Enquanto a #217 mantiver esses cenarios operacionais como obrigatorios para seu encerramento, **esta PR permanece incremental e nao fecha a #217**. O bloqueio remanescente deve ser referido como dependencia operacional da #1024, nao como ausencia da implementacao tecnica da #898.

## Regras do gate

- cada cenario listado em `requiredScenarioProofs` precisa existir como teste executavel no arquivo declarado;
- remover apenas um teste obrigatorio de uma suite com outros testes reprova o contrato;
- `describe.skip`, `it.skip`, `test.skip`, `test.todo`, `it.todo`, `xdescribe`, `xit` e `xtest` reprovam o contrato;
- os scripts TiDB obrigatorios precisam existir;
- a regressao focada nao chama Meta ou Asaas reais; ela reutiliza suites fake-driven do repositorio;
- o gate TiDB exige `DATABASE_URL`, cria bancos scratch deterministas e isolados, executa onboarding/migracao sem o schema completo que introduz FKs alheias ao harness e aplica o schema corrente no banco de billing antes das provas de billing e transicao comercial;
- sucesso do job TiDB significa que onboarding, migracao de telefone, billing e snapshot congelado da transicao comercial foram realmente alcancados e aprovados.
