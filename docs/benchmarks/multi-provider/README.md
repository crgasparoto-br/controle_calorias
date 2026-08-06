# Benchmark multi-provider por capacidade

## Objetivo

Este diretório contém o benchmark reproduzível da issue #927. O harness executa as fronteiras reais das capacidades migradas sem acessar rede, segredos, produção ou dados de usuário. Providers determinísticos são injetados somente no limite dos adapters; resolvedor, executor comum, validações de domínio, retry, fallback, ferramentas e degradações permanecem os mesmos usados pela aplicação.

As fixtures são sintéticas e licenciadas. O relatório guarda somente identificadores de cenário, checks, métricas agregáveis e metadados sanitizados. Ele não guarda texto de entrada/saída, prompt, transcrição, foto, base64, resposta bruta, reasoning, segredo ou URL assinada.

## Decisões seguras por padrão

- fallback continua desabilitado por capacidade na configuração recomendada;
- cross-provider continua bloqueado em produção;
- `IMAGE_ANNOTATION` permanece em modo `local`;
- `FOOD_CLASSIFICATION` permanece embutida em `MEAL_TEXT` e `MEAL_VISION`, sem chamada separada;
- nenhuma variável do Render, segredo, provider ou modelo de produção é alterada pelo harness;
- ausência de comparação live suficiente preserva o baseline.

## Cobertura executável

O manifesto `fixtures/manifest.json` contém entradas sintéticas, respostas determinísticas de provider, expectativas funcionais e uma matriz versionada `capacidade × política`. Cada família (`primary`, `retry`, fallback same-provider, cross-provider bloqueado/permitido e degradação local) precisa apontar para cenários da própria capacidade ou declarar explicitamente por que não é aplicável. Tags globais isoladas não satisfazem cobertura. O runner mede o que ocorreu durante a execução e cobre:

- refeição por texto e visão, inclusive resultado válido sem alimento e NOVA embutida;
- WhatsApp simples, ambíguo e adversarial, comando determinístico, contexto pendente, correção, substituição e exclusão. Os cenários de continuidade usam o repositório persistente em memória e verificam estado antes/depois, cancelamento ou consumo, efeito de domínio, duplicidade e isolamento entre usuários;
- perguntas `/` com ferramenta disponível/executada;
- pesquisa nutricional com fonte vinculada e rejeição de ambiguidade;
- embeddings e degradação segura semântica → canônica;
- áudio PT-BR com retry limitado;
- anotação local, externa, desabilitada e externa → local;
- primário, retry, fallback same-provider, cross-provider bloqueado e cross-provider explicitamente permitido em teste;
- contagem de outbound e prova de execução sequencial.

## Métricas

O relatório deriva da execução:

- operação válida e checks críticos;
- falsos positivos e fonte verificável;
- p50/p95, timeout, indisponibilidade e tentativas;
- primário, retry, fallback same-provider/cross-provider e degradação local;
- ferramenta executada e unidades faturáveis;
- custo total estimado e custo por operação válida;
- regressões de segurança e privacidade.

`criticalAccuracy` é `null` quando não existe evidência crítica; nunca é preenchida implicitamente como 100%. Custo é estimativa do catálogo versionado, não cobrança real.

## Execução

```bash
pnpm benchmark:ai:multi-provider
```

Gerar relatório gzip e metadata vinculada:

```bash
pnpm benchmark:ai:multi-provider -- \
  --output docs/benchmarks/multi-provider/results/2026-08-06-executable-harness.json.gz \
  --metadata-output docs/benchmarks/multi-provider/results/2026-08-06-executable-harness.metadata.json
```

O verificador oficial lê gzip diretamente, regenera deterministicamente todas as observações e decisões e exige igualdade estrutural integral. A metadata também vincula os bytes JSON/gzip, SHA testado, árvore executável, contagem de observações e estado operacional. Alterar uma métrica ou decisão sem regenerar o harness faz o gate falhar.

Smoke funcional completo, sem credenciais:

```bash
pnpm smoke:issue-927
```

Verificar que o relatório versionado continua compatível com a árvore executável atual (este comando também faz parte de `pnpm agent:check`):

```bash
pnpm benchmark:ai:multi-provider:verify
```

O wrapper `scripts/issue-927-run-benchmark.sh` delega ao script canônico do `package.json`.

## Identidade reproduzível

O relatório registra:

- SHA em que o harness foi executado;
- SHA-256 da árvore executável versionada;
- versão da rubrica e catálogo de preços;
- ambiente e classe de endpoint;
- limitações e decisão operacional.

Latências herméticas usam o relógio virtual do adapter, não o relógio da máquina. Assim, duas execuções com os mesmos fixtures, código e catálogo produzem o mesmo relatório.

A pasta `docs/benchmarks/multi-provider/results/` é excluída do hash para evitar autorreferência: adicionar o próprio relatório muda o commit, mas não muda a árvore executável. O relatório guarda o SHA do candidato efetivamente executado. No head final, o gate `benchmark:ai:multi-provider:verify` exige que esse SHA seja ancestral, que o delta posterior contenha somente arquivos da pasta de resultados, que o SHA-256 da árvore executável permaneça idêntico e que a regeneração integral seja igual ao artefato commitado. Qualquer mudança posterior em runtime, harness, fixtures, documentação operacional ou testes invalida a evidência.

## Promoção e rollout

Somente `gpt-4o-mini-transcribe` possui comparação live versionada suficiente para permanecer como candidato de rollout controlado; `whisper-1` é o rollback. As demais capacidades mantêm o baseline. Fallback e cross-provider não foram promovidos.

O rollout/rollback real no Render não foi executado pela PR e exige autorização, responsável, janela, smoke anterior/posterior e observação sanitizada na issue #962. O procedimento canônico está em `docs/runbooks/multi-provider-rollout.md`.
