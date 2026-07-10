# Diagnóstico de contexto conversacional do WhatsApp — #767

## Escopo coberto

Este runbook cobre o diagnóstico de sintomas relacionados ao histórico conversacional persistente do WhatsApp (issues #763–#767): perda de contexto, respostas duplicadas, pendências não resolvidas e falhas de concorrência.

Sintomas típicos:

- "A IA respondeu sem lembrar da conversa" (parecia ter esquecido uma referência recente).
- "A IA duplicou uma refeição/água/peso" após reenvio de mensagem.
- "A IA pediu esclarecimento desnecessário" para algo já resolvido antes.
- "Uma confirmação/exclusão foi aplicada duas vezes" ou "nunca foi aplicada".

## Causa provável

Toda investigação começa consultando `inferenceLogs` filtrando por `userId` e pelos `eventType`s abaixo (via `logInferenceEvent`/`getAdminSnapshot`, nunca lendo o payload bruto do webhook). O campo `detail` nunca contém texto de mensagem — apenas contagens, enums e ids já tipados em outras colunas.

| `eventType` | Causa provável | Próximo passo |
|---|---|---|
| `whatsapp.history.context_missing` | Usuário sem histórico persistido ainda, ou `getDb()` retornando `null` (banco indisponível) | Verificar `logPersistenceWarning` recente para o mesmo período; se `getDb()` estiver falhando, é indisponibilidade de banco, não perda de dado |
| `whatsapp.history.context_expired` / `conversationActive:false` no detail de `context_found` | Última mensagem mais antiga que `WHATSAPP_CONVERSATION_ACTIVE_TTL_MS` — referências vagas ("isso", "o mesmo") não devem ser resolvidas silenciosamente | Comportamento esperado; confirmar que a resposta pediu esclarecimento em vez de inferir o alvo |
| `whatsapp.history.context_truncated` | Conversa excedeu o orçamento do consumidor (`CONTEXT_BUDGETS`) e parte foi resumida/omitida | Conferir se `whatsapp.history.summary_used` também disparou para a mesma janela — se não, o resumo falhou e a IA respondeu só com a janela recente |
| `whatsapp.history.summary_failed` / `whatsapp.conversation_summary_failed` / `whatsapp.conversation_summary_empty` | Falha ao chamar o LLM para gerar o resumo, ou resposta vazia | Não bloqueia o atendimento (fallback para janela recente + banco) — mas explica por que referências além da janela recente não foram resolvidas |
| `whatsapp.idempotency.duplicate_detected` | Reentrega do mesmo `message.id` da Meta — a ação/domínio já havia sido processado e não foi repetido | Comportamento esperado; se o usuário reporta duplicação mesmo assim, verificar se a duplicação ocorreu **antes** desta issue ser aplicada (migração de dados antiga) |
| Ausência de `whatsapp.idempotency.duplicate_detected` mas relato de duplicação | `wasMessageAlreadyProcessed` só está wired em `whatsappIntentWebhook.ts` (fluxo de texto) — mensagens de imagem/áudio reentregues passam pelo dedup em memória de `messageDeduplicationCache.ts`, que não sobrevive a reinício de processo | Verificar se houve deploy/restart entre o envio original e a reentrega |
| `whatsapp.concurrency.conflict_detected` / corridas em `createOrGetActiveConversation` ou `insertConversationSummary` | Duas mensagens do mesmo usuário processadas por requisições concorrentes (ex.: Meta reentregando enquanto a primeira tentativa ainda processava) | Não é um erro — o CAS (compare-and-swap) garante que só uma escrita venceu; confirmar que o estado final é consistente via `findRecentMessages` |
| Pendência aplicada duas vezes | Não deveria ocorrer — `claimPendingOperation` usa `UPDATE ... WHERE state='active' AND version=?` | Bug real se confirmado; verificar se algum caminho de código chama a ação sem passar pelo `claimPendingOperation` primeiro |

## Como diagnosticar

1. Levantar `userId` e janela de tempo aproximada do relato.
2. Consultar `inferenceLogs` (via admin ou diretamente) filtrando `userId` e `eventType LIKE 'whatsapp.history.%' OR eventType LIKE 'whatsapp.concurrency.%' OR eventType LIKE 'whatsapp.idempotency.%'`, ordenado por `createdAt`.
3. Cruzar com `eventType` dos webhooks (`whatsapp.intent.*`, `whatsapp.action_*`) da mesma janela para reconstruir a sequência de decisões.
4. Se precisar confirmar o conteúdo real da conversa (não apenas metadados), isso exige acesso autorizado separado à tabela `whatsappConversationMessages` (`sanitizedText`/`sanitizedTranscript`, nunca as colunas brutas fora da janela de retenção `ephemeral`), seguindo o processo padrão de acesso a dados — nunca lendo os logs de inferência para esse fim.

## Privacidade

Os `eventType`s deste runbook (`whatsapp.history.*`, `whatsapp.concurrency.*`, `whatsapp.idempotency.*`) nunca registram texto de mensagem, telefone ou identificadores de alta cardinalidade no campo `detail` — apenas contagens, enums (`reason`, `contextSource`) e ids que já são colunas tipadas em outras tabelas. Diagnosticar o conteúdo de uma conversa específica exige acesso autorizado separado ao banco (não aos logs), respeitando a camada de retenção ainda vigente para aquele dado.
