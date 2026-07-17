# Design técnico: roteador de intenção do WhatsApp

## Responsabilidade

A subissue #398 introduz uma camada explícita de roteamento antes do parser nutricional e do fallback de alimento. O objetivo é impedir que números soltos, contas, confirmações, pedidos de gráfico, perguntas e mensagens ambíguas gerem registros alimentares indevidos.

A subissue #408 amplia essa proteção para contas e comandos numéricos de ajuste, garantindo que mensagens como `somar 30g` ou `excluir 2` não sejam tratadas como alimento genérico quando faltam alvo ou contexto pendente.

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
- `route_to_pending_context`: reconhece resposta curta ou comando numérico com contexto pendente e impede parser alimentar.

## Proteções

O roteador bloqueia fallback alimentar para:

- número isolado sem contexto;
- confirmação curta sem contexto;
- conta matemática com unidade;
- comando numérico de soma, correção, adição sem alimento ou remoção sem lista/contexto;
- gráfico/evolução ainda sem fluxo completo;
- pergunta sem alimento registrável;
- mensagem ambígua;
- comandos de remoção, correção ou relatório que não forem tratados por fluxo próprio.

## Regras numéricas da #408

- `110 - 30 g` é calculado de forma determinística e retorna o resultado sem criar refeição.
- `2` sem contexto pede esclarecimento e não aciona fallback alimentar.
- `2` com `pendingContextKind` é roteado para o contexto pendente como seleção, confirmação ou quantidade.
- `somar 30g`, `corrigir 30g` e `excluir 2` sem alvo/contexto pedem esclarecimento.
- `somar 30g` ou `excluir 2` com contexto pendente usam `route_to_pending_context`.
- `adicionar 30g de arroz` continua sendo registro alimentar válido, porque contém alvo alimentar explícito.

## Compatibilidade

Mensagens alimentares com quantidade, como `100g de arroz`, continuam autorizadas a seguir para o fluxo existente. Comandos alimentares, hidratação, relatórios já suportados e sugestões seguem para os handlers atuais antes de qualquer fallback.

## Integração atual

`simulateWhatsappInbound` usa o roteador em dois momentos:

1. logo após a guarda de idempotência, para respostas seguras imediatas;
2. imediatamente antes de `processMealDraft`, para garantir que só mensagens alimentares elegíveis chegam ao parser nutricional.

## Esclarecimento genérico canônico

A mensagem genérica de baixa confiança possui uma única versão amigável, definida em `replyMessages.ts`. O roteador, o classificador determinístico e o fallback do executor LLM importam diretamente essa mesma constante; o builder canônico apenas aplica a formatação final da resposta.

Perguntas específicas, como solicitação de quantidade, refeição ou item, continuam sendo fornecidas ao builder sem substituição textual.

## Limites

Esta entrega não implementa o fluxo completo de remoção, gráficos, resposta profissional-paciente ou validação final de persistência. Esses pontos permanecem nas subissues específicas: #399, #418, #419 e #412.

## Casos de teste

`server/modules/whatsapp/intentRouter.test.ts` cobre:

- alimento simples e comando de adicionar;
- número isolado com e sem contexto pendente;
- confirmação curta sem contexto;
- conta matemática com unidade;
- soma, correção e remoção numérica com e sem contexto;
- resumo, relatório, gráfico, sugestão e pergunta;
- mensagem ambígua;
- comando de remoção textual sem fallback alimentar.

`server/modules/whatsapp/service.test.ts` cobre a integração para impedir que ajuste numérico sem contexto chegue ao processamento de refeição.

`server/modules/whatsapp/genericClarificationMessage.test.ts` cobre a fonte canônica e o fallback determinístico sem LLM. `server/modules/whatsapp/service.test.ts` valida a resposta pelo fluxo completo de entrada, e `server/modules/whatsapp/llmIntentActions.test.ts` cobre baixa confiança da LLM com texto genérico.

Esses testes verificam a resposta final enviada pelo pipeline e impedem que as variantes antigas voltem a ser exibidas ao usuário.

As asserções dos fluxos antigos também utilizam a constante compartilhada, evitando expectativas divergentes entre os testes e o comportamento de produção.