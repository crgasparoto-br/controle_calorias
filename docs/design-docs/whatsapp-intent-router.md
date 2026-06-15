# Design técnico: roteador de intenção do WhatsApp

## Responsabilidade

A subissue #398 introduz uma camada explícita de roteamento antes do parser nutricional e do fallback de alimento. O objetivo é impedir que números soltos, contas, confirmações, pedidos de gráfico, perguntas e mensagens ambíguas gerem registros alimentares indevidos.

O contrato fica em `server/modules/whatsapp/intentRouter.ts` e é chamado por `simulateWhatsappInbound` depois da idempotência e antes das ações persistentes.

## Decisão

O roteador produz uma decisão estruturada com:

- intenção canônica da taxonomia de #411;
- confiança;
- ação de rota;
- permissão explícita para fallback nutricional;
- motivo rastreável;
- resposta segura quando aplicável;
- dados auxiliares, como cálculo ou contexto pendente.

## Ações de rota

- `continue_pipeline`: segue para os fluxos existentes de LLM estruturada, intents determinísticas, assistente e, se permitido, fallback nutricional.
- `safe_clarification`: pede esclarecimento e bloqueia fallback nutricional.
- `safe_non_food_response`: responde com segurança para mensagens não alimentares e bloqueia fallback nutricional.
- `route_to_pending_context`: reconhece resposta curta com contexto pendente e impede parser alimentar.

## Proteções

O roteador bloqueia fallback alimentar para:

- número isolado sem contexto;
- confirmação curta sem contexto;
- conta matemática com unidade;
- gráfico/evolução ainda sem fluxo completo;
- pergunta sem alimento registrável;
- mensagem ambígua;
- comandos de remoção, correção ou relatório que não forem tratados por fluxo próprio.

## Compatibilidade

Mensagens alimentares com quantidade, como `100g de arroz`, continuam autorizadas a seguir para o fluxo existente. Comandos alimentares, hidratação, relatórios já suportados e sugestões seguem para os handlers atuais antes de qualquer fallback.

## Integração atual

`simulateWhatsappInbound` usa o roteador em dois momentos:

1. logo após a guarda de idempotência, para respostas seguras imediatas;
2. imediatamente antes de `processMealDraft`, para garantir que só mensagens alimentares elegíveis chegam ao parser nutricional.

## Limites

Esta entrega não implementa o fluxo completo de remoção, gráficos, resposta profissional-paciente ou validação final de persistência. Esses pontos permanecem nas subissues específicas: #399, #418, #419 e #412.

## Casos de teste

`server/modules/whatsapp/intentRouter.test.ts` cobre:

- alimento simples e comando de adicionar;
- número isolado com e sem contexto pendente;
- confirmação curta sem contexto;
- conta matemática com unidade;
- resumo, relatório, gráfico, sugestão e pergunta;
- mensagem ambígua;
- comando de remoção sem fallback alimentar.
