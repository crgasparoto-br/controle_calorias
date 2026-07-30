# Matriz de segurança do histórico da rota `/` no WhatsApp

Esta matriz protege o consumidor `slash_assistant` quando uma pergunta atual usa mensagens anteriores recuperadas do contexto persistente.

| Cenário | Entrada histórica | Resultado obrigatório |
|---|---|---|
| Prompt injection bloqueada em turno anterior | Mensagem inbound que falha em `inspectWhatsAppUserContentSafety` | O texto não aparece no payload enviado ao provider no turno posterior |
| Mensagem inbound permitida | Texto sanitizado recuperado da janela persistente | O texto é envolvido por `buildUntrustedWhatsAppUserContent` |
| Falsificação de delimitador | Texto contém marcadores internos de conteúdo não confiável | Os marcadores são neutralizados antes da composição do prompt |
| Resposta anterior do assistente | Mensagem outbound persistida, inclusive com conteúdo refletido ou externo | A mensagem é delimitada como citação histórica não confiável e marcadores forjados são neutralizados |
| Pergunta `/` corrente | A mensagem atual também está persistida no lifecycle | A pergunta aparece uma única vez e fica fora da janela histórica |
| Conteúdo bloqueado detectado | Um ou mais turnos são excluídos | A telemetria registra somente a contagem e o consumidor, sem o texto bruto |

## Evidência executável

- `server/modules/whatsapp/aiQuestionAssistant.persistedHistorySecurity.test.ts`
- `server/modules/whatsapp/aiQuestionAssistant.history.test.ts`
- `server/modules/whatsapp/intentContext.currentMessage.test.ts`
- `server/modules/whatsapp/intentContext.rollout.test.ts`

A regressão principal usa o `buildWhatsappIntentContext` real com um repositório persistente controlado, mantém o rollout em modo `persistent`, inclui a pergunta corrente já persistida, executa uma pergunta posterior com `/` e inspeciona o payload real passado ao cliente OpenAI mockado na última fronteira externa. O teste deve falhar se o construtor canônico for bypassado, se a mensagem corrente for duplicada ou se qualquer marcador histórico for aceito sem neutralização.
