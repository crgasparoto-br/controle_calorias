# Branch protection: main

A branch `main` deve exigir o status check abaixo antes de merge:

- Required status check: `Agent-first gate`

Esse nome deve bater com o job `Agent-first gate` definido em `.github/workflows/agent-check.yml`. A Delivery V2 altera o conteúdo interno do gate conforme o risco da PR, sem alterar o nome exigido pela proteção.

Para PRs, a cadeia é:

1. `Delivery V2 risk` classifica deterministicamente os arquivos alterados em FAST, STANDARD ou CRITICAL;
2. `Merge preview integration` verifica compatibilidade TypeScript do merge preview quando há código, sem repetir a suíte Vitest;
3. `Database integrity check` executa `pnpm db:check-integrity` no runner self-hosted `tidb-vps` para o perfil CRITICAL;
4. `Agent-first gate` valida o `head_sha` exato com o conjunto exigido pelo perfil e propaga falha do gate de banco;
5. paths desconhecidos ou sensíveis promovem para CRITICAL e não podem ser rebaixados por configuração.

Push para `main` e `develop` continua executando regressão completa independentemente do perfil usado na PR.

## Regras operacionais

- Vercel preview/deploy é complementar e não substitui o required status check `Agent-first gate`.
- PRs CRITICAL executam `pnpm db:check-integrity` no runner self-hosted `tidb-vps` com `DATABASE_URL`.
- Quando `DATABASE_URL` não estiver disponível em um gate que exija banco, o job deve falhar explicitamente; o check não pode ser tratado como sucesso ou pulado.
- O perfil Delivery V2 e o `head_sha` validado ficam registrados no summary/manifest do workflow.
- Se o required status check configurado no GitHub divergir deste arquivo, ajuste a configuração do repositório ou este documento no mesmo PR.
