-- Corrige itens persistidos em que o bolo com cobertura de chantilly e
-- recheio de doce de leite foi associado indevidamente ao canônico Leite integral.
UPDATE `mealItems`
SET
  `canonicalName` = 'Bolo com cobertura de chantilly e recheio de doce de leite',
  `foodCatalogId` = NULL,
  `portionId` = NULL,
  `source` = CASE WHEN `source` = 'catalog' THEN 'hybrid' ELSE `source` END
WHERE `canonicalName` = 'Leite integral'
  AND LOWER(`foodName`) LIKE '%bolo%'
  AND LOWER(`foodName`) LIKE '%chantilly%'
  AND LOWER(`foodName`) LIKE '%doce de leite%';
--> statement-breakpoint
UPDATE `mealInferences`
SET `itemsJson` = REPLACE(
  `itemsJson`,
  '"canonicalName":"Leite integral"',
  '"canonicalName":"Bolo com cobertura de chantilly e recheio de doce de leite"'
)
WHERE `itemsJson` LIKE '%"canonicalName":"Leite integral"%'
  AND LOWER(`itemsJson`) LIKE '%bolo%'
  AND LOWER(`itemsJson`) LIKE '%chantilly%'
  AND LOWER(`itemsJson`) LIKE '%doce de leite%';
--> statement-breakpoint
UPDATE `mealFavorites`
SET `itemsJson` = REPLACE(
  `itemsJson`,
  '"canonicalName":"Leite integral"',
  '"canonicalName":"Bolo com cobertura de chantilly e recheio de doce de leite"'
)
WHERE `itemsJson` LIKE '%"canonicalName":"Leite integral"%'
  AND LOWER(`itemsJson`) LIKE '%bolo%'
  AND LOWER(`itemsJson`) LIKE '%chantilly%'
  AND LOWER(`itemsJson`) LIKE '%doce de leite%';
