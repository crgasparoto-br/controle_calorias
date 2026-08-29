# Issue #217 - regressao de onboarding e ativacao comercial

Este gate consolida as provas automatizadas ja existentes para o onboarding via WhatsApp e a integracao comercial. Ele nao replica regras de produto: referencia as suites comportamentais que exercitam lead/token, cadastro recuperavel, vinculacao de conta existente, catalogo, checkout, elegibilidade, ativacao, saudacao, capacidade, cobertura profissional, ciclo de assinatura e integracao fake do Asaas.

## Execucao local

Regressao focada sem banco externo:

```bash
pnpm exec tsx scripts/test-issue-217-regression.ts
```

Somente o contrato estrutural da matriz, incluindo a proibicao de `skip`/`todo` nas suites obrigatorias:

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

## Matriz consolidada

| Grupo | Prova principal |
| --- | --- |
| WhatsApp: lead, token, cadastro e recuperacao | `server/auth.whatsappOnboarding.test.ts`, `server/modules/onboarding/whatsappLeadService.test.ts`, `server/modules/onboarding/whatsappOnboardingErrors.test.ts` |
| Ativacao, reconciliacao e saudacao | `server/modules/onboarding/whatsappActivationReconciler.test.ts`, `server/modules/onboarding/webGreetingService.test.ts` |
| Catalogo e politica comercial | `server/modules/billing/catalogPolicy.test.ts`, `server/modules/billing/catalogService.test.ts` |
| Checkout web e fronteira publica | `server/modules/billing/billingWebCheckoutAttempt.test.ts`, `server/modules/billing/webPublic*.test.ts` |
| Provider fake/Asaas, agenda e idempotencia | `server/modules/billing/asaas/adapter*.test.ts`, `server/modules/billing/asaas/lifecycleHooks.test.ts`, `server/modules/billing/asaas/mutationGuard.test.ts`, `server/modules/billing/asaas/operationStore.test.ts` |
| Elegibilidade, precedencia e ciclo de assinatura | `server/modules/billing/accessPolicy.test.ts`, `server/modules/billing/subscriptionLifecycle*.test.ts` |
| Identidade comercial e antifraude | `server/modules/billing/commercialIdentity.auditRemediation.test.ts` |
| Cobertura profissional e capacidade | `server/modules/billing/professionalCoveragePolicy.test.ts`, `server/modules/billing/professionalCoverageService.test.ts`, `server/modules/billing/professionalCapacityRead.test.ts` |
| Persistencia/concorrencia/uniqueness | `db:test:whatsapp-onboarding-activation`, `db:test:whatsapp-active-phone-migration`, `db:test:billing` |
| Suite completa, frontend e regressao transversal | `pnpm test`, `pnpm check`, `pnpm architecture:check`, `pnpm docs:check`, `pnpm build`, executados pelo `Agent-first gate` |

## Dependencia bloqueante #898

A especificacao vigente da #217 inclui, por comentario vinculante, a validacao automatizada do rollout progressivo definido na #898. Como a #898 ainda nao possui implementacao de rollout/coortes disponivel para ser exercitada, esta PR e este gate sao **incrementais e nao encerram a #217**.

O fechamento da #217 permanece bloqueado ate que a #898 disponibilize comportamento executavel para provider fake em tres ciclos, sandbox, coortes internas, pilotos A/B, progressao `enforced` em 10%/25%/50%/100%, gates de avancao, concorrencia de aprovacoes, pausa, rollback e retomada. Quando esse comportamento existir, os testes correspondentes devem ser incorporados a esta matriz antes de qualquer `Closes #217`.

Nao e permitido substituir esses cenarios por placeholders, fixtures que apenas repetem constantes da especificacao ou uma declaracao de adiamento tratada como aprovacao.

## Regras do gate

- as suites listadas precisam existir;
- cada suite Vitest listada precisa conter casos executaveis;
- `describe.skip`, `it.skip`, `test.skip`, `test.todo`, `it.todo`, `xdescribe`, `xit` e `xtest` reprovam o contrato;
- os scripts TiDB obrigatorios precisam existir;
- a regressao focada nao chama Meta ou Asaas reais; ela reutiliza as suites fake-driven do repositorio;
- o gate TiDB exige `DATABASE_URL`, cria bancos scratch deterministas e isolados, executa onboarding/migracao sem o schema completo que introduz FKs alheias ao harness e aplica o schema corrente somente no banco de billing antes de `db:test:billing`;
- sucesso do job TiDB significa que os tres comandos obrigatorios foram realmente alcancados e aprovados; ausencia de banco ou falha de qualquer comando reprova o job.
