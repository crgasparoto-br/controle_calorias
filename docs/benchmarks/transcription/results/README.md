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

A execução exige `OPENAI_API_KEY` no ambiente autorizado. A chave não deve ser gravada em `.env`, shell history, resultado, commit, comentário ou log. Remova-a do ambiente ao concluir.

## Registro obrigatório

Antes de versionar, confirme:

- o SHA avaliado corresponde ao `HEAD` limpo;
- os seis fixtures sintéticos foram processados pelos dois modelos;
- o JSON é válido e não contém `NaN`/`Infinity`;
- todas as 12 combinações modelo/fixture retornaram `status: "ok"`;
- o arquivo não contém texto transcrito nem material sensível;
- a PR registra data UTC, SHA, modelos efetivos, quantidade de erros, WER, recall, latência, custo e limitações;
- nenhuma configuração de produção foi alterada.

Falhas de autenticação, permissão ou disponibilidade de modelo devem permanecer como evidência do GitHub Actions e como impedimento registrado na PR; não devem ser convertidas em métricas de qualidade.

## Estado da execução da issue #924

Em 2026-08-04, o job protegido foi executado com o secret `OPENAI_API_KEY` disponibilizado pelo GitHub Actions. A primeira execução tentou as 12 combinações e todas falharam antes da produção de métricas válidas. Um probe posterior, limitado a uma chamada e sem registrar mensagem, corpo, áudio ou transcrição, confirmou para `whisper-1`:

```json
{
  "httpStatus": 403,
  "providerCode": "model_not_found",
  "providerType": "invalid_request_error"
}
```

O benchmark permanece pendente até que o projeto associado à chave tenha acesso aos dois modelos exigidos. Depois da correção externa, o job protegido da PR deverá produzir o JSON sanitizado; somente esse resultado bem-sucedido deve ser adicionado a este diretório.

## Decisão

A conclusão deve recomendar manter o baseline ou avaliar outro modelo na #927. O resultado desta pasta não promove modelo, não habilita fallback e não autoriza segundo provider por si só.
