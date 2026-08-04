# Resultados do benchmark de transcrição

Este diretório recebe somente JSONs sanitizados produzidos pelo harness da issue #924. Não inclua áudio, transcrição, prompt, URL de mídia, telefone ou credencial.

## Execução

```bash
export TRANSCRIPTION_BENCHMARK_WHISPER_MODEL="whisper-1"
export TRANSCRIPTION_BENCHMARK_GPT4O_MINI_MODEL="gpt-4o-mini-transcribe"

BENCHMARK_SHA=$(git rev-parse HEAD)
BENCHMARK_DATE=$(date -u +%Y-%m-%d)
RESULT_FILE="docs/benchmarks/transcription/results/${BENCHMARK_DATE}-${BENCHMARK_SHA:0:12}.json"

pnpm benchmark:transcription -- "$RESULT_FILE"
jq empty "$RESULT_FILE"
jq '{generatedAt, models, environment, executionPolicy, summary, limitations}' "$RESULT_FILE"
```

A execução exige `OPENAI_API_KEY` no ambiente local autorizado. A chave não deve ser gravada em `.env`, shell history, resultado, commit, comentário ou log. Remova-a do ambiente ao concluir.

## Registro obrigatório

Antes de versionar, confirme:

- o SHA avaliado corresponde ao `HEAD` limpo;
- os seis fixtures sintéticos foram processados pelos dois modelos;
- o JSON é válido e não contém `NaN`/`Infinity`;
- `.results[].status == "error"` foi revisado;
- o arquivo não contém texto transcrito nem material sensível;
- a PR registra data UTC, SHA, modelos efetivos, quantidade de erros, WER, recall, latência, custo e limitações;
- nenhuma configuração de produção foi alterada.

## Decisão

A conclusão deve recomendar manter o baseline ou avaliar outro modelo na #927. O resultado desta pasta não promove modelo, não habilita fallback e não autoriza segundo provider por si só.
