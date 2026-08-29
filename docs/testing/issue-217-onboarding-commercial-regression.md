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

Regressao TiDB, com `DATABASE_URL` apontando para o ambiente de teste autorizado:

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

## Dependencia futura #898

Os cenarios exclusivos de piloto/rollout comercial permanecem fora do contrato de fechamento da #217 enquanto a #898 estiver aberta. A #217 nao considera esses cenarios aprovados nem cria um falso positivo: o gate registra explicitamente a dependencia. Quando a #898 for implementada, seus cenarios devem ser incorporados a esta matriz ou a um gate sucessor com os mesmos controles de rastreabilidade.

## Regras do gate

- as suites listadas precisam existir;
- cada suite Vitest listada precisa conter casos executaveis;
- `describe.skip`, `it.skip`, `test.skip`, `test.todo`, `it.todo`, `xdescribe`, `xit` e `xtest` reprovam o contrato;
- os scripts TiDB obrigatorios precisam existir;
- a regressao focada nao chama Meta ou Asaas reais; ela reutiliza as suites fake-driven do repositorio;
- a regressao TiDB exige `DATABASE_URL` e falha explicitamente quando solicitada sem a configuracao necessaria.
