# Resultados do benchmark de transcrição

Este diretório recebe somente JSONs sanitizados produzidos pelo harness da issue #924. Não inclua áudio, transcrição, prompt, URL de mídia, telefone ou credencial.

## Execução

```bash
export TRANSCRIPTION_BENCHMARK_WHISPER_MODEL="whisper-1"
export TRANSCRIPTION_BENCHMARK_GPT4O_MINI_MODEL="gpt-4o-mini-transcribe"

BENCHMARK_SHA=$(git rev-parse HEAD)
BENCHMARK_DATE=$(date -u +%Y-%m-%d)
RESULT_FILE="docs/benchmarks/transcription/results/${BENCHMARK_DATE}-${BENCHMARK_SHA:0:12}.json"

OPENAI_API_KEY="..." pnpm benchmark:transcription -- "$RESULT_FILE"
jq empty "$RESULT_FILE"
jq '{generatedAt, testedSha, models, environment, executionPolicy, summary, limitations}' "$RESULT_FILE"
```

A chave deve existir somente no processo confiável que realiza a chamada externa. Não executar o benchmark em workflow de `pull_request` com secrets permanentes do repositório. PRs usam testes herméticos e controles estáticos; comparação real deve ocorrer localmente ou em contexto protegido que não execute código mutável da PR com credenciais.

## Registro obrigatório

Antes de versionar, confirme:

- o campo `testedSha` corresponde ao `HEAD` limpo executado;
- os seis fixtures sintéticos foram processados pelos dois modelos;
- o JSON é válido e não contém `NaN`/`Infinity`;
- `.results[].status == "error"` foi revisado e possui somente classificação sanitizada;
- o arquivo não contém texto transcrito nem material sensível;
- a PR registra data UTC, SHA, modelos efetivos, quantidade de erros, WER, recall, latência, custo e limitações;
- o digest do artefato e o SHA-256 do JSON foram registrados em `evidence-manifest.json`;
- qualquer reutilização em SHA posterior comprovou que runtime, harness e fixtures permaneceram idênticos;
- nenhuma configuração de produção foi alterada.

## Execuções de 2026-08-04

### Execução histórica — `7758bbdafc0b`

O arquivo `2026-08-04-7758bbdafc0b.json` registra o SHA `7758bbdafc0b80f6b0ac37338eff4bd2005450e9`:

- 12 de 12 combinações concluídas com texto útil;
- `whisper-1`: WER médio `0.3069`, recall crítico `0.6250`, latência média `948.6667 ms`, custo estimado total `US$ 0.00220234` e segmentos em 100% dos fixtures;
- `gpt-4o-mini-transcribe`: WER médio `0.3283`, recall crítico `0.6167`, latência média `616.6667 ms`, custo estimado total `US$ 0.00107125` e ausência de segmentos;
- retries e fallback permaneceram em zero.

Nesta amostra, `whisper-1` teve pequena vantagem de WER e recall.

### Execução canônica do runtime auditado — `751c3c709674`

O arquivo `2026-08-04-751c3c709674.json` foi importado do artefato do run `30935644636`, job `transcription benchmark`, e registra o SHA `751c3c7096748c16a1546b2ab8161e512ecf133a`:

- 12 de 12 combinações concluídas com texto útil;
- exatamente uma tentativa por combinação;
- retries e fallback em zero;
- `whisper-1`: WER médio `0.3069`, recall crítico `0.6250`, latência média `935.3333 ms`, custo estimado total `US$ 0.00220234` e segmentos em 100% dos fixtures;
- `gpt-4o-mini-transcribe`: WER médio `0.2734`, recall crítico `0.7167`, latência média `540.3333 ms`, custo estimado total `US$ 0.00108125` e ausência de segmentos.

Nesta execução, `gpt-4o-mini-transcribe` apresentou WER, recall, latência e custo melhores. A divergência entre as duas execuções demonstra variabilidade do provider e da amostra sintética; nenhuma delas, isoladamente, promove modelo.

A remediação posterior a `751c3c709674` remove apenas o job inseguro que entregava secret a código de PR, reescreve o controle estático e torna esta evidência durável. Runtime, harness e fixtures devem permanecer idênticos para que a execução continue válida; qualquer alteração nesses caminhos exige novo benchmark em contexto confiável.

## Decisão

A issue #924 mantém `whisper-1` como default compatível. A #927 deve tratar os dois resultados como evidência de uma amostra pequena e variável, considerar ausência de segmentos no GPT-4o mini e exigir nova coleta segura antes de qualquer promoção.
