# Roteador canônico do WhatsApp

## Contexto

A issue #398 introduz uma etapa de roteamento antes do fallback nutricional. O objetivo é evitar que mensagens não alimentares, números soltos, contas e pedidos de relatório/gráfico/sugestão caiam no parser de alimentos e gerem registros incorretos.

A issue #408 amplia esse contrato para contas, números isolados, respostas curtas e comandos numéricos de ajuste.

A issue #418 amplia a separação entre registro alimentar e pedidos de análise, relatório, gráfico, sugestão, histórico e perguntas.

A issue #426 adiciona limites de segurança para perguntas de saúde, dieta, sintomas, medicamentos, suplementos e orientação profissional. Essas mensagens não podem gerar registro alimentar, plano, meta ou prescrição automática.

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
8. guard de ajustes de registros;
9. assistente alimentar.

Ele roda imediatamente antes de `processMealDraft`. Assim, preserva os fluxos já suportados e bloqueia apenas o último fallback genérico quando não há sinal alimentar seguro.

## Regras cobertas

- `100g de arroz`, `adicionar 30g de arroz`, `1 banana` e narrativas como `almocei arroz, feijão e frango grelhado` continuam seguindo para o fluxo nutricional.
- número isolado sem contexto pendente vira `mensagem_ambigua` e pede esclarecimento.
- número isolado com contexto pendente vira `selecionar_opcao`.
- resposta curta sem contexto, como `sim`, `não` ou `ok`, não altera dados e pede esclarecimento.
- resposta curta com contexto pendente vira `confirmacao_sim_nao` ou `cancelar_pendencia`, sem cair no parser nutricional.
- conta com unidade, como `110 - 30 g`, vira `calcular_quantidade` e não salva alimento automaticamente.
- comandos numéricos sem alvo seguro, como `somar 30g`, `era 150g` ou `excluir 2`, não criam alimento nem alteram registro automaticamente.
- comandos numéricos com contexto pendente são roteados para a intenção canônica adequada antes de qualquer alteração.
- perguntas médicas sensíveis, como diabetes, hipertensão, medicamentos, insulina ou transtornos alimentares, viram `pergunta_medica_sensivel`, usam `safety_level` sensível e recebem resposta segura sem registro.
- perguntas sobre dieta com potencial de orientação profissional, como jejum, suplemento, creatina, whey, low carb ou cortes de calorias, viram `pergunta_saude_dieta` e não prescrevem conduta.
- possíveis urgências, como dor no peito, falta de ar, hipoglicemia, desmaio, convulsão ou pressão alta, viram `possivel_urgencia_saude`, usam `safety_level` de risco de saúde e orientam buscar atendimento imediato.
- pedidos de gráfico viram `gerar_grafico` com tipo de saída `grafico`.
- pedidos de relatório viram `gerar_relatorio` com tipo de saída `relatorio`.
- pedidos de resumo do dia ou período viram `resumo_dia` ou `resumo_periodo`.
- pedidos de sugestão viram `sugestao_refeicao` ou `sugestao_alimento`.
- consultas como `o que eu comi hoje?` viram `consulta_historico`.
- perguntas simples sobre meta, evolução, qualidade alimentar ou alimento viram intenções de pergunta, sem registro alimentar.
- texto ambíguo sem alimento claro pede esclarecimento.

## Observabilidade

A decisão é registrada no trace operacional como etapa `canonical_router`, com:

- schema version;
- intenção canônica;
- confiança;
- nível de segurança;
- necessidade de confirmação;
- permissão ou bloqueio do fallback nutricional;
- motivo da decisão.

## Limitações atuais

- O contexto pendente real ainda não é buscado de armazenamento durável; a função já aceita `pendingContextId` para preparar a integração futura.
- A resposta para relatório, gráfico, sugestão e perguntas de saúde ainda é segura/curta quando os handlers anteriores não resolvem a intenção.
- Comandos numéricos com contexto pendente ainda são apenas roteados; a execução contextual completa fica para #399/#420.
- O roteador não persiste dados nem executa ações de domínio; ele apenas libera ou bloqueia o fallback nutricional.
