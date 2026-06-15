# Qualidade de classificacao da base global de alimentos

## Contexto

A issue #404 e a Fase 2 do roteiro #397 precisam que alimentos da base global sejam auditaveis antes de novas automacoes de fonte nutricional, tabela online e revisao recorrente. Esta primeira entrega nao altera schema nem recalcula historico. Ela cria uma avaliacao deterministica e reutilizavel para apontar se um alimento possui classificacao minima suficiente.

## Escopo desta entrega

- Identificar alimentos com classificacao incompleta a partir dos campos ja disponiveis.
- Marcar quando falta categoria, fonte nutricional ou classificacao alimentar inferivel.
- Sinalizar produtos com marca que ainda dependem de fonte generica ou estimada.
- Expor status, confianca, necessidade de revisao, motivos e flags inferidas em um formato estavel.

## Fora desta entrega

- Rotina recorrente de varredura da base global.
- Fila administrativa persistida.
- Migracao de novos campos de classificacao na tabela `foods`.
- Busca de tabela nutricional online para produtos com marca.
- Comparacao entre estimativas antigas e fontes confirmadas.

Esses pontos continuam enderecados pelas subissues #405, #406, #407 e #435.

## Contrato do avaliador

O modulo `server/modules/foods/classificationQuality.ts` recebe dados basicos do alimento:

- nome;
- marca, quando houver;
- categoria;
- fonte nutricional.

A saida contem:

- `status`: `complete`, `partial` ou `pending`;
- `reviewRequired`: indica se o item precisa entrar em revisao;
- `confidence`: confianca calculada a partir das lacunas encontradas;
- `reasons`: motivos objetivos da pendencia;
- `flags`: sinais alimentares inferidos, como bebida, proteina, fruta, vegetal, ultraprocessado, produto com marca e bebida de baixa caloria.

## Regras iniciais

- Ausencia de categoria gera `missing_category`.
- Ausencia de fonte nutricional gera `missing_nutrition_source`.
- Item sem sinal alimentar util alem de `generic` ou `branded` gera `missing_processing_classification`.
- Fonte ausente, manual, generica ou estimada gera `estimated_or_generic_source`.
- Produto com marca usando fonte generica ou estimada gera `branded_product_without_specific_source`.

## Caminho para #406

A rotina recorrente de verificacao pode usar o avaliador para varrer a tabela `foods`, filtrar itens com `reviewRequired = true` e produzir uma fila operacional ou relatorio administrativo. Essa rotina deve decidir se a saida sera endpoint interno, job agendado ou tela de curadoria.
