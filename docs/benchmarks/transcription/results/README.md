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

## Execuções de 2026-08-04 — histórico não canônico

Os dois JSONs versionados continuam disponíveis para transparência e para validar o formato sanitizado, mas **não são evidência canônica** da issue #924:

- `2026-08-04-751c3c709674.json` foi produzido no run `30935644636`, cujo workflow de `pull_request` executava código mutável do head com `OPENAI_API_KEY` disponível ao passo do benchmark. Não há evidência de vazamento, porém a fronteira de confiança foi violada.
- `2026-08-04-7758bbdafc0b.json` não possui atestação versionada suficiente para demonstrar execução em contexto confiável.

O `evidence-manifest.json` mantém ambos como histórico de proveniência não confiável e define `canonicalRun: null`. Seus números não podem fundamentar promoção de modelo nem encerramento da issue.

## Nova coleta obrigatória

Uma nova comparação real deve:

1. executar código já revisado e imutável, com working tree limpa;
2. resolver `git rev-parse HEAD` e rejeitar qualquer `TRANSCRIPTION_BENCHMARK_TESTED_SHA` ou `GITHUB_SHA` divergente;
3. disponibilizar a credencial somente ao processo confiável do benchmark, nunca a código mutável de workflow `pull_request`;
4. produzir JSON sanitizado e registrar SHA-256, ambiente, modelos, data e limitações;
5. substituir `canonicalRun: null` no manifesto somente depois de revisão da proveniência.

## Decisão

A issue #924 mantém `whisper-1` como default compatível. A #927 não deve promover modelo usando os resultados históricos acima; uma coleta confiável continua obrigatória.
