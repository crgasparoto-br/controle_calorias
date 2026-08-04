# Benchmark de transcrição

Este diretório contém somente fixtures sintéticos, o manifesto versionado e resultados sanitizados. Nenhum áudio de usuário, transcrição real, número de telefone, URL de mídia, prompt de produção ou credencial pode ser incluído.

## Cenários

A matriz cobre alimentos comuns, marca, peso, unidades de volume, ambiguidade, produto comercial e ruído branco controlado. Cada fixture declara a frase de referência e os termos críticos usados no cálculo de recall.

O harness falha antes de qualquer chamada externa quando o manifesto não é `synthetic-only`, está vazio, possui IDs repetidos, referência/arquivo ausente, lista de termos críticos vazia ou duração inválida. A métrica de texto útil usa a mesma regra do runtime: pontuação isolada e frases compostas somente por marcadores ou mensagens auxiliares de silêncio/áudio inaudível não contam como sucesso; conteúdo misto com fala acionável continua válido.

## Execução segura

Use o harness somente em um contexto confiável no qual o código executado já tenha sido revisado. Um workflow de `pull_request` não deve executar este benchmark com secrets permanentes do repositório, porque o código do head da PR poderia ler ou exfiltrar a credencial.

Resultado produzido fora dessa fronteira deve permanecer apenas como histórico não canônico. Integridade por hash não corrige proveniência insegura. O manifesto mantém `canonicalRun: null` até existir nova coleta real em contexto confiável.

A execução pode ocorrer localmente ou em infraestrutura protegida que execute uma revisão imutável do código. Disponibilize `OPENAI_API_KEY` apenas durante o processo da chamada externa, sem gravá-la em `.env`, shell history, logs, comentários, resultados ou artefatos.

```bash
OPENAI_API_KEY="..." \
  pnpm benchmark:transcription -- \
  docs/benchmarks/transcription/results/<data>-<sha>.json
```

O harness sempre resolve `git rev-parse HEAD` e compara qualquer SHA informado por ambiente. `GITHUB_SHA` de merge preview, variável antiga ou SHA de outro commit causa falha antes da primeira chamada ao provider.

A PR deve provar o comportamento por testes herméticos, doubles e controles de contagem de chamadas. Evidência real de provider é complementar e somente pode ser reutilizada quando estiver vinculada ao SHA testado e quando nenhum arquivo de runtime, harness ou fixture tiver mudado depois da coleta.

## Métricas e decisão

Compare:

- WER e recall de termos críticos;
- latência por fixture e modelo;
- custo estimado pelo catálogo de preços versionado no harness;
- disponibilidade real de segmentos;
- erros, tentativas e uso de fallback.

Taxas com denominador zero são registradas como `0`, e médias sem observações são `null`; o JSON nunca contém `NaN` ou `Infinity`.

A troca do modelo padrão não é automática. O resultado subsidia decisão posterior e deve considerar qualidade, custo, latência, privacidade, variabilidade entre execuções e rollback.

## Modelos e snapshots

Por padrão, o harness usa os aliases `whisper-1` e `gpt-4o-mini-transcribe`. Para registrar snapshots exatos sem alterar o código, defina `TRANSCRIPTION_BENCHMARK_WHISPER_MODEL` e `TRANSCRIPTION_BENCHMARK_GPT4O_MINI_MODEL`. O JSON registra os IDs efetivos, ambiente, política, data, catálogo de preços e o `testedSha` obtido do `HEAD` executado.

## Privacidade e registro

O arquivo de resultado deliberadamente não contém o texto transcrito. Ele registra apenas métricas e códigos sanitizados; assim pode ser compartilhado com a #927 sem transportar conteúdo de áudio.

O nome, validação, resumo, proveniência e checklist para registrar uma execução estão em `results/README.md` e `results/evidence-manifest.json`. Não versionar `OPENAI_API_KEY`, áudio, prompt, URL de mídia ou saída textual do provider.
