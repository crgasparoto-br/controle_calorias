# Capacidade `TRANSCRIPTION`

## Contrato de produção

Toda transcrição de áudio do web app e do WhatsApp entra por `transcribeAudio` e é executada como a capacidade `TRANSCRIPTION`. O resolvedor escolhe provider, modelo, timeout, número máximo de tentativas e fallback antes da criação do adapter. O default compatível permanece `openai` + `whisper-1`.

A resposta de domínio contém texto útil após `trim`, provider e modelo efetivamente usados e metadados normalizados de execução. `language`, `duration`, `segments` e `usage` são opcionais. O campo SDK `raw` não atravessa a fronteira de domínio.

`whisper-1` usa `verbose_json`, preservando segmentos quando fornecidos. `gpt-4o-mini-transcribe` usa `json`, conforme o contrato da Audio API, e o sistema não fabrica segmentos vazios. Consumidores devem depender somente de `text` para continuar o fluxo.

## Validação antes do provider

Antes de qualquer chamada ao provider, a fronteira valida:

- base64 canônico ou download concluído;
- MIME permitido;
- payload não vazio;
- limite máximo de 16 MiB;
- provider/modelo/operação suportados e configuração executável.

Erros públicos e diagnósticos são sanitizados. Áudio, transcrição, prompt, base64, URL de mídia, chave e payload do SDK não podem aparecer em logs, métricas ou mensagens de erro.

## Retry e fallback

- `AI_TRANSCRIPTION_MAX_ATTEMPTS` controla tentativas primárias sequenciais;
- fallback permanece desabilitado por padrão;
- quando habilitado, ocorre somente após esgotar falhas operacionais do primário;
- falhas de autenticação, modelo, incompatibilidade ou configuração não acionam fallback;
- existe no máximo uma chamada de fallback, sem paralelismo ou cadeia;
- fallback cross-provider exige opt-in explícito e continua bloqueado em produção até a issue #927.

## WhatsApp e idempotência

A mudança não altera a correlação ou o ciclo de vida da mensagem recebida. A deduplicação do webhook acontece antes da preparação de mídia; portanto, callback duplicado não baixa, não transcreve e não registra novamente a mesma mensagem. Falha de storage ainda permite processamento inline, preservando a identidade da mensagem original.

## Benchmark reproduzível

Os fixtures em `docs/benchmarks/transcription/fixtures` são vozes sintéticas PT-BR, sem dados pessoais. Execute:

```bash
pnpm benchmark:transcription -- /tmp/transcription-benchmark.json
```

O harness usa o caminho produtivo, uma tentativa, sem fallback, e compara `whisper-1` com `gpt-4o-mini-transcribe` por latência, WER, recall de termos críticos, presença de segmentos e custo estimado. Resultados devem ser registrados fora do repositório quando contiverem transcrições; somente agregados revisados e sem conteúdo sensível podem ser versionados.
