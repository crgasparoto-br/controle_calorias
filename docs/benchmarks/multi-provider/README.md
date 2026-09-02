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
- ausência de comparação live suficiente preserva o baseline técnico versionado.

## Cobertura executável

O manifesto `fixtures/manifest.json` contém entradas sintéticas, planos determinísticos de provider, expectativas funcionais e uma matriz versionada `capacidade × política`. Os perfis técnicos usados nos controles ficam em `scripts/issue-927-policy-controls.ts`.

Cada capacidade externa possui quatro controles obrigatórios, executados pelo resolvedor e executor comuns:

1. fallback desabilitado: uma falha do primário produz uma chamada e nenhum segundo envio;
2. retry: uma falha recuperável seguida de sucesso produz exatamente duas chamadas primárias sequenciais;
3. fallback same-provider: após a falha do primário ocorre exatamente uma chamada de fallback no mesmo provider;
4. cross-provider bloqueado em produção: a configuração é reconhecida, mas nenhum segundo provider recebe a operação.

São 32 controles (`8 capacidades externas × 4 famílias`). Cada tentativa corresponde a uma única chamada no último limite externo. Uma capacidade não pode reutilizar controle de outra capacidade.

Política não aplicável continua exigindo justificativa não vazia no manifesto. Para a decisão automática, o gate complementar não confia no texto livre: deriva um `reasonCode` fechado a partir da capacidade e da família e liga exceções de transporte ao controle executável correspondente. Frases circulares no manifesto não contam como evidência nem determinam a cobertura.

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
- resultado individual dos 32 controles de política no artefato complementar obrigatório `results/2026-08-06-policy-controls.json`.

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

Verificar a integridade, a metadata e a linhagem Git do relatório versionado (este comando também faz parte de `pnpm agent:check`):

```bash
pnpm benchmark:ai:multi-provider:verify
```

Executar os 32 controles complementares e verificar obrigatoriamente o artefato versionado:

```bash
pnpm issue-927:policy-controls
pnpm issue-927:policy-controls:verify
```

O primeiro comando reexecuta os 32 controles no candidato atual. O segundo valida que o artefato histórico permaneceu imutável e foi publicado a partir do `testedSha` sem mudanças executáveis intermediárias.

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

A pasta `docs/benchmarks/multi-provider/results/` é excluída do hash para evitar autorreferência. O relatório versionado é um snapshot histórico: `benchmark:ai:multi-provider:verify` recompõe a árvore executável exatamente no `testedSha`, confere o SHA-256 registrado, exige que o commit que publicou relatório e metadata tenha alterado somente arquivos de `results/`, confirma que esse commit continua ancestral do candidato atual e verifica que os bytes publicados não foram modificados depois da publicação. Assim, uma mudança futura de runtime, harness, fixtures, documentação ou testes não reescreve nem invalida a evidência histórica já publicada.

O candidato atual continua sendo validado separadamente: `smoke:issue-927` executa novamente o harness e exige gates verdes no `VERIFICATION_HEAD_SHA`, enquanto `issue-927:policy-controls` reexecuta os 32 controles. Um novo snapshot em `results/` só é necessário quando houver decisão explícita de publicar nova evidência de benchmark; não é requisito para cada PR que apenas altera o produto.

## Promoção e rollout

A conclusão do benchmark da #927 permanece histórica: naquele recorte nenhuma capacidade possuía evidência suficiente para promover um novo modelo. Em `TRANSCRIPTION`, a comparação live histórica favorecia `gpt-4o-mini-transcribe`, porém esse identificador era um alias mutável e o catálogo runtime versionado não continha um snapshot imutável equivalente com preço validado. Por isso a #927 manteve `whisper-1` como baseline técnico e `keep-baseline`, sem promover fallback ou cross-provider.

Esse resultado não descreve o estado operacional posterior. Em 2026-09-01, o responsável confirmou na #962 que as configurações de IA por capacidade foram implantadas no Render e estão funcionando em produção. A PR da #927 não executou esse rollout; a execução ocorreu posteriormente no fluxo operacional da #962.

Os valores efetivos de produção permanecem gerenciados no Render e não são inferidos dos defaults deste benchmark. O registro sanitizado dessa conclusão está em `docs/history/ai-multi-provider-rollout-2026-09-01.md`; futuras mudanças e reversões continuam seguindo `docs/runbooks/multi-provider-rollout.md`.
