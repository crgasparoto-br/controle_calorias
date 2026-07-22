# Matriz de regressão do contrato de respostas do WhatsApp

Issue: #780 (baseline da epic #779). A matriz preserva o inventário histórico e registra o estado final após a migração #781–#788. A coluna de lacuna reflete o estado final: itens `concluído` foram migrados e validados; observações remanescentes estão registradas na própria linha.

Os textos legados descritos aqui **não são contrato permanente**: a coluna "Resposta desejada" indica o destino aprovado na #779. Os testes de caracterização protegem efeitos de domínio, rota, quantidade/ordem de mensagens, persistência da resposta e idempotência — não o texto literal.

## Definições usadas na matriz

- **Resposta funcional lógica**: a resposta que resolve a mensagem do usuário. Gravada exatamente uma vez no lifecycle persistente (`recordOutboundReply`).
- **Mensagem física**: cada POST à Cloud API `/messages`. Uma resposta lógica pode ser uma sequência (ex.: texto final + imagem anotada).
- **Acknowledgement**: "Recebi sua imagem/texto/áudio e estou processando." Não é resposta funcional e **não** é gravado no lifecycle.
- **Mídia auxiliar**: imagem anotada da mesma resposta lógica; não é segunda execução nutricional.
- **Resposta conversacional livre**: perguntas iniciadas por `/` (aiQuestionAssistant), resolvidas pelo gate de precedência.

## Cadeia real de produção (entrypoint canônico)

`POST /api/whatsapp/webhook` → `handleWhatsAppPersistentContextWebhook` ([server/whatsappPersistentContextWebhook.ts](../../server/whatsappPersistentContextWebhook.ts)):

1. correlação de mídia + escopo do lifecycle persistente (`runWithMessageLifecycleRequestScope`);
2. `handleWhatsAppWebhookWithImageIdempotency` ([server/whatsappImageIdempotencyWebhook.ts](../../server/whatsappImageIdempotencyWebhook.ts)) — onboarding de lead, claim persistente por `message.id`, imagem de água com legenda;
3. `handleWhatsAppWebhookWithTextIntent` ([server/whatsappIntentWebhook.ts](../../server/whatsappIntentWebhook.ts)) — segurança e gate canônico: callback interativo, pergunta `/`, resposta curta destrutiva, novo comando destrutivo completo, resolução de pendência alimentar da #855, confirmação genérica e só então profissional, peso, água+alimento, listagem, substituição contextual, gramas, intents textuais, LLM, assistente de alimentos e alimento desconhecido;
4. `handleWhatsAppWebhookWithAnnotatedImages` ([server/whatsappAnnotatedImageWebhook.ts](../../server/whatsappAnnotatedImageWebhook.ts)) — imagem: read receipt, acknowledgement, inferência, registro, consolidação, resposta funcional, imagem anotada;
5. `handleWhatsAppWebhook` ([server/whatsappWebhook.ts](../../server/whatsappWebhook.ts)) — fallback nutricional: áudio, multimodal, texto não tratado, água/peso legados, ações genéricas, erros.

Fronteiras de idempotência: `whatsappConversationMessages` + lease por `message.id` (`messageLifecycle.ts`), caches locais como fast-path, `whatsappPendingOperations` com consumo compare-and-set para seleção/confirmação/quantidade alimentar.

## Transporte atual (Cloud API)

Todas as chamadas à Cloud API vivem em [server/modules/whatsapp/webhookUtils.ts](../../server/modules/whatsapp/webhookUtils.ts):

| Função | Tipo físico | Observações |
|---|---|---|
| `sendWhatsAppTextMessage` | `text` | transporte padrão |
| `sendWhatsAppInteractiveUrlButtonMessage` | `interactive` (cta_url) | Adapter do CTA de edição rápida/onboarding/Strava; devolve o resultado original para a política única de fallback do `replyTransport` |
| `sendWhatsAppImageMessage` | `image` (por URL) | imagem anotada |
| `sendWhatsAppImageBufferMessage` | upload `/media` + `image` | fallback da imagem anotada |
| `markWhatsAppMessageAsRead` | status read | não é mensagem outbound |

Onboarding, profissionais e Strava montam `WhatsAppLogicalReply` e chamam `replyTransport`. Chamadas à Cloud API ficam restritas a `webhookUtils.ts`, `replyTransport.ts` e ao adaptador separado de acknowledgement; `architecture:check` protege essa fronteira.

`buttons`, `list` e `cta_url` compartilham a política central de fallback textual do `replyTransport`: uma tentativa degradada por posição, resultado original/fallback/efetivo discriminado e lifecycle gravado somente pelo sucesso efetivo da primária. A regressão cobre rejeição local/provedor, falha total, sanitização e continuidade de `texto -> CTA -> imagem` após falha do CTA auxiliar.

`simulateWhatsappInbound` ([server/modules/whatsapp/service.ts](../../server/modules/whatsapp/service.ts), via tRPC) percorre a cadeia de intents e **retorna** `reply` para o chamador web — não envia pela Cloud API.

## Inventário de fluxos

Colunas: entrada representativa → entrypoint/wrappers → efeito de domínio → builder/transporte atuais → composição outbound atual → resposta desejada (#779) → testes existentes → lacuna → subissue.

### Refeições e ações sobre alimentos (migração: #783)

**Status: migrado.** Todos os fluxos de refeição/alimento abaixo reutilizam os mesmos blocos centrais de item e total de `replyTemplates.ts` (`buildWhatsAppFoodLines`/`buildWhatsAppMealTotalLines`) via `buildWhatsAppMealActionReplyMessage`/`buildWhatsAppConsolidatedMealReplyMessage` (`replyMessages.ts`), recarregando sempre o estado atual da refeição (`listMeals`/`updateMeal`/`removeMeal`) antes de responder. Nenhuma mudança em seleção temporal, consolidação, catálogo, cálculo nutricional, persistência ou na regra de meta ajustada da #756.

**Ambiguidade por botões/lista:** quando um ajuste de gramas, correção de quantidade em contexto curto ou substituição de alimento encontra mais de um item candidato, a seleção passa a usar `server/modules/whatsapp/mealItemSelectionCallback.ts` — mesmo padrão de `whatsappPendingOperations` + `interactiveCallback.ts` já usado pela exclusão (#782), com fallback textual numerado mantido. Nenhuma mutação ocorre antes da seleção; a pendência é consumida por compare-and-set (reentrega/clique duplo não repete a mutação); isolamento entre usuários é reforçado pelo mesmo `claimWhatsAppInteractiveCallback`. Cobre `gramsAdjustmentIntent.ts`, `contextualFoodReplacementIntent.ts` e os handlers de `intentActions.ts` (`gramsAdjustmentHandlers.ts`, `foodReplacementHandlers.ts`) — os pontos realmente exercitados pelo webhook de produção. Ambiguidades entre refeições e fluxos do simulador usam a mesma seleção persistida, preservando refeição, item, ação e ordem sem mutação antecipada.

| Fluxo | Entrada | Cadeia | Efeito de domínio | Builder/transporte atuais | Outbound atual | Resposta desejada | Testes existentes | Lacuna |
|---|---|---|---|---|---|---|---|---|
| Registro por texto (fallback nutricional) | `100g arroz branco` | idempotency → intent (não trata) → annotated (sem imagem) → base | 1 refeição criada + consolidação | `buildWhatsAppMealReplyMessage`/`buildWhatsAppConsolidatedMealReplyMessage` + quick edit | 1 resposta funcional | padrão único de refeição, sem acknowledgement no caminho rápido | `whatsappWebhook.test.ts`, `whatsappPersistentContextWebhook.test.ts` | concluído |
| Adição a refeição existente (intent) | `adiciona 1 banana no almoço` | intent webhook (`datedFoodAdditionIntent` → `executeWhatsappTextIntent`) | item adicionado 1x, refeição recarregada | ✅ migrado: `buildWhatsAppMealActionReplyMessage` (mesmo bloco do registro); `buildMealFullSummary` local removido de `whatsappIntentWebhook.ts` (duplicava a resposta) | 1 mensagem | repetir todos os itens e totais no formato central | `datedFoodAdditionIntent.test.ts`, `whatsappIntentWebhook.test.ts` | concluído |
| Listagem de refeição | `o que registrei no almoço?` | intent webhook (`mealListIntent`) | nenhum (consulta ao banco) | ✅ migrado: `mealListIntent.ts` usa `buildWhatsAppFoodLines`/`buildWhatsAppMealTotalLines` (mesmo bloco do registro) | 1 mensagem | mesmo padrão visual do registro | `mealListIntent.test.ts`, `whatsappIntentWebhook.mealList.test.ts` | concluído |
| Substituição contextual | `não era arroz, era batata` | intent webhook (`contextualFoodReplacementIntent`) | substituição aplicada direto (sem confirmação), refeição(ões) recarregada(s) | ✅ migrado: `buildWhatsAppMealActionReplyMessage` por refeição afetada (builders locais `formatMealSummary`/`formatTotalsLine` removidos) | 1 mensagem (ou 1 bloco por refeição quando a substituição atinge mais de uma) | aplicar direto + repetir itens/totais | `contextualFoodReplacementIntent.test.ts`, `whatsappIntentWebhook.test.ts` | concluído |
| Ajuste de gramas/quantidade | `muda o arroz para 150g` | intent webhook (`gramsAdjustmentIntent`/`gramsIncrementIntent`) | update no registro correto, refeição recarregada | ✅ já usava `buildWhatsAppMealActionReplyMessage` (bloco central) | 1 mensagem | aplicar direto + repetir itens/totais | `gramsAdjustmentIntent*.test.ts`, `gramsIncrementIntent.test.ts` | concluído |
| Exclusão de alimento | `apaga a banana` → botão `Confirmar` (ou texto `sim`) | precedence gate + `deleteIntent` + `interactiveCallback` + `whatsappPendingOperations` | exclusão só após confirmação; recarrega a refeição e mostra itens restantes; se era o último item, remove a refeição e responde com confirmação coerente | `buildWhatsAppMealActionReplyMessage` com os itens restantes após recarregar via `listMeals` | 1 pergunta + 1 confirmação | mostrar itens restantes e totais atuais | `deleteIntent*.test.ts`, `whatsappIntentWebhook.delete.test.ts`, `whatsappIntentWebhook.interactiveCallback.test.ts` | concluído |
| Exclusão de refeição 0/1/N | `apagar o almoço` com zero, um ou vários almoços | precedence gate + `deleteIntent` + `interactiveCallback` + `whatsappPendingOperations` | zero gera esclarecimento; um gera confirmação; vários geram seleção ordenada e somente depois confirmação; nunca escolhe o primeiro silenciosamente | lista com `Cancelar`, seguida de botões `Confirmar`/`Cancelar`; confirmação final em texto simples | 1 seleção opcional + 1 confirmação | cardinalidade segura e revalidação antes da mutação | `deleteIntent.issue856.test.ts`, `deleteIntent*.test.ts`, `messageRouter.interactiveCallback.test.ts` | concluído (#856) |
| Novo delete durante pendência alimentar | seleção `meal_item_selection` ativa → `Excluir o Registrar` | `messageRouter`/simulador → `executeWhatsappDeleteIntent` antes do resolvedor alimentar | pendência incompatível marcada `superseded`; nova confirmação destrutiva criada; nenhuma mutação alimentar | mesmo contrato canônico de exclusão | 1 confirmação | novo comando destrutivo não é capturado por pendência anterior | `deleteIntent.issue856.test.ts`, `conversationContext.issue856.test.ts`, `service.issue856.pending.test.ts`, `messageRouter.test.ts` | concluído (#856) |
| Resposta inválida a delete pendente | confirmação ativa → `talvez o arroz` | `deleteIntent` resolve pendência antes dos demais intents | pendência permanece ativa; zero LLM, zero `processMealInput`/`processMealDraft`, zero mutação | mesma interação reapresentada | 1 reapresentação | fail-closed até confirmar, cancelar ou enviar novo delete completo | `deleteIntent.issue856.test.ts` | concluído (#856) |
| Exclusão via legenda de imagem | foto com legenda `apague o almoço` | annotated webhook desvia para `deleteIntent` | nenhuma refeição criada da imagem | reply do deleteIntent | 1 resposta | sem duplicidade, resposta central | `whatsappWebhook.mediaIntent.test.ts` | concluído (#785) |
| Exclusão via simulador | pendência conversacional real + `Excluir o Registrar` | `conversationContext` libera comando destrutivo; `simulateWhatsappInbound` chama `deleteIntent` antes dos parsers alimentares | comando destrutivo nunca cai no fallback nutricional nem pede quantidade | executor canônico de `deleteIntent.ts` | 1 seleção/confirmação | paridade com webhook e áudio transcrito | `service.issue856.pending.test.ts`, `service.test.ts` | concluído (#856) |
| Alimento ausente do catálogo / estimado pela IA | `1 bisnaguinha xpto` | intent webhook / fluxo de registro segue para estimativa da IA | item estimado incluído na refeição e nos totais | `buildWhatsAppFoodLines` inclui `WHATSAPP_ESTIMATED_NUTRITION_WARNING` abaixo de cada item estimado | 1 mensagem | seguir direto para estimativa da IA; aviso individual; totais incluem estimados | `replyMessages.estimatedNutrition.test.ts`, `whatsappIntentWebhook.test.ts` | concluído |
| Link de edição rápida | refeição registrada/atualizada com CTA disponível | builders de refeição anexam CTA quando o link é gerado | nenhum efeito adicional | CTA opaco com fallback textual | mantido | falha ao gerar não bloqueia a resposta nutricional | `replyMessages.*.test.ts` | fora do escopo da #856 |
| Contagem com porção canônica segura | `2 kit kat` / alimento naturalmente contável exato | parser especializado → `foodClarification` → catálogo exato → serviço nutricional canônico | registra a contagem uma única vez; converte pela porção exata, nunca por similar | resposta canônica da refeição após recarregar estado | 1 resposta funcional | unidade somente com candidato exato e porção estável | `foodClarification.test.ts`, `foodClarification.lifecycle.test.ts` | concluído (#855) |
| Contagem sem porção canônica | `1 iogurte natural desnatado` | `foodClarification` antes do parser alimentar genérico | nenhuma mutação; cria `food_registration_clarification` aberta preservando alimento e qualificadores | pergunta específica de peso/tamanho; transporte textual por ser decisão aberta | 1 pergunta + 1 resposta | não assumir `100 g`; `170 g` completa o alimento original | `foodClarification.test.ts`, `foodClarification.lifecycle.test.ts`, `foodClarificationGate.test.ts` | concluído (#855) |
| Erro ortográfico conservador | `1 iogurte natual desnatado` | normalização preserva texto original e candidato `iogurte natural desnatado` separados | confirmação específica, seleção ou quantidade conforme candidatos/porção | contrato persistido expõe classificação, tipo, ações e instrução para #858 | 1 pergunta específica | nunca perguntar genericamente pela intenção; nunca corrigir ambiguidade silenciosamente | `foodClarification.test.ts` | concluído (#855) |
| Resposta incompatível à pendência alimentar | quantidade ativa → `registrar` | gate persistente antes de contexto, parsers e LLM | pendência permanece ativa; zero item e zero refeição | mesma instrução específica reapresentada | 1 reapresentação | respostas curtas resolvem somente tipo compatível | `foodClarification.test.ts`, `foodClarificationGate.test.ts` | concluído (#855) |
| Comando isolado sem pendência | `registrar`, `confirmar`, `cancelar`, `sim`, número isolado | gate antecipado + validação estruturada | zero LLM e zero persistência nutricional; `foodName: Registrar` é rejeitado | esclarecimento seguro; frase completa segue o pipeline | 1 mensagem | pedir comando completo sem criar alimento fantasma | `standaloneCommandWords.test.ts`, `intentSchema.issue855.test.ts`, `foodClarificationGate.test.ts` | concluído (#855) |

### Resumos, metas, água, peso e exercícios (migração: #784)

| Fluxo | Entrada | Cadeia | Efeito de domínio | Builder/transporte atuais | Outbound atual | Resposta desejada | Testes existentes | Lacuna |
|---|---|---|---|---|---|---|---|---|
| Resumo/relatório de período | `resumo de hoje` | intent webhook → bundle canônico de relatórios | nenhum (consulta) | builder central recebe a meta efetiva do domínio | 1 mensagem | somente `Meta`, diferença `consumo - meta`, macros `P`/`C`/`G` com `•` | `whatsappIntentWebhook.test.ts`, `replyMessages.test.ts` | concluído (#784) |
| Clarificação de período pendente | `resumo` → lista `Hoje`/`Ontem`/`Esta semana`/`Este mês` (ou texto `ontem`) | pendência `period_report_clarification` em `whatsappPendingOperations` resolvida pelo gate central | nenhum | lista interativa com callback opaco; fallback textual resolve a mesma pendência | 1 pergunta + 1 resposta | lista/botões de período | `periodReportClarification.test.ts`, `whatsappIntentWebhook.test.ts` | concluído (#782/#784) |
| Água por texto | `300 ml de água` | intent webhook → `executeWhatsappTextIntent` | 1 water log | formatter canônico com quantidade, total, meta e data no timezone do perfil | 1 resposta funcional | diferença `consumo - meta`; ausência de meta explícita | `waterFoodText.test.ts`, `userMeasurementReplyContext.test.ts`, baseline | concluído |
| Água + alimento na mesma mensagem | `300ml água\n1 pão` | intent webhook divide (`splitWhatsAppWaterAndFoodText`) e repassa alimento | água 1x + refeição 1x | blocos centrais compostos antes do envio final | 1 resposta funcional consolidada | sequência coordenada do contrato central | `whatsappIntentWebhook.test.ts`, `waterFoodText.test.ts` | concluído (#785) |
| Água por texto no fallback base | água detectada no webhook base | base webhook (`detectWaterLogFromMessage`) | 1 water log | formatter canônico e delivery lógico central | 1 resposta funcional | mesmo contrato do intent | `whatsappWebhook.test.ts` | concluído |
| Peso por texto | `pesei 82,5 kg` | intent/base webhook → `ensureWhatsAppWeightEntry` | peso persistido no máximo 1x | formatter canônico recebe variação e timezone | 1 resposta funcional | variação neutra; primeiro registro explícito | `weightIdempotency.test.ts`, `userMeasurementReplyContext.test.ts`, `whatsappWebhook.test.ts` | concluído |
| Peso sem valor | `quero registrar meu peso` | intent webhook | nenhum registro | clarificação sanitizada | 1 mensagem | nenhuma mutação sem valor válido | baseline | concluído |
| Imagem de água com legenda | foto + legenda `500 ml de água` | idempotency webhook (`handleWaterImageMessage`) | 1 water log ou clarificação | formatter canônico de água | 1 resposta funcional | mesmo formato de texto e timezone | `whatsappWebhook.image.water.test.ts` | concluído |
| Notificação de exercício (Strava) | activity webhook Strava | `strava/exercises.ts` | exercício upserted; reimportação não duplica calorias | `buildWhatsAppCanonicalExerciseReply` + CTA | 1 mensagem proativa | contrato central; não informar efeito na meta | `modules/healthIntegrations/strava/*.test.ts`, `whatsappImageIdempotencyWebhook.test.ts` | concluído (#787) |

### Imagem, áudio e multimodal (migração: #785)

| Fluxo | Entrada | Cadeia | Efeito de domínio | Builder/transporte atuais | Outbound atual | Resposta desejada | Testes existentes | Lacuna |
|---|---|---|---|---|---|---|---|---|
| Imagem de refeição | foto de prato | annotated webhook | 1 refeição + consolidação; mídia vinculada | resposta lógica central com texto e imagem auxiliar | read receipt + ack se lento + resposta | uma resposta lógica; falha da mídia não repete domínio | `whatsappAnnotatedImageWebhook.test.ts`, `annotatedImage.test.ts`, baseline | concluído (#785) |
| Imagem não reconhecida | foto ruim | webhook multimodal (`MealInferenceError`) | nenhum registro | `mediaReplyMessages` | resposta final; ack único se lento | erro central sem detalhe técnico | `whatsappAnnotatedImageWebhook.test.ts`, `processingAcknowledgement.test.ts` | concluído |
| Falha ao gerar/enviar anotada | idem imagem | annotated webhook | refeição já registrada; sem reexecução | resposta lógica central; falha gera evento operacional | resposta funcional, mídia auxiliar opcional | mídia opcional sem segunda resposta funcional | `whatsappAnnotatedImageWebhook.test.ts` | concluído (#785) |
| Áudio | áudio `comi 2 ovos` | base webhook: transcrição → intent ou nutricional | refeição/água/peso conforme transcrição | mesmos builders do texto | resposta final; ack único se lento | ação correspondente sem transcrição exibida | `whatsappWebhook.audioTranscription.test.ts`, `whatsappAudioHydrationWebhook.test.ts` | concluído (#785) |
| Falha de transcrição | áudio corrompido | base webhook | nenhum registro | erros centrais de mídia | 1 resposta | erro central | `whatsappWebhook.audioTranscription.test.ts` | — |
| Multimodal | imagem + áudio | base webhook | 1 refeição única | builders de refeição | 1 resposta lógica | uma resposta lógica | `whatsappWebhook.mediaIntent.test.ts` | — |

### IA estruturada, perguntas e sugestões (migração: #786)

| Fluxo | Entrada | Cadeia | Efeito de domínio | Builder/transporte atuais | Outbound atual | Resposta desejada | Testes existentes | Lacuna |
|---|---|---|---|---|---|---|---|---|
| Pergunta livre `/` | `/quanto posso jantar?` | gate de precedência → `aiQuestionAssistant` | nenhum registro | resposta gerada pela IA | 1 mensagem | continua iniciada por `/` | `aiQuestionRouting.test.ts`, `whatsappWebhook.aiQuestion.test.ts`, `messageRouter.test.ts` | exceção deliberada da #786 |
| Intent estruturada via LLM | `troque o queijo por ricota` | intent webhook → `llmIntentActions` → ações canônicas | ação executada 1x; ambiguidade cria seleção | builders centrais; saída da IA sem texto final | 1 mensagem ou pergunta interativa | formatadores centrais | `llmIntentActions.test.ts`, `intentValidation.test.ts`, `whatsappIntentWebhook.llm.test.ts`, `aiToolContract.test.ts` | concluído (#786) |
| Fallback nutricional com hint | texto ambíguo → `intentHint` | intent webhook repassa ao pipeline nutricional | 1 refeição | builders de refeição | 1 resposta | idem refeições | `whatsappIntentWebhook.llm.test.ts` | concluído (#786) |
| Sugestão de lanche | `sugestão de lanche` | intent/foodAssistant | nenhum registro | `buildWhatsAppSnackSuggestionReplyMessage` | 1 mensagem | não registrar automaticamente | `replyMessages.test.ts`, `foodAssistant.test.ts` | — |

### Onboarding, profissionais, segurança e erros (migração: #787)

| Fluxo | Entrada | Cadeia | Efeito de domínio | Builder/transporte atuais | Outbound atual | Resposta desejada | Testes existentes | Lacuna |
|---|---|---|---|---|---|---|---|---|
| Lead sem cadastro | telefone desconhecido | idempotency webhook | lead criado | builder central + CTA | 1 mensagem | contrato central | `whatsappImageIdempotencyWebhook.test.ts` | concluído (#787) |
| Boas-vindas pós-cadastro | conclusão web | `onboarding/webGreetingService` | nenhum | sequência central | 2 mensagens físicas em 1 lógica | sequência do contrato central | `modules/onboarding/*.test.ts` | concluído (#788) |
| Pedido de acesso profissional | profissional solicita acesso | `professionals/service` | pendência `professional_access` | botões `Autorizar`/`Recusar` | 1 mensagem proativa | decisão vinculada à pendência | `professionalPatientFlow.test.ts`, `whatsappAuthorization.test.ts`, `messageRouter.interactiveCallback.test.ts` | — |
| Decisão do paciente | botão ou texto | gate central ou intent webhook | decisão aplicada 1x | resposta central sanitizada | 1 mensagem | repetição não muda decisão consumida | `professionalPatientFlow.test.ts`, `messageRouter.interactiveCallback.test.ts` | matcher textual amplo fora do escopo |
| Conteúdo suspeito | prompt injection | guards em todos os entrypoints | nenhum registro | template central | 1 mensagem | erro sanitizado | `promptInjectionGuard.test.ts`, `whatsappWebhook.secret.test.ts` | concluído (#787) |
| Erro de processamento | exceção | catch dos wrappers | nenhum efeito adicional | erros centrais | 1 mensagem | sem detalhe técnico | `whatsappImageIdempotencyWebhook.failure.test.ts`, baseline | concluído (#787) |
| Canal errado | outro `phone_number_id` | base webhook | nenhum | silêncio | 0 | manter silêncio | `whatsappWebhook.secret.test.ts` | — |
| Telefone sem vínculo | número desconhecido | base webhook | nenhum | `Conta não identificada` | 1 mensagem | sanitizada | `whatsappWebhook.test.ts` | concluído (#787) |

### Contrato central e transporte

| Ponto | Situação atual | Ação da epic |
|---|---|---|
| `replyMessages.ts` / `replyTemplates.ts` / `domainReplyFormatters.ts` | contrato único: texto, botões, listas, CTA e mídia | concluído — #781 |
| `sendAndLogTextReply` | delega ao delivery lógico central | concluído — #781 |
| Builders locais | migrados; `architecture:check` bloqueia caminhos paralelos | concluído — #783–#788 |
| `whatsappPendingOperations` | confirmação genérica, seleção/confirmação de exclusão, período, autorização, seleção de item e `food_registration_clarification` da #855 | fonte única para texto/callback com texto original, candidato normalizado, classificação, ações, validação, expiração, `superseded` e CAS — #782/#783/#855/#856 |
| Acks e read receipts | read receipt separado; ack cancelável | no máximo 1 ack em processamento lento — #785 |

## Contratos da #756 e riscos para a tela de Relatórios

- A configuração "exercícios aumentam a meta" (#756) é aplicada no domínio (`shared/reportsGoalAnalytics.calculateAdjustedGoalCalories` consumido pelas telas e por `goalProgressService`).
- **Risco encerrado (#784)**: o WhatsApp recebe a meta efetiva do domínio e usa somente `Meta`; o gate de arquitetura proíbe `calculateAdjustedGoalCalories`, `Meta estimada` e `Meta ajustada` nos fluxos WhatsApp.
- A tela de Relatórios não é tocada por esta epic; mudanças em `shared/reportsGoalAnalytics` ficam fora de escopo.

## Evidências executáveis da baseline

| Contrato protegido | Evidência |
|---|---|
| Cadeia real do entrypoint, dedup entre instâncias, falha de envio sem reexecução | `server/whatsappPersistentContextWebhook.test.ts` |
| Quantidade e ordem física, ack separado, persistência e reentrega | `server/whatsappResponseBaseline.characterization.test.ts` |
| Lease persistente e `processedAt` | `messageLifecycle.processingClaim.test.ts`, `whatsappImageIdempotencyWebhook.failure.test.ts` |
| Callback/confirmação repetida não repete ação | `whatsappPendingOperationRepository.test.ts`, `deleteIntent.selection.test.ts`, `messageRouter.test.ts` |
| Callback opaco: isolamento, expiração, adulteração e corrida | `interactiveCallback.test.ts`, `messageRouter.interactiveCallback.test.ts`, `whatsappIntentWebhook.interactiveCallback.test.ts` |
| Gate destrutivo supera pendência incompatível real | `deleteIntent.issue856.test.ts`, `conversationContext.issue856.test.ts`, `service.issue856.pending.test.ts`, `messageRouter.test.ts` |
| Resposta inválida de exclusão permanece fail-closed | `deleteIntent.issue856.test.ts` |
| Refeições 0/1/N sem escolha silenciosa | `deleteIntent.issue856.test.ts` |
| Webhook HTTP, áudio transcrito e simulador não chamam fallback | `whatsappIntentWebhook.delete.test.ts`, `whatsappWebhook.audioTranscription.test.ts`, `service.issue856.pending.test.ts` |
| Isolamento entre usuários nas intents destrutivas | `deleteIntent.test.ts`, `learningSecurity.test.ts` |
| Clarificação alimentar preserva original/normalizado e rejeita `100 g` implícito | `foodClarification.test.ts`, `foodClarification.lifecycle.test.ts` |
| Gate alimentar preserva parsers especializados e bloqueia comando isolado | `foodClarificationGate.test.ts`, `standaloneCommandWords.test.ts` |
| Saída estruturada com comando operacional como alimento é inválida | `intentSchema.issue855.test.ts` |

## Ordem e dependências da migração

1. #781 depende da baseline.
2. #782 depende de #781 e reutiliza `whatsappPendingOperations`.
3. #783–#787 migram os fluxos por domínio.
4. #788 remove legados e adiciona checagem arquitetural.
5. #856 reforça a precedência destrutiva sem reabrir transporte ou cálculo nutricional.
6. #855 adiciona o contrato alimentar persistente consumível pela #858 e pela matriz end-to-end #860.

### Fechamento da auditoria da epic #779

- O relatório por período consome metas efetivas diárias do bundle canônico.
- A data lógica usa o timezone do perfil, com fallback documentado.
- Ambiguidades enumeráveis criam pendência e lista interativa, sem mutação antecipada.
- O onboarding composto retoma apenas mensagens ainda não entregues.
- Telefone sem conta vinculada recebe orientação sanitizada.
- Erros de imagem e áudio têm templates distintos; acknowledgement não entra no lifecycle funcional.
- `architecture:check` bloqueia transporte direto, payload bruto, builders locais, regra paralela de meta e texto final em contratos estruturados da IA.
