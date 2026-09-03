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
3. referência exata e verificável da mesma medida para o mesmo alimento/produto, incluindo resolução pesquisada exata persistida e ainda válida;
4. referência pessoal anterior (`user_learned`) da mesma identidade, marca/variante quando aplicável e medida, aprendida somente após correção explícita bem-sucedida;
5. média usual (`usual_average`) da mesma medida para o mesmo alimento/tipo/preparo;
6. estimativa contextual (`contextual_estimate`) baseada em uma única referência verificável e fisicamente compatível quando não houver contradição conhecida;
7. clarificação persistente de peso/volume somente quando nenhuma das etapas anteriores resolver ou estimar a quantidade com segurança suficiente;
8. nunca promover a base nutricional de `100 g` a medida caseira implícita.

O preflight compartilhado por webhook, simulador e registro confirmado deve tentar resolver cada item seguindo essa precedência antes de criar uma pendência. Itens resolvidos por porção canônica, referência exata, referência pessoal, média usual ou estimativa contextual são quantitativamente resolvidos. Enquanto existir item que realmente dependa de clarificação, a refeição completa permanece em `whatsappPendingOperations` e nenhum item da mesma mensagem é persistido.

### Média usual e estimativa contextual

A média usual e a estimativa contextual existem para evitar perguntas desnecessárias quando o sistema já possui base suficiente para estimar uma medida caseira de forma útil. Nenhuma delas é uma constante universal da unidade.

Exemplos de interpretações válidas:

- `1 fatia de presunto` pode usar uma referência compatível de fatia de presunto;
- `1 fatia de mussarela` pode usar uma referência própria de fatia de mussarela, ainda que o peso seja diferente do presunto;
- `1 colher de requeijão` pode usar referência de colher para requeijão, sem reaproveitar a mesma gramatura para outros alimentos;
- `1 unidade` só pode ser estimada quando a identidade do alimento tornar a unidade física suficientemente definida.

Uma `usual_average` pode ser aceita quando uma fonte compatível declarar explicitamente a medida como média/usual/típica ou quando duas ou mais referências independentes e compatíveis produzirem um valor central coerente. Uma única referência compatível que não se declare típica pode sustentar `contextual_estimate` somente quando a relação quantidade-unidade-gramas e a identidade do alimento/tipo/preparo forem verificáveis e a medida for fisicamente definida. Medidas genéricas como `porção`, `pedaço`, `pacote` e `punhado` não são promovidas a estimativa contextual apenas por existir uma referência isolada.

Duas ou mais referências verificadas materialmente conflitantes não autorizam selecionar arbitrariamente uma delas: o resultado volta a ser clarificação.

A evidência que sustenta a relação entre a medida e a gramatura deve estar semanticamente vinculada ao mesmo alimento/tipo no próprio trecho de suporte. Menções ao alimento em um trecho e a relação `medida -> gramas` de outro alimento em outro trecho da mesma página não podem ser combinadas para formar uma referência exata, média usual ou estimativa contextual.

Para produto com marca/variante explícita, uma porção exata da mesma marca/variante tem precedência. Na ausência dela, uma referência do mesmo alimento/tipo e da mesma medida física pode estimar apenas a **quantidade**. Isso não transforma outra marca em correspondência exata nem autoriza substituir a composição nutricional específica do produto quando ela estiver disponível.

Não é permitido criar mapas ou constantes paralelas como `PRESUNTO_SLICE_GRAMS` no parser, intent ou handler. A resolução passa por `householdMeasureResolution.ts`. Resoluções pesquisadas reutilizáveis são persistidas por usuário em `userPreferences` por identidade alimentar, marca/variante, unidade e tipo de resolução, preservando quantidade de referência, gramas, procedência, evidência, fontes, data de verificação e expiração. O armazenamento persistente é a fonte de verdade para reuse entre restart e múltiplas instâncias; não existe cache em memória obrigatório para correção do fluxo.

Resoluções pesquisadas (`researched_exact`, `usual_average` e `contextual_estimate`) possuem validade temporal e, quando expiradas, são tratadas como miss para permitir nova verificação. `user_learned` não expira automaticamente, mas permanece estritamente isolado pelo usuário e pela identidade específica da medida.

### Aprendizado por correção explícita

Uma correção do usuário só gera `user_learned` quando todas as condições abaixo forem verdadeiras:

- o alvo da refeição é único e não ambíguo;
- antes da mutação ainda são conhecidos alimento, marca/variante, quantidade original e unidade contável original;
- a correção nova informa massa/volume válido;
- a atualização canônica da refeição termina com sucesso;
- a identidade alimentar não foi substituída por outra incompatível.

A gravação ocorre **depois** da mutação da refeição e usa upsert idempotente. Falha de escrita, cancelamento, ambiguidade, estado stale ou tentativa que não chega à mutação não ensinam nada. Uma correção posterior da mesma relação atualiza a referência pessoal em vez de acumular duplicatas.

O aprendizado não vira dado global: uma referência corrigida pelo usuário A não pode resolver a medida do usuário B. Também não atravessa alimento, marca/variante ou unidade diferentes. Porção canônica e medida pesquisada exata específica continuam tendo precedência sobre uma referência pessoal genérica.

### Transparência da estimativa

Quando `usual_average`, `contextual_estimate` ou `user_learned` forem usados, a resposta deve indicar que a gramatura é aproximada, preservar a medida original e informar os gramas usados no cálculo nutricional. O usuário não precisa confirmar antes do registro quando a estimativa cumprir os critérios acima.

Exemplos conceituais:

```text
Presunto — 1 fatia (aprox. 18 g)
Estimativa contextual usada no cálculo. Você pode corrigir depois.
```

```text
Presunto — 1 fatia (aprox. 20 g)
Usei como aproximação uma referência pessoal anterior que você corrigiu.
```

A correção posterior continua disponível pelos fluxos canônicos de ajuste no WhatsApp e pela tela de ajuste da refeição.

Para ajustes de refeições já persistidas, `fatia`, `unidade` e demais medidas contáveis seguem a mesma fronteira canônica. Não existe tabela paralela de pesos no parser/intent. Se uma medida permanecer sem resolução segura, o plano do comando é persistido e o usuário informa somente o peso/volume faltante. Operações já resolvidas ou estimadas permanecem no plano e só são aplicadas quando todo o comando estiver pronto, preservando atomicidade e exactly-once.
