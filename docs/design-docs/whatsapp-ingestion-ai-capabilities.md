# Extensão de ingestão do WhatsApp — capacidades de IA (#922)

Este documento complementa `docs/design-docs/whatsapp-ingestion.md` sem substituir as regras atuais de metas, exercícios, idempotência, callbacks e transporte central consolidadas posteriormente na `develop`.

## Executor de intenção por capacidade

A classificação genérica usa `WHATSAPP_INTENT` somente depois do gate de precedência, das operações pendentes e dos comandos determinísticos. O consumidor chama `executeResolvedCapability`; cada tentativa recebe provider e modelo já pareados e usa a fronteira sanitizada de resposta, sem `raw` do SDK no domínio.

A compatibilidade `OPENAI_WHATSAPP_INTENT_MODEL` e `OPENAI_TEXT_MODEL` aplica-se apenas quando o provider resolvido usa o protocolo OpenAI. Gemini permanece associado a `GEMINI_MODEL` ou `AI_WHATSAPP_INTENT_MODEL`, impedindo envio de modelo OpenAI ao adapter Gemini e vice-versa.

A migração não altera estados persistidos, interação pendente, correlação inbound, expiração, cancelamento, idempotência nem isolamento por usuário. Botão e lista são resolvidos no gate antes do classificador; áudio transcrito e texto equivalente continuam convergindo para o mesmo contrato de domínio quando chegam à etapa de intenção.

Falhas operacionais recuperáveis seguem exclusivamente a política da capacidade. Autenticação, configuração inválida, modelo inexistente conhecido, incompatibilidade e bloqueio de segurança não acionam retry nem fallback. A indisponibilidade da IA mantém a resposta funcional segura já documentada e nunca cria refeição genérica ou vazia silenciosamente.
