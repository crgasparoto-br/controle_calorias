# Roteador canônico do WhatsApp

## Contexto

A issue #398 introduz uma etapa de roteamento antes do fallback nutricional. O objetivo é evitar que mensagens não alimentares, números soltos, contas e pedidos de relatório/gráfico/sugestão caiam no parser de alimentos e gerem registros incorretos.

## Contrato inicial

O roteador é representado por `server/modules/whatsapp/intentRouter.ts`.

Ele recebe texto já normalizado pela camada multimodal/informal e produz uma decisão com:

- `canonical`: saída compatível com `whatsapp-intent-schema/v1`.
- `shouldUseNutritionFallback`: indica se o parser nutricional pode receber a mensagem.
- `response`: resposta segura quando a mensagem não deve virar alimento.
- `reason`: motivo operacional para auditoria e trace.

## Ordem no pipeline

No `simulateWhatsappInbound`, o roteador roda depois de:

1. normalização multimodal e informal;
2. idempotência;
3. acesso profissional;
4. separação água/alimento em mensagem multi-linha;
5. correção textual água -> alimento;
6. roteador LLM estruturado;
7. intenções determinísticas existentes;
8. assistente alimentar.

Ele roda imediatamente antes de `processMealDraft`. Assim, preserva os fluxos já suportados e bloqueia apenas o último fallback genérico quando não há sinal alimentar seguro.

## Regras cobertas

- `100g de arroz` e `1 banana` continuam seguindo para o fluxo nutricional.
- número isolado sem contexto pendente vira `mensagem_ambigua` e pede esclarecimento.
- número isolado com contexto pendente vira `selecionar_opcao`.
- conta com unidade, como `110 - 30 g`, vira `calcular_quantidade` e não salva alimento automaticamente.
- pedidos de resumo, gráfico, relatório, sugestão e perguntas de meta/evolução são bloqueados antes do parser alimentar.
- texto ambíguo sem alimento claro pede esclarecimento.

## Observabilidade

A decisão é registrada no trace operacional como etapa `canonical_router`, com:

- schema version;
- intenção canônica;
- confiança;
- necessidade de confirmação;
- permissão ou bloqueio do fallback nutricional;
- motivo da decisão.

## Limitações atuais

- O contexto pendente real ainda não é buscado de armazenamento durável; a função já aceita `pendingContextId` para preparar a integração futura.
- A resposta para relatório, gráfico e sugestão ainda é segura/curta quando os handlers anteriores não resolvem a intenção.
- O roteador não persiste dados nem executa ações de domínio; ele apenas libera ou bloqueia o fallback nutricional.
