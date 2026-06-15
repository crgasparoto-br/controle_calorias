# Priorização de Produtos com Marca

## Contexto

A issue #401 melhora a interpretação de alimentos informados com marca, produto, variação e quantidade. Exemplos comuns são `iogurte Nestlé natural`, `Coca-Cola zero lata`, `Leite Molico 200ml`, `pão integral Wickbold` e `queijo Polenghi light`.

A intenção desta entrega é reduzir o uso indevido de alimentos genéricos quando o texto já contém uma marca ou variação relevante.

## Estratégia desta entrega

A primeira camada foi implementada no catálogo de referência local usado pelo `nutritionEngine`.

Foram adicionados produtos de marca com aliases em diferentes posições da frase:

- marca no fim: `iogurte natural Nestlé`;
- marca no meio: `iogurte Nestlé natural`;
- marca no início: `Nestlé iogurte natural`;
- variações críticas: `zero`, `tradicional`, `desnatado`, `light`, `integral`;
- embalagem/unidade: `lata`, `fatias`, `200 ml`.

Como o matcher atual já procura correspondência exata por nome e aliases antes do fallback genérico, aliases específicos de marca passam a ganhar do alimento genérico quando há confiança textual suficiente.

## Comportamentos cobertos

- `comi um iogurte Nestlé natural 170g` resolve para `Iogurte natural Nestlé`.
- `Coca-Cola zero lata` resolve para a versão zero, sem cair na tradicional.
- `Leite Molico 200ml` resolve para `Leite Molico desnatado` mesmo quando a IA falha e o fallback textual é usado.
- `200ml leite` continua usando `Leite integral`, preservando o fluxo genérico sem marca.

## Limites atuais

- Esta entrega não cria crawler nem busca online de tabela nutricional; isso permanece em #407.
- A rastreabilidade completa de fonte, confiança e aproximação será aprofundada em #405/#417/#435.
- Produtos de marca fora do catálogo local ainda podem cair para estimativa ou genérico, conforme as regras existentes.
- Casos ambíguos entre vários produtos muito parecidos ainda dependem das próximas camadas de seleção/esclarecimento.

## Próximos encaixes

- #402 deve ampliar tratamentos para bebidas sem açúcar e itens de baixa caloria.
- #404 deve organizar a qualidade e classificação da base global.
- #405 deve definir hierarquia de fonte nutricional e rastreabilidade.
- #407 deve buscar tabela nutricional online de produtos com marca quando o catálogo local não for suficiente.
