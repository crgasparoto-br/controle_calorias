# Matriz de segurança do histórico da rota `/` no WhatsApp

Esta matriz protege o consumidor `slash_assistant` quando uma pergunta atual usa mensagens anteriores recuperadas do contexto persistente.

| Cenário | Entrada histórica | Resultado obrigatório |
|---|---|---|
| Prompt injection bloqueada em turno anterior | Mensagem inbound que falha em `inspectWhatsAppUserContentSafety` | O texto não aparece no payload enviado ao provider no turno posterior |
| Mensagem inbound permitida | Texto sanitizado recuperado da janela persistente | O texto é envolvido por `buildUntrustedWhatsAppUserContent` |
| Falsificação de delimitador | Texto contém marcadores internos de conteúdo não confiável | Os marcadores são neutralizados antes da composição do prompt |
| Resposta anterior do assistente | Mensagem outbound persistida | A mensagem aparece somente como contexto histórico citado |
| Pergunta `/` corrente | A mensagem atual também está persistida no lifecycle | A pergunta aparece uma única vez e fica fora da janela histórica |
| Conteúdo bloqueado detectado | Um ou mais turnos são excluídos | A telemetria registra somente a contagem e o consumidor, sem o texto bruto |

## Evidência executável

- `server/modules/whatsapp/aiQuestionAssistant.persistedHistorySecurity.test.ts`
- `server/modules/whatsapp/aiQuestionAssistant.history.test.ts`
- `server/modules/whatsapp/intentContext.currentMessage.test.ts`
- `server/modules/whatsapp/intentContext.rollout.test.ts`

A regressão principal fornece um repositório persistente em memória, executa uma pergunta posterior com `/` e inspeciona o payload real passado ao cliente OpenAI mockado na última fronteira externa.
