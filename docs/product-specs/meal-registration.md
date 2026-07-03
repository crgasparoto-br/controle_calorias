# Especificação de produto: registro de refeições

## Objetivo

Permitir que o usuário registre refeições por texto, imagem, áudio ou entrada manual, revise a inferência nutricional e confirme apenas dados que deseja persistir.

## Fluxo principal

1. Usuário informa uma refeição pelo canal web ou WhatsApp.
2. Sistema cria um rascunho com itens, porções, calorias, proteínas, carboidratos e gorduras.
3. Usuário revisa e ajusta os itens inferidos.
4. Sistema confirma a refeição, persiste itens individuais e atualiza totais, hábitos e relatórios.

## Regras de produto

- Toda inferência nutricional deve ser tratada como rascunho até confirmação explícita ou fluxo conversacional equivalente.
- O usuário deve conseguir entender quais alimentos foram identificados e quais valores foram estimados.
- Alimentos reconhecidos por imagem com segurança, mas sem tabela nutricional visível ou macros confiáveis, devem usar valores estimados em vez de manter calorias e macronutrientes zerados.
- Refeições confirmadas devem aparecer nos relatórios, dashboard e totais diários.
- Texto original, transcrição e mídia são dados sensíveis; usar apenas pelo tempo necessário e evitar logs crus.
- Todo item sem correspondência no catálogo de alimentos deve receber uma classificação de processamento (NOVA), fibra estimada e sinalização de fruta/vegetal a partir da própria análise de IA, e essa classificação deve ser persistida no catálogo para reaproveitamento em relatórios futuros — não deve depender de curadoria manual para deixar de aparecer como "não classificado".

## Classificação automática de alimentos (pipeline)

- A extração por IA (`server/mealAiExtraction.ts`) retorna, para cada item, um `foodClassification` com `processingLevel` (escala NOVA: `natural_or_minimally_processed`, `processed_culinary_ingredient`, `processed`, `ultra_processed`), `isFruit`, `isVegetable` e `fiberGrams` estimado para a porção.
- Ao confirmar a refeição, itens sem correspondência exata no `foodCatalog` (`server/modules/foods/catalog.ts`, `resolveFoodCatalogIds`) geram automaticamente uma nova linha em `foodCatalog` com essa classificação (`dataSource`/`classificationSource = "ai_estimated"`, `isUserCreated = 1`, `createdByUserId` do usuário), e o item passa a referenciar esse `foodCatalogId`.
- Isso torna o alimento classificado tanto na refeição atual quanto em ocorrências futuras do mesmo nome (a busca por nome/alias em `resolveFoodCatalogIds` já encontra a linha criada automaticamente).
- Itens sem estimativa de nutrição utilizável pela IA (fallback heurístico local, sem classificação confiável) continuam sem classificação — não há dado suficiente para classificar com segurança nesses casos.
- Refeições confirmadas antes deste pipeline existir podem ser reprocessadas com `pnpm foods:backfill-classification` (`scripts/backfill-food-classification.ts`): para cada item de `mealItems` com `foodCatalogId` nulo, primeiro tenta casar por nome/alias com o catálogo existente (sem custo de IA); se não encontrar, classifica via `classifyFoodNameWithAi` (texto apenas, sem imagem, sem recalcular nutrição) e cria uma entrada em `foodCatalog` (`classificationSource = "ai_backfill"`). Suporta `--dry-run` (não escreve, só relata) e `--limit=N` (limita quantas chamadas de IA fazer nessa execução, para rodar em lotes). Já rodado uma vez em produção (2026-07-03): 635 itens históricos classificados (20 por correspondência direta + 615 via IA).
- `buildFoodLookupForMeals` (`server/modules/insights/service.ts`) monta o lookup de qualidade alimentar de um período combinando duas fontes: busca por nome (limitada às primeiras `FOOD_QUALITY_LOOKUP_NAME_LIMIT` = 24 nomes distintos do período) **e** busca direta por `foodCatalogId` (`getFoodsByIds`, sem limite, já que a tabela `foodCatalog` é pequena). A busca direta por id é essencial: sem ela, itens com `foodCatalogId` já resolvido no banco apareciam como "não classificados" em relatórios de períodos com mais de 24 alimentos distintos, porque o lookup por nome truncava antes de alcançá-los.
- Relatórios não exibem mais a lista item a item de "alimentos não classificados" (ver `docs/product-specs/goals-and-reports.md`); apenas o percentual agregado por categoria de processamento é mostrado.

## Critérios de aceite

- Texto, imagem e áudio criam rascunho consistente.
- Confirmação persiste refeição e itens com macros por item.
- Erros de rascunho inexistente retornam mensagem amigável.
- Alterações no fluxo rodam `pnpm agent:check`.
