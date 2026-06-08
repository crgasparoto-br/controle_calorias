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
