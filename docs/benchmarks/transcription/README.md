# Benchmark de transcrição

Este diretório contém somente fixtures sintéticos e um manifesto versionado. Nenhum áudio de usuário, transcrição real, número de telefone, URL de mídia ou prompt de produção pode ser incluído.

## Cenários

A matriz cobre alimentos comuns, marca, peso, unidades de volume, ambiguidade, produto comercial e ruído branco controlado. Cada fixture declara a frase de referência e os termos críticos usados no cálculo de recall.

## Execução e decisão

Use `pnpm benchmark:transcription -- <arquivo.json>`. Compare:

- WER e recall de termos críticos;
- latência por fixture e modelo;
- custo estimado pelo catálogo de preços versionado no harness;
- disponibilidade real de segmentos;
- erros, tentativas e uso de fallback.

A troca do modelo padrão não é automática. O resultado subsidia decisão posterior e deve considerar qualidade, custo, latência, privacidade e rollback.

## Modelos e snapshots

Por padrão, o harness usa os aliases `whisper-1` e `gpt-4o-mini-transcribe`. Para registrar snapshots exatos sem alterar o código, defina `TRANSCRIPTION_BENCHMARK_WHISPER_MODEL` e `TRANSCRIPTION_BENCHMARK_GPT4O_MINI_MODEL`. O JSON registra os IDs efetivos, ambiente, política, data e catálogo de preços.

O arquivo de resultado deliberadamente não contém o texto transcrito. Ele registra apenas métricas e códigos sanitizados; assim pode ser compartilhado com a #927 sem transportar conteúdo de áudio.
