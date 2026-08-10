# Matriz de segurança do histórico da rota `/` no WhatsApp

Esta matriz protege o consumidor `slash_assistant` quando uma pergunta atual usa mensagens anteriores recuperadas do contexto persistente.

| Cenário | Entrada histórica | Resultado obrigatório |
|---|---|---|
| Prompt injection bloqueada em turno anterior | Mensagem inbound que falha em `inspectWhatsAppUserContentSafety` | O texto não aparece no payload enviado ao provider no turno posterior |
| Mensagem inbound permitida | Texto sanitizado recuperado da janela persistente | O texto é envolvido por `buildUntrustedWhatsAppUserContent` |
| Falsificação de delimitador | Texto contém marcadores internos de conteúdo não confiável | Os marcadores são neutralizados antes da composição do prompt |
| Resposta anterior do assistente | Mensagem outbound persistida, inclusive com conteúdo refletido ou externo | A mensagem é delimitada como citação histórica não confiável e marcadores forjados são neutralizados |
| Overflow resumido | Mensagens excedem o orçamento e incluem outbound com instrução refletida ou delimitador forjado | O payload do resumidor recebe o outbound delimitado; o resumo persistido é delimitado novamente antes de entrar no classificador |
| Pergunta `/` corrente | A mensagem atual também está persistida no lifecycle | A pergunta aparece uma única vez e fica fora da janela histórica |
| Mensagens concorrentes no mesmo segundo | Dois inbound possuem o mesmo `occurredAt`, mas `externalMessageId` distintos | Somente o inbound da requisição atual é excluído; o irmão concorrente permanece |
| Timestamp ausente ou divergente | O instante usado pelo webhook difere do persistido | A identidade estável da Meta ainda exclui a mensagem corrente exatamente uma vez |
| Timestamp ambíguo sem identidade | Dois inbound coincidem no timestamp e não há `externalMessageId` correlacionado | O sistema não remove arbitrariamente um irmão; o fallback temporal só vale quando a correspondência é única |
| Conversa expirada | Último turno anterior excede 30 minutos e a pergunta corrente já está persistida | A pergunta corrente não reativa o histórico; nenhum turno ou resumo expirado chega ao provider |
| Conteúdo bloqueado detectado | Um ou mais turnos são excluídos | A telemetria registra somente a contagem e o consumidor, sem o texto bruto |

## Evidência executável

- `server/modules/whatsapp/aiQuestionAssistant.persistedHistorySecurity.test.ts`
- `server/modules/whatsapp/aiQuestionAssistant.history.test.ts`
- `server/modules/whatsapp/conversationSummarySecurity.integration.test.ts`
- `server/modules/whatsapp/conversationSummaryService.test.ts`
- `server/modules/whatsapp/intentContext.currentMessage.test.ts`
- `server/modules/whatsapp/intentContext.rollout.test.ts`

A regressão da rota `/` usa o `buildWhatsappIntentContext` real com um repositório persistente controlado, mantém o rollout em modo `persistent`, inclui a pergunta corrente já persistida e inspeciona o payload real passado ao adapter de IA mockado na última fronteira externa, sem assumir provider específico. Como `slash_assistant` declara `usesSummary:false`, o construtor não chama o resumidor nesse fluxo. A regressão transitiva separada força overflow, inspeciona o payload real de `invokeLLM`, persiste uma saída contendo marcadores forjados e comprova que o classificador a delimita novamente. Os controles devem falhar se a correlação usar apenas timestamp, se a mensagem corrente for duplicada, se um irmão concorrente for removido, se contexto expirado for enviado ou se qualquer mensagem ou resumo histórico atravessar uma fronteira LLM sem neutralização.
