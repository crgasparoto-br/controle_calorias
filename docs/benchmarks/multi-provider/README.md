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

O manifesto `fixtures/manifest.json` contém entradas sintéticas, planos determinísticos de provider, expectativas funcionais e uma matriz versionada `capacidade × política`. Os perfis técnicos usados nos controles ficam em `scripts/issue-927-policy-controls.ts`.

Cada capacidade externa possui quatro controles obrigatórios, executados pelo resolvedor e executor comuns:

1. fallback desabilitado: uma falha do primário produz uma chamada e nenhum segundo envio;
2. retry: uma falha recuperável seguida de sucesso produz exatamente duas chamadas primárias sequenciais;
3. fallback same-provider: após a falha do primário ocorre exatamente uma chamada de fallback no mesmo provider;
4. cross-provider bloqueado em produção: a configuração é reconhecida, mas nenhum segundo provider recebe a operação.

São 32 controles (`8 capacidades externas × 4 famílias`). Cada tentativa corresponde a uma única chamada no último limite externo. Uma capacidade não pode reutilizar controle de outra capacidade.

Política não aplicável exige justificativa técnica concreta. O gate complementar rejeita justificativas circulares como “não há evidência de promoção” ou “o baseline foi mantido”, porque ausência de intenção de promover não prova inaplicabilidade técnica.

O runner também cobre:

- refeição por texto e visão, inclusive resultado válido sem alimento e NOVA embutida;
- `WHATSAPP_INTENT` por chamada real ao provider, com provider/modelo efetivos e telemetria;
- comandos determinísticos, contexto pendente, correção, substituição e exclusão sem chamada desnecessária;
- continuidade do WhatsApp com estado antes/depois, cancelamento ou consumo, efeito persistido, duplicidade e isolamento entre usuários;
- perguntas `/` com ferramenta disponível/executada;
- pesquisa nutricional com fonte vinculada e rejeição de ambiguidade;
- embeddings e degradação segura semântica → canônica;
- áudio PT-BR com retry limitado;
- anotação local, externa, desabilitada e externa → local;
- cross-provider explicitamente permitido somente no cenário sintético discriminante de `MEAL_TEXT`;
- contagem de outbound e prova de execução sequencial.

O cenário `intent-provider-primary` usa a tag técnica `provider-primary`: ele não substitui o comando determinístico que governa a família `primary`, mas é obrigatório no gate complementar e comprova uma chamada real com provider/modelo efetivos.

## Métricas

O relatório deriva da execução:

- operação válida e checks críticos;
- falsos positivos e fonte verificável;
- provider/modelo solicitados e efetivamente executados;
- p50/p95, timeout, indisponibilidade e tentativas;
- primário, retry, fallback same-provider/cross-provider e degradação local;
- ferramenta executada e unidades faturáveis;
- custo total estimado e custo por operação válida;
- regressões de segurança e privacidade;
- resultado individual dos 32 controles de política no artefato complementar `results/2026-08-06-policy-controls.json`.

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

Smoke funcional completo, sem credenciais:

```bash
pnpm smoke:issue-927
```

Verificar o relatório versionado, sua metadata e a regeneração determinística (este comando também faz parte de `pnpm agent:check`):

```bash
pnpm benchmark:ai:multi-provider:verify
```

Executar os 32 controles complementares e verificar o artefato versionado quando presente:

```bash
pnpm issue-927:policy-controls
pnpm issue-927:policy-controls:verify
```

O wrapper `scripts/issue-927-run-benchmark.sh` delega ao script canônico do `package.json`.

## Identidade reproduzível

O relatório integrado e o artefato complementar de políticas registram:

- SHA em que o harness foi executado;
- SHA-256 da árvore executável versionada;
- versão da rubrica e catálogo de preços;
- ambiente e classe de endpoint;
- contagem de cenários e, no artefato complementar, os 32 controles;
- limitações e decisão operacional.

Latências herméticas usam o relógio virtual do adapter, não o relógio da máquina. Assim, duas execuções com os mesmos fixtures, código e catálogo produzem o mesmo relatório.

A pasta `docs/benchmarks/multi-provider/results/` é excluída do hash para evitar autorreferência. No head final, o gate `benchmark:ai:multi-provider:verify` exige que o SHA testado seja ancestral, que o delta posterior contenha somente arquivos da pasta de resultados, que o SHA-256 da árvore executável seja idêntico e que a regeneração integral seja estruturalmente igual ao artefato commitado. Qualquer mudança posterior em runtime, harness, fixtures, documentação operacional ou testes invalida a evidência.

## Promoção e rollout

Somente `gpt-4o-mini-transcribe` possui comparação live versionada suficiente para permanecer como candidato de rollout controlado; `whisper-1` é o rollback. As demais capacidades mantêm o baseline. Fallback e cross-provider não foram promovidos.

O rollout/rollback real no Render não foi executado pela PR e exige autorização, responsável, janela, smoke anterior/posterior e observação sanitizada na issue #962. O procedimento canônico está em `docs/runbooks/multi-provider-rollout.md`.
