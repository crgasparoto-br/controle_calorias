# Benchmark de latência da capacidade QUESTION

Este diretório é a fonte canônica da coorte sintética e das evidências de latência para perguntas textuais do WhatsApp atendidas pela capacidade `QUESTION`.

## Escopo

O benchmark inclui somente perguntas de texto iniciadas por `/`. Imagem, áudio, mutações, confirmações pendentes e outras capacidades de IA ficam fora da coorte. O manifesto em `fixtures/manifest.json` é `syntheticOnly` e não contém PII.

A comparação hermética executa a política de seleção de contexto usada pelo runtime candidato com o mesmo conjunto de fixtures e um provider double de atraso fixo. O lado `baseline` reproduz o comportamento anterior da rota: carregar simultaneamente contexto diário, semanal e de 30 dias para toda pergunta. O lado `candidate` usa a janela escolhida por `resolveQuestionContextScope`.

O double existe para tornar a comparação de orquestração reproduzível e sem credenciais. Ele não mede latência de rede de OpenAI/Gemini nem substitui smoke real de provider quando esse dado for necessário para rollout. Provider, modelo, política, delays e SHAs são gravados no resultado.

## Métricas

Cada lado executa pelo menos 30 observações bem-sucedidas e registra, por observação, `totalMs`, `dbMs`, `contextMs`, `llmMs`, `persistMs` e `timeToFirstTokenMs`. Como o contrato atual de `QUESTION` é não streaming, TTFT fica explicitamente como não mensurável em vez de ser inferido a partir da resposta completa.

O gate exige:

- melhora de pelo menos 20% em p90 ou p95 de `totalMs`;
- nenhuma regressão superior a 5% em p50, p90 ou p95;
- nenhuma elevação de erros/timeouts;
- pelo menos 30 execuções bem-sucedidas por lado.

## Execução

```bash
pnpm exec tsx scripts/issue-989-question-latency-benchmark.ts -- \
  --base-sha <sha-develop> \
  --candidate-sha <sha-candidato> \
  --out docs/benchmarks/question-latency/results/<data>-<sha>.json
```

O resultado não inclui perguntas, respostas, prompts, credenciais, telefone ou outro dado pessoal. Apenas IDs de fixtures, escopo selecionado, métricas e metadados sanitizados são versionáveis.

## Observabilidade em produção

A rota emite `whatsapp.ai_question.latency` com um `requestId` aleatório correlacionado à observabilidade do executor multi-provider. O evento registra métricas numéricas, escopo de contexto, provider/modelo efetivos, tentativas, retry/fallback e uso da pesquisa web. Pergunta e resposta não são incluídas. `persist_ms` e `time_to_first_token_ms` permanecem `null` quando as etapas não se aplicam ou não são observáveis no contrato atual.

## Riscos e confiabilidade

A otimização é fail-safe: `full` continua sendo o fallback para follow-ups, frases curtas e perguntas ambíguas. A seleção só reduz dados quando o período ou a natureza genérica da pergunta estão explícitos. O executor, timeout, retry/fallback, provider/model e a ferramenta `web_search` continuam pertencendo à fundação multi-provider descrita em `ARCHITECTURE.md` e `docs/RELIABILITY.md`.

O risco principal é classificar como genérica uma pergunta que na realidade depende do histórico pessoal. O controle negativo versionado mantém follow-ups ambíguos em `full`, e os testes de integração verificam que `none` remove apenas a base pessoal, sem remover histórico recente nem a disponibilidade de pesquisa web. Não há nova persistência nem novo envio de dados pessoais a outro provider.
