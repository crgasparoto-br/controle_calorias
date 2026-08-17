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
- Em produtos industrializados reconhecidos por imagem, marca, produto, variação e embalagem/porção compatível formam a identidade nutricional. Uma referência específica compatível deve ser tentada antes da referência de categoria; se nenhuma fonte específica rastreável for confiável, o fallback preserva a identidade comercial exibida sem declarar os valores genéricos como próprios da marca.
- Marca ausente ou ambígua não pode ser inventada nem selecionar silenciosamente um SKU. Versões incompatíveis, como regular/`Zero`, `Original`/outra linha ou marcas distintas da mesma categoria, permanecem referências diferentes.
- Bebidas gaseificadas explicitamente identificadas como `zero`, `zero açúcar`, `sem açúcar` ou `diet` devem priorizar uma referência nutricional específica e semanticamente compatível do catálogo. Quando essa referência não existir e a IA não fornecer nutrição utilizável, o fallback heurístico usa `0 kcal`, `0 g` de proteína, `0 g` de carboidratos e `0 g` de gordura, preservando o nome/marca informado e a quantidade em ml.
- A heurística de bebida zero não se aplica a alimentos sólidos apenas por conterem `zero açúcar`, nem a bebidas regulares sem marcador explícito. Se a IA estiver indisponível, uma bebida zero reconhecida pelo texto continua usando esse fallback específico em vez da referência genérica de alimento sólido.
- Refeições confirmadas devem aparecer nos relatórios, dashboard e totais diários.
- Item persistido, totais e resposta do WhatsApp devem derivar da mesma referência nutricional selecionada. Água potável pura continua fora desse pipeline: o roteamento para hidratação prevalece mesmo quando marca e embalagem foram reconhecidas.
- Texto original, transcrição e mídia são dados sensíveis; usar apenas pelo tempo necessário e evitar logs crus.
- Todo item sem correspondência no catálogo de alimentos deve receber uma classificação de processamento (NOVA), fibra estimada e sinalização de fruta/vegetal a partir da própria análise de IA, e essa classificação deve ser persistida no catálogo para reaproveitamento em relatórios futuros — não deve depender de curadoria manual para deixar de aparecer como "não classificado".

## Classificação automática de alimentos (pipeline)

- A extração por IA (`server/mealAiExtraction.ts`) retorna, para cada item, um `foodClassification` com `processingLevel` (escala NOVA: `natural_or_minimally_processed`, `processed_culinary_ingredient`, `processed`, `ultra_processed`), `isFruit`, `isVegetable` e `fiberGrams` estimado para a porção.
- A normalização do rascunho preserva `foodClassification` nos caminhos de nutrição por catálogo, híbrido e estimativa heurística. A escolha da fonte de calorias/macros não pode descartar a classificação produzida na mesma chamada de `MEAL_TEXT` ou `MEAL_VISION`.
- Ao confirmar a refeição, itens sem correspondência exata no `foodCatalog` (`server/modules/foods/catalog.ts`, `resolveFoodCatalogIds`) geram automaticamente uma nova linha em `foodCatalog` com essa classificação (`dataSource`/`classificationSource = "ai_estimated"`, `isUserCreated = 1`, `createdByUserId` do usuário), e o item passa a referenciar esse `foodCatalogId`.
- Isso torna o alimento classificado tanto na refeição atual quanto em ocorrências futuras do mesmo nome (a busca por nome/alias em `resolveFoodCatalogIds` já encontra a linha criada automaticamente).
- Itens sem estimativa de nutrição utilizável pela IA usam referência nutricional heurística, mas preservam a classificação NOVA retornada pela própria IA para persistência e revisão. Quando a IA não fornece classificação, o item permanece sem classificação e deve ser tratado como pendente.
- A fila de revisão/curadoria do catálogo pode ser gerada com `pnpm foods:review-classification`. O comando é somente leitura, adapta os campos persistidos de `foodCatalog` ao contrato de `classificationReview.ts` e lista classificações ausentes, estimadas ou abaixo da confiança mínima, sem nova chamada externa de IA e sem alterar dados.
- Refeições históricas podem executar `pnpm foods:backfill-classification`: o script vincula somente correspondências determinísticas por nome/alias ao catálogo existente. Nomes sem correspondência permanecem pendentes e são listados para a revisão/curadoria existente; o script não chama IA, não cria classificação externa e não consome `FOOD_CLASSIFICATION`. A execução histórica de 3 de julho de 2026 permanece como registro do passado, não como comportamento ativo.
- `buildFoodLookupForMeals` (`server/modules/insights/service.ts`) monta o lookup de qualidade alimentar de um período combinando duas fontes: busca por nome (limitada às primeiras `FOOD_QUALITY_LOOKUP_NAME_LIMIT` = 24 nomes distintos do período) **e** busca direta por `foodCatalogId` (`getFoodsByIds`, sem limite, já que a tabela `foodCatalog` é pequena). A busca direta por id é essencial: sem ela, itens com `foodCatalogId` já resolvido no banco apareciam como "não classificados" em relatórios de períodos com mais de 24 alimentos distintos, porque o lookup por nome truncava antes de alcançá-los.
- Relatórios não exibem mais a lista item a item de "alimentos não classificados" (ver `docs/product-specs/goals-and-reports.md`); apenas o percentual agregado por categoria de processamento é mostrado.

## Exclusão de alimento da base ativa

Alimentos criados pelo próprio usuário no catálogo legado podem ser removidos da base ativa sem apagar refeições anteriores. A ação exige confirmação, retira o item de busca, recentes e favoritos, preserva lookup histórico por ID e impede que o matching nominal reutilize a identidade depreciada. Em um registro posterior pela IA, a classificação atual do item pode gerar uma nova entrada ativa. Alimentos globais e entradas de outra conta nunca podem ser excluídos por esse fluxo.

## Critérios de aceite

- Texto, imagem e áudio criam rascunho consistente.
- Confirmação persiste refeição e itens com macros por item.
- Erros de rascunho inexistente retornam mensagem amigável.
- Alterações no fluxo rodam `pnpm agent:check`.


## Capacidades de extração (#922)

- Texto usa `MEAL_TEXT`; entradas com imagem usam `MEAL_VISION`. Provider, modelo, timeout, tentativas e fallback são resolvidos independentemente.
- O mesmo Structured Output inclui nutrição e classificação NOVA. `FOOD_CLASSIFICATION` não possui consumidor externo nesta fase e não existe chamada por item.
- `items: []` validado por Zod é resultado funcional e não aciona retry, fallback ou escalonamento.
- Erros recuperáveis podem seguir a política limitada; autenticação, modelo inexistente, incompatibilidade, bloqueio de segurança e configuração inválida não geram segundo envio.
- Ao esgotar o caminho externo, o núcleo mantém a resposta funcional documentada de esclarecimento/indisponibilidade e não persiste refeição vazia ou genérica.
