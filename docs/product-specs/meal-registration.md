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
- Alimentos **sem marca/variante explícita** reconhecidos por imagem com segurança, mas sem tabela nutricional visível ou macros confiáveis, podem usar valores estimados em vez de manter calorias e macronutrientes zerados. Produto com marca ou variante explícita segue a política fail-closed abaixo e não herda essa permissão de estimativa genérica.
- Em imagens de produtos industrializados, marca e termos relevantes de linha, versão, estilo ou sabor visíveis no rótulo fazem parte da identidade nutricional. A seleção deve preferir referência compatível de produto + marca + variante + embalagem/porção; um resultado genérico nunca pode ser apresentado como se fosse específico da marca.
- Quando não houver referência interna exata para um produto com marca reconhecida, o fluxo usa a capacidade canônica `NUTRITION_SEARCH` para buscar fonte rastreável. Produto, marca, variante e porção precisam ser compatíveis. Se a identidade comercial exata não puder ser comprovada, o sistema preserva a identidade, zera a composição nutricional não comprovada e solicita clarificação; não é permitido reutilizar macros genéricos nem a estimativa da LLM como se fossem do produto de marca.
- Uma exceção segura existe para imagem com **variante explícita e tabela nutricional legível**: os macros efetivamente lidos do rótulo podem ser usados como `nutrition_label`, com procedência própria, mesmo sem correspondência de catálogo. Foto sem variante legível não autoriza escolher silenciosamente uma variante da marca.
- Quando uma marca sem variante possuir mais de uma alternativa plausível, o sistema deve expor as alternativas e pedir ao usuário que identifique a variante/linha/sabor antes da mutação nutricional. O mesmo vale para variante explicitamente informada cuja identidade não tenha sido comprovada.
- Bebidas gaseificadas explicitamente identificadas como `zero`, `zero açúcar`, `sem açúcar` ou `diet` devem priorizar uma referência nutricional específica e semanticamente compatível do catálogo. O fallback heurístico de `0 kcal` só se aplica ao comportamento genérico já documentado quando **não existe identidade comercial de marca/variante pendente**; uma marca explícita sem comprovação continua fail-closed.
- A heurística de bebida zero não se aplica a alimentos sólidos apenas por conterem `zero açúcar`, nem a bebidas regulares sem marcador explícito. Se a IA estiver indisponível, uma bebida zero genérica reconhecida pelo texto continua usando esse fallback específico em vez da referência genérica de alimento sólido.
- Refeições confirmadas devem aparecer nos relatórios, dashboard e totais diários.
- Texto original, transcrição e mídia são dados sensíveis; usar apenas pelo tempo necessário e evitar logs crus.
- Água potável pura continua obedecendo ao split de hidratação antes da persistência da refeição, mesmo quando marca ou embalagem forem reconhecidas na imagem.
- Todo item sem correspondência no catálogo de alimentos deve receber uma classificação de processamento (NOVA), fibra estimada e sinalização de fruta/vegetal a partir da própria análise de IA, e essa classificação deve ser persistida no catálogo para reaproveitamento em relatórios futuros — não deve depender de curadoria manual para deixar de aparecer como "não classificado".

## Contrato semântico multimodal (#1051)

`processMealInput` produz um contrato semântico canônico para novas inclusões, independentemente de a origem ser texto, transcrição de áudio, imagem ou combinação multimodal. O contrato preserva o texto original/normalizado e, por item, identidade comercial, marca, variante, quantidade, unidade, porção, gramas estimados, confiança e procedência da evidência.

- `inputType` diferencia `text`, `audio_transcript`, `image` e `multimodal`, sem criar resolvedores nutricionais paralelos por canal.
- Evidências de identidade, marca, variante, quantidade, gramas e nutrição carregam origem, confiança e estado de verificação. As origens incluem texto, transcrição, visão, catálogo, pesquisa web, tabela nutricional, estimativa de IA, heurística e indisponibilidade.
- O contrato mantém `alternatives`, `needsClarification` e motivo estruturado quando a identidade comercial não puder ser fechada. `brand_variant_unresolved` representa marca conhecida sem variante segura; `commercial_identity_unverified` representa variante/identidade informada mas ainda não comprovada.
- `barcode` permanece `null` enquanto o pipeline atual não tiver evidência estruturada confiável de código de barras; o contrato não fabrica esse valor.
- A composição nutricional de produto de marca só é `verified` quando provém de referência compatível de catálogo/pesquisa ou de tabela nutricional legível da mesma variante. `hybrid` estimado pela LLM não é evidência suficiente para fechar marca/variante.
- Quando houver clarificação de identidade, `processMealInput` encerra antes da mutação. No registro confirmado do WhatsApp, o `MealInferenceError` estruturado segue para a continuação persistente de detalhes já existente, preservando a mensagem original antes de perguntar novamente ao usuário.

## Classificação automática de alimentos (pipeline)

- A extração por IA (`server/mealAiExtraction.ts`) retorna, para cada item, um `foodClassification` com `processingLevel` (escala NOVA: `natural_or_minimally_processed`, `processed_culinary_ingredient`, `processed`, `ultra_processed`), `isFruit`, `isVegetable` e `fiberGrams` estimado para a porção.
- A normalização do rascunho preserva `foodClassification` nos caminhos de nutrição por catálogo, híbrido e estimativa heurística. A escolha da fonte de calorias/macros não pode descartar a classificação produzida na mesma chamada de `MEAL_TEXT` ou `MEAL_VISION`.
- Ao confirmar a refeição, itens sem correspondência exata no `foodCatalog` (`server/modules/foods/catalog.ts`, `resolveFoodCatalogIds`) geram automaticamente uma nova linha em `foodCatalog` com essa classificação (`dataSource`/`classificationSource = "ai_estimated"`, `isUserCreated = 1`, `createdByUserId` do usuário), e o item passa a referenciar esse `foodCatalogId`.
- Isso torna o alimento classificado tanto na refeição atual quanto em ocorrências futuras do mesmo nome (a busca por nome/alias em `resolveFoodCatalogIds` já encontra a linha criada automaticamente).
- Itens sem estimativa de nutrição utilizável pela IA usam referência nutricional heurística, mas preservam a classificação NOVA retornada pela própria IA para persistência e revisão. Quando a IA não fornece classificação, o item permanece sem classificação e deve ser tratado como pendente. Esta regra não autoriza fallback nutricional de produto com marca/variante explícita sem identidade comprovada.
- A fila de revisão/curadoria do catálogo pode ser gerada com `pnpm foods:review-classification`. O comando é somente leitura, adapta os campos persistidos de `foodCatalog` ao contrato de `classificationReview.ts` e lista classificações ausentes, estimadas ou abaixo da confiança mínima, sem nova chamada externa de IA e sem alterar dados.
- Refeições históricas podem executar `pnpm foods:backfill-classification`: o script vincula somente correspondências determinísticas por nome/alias ao catálogo existente. Nomes sem correspondência permanecem pendentes e são listados para a revisão/curadoria existente; o script não chama IA, não cria classificação externa e não consome `FOOD_CLASSIFICATION`. A execução histórica de 3 de julho de 2026 permanece como registro do passado, não como comportamento ativo.
- `buildFoodLookupForMeals` (`server/modules/insights/service.ts`) monta o lookup de qualidade alimentar de um período combinando duas fontes: busca por nome (limitada às primeiras `FOOD_QUALITY_LOOKUP_NAME_LIMIT` = 24 nomes distintos do período) **e** busca direta por `foodCatalogId` (`getFoodsByIds`, sem limite, já que a tabela `foodCatalog` é pequena). A busca direta por id é essencial: sem ela, itens com `foodCatalogId` já resolvido no banco apareciam como "não classificados" em relatórios de períodos com mais de 24 alimentos distintos, porque o lookup por nome truncava antes de alcançá-los.
- Relatórios não exibem mais a lista item a item de "alimentos não classificados" (ver `docs/product-specs/goals-and-reports.md`); apenas o percentual agregado por categoria de processamento é mostrado.

## Exclusão de alimento da base ativa

Alimentos criados pelo próprio usuário no catálogo legado podem ser removidos da base ativa sem apagar refeições anteriores. A ação exige confirmação, retira o item de busca, recentes e favoritos, preserva lookup histórico por ID e impede que o matching nominal reutilize a identidade depreciada. Em um registro posterior pela IA, a classificação atual do item pode gerar uma nova entrada ativa. Alimentos globais e entradas de outra conta nunca podem ser excluídos por esse fluxo.

## Critérios de aceite

- Texto, imagem e áudio criam rascunho consistente e projetam a mesma identidade no contrato semântico quando descrevem o mesmo produto.
- Produto com marca/variante sem evidência específica não recebe macros genéricos ou estimativa da IA como composição exata.
- Marca sem variante com múltiplas opções plausíveis gera clarificação antes de qualquer mutação.
- Confirmação persiste refeição e itens com macros por item.
- Erros de rascunho inexistente retornam mensagem amigável.
- Alterações no fluxo rodam `pnpm agent:check`.

## Capacidades de extração (#922)

- Texto usa `MEAL_TEXT`; entradas com imagem usam `MEAL_VISION`. Provider, modelo, timeout, tentativas e fallback são resolvidos independentemente.
- O mesmo Structured Output inclui nutrição e classificação NOVA. `FOOD_CLASSIFICATION` não possui consumidor externo nesta fase e não existe chamada por item.
- `items: []` validado por Zod é resultado funcional e não aciona retry, fallback ou escalonamento.
- Erros recuperáveis podem seguir a política limitada; autenticação, modelo inexistente, incompatibilidade, bloqueio de segurança e configuração inválida não geram segundo envio.
- Ao esgotar o caminho externo, o núcleo mantém a resposta funcional documentada de esclarecimento/indisponibilidade e não persiste refeição vazia ou genérica.
