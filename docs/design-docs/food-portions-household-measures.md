# Porcoes e medidas caseiras do catalogo

## Objetivo

Permitir que alimentos do catalogo sejam registrados por medidas comuns, como colher de sopa, concha, unidade, fatia ou xicara. Cada medida fica vinculada a um alimento especifico em `food_portions` e possui conversao propria para gramas.

## Regra de conversao

A conversao e feita no backend antes do calculo nutricional:

```text
grams_final = food_portion.grams * quantidade_informada / food_portion.quantity
```

Exemplos:

- Arroz branco cozido: 1 colher de sopa = 25 g.
- Feijao cozido: 1 concha media = 100 g.
- Banana prata: 1 unidade media = 86 g.
- Pao frances: 1 unidade = 50 g.

## Fluxo no registro de refeicao

O item de refeicao passa a aceitar:

- `foodId`: alimento do catalogo.
- `portionId`: porcao cadastrada para aquele alimento.
- `portionQuantity`: quantidade da porcao escolhida.
- `estimatedGrams`: fallback para entrada manual em gramas.

Quando `foodId` e `portionId` estao presentes, o backend chama `convertFoodPortionToGrams` e usa os gramas convertidos no snapshot nutricional. Quando nao ha porcao, o fluxo continua aceitando `estimatedGrams`.

## Escopo e seguranca

A consulta de porcao valida o acesso ao alimento com a mesma regra do catalogo:

```sql
foods.owner_user_id IS NULL OR foods.owner_user_id = :userId
```

Assim, um usuario pode usar porcoes de alimentos globais e de alimentos personalizados proprios, mas nao de alimentos personalizados de outro usuario.

## Seed inicial

O seed `common_brazil_foods.seed.json` inclui porcoes caseiras para alimentos comuns do Brasil, incluindo arroz, feijao, banana, pao frances, leite, batata, ovo e frango.

## Validacoes pendentes

Esta PR precisa ser validada com:

- `pnpm check`
- `pnpm test`
- `pnpm architecture:check`
- `pnpm docs:check`
- `pnpm agent:check`

## WhatsApp: composição nutricional e medida contável

A composição nutricional e a quantidade consumida são decisões distintas. Uma referência TACO ou de catálogo expressa por `100 g` pode resolver identidade e nutrientes por peso, mas **não** prova que `1 fatia` ou `1 unidade` pese 100 g.

No registro textual do WhatsApp a precedência é:

1. massa/volume explícitos informados pelo usuário;
2. porção contável canônica e compatível do catálogo, usando `food_portions`/`convertFoodPortionToGrams` quando disponível;
3. referência exata e verificável da mesma medida para o mesmo alimento/produto;
4. média usual contextual e defensável da medida para o mesmo alimento/tipo/preparo;
5. clarificação persistente de peso/volume somente quando nenhuma das etapas anteriores resolver ou estimar a quantidade com segurança suficiente;
6. nunca promover a base nutricional de `100 g` a medida caseira implícita.

O preflight compartilhado por webhook, simulador e registro confirmado deve tentar resolver cada item seguindo essa precedência antes de criar uma pendência. Itens resolvidos por porção canônica, referência exata ou média usual contextual são considerados quantitativamente resolvidos. Enquanto existir item que realmente dependa de clarificação, a refeição completa permanece em `whatsappPendingOperations` e nenhum item da mesma mensagem é persistido.

### Média usual contextual

A média usual existe para evitar perguntas desnecessárias quando o sistema já possui base suficiente para estimar uma medida caseira de forma útil. Ela **não** é uma constante universal da unidade.

Exemplos de interpretações válidas:

- `1 fatia de presunto` pode usar uma média usual de fatia de presunto;
- `1 fatia de mussarela` pode usar uma média usual de fatia de mussarela, ainda que o peso seja diferente do presunto;
- `1 colher de requeijão` pode usar uma média usual de colher para requeijão, sem reaproveitar a mesma gramatura para outros alimentos;
- `1 unidade` só pode ser estimada quando a identidade do alimento tornar a unidade física suficientemente definida.

Uma média usual pode ser aceita quando houver uma fonte compatível que declare explicitamente a medida como média/usual/típica, ou quando duas ou mais referências compatíveis permitirem derivar um valor central coerente sem dispersão que torne a estimativa enganosa.

Para produto com marca/variante explícita, uma porção exata da mesma marca/variante tem precedência. Na ausência dela, uma média usual do mesmo alimento/tipo e da mesma medida física pode estimar apenas a **quantidade**. Isso não transforma outra marca em correspondência exata nem autoriza substituir a composição nutricional específica do produto quando ela estiver disponível.

Não é permitido criar mapas ou constantes paralelas como `PRESUNTO_SLICE_GRAMS` no parser, intent ou handler. A resolução deve passar por uma fronteira canônica reutilizável. Se uma medida obtida externamente for persistida para reutilização futura, deve entrar na fonte canônica de porções com a procedência aplicável.

### Transparência da estimativa

Quando uma média usual for usada, a resposta deve indicar que a gramatura é aproximada e que os nutrientes foram calculados com base nessa estimativa. O usuário não precisa confirmar antes do registro quando a estimativa cumprir os critérios acima.

A resposta deve permitir compreender algo equivalente a:

```text
Presunto — 1 fatia (aprox. 18 g)
Estimativa baseada na medida média usual para fatia de presunto.
```

A correção posterior deve continuar disponível pelos fluxos canônicos de ajuste no WhatsApp e pela tela de ajuste da refeição.

Para ajustes de refeições já persistidas, `fatia`, `unidade` e demais medidas contáveis seguem a mesma precedência do registro: `food_portions` -> referência exata verificável -> média usual contextual -> clarificação. Não existe tabela paralela de pesos no parser/intent. Se uma medida permanecer sem resolução segura, o plano do comando é persistido e o usuário informa somente o peso/volume faltante. Operações já resolvidas ou estimadas permanecem no plano e só são aplicadas quando todo o comando estiver pronto, preservando atomicidade e exactly-once.
