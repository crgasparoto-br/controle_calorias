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

## Procedimento verificável de encerramento da migração #1317

Esta lista distingue **contrato versionado** de **configuração efetiva no GitHub**. Um workflow verde não comprova rulesets, variáveis ou consumidores externos. Registre a data, o responsável, a URL/captura da evidência e o SHA auditado na PR #1318 antes de marcar qualquer verificação externa como concluída.

### 1. Proteção efetiva de main e develop (administrador)

1. Abrir **Settings > Rules > Rulesets** e **Settings > Branches** do repositório e identificar todas as regras ativas aplicáveis a `main` e `develop` (inclusive rulesets da organização, quando houver).
2. Para cada branch, confirmar que o required status check aponta ao job `Agent-first gate`, que a regra é aplicada ao destino correto e que restrições de push, pull request obrigatória, atores com bypass e exceções não permitem uma janela de merge sem gate. Se a política permitir bypass, registrar quem pode usá-lo e a justificativa; não afirmar ausência de bypass sem inspeção.
3. Registrar link ou export da configuração efetiva, identificando o ator e a data. Corrigir divergências de administração **antes** do merge; nunca remover a regra antiga antes da substituta estar efetiva.

**Aceite:** evidência da configuração de ambas as branches, com status obrigatório e política de bypass/push explicitamente classificados como `confirmado`, `desvio` ou `não verificado`.

### 2. Variável de risco (administrador)

1. Em **Settings > Secrets and variables > Actions > Variables**, verificar se `CI_RISK_PROFILE` ou `DELIVERY_V2_RISK_PROFILE` estão definidos em escopos efetivos (repositório/organização/ambiente, quando aplicável). Não copiar valores confidenciais para logs.
2. Caso só a variável legada exista, configurar `CI_RISK_PROFILE` com o mesmo valor validado (`auto`, `fast`, `standard` ou `critical`). Se ambas existirem, confirmar a precedência da nova variável e documentar a escolha.
3. Executar nova CI por alteração legítima da PR ou rerun com identidade comprovada, observar o perfil **solicitado e efetivo** no resumo do classificador e revalidar o exact-head. Só em mudança posterior remover o alias legado; nunca nessa migração sem prova de configuração.

**Aceite:** escopo/valor não secreto ou classificação documentada, precedência confirmada, link do run e SHA correspondentes.

### 3. Consumidores de artefatos legados

1. Inventariar referências a `.delivery-v2/`, `scripts/delivery-v2-ci-classifier.mjs`, `refs/orchestrator/` e ao bundle `agent-first-repository-*` no próprio repositório, repositórios de automação (inclusive `crgasparoto-br/skill`) e consumidores externos conhecidos.
2. Distinguir referência histórica/documental de uso de runtime. Identificar proprietário, contrato de entrada, ref esperada, retenção e plano de migração por consumidor. Ausência de resultados em busca de código **não** prova ausência de consumidores externos.
3. Preservar `.delivery-v2/` e o bundle publicado até haver inventário assinado/confirmado por seus responsáveis. Planejar remoção posterior em PR separada com validações dos consumidores migrados.

**Aceite:** inventário com estado `ativo`, `histórico` ou `desconhecido`, evidência por consumidor, e decisão explícita de retenção. Estado desconhecido impede descontinuação.

### 4. Auditoria independente

1. Fixar `base_sha`, `head_sha`, arquivos alterados e run de CI do HEAD atual.
2. Ler o contrato `docs/audit/github-native-contract.json` **na base imutável** e aplicar o classificador de transporte da skill `auditar-issue`; não aceitar contrato introduzido apenas pelo candidato.
3. Validar artefatos exatos, política de risco, logs e gates; executar os recursos internos exigidos da skill em contexto realmente independente. Não inferir independência da execução de um self-test no workflow.
4. Registrar parecer e evidências na PR. Se a execução do auditor não disponibilizar os recursos necessários, declarar `INCONCLUSIVA` por limitação de runtime, sem atribuir defeito fictício ao código.

**Aceite:** parecer independente vinculando SHA, run, escopo, evidências e limitações. Nenhum merge automático.
