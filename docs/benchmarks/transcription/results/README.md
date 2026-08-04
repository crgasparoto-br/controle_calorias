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
jq '{generatedAt, testedSha, models, environment, executionPolicy, summary, limitations}' "$RESULT_FILE"
```

A execução exige `OPENAI_API_KEY`. Localmente, disponibilize a variável apenas durante o comando e remova-a ao concluir. No GitHub Actions, use exclusivamente o secret canônico `OPENAI_API_KEY`, injetado somente no passo **Run exact-head transcription benchmark**, após checkout, validação de identidade, setup e instalação sem credenciais. A chave não pode ser gravada em `.env`, shell history, resultado, commit, comentário, log ou artefato.

No job protegido, `TRANSCRIPTION_BENCHMARK_TESTED_SHA` recebe o head exato da PR e o harness recusa divergência em relação ao `HEAD` efetivamente checkoutado. O JSON sanitizado é publicado como artefato `issue-924-transcription-benchmark-<sha>`; ele pode ser incorporado a esta pasta somente depois da revisão de privacidade e da confirmação de identidade.

## Registro obrigatório

Antes de versionar, confirme:

- o campo `testedSha` corresponde ao `HEAD` limpo e ao SHA indicado no nome do arquivo;
- os seis fixtures sintéticos foram processados pelos dois modelos;
- o JSON é válido e não contém `NaN`/`Infinity`;
- `.results[].status == "error"` foi revisado e possui somente classificação sanitizada;
- o arquivo não contém texto transcrito nem material sensível;
- a PR registra data UTC, SHA, modelos efetivos, quantidade de erros, WER, recall, latência, custo e limitações;
- nenhuma configuração de produção foi alterada.

## Resultado de 2026-08-04

O arquivo `2026-08-04-7758bbdafc0b.json` registra a execução protegida do SHA `7758bbdafc0b80f6b0ac37338eff4bd2005450e9`, também gravado no campo `testedSha` do JSON:

- 12 de 12 combinações concluídas com texto útil;
- `whisper-1`: WER médio `0.3069`, recall crítico `0.625`, latência média `948.6667 ms`, custo estimado total `US$ 0.00220234` e segmentos em 100% dos fixtures;
- `gpt-4o-mini-transcribe`: WER médio `0.3283`, recall crítico `0.6167`, latência média `616.6667 ms`, custo estimado total `US$ 0.00107125` e ausência de segmentos;
- retries e fallback permaneceram em zero.

Nesta amostra sintética, `whisper-1` teve pequena vantagem de WER e recall e preservou segmentos; `gpt-4o-mini-transcribe` foi mais rápido e mais barato. A issue #924 mantém `whisper-1` como default compatível. Qualquer promoção de modelo pertence ao rollout da #927.

## Decisão

A conclusão deve recomendar manter o baseline ou avaliar outro modelo na #927. O resultado desta pasta não promove modelo, não habilita fallback e não autoriza segundo provider por si só.
