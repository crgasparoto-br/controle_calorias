# Bebidas Sem Açúcar e Itens de Baixa Caloria

## Contexto

A issue #402 trata casos como `3 xícaras de café sem açúcar`, em que a bebida deve ser registrada com calorias nulas ou praticamente nulas, sem cair em estimativas genéricas relevantes.

## Estratégia desta entrega

Foram adicionadas referências específicas no catálogo local para bebidas de baixa caloria:

- `Café sem açúcar`;
- `Chá sem açúcar`;
- `Água`;
- `Água com gás`.

Os aliases de café e chá são qualificados, por exemplo `sem açúcar`, `sem adição de açúcar`, `puro`, `preto` e `natural`. O catálogo não adiciona alias genérico amplo para `café` ou `chá`, para evitar zerar bebidas com complementos calóricos.

## Comportamentos cobertos

- `3 xícaras de café sem açúcar` registra calorias e macros zerados.
- `2 xícaras de chá sem açúcar` registra calorias e macros zerados.
- `1 copo de água com gás` registra calorias e macros zerados.
- `1 xícara de café com leite` não é tratado como `Café sem açúcar` e continua usando uma referência calórica.

## Limites atuais

- A regra é conservadora e depende de qualificadores claros para café e chá.
- Bebidas com açúcar, leite, mel, creme ou outro complemento não são zeradas por essa camada.
- A rastreabilidade formal de regra/fonte por item será aprofundada nas issues de fonte nutricional e rastreabilidade (#405/#417/#435).
