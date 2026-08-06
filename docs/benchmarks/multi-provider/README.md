# Benchmark multi-provider por capacidade

## Objetivo

Este diretório contém o benchmark reproduzível da issue #927. Ele compara o comportamento esperado das capacidades de IA sem alterar provider, modelo, fallback, secrets ou configuração de produção.

O benchmark é um gate hermético e versionado. Os cenários são sintéticos, sem conteúdo de usuário, prompt, transcrição, mídia, base64, resposta bruta, reasoning ou URL assinada. A única evidência live reutilizada é a comparação sanitizada e versionada de `TRANSCRIPTION` produzida pela issue #924.

## Decisões seguras por padrão

- fallback continua desabilitado por capacidade;
- cross-provider continua desabilitado em produção;
- `IMAGE_ANNOTATION` permanece em modo `local`;
- `FOOD_CLASSIFICATION` permanece embutida no Structured Output de `MEAL_TEXT` e `MEAL_VISION`, sem chamada separada;
- nenhuma variável do Render, secret, provider ou modelo de produção é alterada por este benchmark;
- ausência de evidência live suficiente preserva o baseline vigente.

## Cobertura

O manifesto em `fixtures/manifest.json` cobre:

- `MEAL_TEXT`, `MEAL_VISION` e classificação NOVA embutida;
- intenção do WhatsApp, comandos determinísticos e operação pendente sem chamada externa;
- correção, substituição e exclusão;
- perguntas `/`, pesquisa nutricional e fontes verificáveis;
- embeddings e degradação para busca canônica;
- transcrição PT-BR;
- anotação local, externa e desativada;
- primário, retry, fallback same-provider, cross-provider bloqueado/explicitamente permitido e degradação local.

Cada observação registra somente metadados sintéticos: resultado funcional, verificações críticas, latência, timeout, indisponibilidade, quantidade de tentativas, chamadas externas, ferramenta executada e custo estimado.

## Métricas

O relatório agrega por capacidade:

- taxa de operação válida;
- acurácia dos checks críticos;
- falsos positivos;
- taxa de fonte verificável quando exigida;
- p50 e p95 de latência;
- timeout, retry, fallback e indisponibilidade;
- prova de ausência de chamada externa nos fluxos determinísticos;
- custo total estimado e custo por operação válida;
- regressões de segurança e privacidade.

Custo é estimativa operacional do catálogo versionado, nunca cobrança real.

## Execução

```bash
./scripts/issue-927-run-benchmark.sh
```

Para gerar um relatório associado a um candidato:

```bash
./scripts/issue-927-run-benchmark.sh \
  --tested-sha <sha> \
  --source-tree-sha256 <sha256> \
  --price-catalog-version 2026-08-05.4 \
  --price-catalog-effective-date 2026-08-05 \
  --output docs/benchmarks/multi-provider/results/<data>-<sha-curto>.json
```

O smoke hermético, sem credenciais, é:

```bash
./scripts/issue-927-run-benchmark.sh --self-test
```

## Critério de promoção

Uma capacidade só pode mudar de baseline quando existir evidência reproduzível que prove, ao mesmo tempo:

1. ausência de regressão funcional, nutricional, conversacional, de segurança e privacidade;
2. melhoria material de qualidade, latência, disponibilidade ou custo;
3. compatibilidade do provider/modelo com o contrato real;
4. rollback explícito e testado;
5. autorização operacional para a mudança de produção.

A evidência atual sustenta somente `gpt-4o-mini-transcribe` como candidato de rollout controlado para `TRANSCRIPTION`. `whisper-1` permanece o rollback. Para as demais capacidades, o benchmark preserva os baselines por falta de comparação live integrada suficiente.

O procedimento operacional está em `docs/runbooks/multi-provider-rollout.md`.

## Rubrica e estado do rollout

A definição de operação válida e os checks críticos de cada capacidade são versionados no campo `rubric` do manifesto. Alterar uma definição exige nova versão de rubrica e novo relatório; métricas antigas não podem ser reinterpretadas retroativamente.

A decisão operacional atual está registrada em `results/2026-08-05-rollout-decision.json`: **pausado, aguardando autorização explícita para produção**. Nenhuma variável, secret, provider, modelo ou flag do Render foi alterada. A retomada começa por `TRANSCRIPTION`, somente após gates verdes, smoke anterior à mudança, responsável e janela registrados.
