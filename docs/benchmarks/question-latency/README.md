# Benchmark de latência da capacidade QUESTION

Este diretório é a fonte canônica da coorte sintética e das evidências de latência para perguntas textuais do WhatsApp atendidas pela capacidade `QUESTION`.

## Escopo

O benchmark inclui somente perguntas de texto iniciadas por `/`. Imagem, áudio, mutações, confirmações pendentes e outras capacidades de IA ficam fora da coorte. O manifesto em `fixtures/manifest.json` é `syntheticOnly` e não contém PII.

A comparação hermética v2 executa o **mesmo entrypoint produtivo** em dois worktrees Git separados: `executeWhatsappAiQuestionIntent` do SHA baseline e o mesmo entrypoint do SHA candidato. O harness não reimplementa a seleção de contexto nem força `scope=full` no candidato para fingir um baseline. Cada lado usa o código realmente versionado no SHA informado.

Para tornar a comparação reproduzível e sem credenciais, somente as fronteiras externas são substituídas por doubles determinísticos: histórico/consultas de contexto têm atrasos fixos e o provider é substituído no `providerResolver`. A execução continua atravessando a resolução de `QUESTION`, `executeResolvedCapability`, `createDomainTextResponse`, montagem de prompt, histórico e carregamento de contexto do próprio SHA testado. Assim, o benchmark mede o caminho produtivo da aplicação sem medir latência variável de rede da OpenAI/Gemini.

## Métricas e integridade da coorte

Cada lado executa pelo menos 30 observações da mesma coorte. O relatório registra por observação somente dados sanitizados: ID da fixture, duração total, outcome, código de erro sanitizado quando houver, quantidade de chamadas ao provider, disponibilidade de `web_search` e contagens de carregamentos sintéticos de contexto.

`errors` e `timeouts` são derivados das observações reais. Não existem zeros ou `noErrorOrTimeoutIncrease=true` fixados no código do gate. Percentis usam apenas observações bem-sucedidas e o relatório preserva a contagem total, sucessos, erros e timeouts dos dois lados.

O gate exige:

- pelo menos 30 execuções bem-sucedidas por lado;
- melhora de pelo menos 20% em p90 ou p95 de `totalMs`;
- nenhuma regressão superior a 5% em p50, p90 ou p95;
- nenhum aumento de erros;
- nenhum aumento de timeouts;
- exatamente uma chamada ao provider por pergunta bem-sucedida;
- `web_search` disponível em toda pergunta bem-sucedida;
- identidades Git baseline/candidato distintas e verificadas pelos worktrees.

Como o contrato atual de `QUESTION` no WhatsApp é não streaming, TTFT permanece explicitamente não mensurável; ele não é inferido a partir do tempo total.

## Execução

```bash
pnpm benchmark:question-latency -- \
  --base-sha <sha-develop> \
  --candidate-sha <sha-candidato> \
  --out docs/benchmarks/question-latency/results/<data>-<sha>-productive.json
```

Para validar apenas a lógica do gate, inclusive a detecção de aumento de erro/timeout e a rejeição de identidades iguais:

```bash
pnpm benchmark:question-latency:self-test
```

O driver exige SHAs explícitos, materializa ambos com `git worktree`, confirma `rev-parse HEAD` em cada lado e registra hashes do manifesto, driver, loader e worker no resultado. O resultado não inclui perguntas, respostas, prompts, tokens reais, telefone, secrets ou outro dado pessoal.

## Observabilidade em produção

A rota emite `whatsapp.ai_question.latency` com um `requestId` aleatório correlacionado à observabilidade do executor multi-provider. O evento registra `total_ms`, `db_ms`, `context_ms`, `llm_ms`, `persist_ms`/TTFT quando aplicáveis, escopo de contexto, provider/modelo efetivos, tentativas, retry/fallback e uso da pesquisa web. Pergunta e resposta não são incluídas. `persist_ms` e `time_to_first_token_ms` permanecem `null` quando as etapas não se aplicam ou não são observáveis no contrato atual.

O `nutrition.admin.overview` agrega as amostras sanitizadas recentes já disponíveis no snapshot administrativo e expõe `questionLatency` com `sampleSize`, sucessos, erros, timeouts e p50/p90/p95 de `total_ms` para o fluxo `whatsapp_question`. Percentis consideram somente respostas bem-sucedidas; erros e timeouts permanecem contadores separados para não melhorar os percentis por exclusão silenciosa de falhas.

## Riscos e confiabilidade

A otimização é fail-safe: `full` continua sendo o fallback para follow-ups, frases curtas e perguntas ambíguas. A seleção só reduz dados quando o período ou a natureza genérica da pergunta estão explícitos. O executor, timeout, retry/fallback, provider/model e a ferramenta `web_search` continuam pertencendo à fundação multi-provider descrita em `ARCHITECTURE.md` e `docs/RELIABILITY.md`.

O harness também falha se uma pergunta bem-sucedida fizer mais de uma chamada ao provider ou deixar de oferecer `web_search`, evitando que o ganho seja produzido por redução funcional silenciosa. Evidência real de provider continua complementar para rollout e não é exigida em CI com secrets permanentes.
