# Benchmark de latência da capacidade QUESTION

Este diretório é a fonte canônica da coorte sintética e das evidências de latência para perguntas textuais do WhatsApp atendidas pela capacidade `QUESTION`.

## Escopo

O benchmark inclui somente perguntas de texto iniciadas por `/`. Imagem, áudio, mutações, confirmações pendentes e outras capacidades de IA ficam fora da coorte. O manifesto em `fixtures/manifest.json` é `syntheticOnly` e não contém PII.

A comparação hermética v3 executa o **mesmo pipeline produtivo fim a fim** em dois worktrees Git separados. Em cada SHA a observação percorre, nesta ordem:

1. início da requisição de pergunta e resolução sintética do usuário;
2. `messageLifecycle.beginInboundMessage`, incluindo persistência do inbound;
3. `executeWhatsappAiQuestionIntent`, com histórico, contexto e a capacidade central `QUESTION`;
4. `sendWhatsAppLogicalDomainReply`, incluindo entrega e persistência da resposta outbound;
5. `messageLifecycle.markMessageProcessed`, incluindo a persistência terminal.

O cronômetro externo do harness engloba a mesma fronteira. No candidato, o evento `whatsapp.ai_question.latency` também precisa declarar `boundary=inbound_persistence_to_processed_reply`, possuir `persist_ms` mensurado e coincidir com o cronômetro fim a fim dentro da tolerância do scheduler. O benchmark falha se a telemetria voltar a terminar no sub-entrypoint do assistente.

Para tornar a comparação reproduzível e sem credenciais, somente fronteiras externas são substituídas por doubles determinísticos: repositório/persistência, entrega do WhatsApp, histórico/consultas de contexto e provider. A execução continua atravessando os módulos produtivos de lifecycle, montagem de prompt, resolução/execução central de `QUESTION` e entrega lógica de cada SHA testado. Assim, a diferença mede o trabalho removido do caminho crítico sem depender da variância de rede da OpenAI/Gemini ou de banco remoto.

## Métricas e integridade da coorte

Cada lado executa pelo menos 30 observações da mesma coorte. Os workers baseline/candidato são iniciados em par no mesmo host, e cada lado executa suas observações sequencialmente, com o mesmo perfil e os mesmos atrasos sintéticos. O relatório registra por observação somente dados sanitizados: ID da fixture, duração total, outcome, código de erro sanitizado quando houver, quantidade de chamadas ao provider/entrega, contagens de carregamentos de contexto e contagens de operações de persistência. Pergunta e resposta brutas não são versionadas no resultado.

`errors` e `timeouts` são derivados das observações reais. Percentis usam apenas observações bem-sucedidas, mas o relatório preserva a contagem total, sucessos, erros e timeouts dos dois lados para que falhas não melhorem percentis silenciosamente.

O gate exige:

- pelo menos 30 execuções bem-sucedidas por lado;
- melhora de pelo menos 20% em p90 ou p95 de `totalMs`;
- nenhuma regressão superior a 5% em p50, p90 ou p95;
- nenhum aumento de erros ou timeouts;
- exatamente uma chamada ao provider e uma entrega por pergunta bem-sucedida;
- `web_search` disponível em toda pergunta bem-sucedida;
- as mesmas operações de lifecycle/persistência em baseline e candidato;
- identidades Git baseline/candidato distintas e verificadas pelos worktrees;
- no candidato, telemetria final com persistência mensurada e fronteira fim a fim coerente com o cronômetro do harness.

Como o contrato atual de `QUESTION` no WhatsApp é não streaming, TTFT permanece explicitamente não mensurável; ele não é inferido a partir do tempo total.

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

O webhook abre o trace de `QUESTION` antes da resolução do usuário e o mantém no mesmo `AsyncLocalStorage` até a persistência terminal. O assistente acrescenta ao trace `db_ms`, `context_ms`, `llm_ms`, escopo de contexto, provider/modelo, tentativas, retry/fallback e pesquisa web. O lifecycle acumula o tempo real gasto nas persistências de inbound, outbound/link e `markProcessed`; a entrega registra sucesso ou falha. O evento só é finalizado após `markProcessed`, ou como erro explícito se a requisição terminar incompleta.

O evento `whatsapp.ai_question.latency` não contém pergunta, resposta, telefone, credencial ou PII. `persist_ms` é numérico quando o fluxo produtivo persistiu a mensagem; `time_to_first_token_ms` permanece `null` enquanto o contrato do canal/provedor não expuser TTFT confiável.

O `nutrition.admin.overview` agrega as amostras sanitizadas recentes e expõe `questionLatency` com `sampleSize`, sucessos, erros, timeouts e p50/p90/p95 de `total_ms` para o fluxo `whatsapp_question`. Erros e timeouts permanecem contadores separados.

## Riscos e confiabilidade

A otimização é fail-safe: `full` continua sendo o fallback para follow-ups, frases curtas, pedidos pessoais implícitos e perguntas ambíguas. A redução para `none` exige que a pergunta seja claramente genérica; linguagem de aconselhamento em primeira pessoa, como `devo`, `deveria` e `para mim`, preserva contexto completo quando não há uma janela temporal menor explícita.

O executor, timeout, retry/fallback, provider/model e a ferramenta `web_search` continuam pertencendo à fundação multi-provider descrita em `ARCHITECTURE.md` e `docs/RELIABILITY.md`. O harness falha se uma pergunta bem-sucedida multiplicar chamadas ao provider, remover `web_search`, pular entrega/persistência ou encerrar a métrica antes da fronteira terminal.
