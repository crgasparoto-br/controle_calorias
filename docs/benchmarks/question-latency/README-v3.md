# Benchmark de latência da capacidade QUESTION

Este diretório é a fonte canônica da coorte sintética e das evidências de latência para perguntas textuais do WhatsApp atendidas pela capacidade `QUESTION`.

## Escopo

O benchmark inclui somente perguntas de texto iniciadas por `/`. Imagem, áudio, mutações, confirmações pendentes e outras capacidades de IA ficam fora da coorte. O manifesto em `fixtures/manifest.json` é `syntheticOnly` e não contém PII.

A comparação hermética v3 executa o **mesmo pipeline produtivo fim a fim** em dois worktrees Git separados. Em cada SHA a observação percorre, nesta ordem:

1. início da requisição de pergunta e resolução sintética do usuário;
2. `messageLifecycle.beginInboundMessage`, incluindo persistência do inbound;
3. `executeWhatsappAiQuestionIntent`, com histórico, contexto e a capacidade central `QUESTION`;
4. `sendWhatsAppLogicalDomainReply`, incluindo entrega e persistência da resposta outbound;
5. `messageLifecycle.markMessageProcessed`, incluindo a persistência terminal somente quando a resposta funcional foi efetivamente entregue.

O cronômetro externo do harness engloba a mesma fronteira. No candidato, o evento `whatsapp.ai_question.latency` também precisa declarar `boundary=inbound_persistence_to_processed_reply`, possuir `persist_ms` mensurado e coincidir com o cronômetro fim a fim dentro da tolerância do scheduler. O benchmark falha se a telemetria voltar a terminar no sub-entrypoint do assistente.

A partir da issue #1061, o webhook produtivo pode emitir uma confirmação auxiliar de recebimento antes da resposta final. Essa confirmação não é TTFT do provider e não altera a definição de `total_ms`: a fronteira terminal continua sendo a resposta final processada. A responsividade percebida do canal passa a ser observada separadamente por `time_to_ack_ms` e `ack_delivery_ok`. O ACK deve ser iniciado antes do trabalho caro de contexto/LLM, em paralelo com esse trabalho, e a resposta final só pode ser liberada depois de concluída a tentativa do ACK, preservando a ordem visual sem serializar a IA.

A mesma issue também torna a entrega final recuperável. Uma falha transitória de rede/provider pode gerar no máximo uma recuperação imediata dentro da mesma requisição, com identidade física de dispatch distinta da tentativa original. Se nenhuma tentativa final for entregue, o inbound não recebe `processedAt`: o processing claim é liberado e a borda HTTP devolve 5xx para permitir que a Meta reentregue o mesmo webhook. A reentrega usa o mesmo entrypoint público e o mesmo `messageId`; ACK e resposta funcional já efetivamente entregues continuam protegidos por idempotência.

Para tornar a comparação reproduzível e sem credenciais, somente fronteiras externas são substituídas por doubles determinísticos: repositório/persistência, entrega do WhatsApp, histórico/consultas de contexto e provider. A execução continua atravessando os módulos produtivos de lifecycle, montagem de prompt, resolução/execução central de `QUESTION` e entrega lógica de cada SHA testado. Assim, a diferença mede o trabalho removido do caminho crítico sem depender da variância de rede da OpenAI/Gemini ou de banco remoto.

## Métricas e integridade da coorte

Cada lado executa pelo menos 30 observações da mesma coorte. Os workers baseline/candidato são iniciados em par no mesmo host, e cada lado executa suas observações sequencialmente, com o mesmo perfil e os mesmos atrasos sintéticos. O relatório registra por observação somente dados sanitizados: ID da fixture, duração total, outcome, código de erro sanitizado quando houver, quantidade de chamadas ao provider/entrega, contagens de carregamentos de contexto e contagens de operações de persistência. Pergunta e resposta brutas não são versionadas no resultado.

`errors` e `timeouts` são derivados das observações reais. Percentis usam apenas observações bem-sucedidas, mas o relatório preserva a contagem total, sucessos, erros e timeouts dos dois lados para que falhas não melhorem percentis silenciosamente.

O gate exige:

- pelo menos 30 execuções bem-sucedidas por lado;
- melhora de pelo menos 20% em p90 ou p95 de `totalMs`;
- nenhuma regressão superior a 5% em p50, p90 ou p95;
- nenhum aumento de erros ou timeouts;
- exatamente uma chamada ao provider de `QUESTION` e uma resposta final lógica por pergunta bem-sucedida; no fluxo produtivo com #1061 é permitida no máximo uma confirmação auxiliar idempotente e uma tentativa física adicional de entrega final quando a primeira falha de modo transitório;
- `web_search` disponível em toda pergunta bem-sucedida;
- as mesmas operações de lifecycle/persistência da resposta final em baseline e candidato;
- identidades Git baseline/candidato distintas e verificadas pelos worktrees;
- no candidato, telemetria final com persistência mensurada e fronteira fim a fim coerente com o cronômetro do harness;
- `db_ms` cobre a leitura persistida de histórico e todos os agregados de insights realmente selecionados pelo escopo, inclusive quando executados em ramos paralelos;
- o caminho de histórico de `QUESTION` não carrega snapshot de refeições, memória contextual nem comparação shadow quando esses dados não são consumidos pelo prompt.

Como o contrato atual de `QUESTION` no WhatsApp é não streaming, TTFT permanece explicitamente não mensurável; ele não é inferido a partir do tempo total nem do ACK. `time_to_ack_ms` mede somente o tempo até a conclusão da tentativa da confirmação do canal.

## Execução

```bash
pnpm benchmark:question-latency -- \
  --base-sha <sha-develop> \
  --candidate-sha <sha-candidato> \
  --out docs/benchmarks/question-latency/results/<data>-<sha>-e2e.json
```

Para validar apenas a lógica do gate, inclusive a detecção de aumento de erro/timeout e a rejeição de identidades iguais:

```bash
pnpm benchmark:question-latency:self-test
```

O driver exige SHAs explícitos, materializa ambos com `git worktree`, confirma `rev-parse HEAD` em cada lado e registra hashes do manifesto, driver, loader e worker no resultado.

## Observabilidade em produção

O entrypoint persistente externo abre o escopo de `QUESTION` antes de gate comercial, resolução do usuário, claim e roteamento textual. O mesmo `AsyncLocalStorage` acompanha a pergunta `/` até a resposta final ou até uma falha terminal retryável. O assistente acrescenta ao trace `db_ms`, `context_ms`, `llm_ms`, escopo de contexto, provider/modelo, tentativas, retry/fallback e pesquisa web. `db_ms` é cumulativo para as operações de leitura da montagem de contexto: inclui a consulta persistida do histórico recente e cada loader de insights selecionado (`today`, `currentWeek`, `last30Days`), mesmo quando os ramos executam em paralelo; `context_ms` continua sendo o wall-clock sobreposto da montagem completa. O lifecycle acumula o tempo real gasto nas persistências de inbound, outbound/link e `markProcessed`; a entrega final registra sucesso ou falha. O evento só é finalizado após `markProcessed` quando há resposta entregue, ou como erro explícito quando a requisição termina sem resposta funcional.

Para perguntas `/` aceitas no webhook real, a issue #1061 adiciona ao evento `whatsapp.ai_question.latency`:

- `time_to_ack_ms`: tempo desde o início do trace fim a fim até a conclusão da tentativa de confirmação de recebimento;
- `ack_delivery_ok`: indica se essa confirmação auxiliar foi efetivamente entregue;
- `delivery_attempts`: quantidade de tentativas lógicas da entrega final feitas nesta requisição;
- `delivery_retry_occurred`: indica se houve a recuperação imediata da entrega final;
- `delivery_retry_release_issued`: indica que nenhuma entrega final foi concluída e o claim foi liberado para reentrega.

Falha do ACK é best-effort: ela deve permanecer observável, mas não transforma por si só uma resposta final bem-sucedida em erro e não impede a tentativa da resposta final. O ACK usa uma posição de envio idempotente própria derivada do `messageId`, separada da posição da resposta final, para evitar colisão ou duplicação em replay.

A resposta funcional segue semântica distinta: o transporte tenta a posição original; para falhas transitórias, pode executar uma recuperação imediata com identidade de dispatch própria. Se a entrega final continuar falhando, não há gravação de resposta outbound nem `processedAt`, o claim persistente volta a ficar imediatamente reclaimable e o endpoint HTTP responde 5xx. Em uma reentrega, uma resposta outbound já gravada para o inbound é tratada como conclusão idempotente para não reenviar conteúdo já entregue após crash entre persistência e finalização do lifecycle.

Para o consumidor `slash_assistant`, o builder de histórico é chamado em modo mínimo: sem `currentDomainSnapshot`, sem memória contextual, sem resumo e sem shadow intent comparison. Isso preserva a seleção canônica de `recentTurns` e elimina I/O/cálculo que o prompt de `QUESTION` não consome.

O evento `whatsapp.ai_question.latency` não contém pergunta, resposta, telefone, credencial ou PII. `persist_ms` é numérico quando o fluxo produtivo persistiu a mensagem; `time_to_first_token_ms` permanece `null` enquanto o contrato do canal/provedor não expuser TTFT confiável.

O `nutrition.admin.overview` agrega as amostras sanitizadas recentes e expõe `questionLatency` com `sampleSize`, sucessos, erros, timeouts e p50/p90/p95 de `total_ms` para o fluxo `whatsapp_question`. Erros e timeouts permanecem contadores separados.

## Riscos e confiabilidade

A otimização é fail-safe: `full` continua sendo o fallback para follow-ups, frases curtas, pedidos pessoais implícitos e perguntas ambíguas. A redução para `none` exige que a pergunta seja claramente genérica; linguagem de aconselhamento em primeira pessoa, como `devo`, `deveria` e `para mim`, preserva contexto completo quando não há uma janela temporal menor explícita.

A confirmação da #1061 também é fail-safe: `/` vazio e capacidade `QUESTION` indisponível não emitem uma mensagem enganosa de processamento; nesses casos a resposta imediata existente permanece suficiente. Quando há ACK, a chamada de confirmação e o processamento de IA são concorrentes, e apenas a entrega final aguarda a tentativa do ACK quando necessário para preservar a ordem das mensagens.

A recuperação de outbound não converte falhas determinísticas de validação/configuração em loop imediato de chamadas à Meta. Essas falhas permanecem observáveis; como não houve resposta funcional entregue, o inbound também não é marcado como concluído. Falhas transitórias de rede, `429`, `408`, `409`, `425` e respostas `5xx` da Meta são elegíveis para uma recuperação imediata antes de devolver 5xx ao webhook.

O executor, timeout, retry/fallback, provider/model e a ferramenta `web_search` continuam pertencendo à fundação multi-provider descrita em `ARCHITECTURE.md` e `docs/RELIABILITY.md`. O harness falha se uma pergunta bem-sucedida multiplicar chamadas ao provider de IA, remover `web_search`, pular entrega/persistência da resposta final ou encerrar a métrica antes da fronteira terminal.