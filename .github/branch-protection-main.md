# Branch protection: main

A branch `main` deve exigir o status check abaixo antes de merge:

- Required status check: `Agent-first gate`

Esse nome deve bater com o job `Agent-first gate` definido em `.github/workflows/agent-check.yml`.

## Regras operacionais

- Vercel preview/deploy é complementar e não substitui o required status check `Agent-first gate`.
- PRs que tocam persistência, schema, dados sensíveis, autenticação ou integrações devem registrar se `DATABASE_URL` estava disponível no CI.
- Quando `DATABASE_URL` não estiver disponível, o passo `pnpm db:check-integrity` será pulado e a PR deve registrar validação alternativa ou risco residual.
- Se o required status check configurado no GitHub divergir deste arquivo, ajuste a configuração do repositório ou este documento no mesmo PR.
