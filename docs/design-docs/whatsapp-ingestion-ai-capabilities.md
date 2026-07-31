# Extensão de ingestão do WhatsApp — capacidades de IA (#922)

Este documento complementa `docs/design-docs/whatsapp-ingestion.md` sem substituir as regras atuais de metas, exercícios, idempotência, callbacks e transporte central consolidadas posteriormente na `develop`.

## Executor de intenção por capacidade

A classificação genérica usa `WHATSAPP_INTENT` somente depois do gate de precedência, das operações pendentes e dos comandos determinísticos. O consumidor chama `executeResolvedCapability`; cada tentativa recebe provider e modelo já pareados e usa a fronteira sanitizada de resposta, sem `raw` do SDK no domínio.

A compatibilidade `OPENAI_WHATSAPP_INTENT_MODEL` e `OPENAI_TEXT_MODEL` aplica-se apenas quando o provider resolvido usa o protocolo OpenAI. Gemini permanece associado a `GEMINI_MODEL` ou `AI_WHATSAPP_INTENT_MODEL`, impedindo envio de modelo OpenAI ao adapter Gemini e vice-versa.

A migração não altera estados persistidos, interação pendente, correlação inbound, expiração, cancelamento, idempotência nem isolamento por usuário. Botão e lista são resolvidos no gate antes do classificador; áudio transcrito e texto equivalente continuam convergindo para o mesmo contrato de domínio quando chegam à etapa de intenção.

Falhas operacionais recuperáveis seguem exclusivamente a política da capacidade. Autenticação, configuração inválida, modelo inexistente conhecido, incompatibilidade e bloqueio de segurança não acionam retry nem fallback. A indisponibilidade da IA mantém a resposta funcional segura já documentada e nunca cria refeição genérica ou vazia silenciosamente.

Em `NODE_ENV=production`, fallback para provider diferente permanece bloqueado fail-closed, mesmo com `AI_WHATSAPP_INTENT_CROSS_PROVIDER_FALLBACK_ENABLED=true`, até benchmark, revisão de privacidade/LGPD e rollout aprovados na #927. O resolvedor retorna a capacidade como `degraded`, preserva o primário válido e torna o fallback inelegível; o executor não recebe autorização para realizar a segunda chamada.

## Perguntas `/` por capacidade (#923)

Mensagens textuais iniciadas por `/` são interceptadas pelo gate de precedência antes de exclusão, pendências ou classificação genérica e são executadas pela capacidade `QUESTION`. O consumidor resolve provider, modelo, timeout, tentativas e fallback por `resolveCapabilityConfig("QUESTION")` e usa exclusivamente `executeResolvedCapability`; não instancia cliente de SDK nem seleciona modelo global. Pergunta vazia e configuração indisponível permanecem respostas controladas e não mutam refeições ou outros estados do domínio.

`AI_QUESTION_WEB_SEARCH_MODE=auto` envia apenas o contrato interno `{ type: "web_search" }` sem `tool_choice`, permitindo resposta com a base interna quando a busca não é necessária. O adapter OpenAI traduz para a ferramenta estável `web_search` e solicita `web_search_call.action.sources`; o adapter Gemini traduz para Google Search Grounding. A telemetria funcional marca execução somente quando o adapter normaliza uma chamada/grounding efetivamente realizado; ferramenta apenas oferecida não registra custo de pesquisa.

A pergunta atual, o histórico delimitado e a base compactada são dados de entrada transitórios. Logs de erro registram somente códigos sanitizados; pergunta, prompt, base compactada, resposta bruta e `raw` dos SDKs não são persistidos em telemetria. As invariantes de correlação, janela persistente e neutralização de histórico continuam documentadas em `docs/testing/whatsapp-ai-question-history-security.md`.
