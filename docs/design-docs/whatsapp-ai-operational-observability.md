# Design técnico: observabilidade operacional da IA no WhatsApp

## Responsabilidade

A subissue #440 define uma camada de observabilidade técnica para investigar custo, latência, falhas, timeout, retry, fallback, uso de modelo e ferramentas no pipeline de IA do WhatsApp.

O contrato fica em `server/modules/whatsapp/operationalObservability.ts` e é alimentado automaticamente por `recordWhatsappIntentAuditLog`.

## Trace por mensagem

Cada trace usa `messageHash` e, quando disponível, `messageIdHash`. O texto cru da mensagem não é armazenado.

O trace contém:

- `traceId`;
- usuário e canal;
- intenção interpretada;
- versões de contexto, schema, prompt e regra;
- estratégia (`deterministic`, `llm_structured` ou `safe_fallback`);
- modelo usado;
- spans por etapa do pipeline;
- totais de latência e custo estimado;
- flags de erro, timeout e fallback.

## Etapas observáveis

O schema de spans cobre:

- `normalization`;
- `router`;
- `llm`;
- `validation`;
- `nutrition_source`;
- `memory`;
- `tools`;
- `persistence`.

A integração atual registra automaticamente as etapas já conhecidas pelo log de intenção: roteador, LLM, validação, ferramentas e persistência quando a ferramenta é persistente. Normalização, memória e fonte nutricional podem ser adicionadas diretamente pelos adaptadores dessas etapas conforme forem integrados ao roteador completo.

## Métricas

`summarizeWhatsappPipelineObservability` permite acompanhar:

- total de mensagens;
- total de spans;
- latência média;
- custo estimado;
- quantidade de erro, timeout, fallback e retry;
- agrupamento por intenção;
- agrupamento por modelo;
- agrupamento por etapa.

## Investigação

`listWhatsappPipelineTraces` permite filtrar por:

- período;
- canal;
- intenção;
- etapa;
- modelo;
- versão;
- erro;
- timeout;
- fallback;
- `traceId`.

## Privacidade e retenção

O MVP evita armazenar conteúdo sensível nos traces. Mensagens e IDs externos são armazenados apenas como hash SHA-256.

A retenção padrão em memória é de 30 dias por entrada, com limite máximo de 1.000 traces. A persistência definitiva, anonimização formal e políticas de expurgo devem ser conectadas ao histórico estruturado da #410.

## Limites

Esta entrega cria o contrato operacional, agregações e integração com a auditoria de intenção. Ela não cria painel visual completo e não substitui métricas de qualidade, aprendizado ou drift.

## Casos de teste

`server/modules/whatsapp/operationalObservability.test.ts` cobre:

- trace por etapa sem texto cru;
- filtros por período, versão, intenção, canal e etapa;
- agregação de latência, custo, modelo e intenção;
- erro de API, timeout, retry, fallback e ferramenta indisponível;
- geração automática de trace a partir da auditoria de intenção.
