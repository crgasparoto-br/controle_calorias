# Benchmark de transcrição

Este diretório contém somente fixtures sintéticos e um manifesto versionado. Nenhum áudio de usuário, transcrição real, número de telefone, URL de mídia ou prompt de produção pode ser incluído.

## Cenários

A matriz cobre alimentos comuns, marca, peso, unidades de volume, ambiguidade, produto comercial e ruído branco controlado. Cada fixture declara a frase de referência e os termos críticos usados no cálculo de recall.

O harness falha antes de qualquer chamada externa quando o manifesto não é `synthetic-only`, está vazio, possui IDs repetidos, referência/arquivo ausente, lista de termos críticos vazia ou duração inválida. A métrica de texto útil usa a mesma regra do runtime: pontuação isolada e marcadores exatos de silêncio ou áudio inaudível não contam como sucesso.

## Execução e decisão

A execução real deve ocorrer somente em ambiente local autorizado. O workflow de pull request não executa este benchmark nem disponibiliza `OPENAI_API_KEY` ao código da PR.

Use:

```bash
pnpm benchmark:transcription -- docs/benchmarks/transcription/results/<data>-<sha>.json
```

Compare:

- WER e recall de termos críticos;
- latência por fixture e modelo;
- custo estimado pelo catálogo de preços versionado no harness;
- disponibilidade real de segmentos;
- erros, tentativas e uso de fallback.

Taxas com denominador zero são registradas como `0`, e médias sem observações são `null`; o JSON nunca contém `NaN` ou `Infinity`.

A troca do modelo padrão não é automática. O resultado subsidia decisão posterior e deve considerar qualidade, custo, latência, privacidade e rollback.

## Modelos e snapshots

Por padrão, o harness usa os aliases `whisper-1` e `gpt-4o-mini-transcribe`. Para registrar snapshots exatos sem alterar o código, defina `TRANSCRIPTION_BENCHMARK_WHISPER_MODEL` e `TRANSCRIPTION_BENCHMARK_GPT4O_MINI_MODEL`. O JSON registra os IDs efetivos, ambiente, política, data e catálogo de preços.

## Privacidade e registro

O arquivo de resultado deliberadamente não contém o texto transcrito. Ele registra apenas métricas e códigos sanitizados; assim pode ser compartilhado com a #927 sem transportar conteúdo de áudio.

O nome, validação, resumo e checklist para registrar uma execução estão em `results/README.md`. Não versionar `OPENAI_API_KEY`, áudio, prompt, URL de mídia ou saída textual do provider.
