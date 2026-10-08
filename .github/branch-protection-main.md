# Branch protection: main

A branch `main` deve exigir o status check abaixo antes de merge:

- Required status check: `Agent-first gate`

Esse nome deve bater com o job `Agent-first gate` definido em `.github/workflows/agent-check.yml`. A CI local altera o conteúdo interno do gate conforme o risco da PR, sem alterar o nome exigido pela proteção.

Para PRs, a cadeia é:

1. `CI risk classification` classifica deterministicamente os arquivos alterados em FAST, STANDARD ou CRITICAL;
2. `Merge preview integration` verifica compatibilidade TypeScript do merge preview quando há código, sem repetir a suíte Vitest;
3. `Agent-first gate` valida o `head_sha` exato com o conjunto exigido pelo perfil;
4. paths desconhecidos ou sensíveis promovem para CRITICAL e não podem ser rebaixados por configuração.

Push para `main` e `develop` continua executando regressão completa independentemente do perfil usado na PR.

## Regras operacionais

- Vercel preview/deploy é complementar e não substitui o required status check `Agent-first gate`.
- PRs CRITICAL que tocam persistência, schema, dados sensíveis, autenticação ou integrações devem registrar se `DATABASE_URL` estava disponível no CI.
- Quando `DATABASE_URL` não estiver disponível em um gate que exija banco, o passo `pnpm db:check-integrity` será pulado e a PR deve registrar validação alternativa ou risco residual.
- O perfil CI local e o `head_sha` validado ficam registrados no summary/manifest do workflow.
- Se o required status check configurado no GitHub divergir deste arquivo, ajuste a configuração do repositório ou este documento no mesmo PR.

A migração #1317 preserva o required status `Agent-first gate`; confirme no GitHub Rulesets/branch protection que ele permanece obrigatório em `main` e `develop` antes de qualquer futura renomeação. A configuração administrativa efetiva não é alterada por este documento.
