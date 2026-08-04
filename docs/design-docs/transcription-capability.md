# Capacidade `TRANSCRIPTION`

## Contrato de produção

Toda transcrição de áudio do web app e do WhatsApp entra por `transcribeAudio` e é executada como a capacidade `TRANSCRIPTION`. O resolvedor escolhe provider, modelo, timeout, número máximo de tentativas e fallback antes da criação do adapter. O default compatível permanece `openai` + `whisper-1` até uma decisão explícita na #927.

A resposta de domínio contém texto útil após `trim`, provider e modelo efetivamente usados e metadados normalizados de execução. `language`, `duration`, `segments` e `usage` são opcionais. O campo SDK `raw` não atravessa a fronteira de domínio. Metadados ausentes não são preenchidos com valores artificiais.

`whisper-1` usa `verbose_json`, preservando segmentos quando fornecidos. `gpt-4o-mini-transcribe` usa `json`, conforme o contrato da Audio API, e o sistema não fabrica segmentos vazios. Consumidores devem depender somente de `text` para continuar o fluxo.

## Validação antes do provider

Antes de qualquer chamada ao provider, a fronteira valida:

- data URL bem formada com marcador `;base64`, quando esse formato é usado;
- base64 canônico ou download concluído;
- MIME permitido;
- payload não vazio;
- limite máximo de 16 MiB;
- provider/modelo/operação suportados e configuração executável.

Data URL malformada retorna `INVALID_FORMAT`; somente uma data URL base64 válida com payload vazio retorna `EMPTY_FILE`. Em ambos os casos, nenhum adapter é criado e nenhuma chamada externa ocorre.

Erros públicos e diagnósticos são sanitizados. Áudio, transcrição, prompt, base64, URL de mídia, chave e payload do SDK não podem aparecer em logs, métricas ou mensagens de erro.

## Retry e fallback

- `AI_TRANSCRIPTION_MAX_ATTEMPTS` controla tentativas primárias sequenciais;
- fallback permanece desabilitado por padrão;
- quando habilitado, ocorre somente após esgotar falhas operacionais do primário;
- falhas de autenticação, modelo, incompatibilidade ou configuração não acionam fallback;
- existe no máximo uma chamada de fallback, sem paralelismo ou cadeia;
- fallback cross-provider exige opt-in explícito e continua bloqueado em produção até a issue #927.

## WhatsApp e idempotência

A mudança não altera a correlação ou o ciclo de vida da mensagem recebida. A deduplicação do webhook acontece antes da preparação de mídia. O teste de regressão executa duas vezes o mesmo callback e comprova que a segunda entrega não baixa mídia, não persiste arquivo, não transcreve, não cria rascunho e não confirma refeição novamente.

Falha de storage ainda permite processamento inline, preservando a identidade da mensagem original. Falha ou texto vazio de transcrição bloqueia uma mensagem exclusivamente de áudio e não cria registro vazio. Quando existe texto ou imagem aproveitável, a falha de áudio pode degradar de forma controlada sem duplicar mutações.

## Benchmark reproduzível

Os fixtures em `docs/benchmarks/transcription/fixtures` são vozes sintéticas PT-BR, sem dados pessoais. Execute:

```bash
pnpm benchmark:transcription -- docs/benchmarks/transcription/results/<data>-<sha>.json
```

O harness usa o caminho produtivo, uma tentativa, sem fallback, e compara `whisper-1` com `gpt-4o-mini-transcribe` por latência, WER, recall de termos críticos, presença de segmentos e custo estimado. O manifesto é recusado quando está vazio, não é `synthetic-only`, possui IDs repetidos, referência/arquivo ausente, termos críticos vazios ou duração inválida.

O JSON não persiste áudio, prompt nem texto retornado. Ele registra somente métricas, códigos sanitizados, ambiente, política, catálogo de preços, modelos efetivos, limitações e metadados do manifesto. O procedimento de registro está em `docs/benchmarks/transcription/results/README.md`.

## Documentação canônica e decisão

A configuração continua documentada em `.env.example`; a arquitetura e as regras transversais permanecem em `README.md`, `ARCHITECTURE.md`, `docs/RELIABILITY.md`, `docs/SECURITY.md` e `docs/PRIVACY_LGPD.md`. Este documento é a especificação detalhada da capacidade e da ingestão de áudio para consumidores web/WhatsApp.

A comparação nesta issue apenas produz evidência. Alterar o modelo padrão, habilitar fallback em produção ou enviar áudio a um segundo provider pertence ao rollout controlado da #927.
