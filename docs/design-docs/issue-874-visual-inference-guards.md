# Issue 874: guardas de inferência visual e edição rápida

## Identidade alimentar

Resultados de imagem não podem ser persistidos quando `foodName` e `canonicalName` representam apenas quantidade, unidade ou marcador de falha. Exemplos bloqueados incluem `não identificado`, `desconhecido`, `item 1`, `alimento desconhecido` e `sem identificação`.

Quando somente `canonicalName` contém uma identidade confiável, ele deve substituir o nome visível antes da confirmação e da persistência.

## Quantidade e porção

`estimatedGrams` isolado não comprova uma porção segura. Marcadores como `porção não informada`, `aprox.`, `estimado` ou `padrão` obrigam clarificação de quantidade, mesmo que o provider tenha preenchido um peso estimado.

A persistência direta exige quantidade positiva com unidade explícita ou texto de porção quantitativo sem marcador de aproximação insegura.

## Edição rápida

Uma identidade enviada é considerada alterada quando qualquer nome submetido não pertence ao conjunto de identidades atuais. Assim, um `canonicalName` antigo não pode neutralizar a alteração manual de `foodName`.

Quando a identidade ou a quantidade muda, calorias e macros são recalculados pelo backend antes da persistência e da confirmação pelo WhatsApp.

## Schema

As tabelas `user_food_favorites` e `user_food_usage_stats` fazem parte do schema canônico do Drizzle. Bancos novos devem recebê-las por `drizzle-kit push`, sem depender da aplicação manual de migration histórica no gate TiDB.
