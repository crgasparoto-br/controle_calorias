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

## Execução canônica de 2026-08-04

A execução confiável está registrada em:

- resultado: `2026-08-04-af087f9b0c64.json`;
- proveniência: `2026-08-04-af087f9b0c64.provenance.json`;
- SHA testado: `af087f9b0c643a3146d46c1567c8fd80bbeff03e`;
- run: `30954486742`, artifact `8910458299`;
- SHA-256 do artifact: `4b60574595b9ebfc02a65bd804ade1c9801e9d81dfcb2ee74909c61ff39f9423`;
- SHA-256 do JSON: `0ce13fcc23a6a5629d0871702c669bb505725fa932104ab6bc28e8cfb93f3029`.

A execução ocorreu por evento `push`, em checkout destacado do SHA exato, com árvore limpa, token somente leitura, credenciais de checkout não persistidas e `OPENAI_API_KEY` disponível apenas no passo do benchmark. Os logs mascararam a chave e o artefato contém somente métricas sanitizadas.

Os dois modelos processaram seis fixtures cada, sem erro, retry ou fallback:

| Métrica | whisper-1 | gpt-4o-mini-transcribe |
|---|---:|---:|
| Taxa de sucesso | 100% | 100% |
| Texto útil | 100% | 100% |
| Latência média | 1360,8333 ms | 786 ms |
| WER médio | 0,3069 | 0,2921 |
| Recall médio de termos críticos | 0,625 | 0,6583 |
| Custo estimado total | US$ 0,00220234 | US$ 0,00107125 |
| Segmentos disponíveis | 100% | 0% |

Nesta amostra sintética, `gpt-4o-mini-transcribe` apresentou menor latência, menor WER, maior recall e menor custo estimado, mas não retornou segmentos. A issue #924 mantém `whisper-1` como default; qualquer promoção ou rollout pertence à #927.

## Histórico não canônico

Os resultados `2026-08-04-751c3c709674.json` e `2026-08-04-7758bbdafc0b.json` permanecem versionados para transparência, mas não fundamentam decisão. Os motivos de invalidação estão em `evidence-manifest.json`.

## Reutilização

A execução canônica somente pode ser reutilizada em SHA posterior quando os caminhos de runtime, harness, testes e fixtures listados no manifesto permanecerem idênticos. Mudança em qualquer desses caminhos invalida a coleta e exige novo benchmark confiável.
