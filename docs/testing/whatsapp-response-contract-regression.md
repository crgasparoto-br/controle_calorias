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
3. `handleWhatsAppWebhookWithTextIntent` ([server/whatsappIntentWebhook.ts](../../server/whatsappIntentWebhook.ts)) — segurança, gate de precedência (`/` e pendência ativa), profissional, peso, água+alimento, exclusão, listagem, substituição contextual, gramas, intents textuais, LLM, assistente de alimentos, alimento desconhecido;
4. `handleWhatsAppWebhookWithAnnotatedImages` ([server/whatsappAnnotatedImageWebhook.ts](../../server/whatsappAnnotatedImageWebhook.ts)) — imagem: read receipt, acknowledgement, inferência, registro, consolidação, resposta funcional, imagem anotada;
5. `handleWhatsAppWebhook` ([server/whatsappWebhook.ts](../../server/whatsappWebhook.ts)) — fallback nutricional: áudio, multimodal, texto não tratado, água/peso legados, ações genéricas, erros.

Fronteiras de idempotência: `whatsappConversationMessages` + lease por `message.id` (`messageLifecycle.ts`), caches locais como fast-path, `whatsappPendingOperations` com consumo compare-and-set para seleção/confirmação.

## Transporte atual (Cloud API)

Todas as chamadas à Cloud API vivem em [server/modules/whatsapp/webhookUtils.ts](../../server/modules/whatsapp/webhookUtils.ts):

| Função | Tipo físico | Observações |
|---|---|---|
| `sendWhatsAppTextMessage` | `text` | transporte padrão |
| `sendWhatsAppInteractiveUrlButtonMessage` | `interactive` (cta_url) | CTA de edição rápida/onboarding/Strava; faz fallback para texto com URL anexada quando o envio interativo falha |
| `sendWhatsAppImageMessage` | `image` (por URL) | imagem anotada |
| `sendWhatsAppImageBufferMessage` | upload `/media` + `image` | fallback da imagem anotada |
| `markWhatsAppMessageAsRead` | status read | não é mensagem outbound |

Onboarding, profissionais e Strava montam `WhatsAppLogicalReply` e chamam `replyTransport`. Chamadas à Cloud API ficam restritas a `webhookUtils.ts`, `replyTransport.ts` e ao adaptador separado de acknowledgement; `architecture:check` protege essa fronteira.

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
| Exclusão de alimento | `apaga a banana` → botão `Confirmar` (ou texto `sim`) | precedence gate + `deleteIntent` + `interactiveCallback` + `whatsappPendingOperations` | exclusão só após confirmação; recarrega a refeição e mostra itens restantes; se era o último item, remove a refeição e responde com confirmação coerente (sem inventar refeição vazia) | ✅ migrado: `buildWhatsAppMealActionReplyMessage` com os itens restantes após recarregar via `listMeals` | 1 pergunta (botões) + 1 confirmação | mostrar itens restantes e totais atuais | `deleteIntent*.test.ts`, `deleteIntent.confirmation.test.ts`, `whatsappIntentWebhook.delete.test.ts`, `whatsappIntentWebhook.interactiveCallback.test.ts` | concluído |
| Exclusão de refeição | `exclua o almoço` → botão `Confirmar` (ou texto `sim`) | precedence gate + `deleteIntent` + `interactiveCallback` + `whatsappPendingOperations` | exclusão só após confirmação; consumo compare-and-set (botão ou texto resolvem a mesma pendência); não tenta renderizar o registro removido | botões `Confirmar`/`Cancelar` (issue #782) com fallback textual `sim`/`cancelar` mantido; confirmação final em texto simples (não há refeição para mostrar) | 1 pergunta (botões) + 1 confirmação | ✅ migrado (#782); confirmação de remoção não lista refeição inexistente | `deleteIntent*.test.ts`, `whatsappIntentWebhook.delete.test.ts`, `whatsappIntentWebhook.interactiveCallback.test.ts`, `messageRouter.interactiveCallback.test.ts` | concluído |
| Exclusão via legenda de imagem | foto com legenda `apague o almoço` | annotated webhook desvia para `deleteIntent` | nenhuma refeição criada da imagem | reply do deleteIntent (já migrado acima) | 1 resposta (ack cancelável só no caminho lento) | sem duplicidade, resposta central | `whatsappWebhook.mediaIntent.test.ts` | concluído (#785) |
| Exclusão via simulador (`simulateWhatsappInbound`) | `Excluir o Registrar` (alvo com nome igual a verbo de registro) | `simulateWhatsappInbound` chama `deleteIntent` antes de `datedFoodAdditionIntent`/`gramsAdjustmentIntent`/`gramsIncrementIntent`, replicando a precedência do webhook real | comando destrutivo nunca cai no fallback nutricional nem pede quantidade de alimento novo | mesmo executor canônico de `deleteIntent.ts` | 1 pergunta (seleção/confirmação) | corrige a divergência de ordenação entre pipeline do webhook e do simulador | `service.test.ts` (`localiza e propõe exclusão do item legado 'Registrar'...`) | concluído (#856) |
| Alimento ausente do catálogo / estimado pela IA | `1 bisnaguinha xpto` | intent webhook / fluxo de registro segue para estimativa da IA (sem pedir macros manualmente) | item estimado incluído na refeição e nos totais | ✅ migrado: `buildWhatsAppFoodLines` (`replyTemplates.ts`) inclui `WHATSAPP_ESTIMATED_NUTRITION_WARNING` ("⚠️ Valores nutricionais estimados pela IA.") logo abaixo de cada item com `source !== "catalog"`; itens de catálogo não recebem o aviso | 1 mensagem | seguir direto para estimativa da IA; aviso individual abaixo do item estimado; totais incluem o item estimado | `replyMessages.estimatedNutrition.test.ts`, `whatsappIntentWebhook.test.ts` (substituição com item estimado) | concluído |
| Link de edição rápida | refeição registrada/atualizada com CTA disponível | `buildWhatsAppMealReplyMessage`/`buildWhatsAppMealActionReplyMessage` anexam o CTA quando o link é gerado com sucesso | nenhum efeito de domínio adicional | CTA opaco (`sendWhatsAppInteractiveUrlButtonMessage`, #781) com fallback textual | mantido como estava | preservado; falha ao gerar não bloqueia a resposta nutricional (comportamento já existente, não alterado nesta issue) | testes de quick edit existentes (`replyMessages.*.test.ts`) | fora do escopo de alteração — apenas verificado, integração já central desde #781 |

### Resumos, metas, água, peso e exercícios (migração: #784)

| Fluxo | Entrada | Cadeia | Efeito de domínio | Builder/transporte atuais | Outbound atual | Resposta desejada | Testes existentes | Lacuna |
|---|---|---|---|---|---|---|---|---|
| Resumo/relatório de período | `resumo de hoje` | intent webhook → bundle canônico de relatórios | nenhum (consulta) | builder central recebe a meta efetiva do domínio | 1 mensagem | somente `Meta`, diferença `consumo - meta`, macros `P`/`C`/`G` com `•` | `whatsappIntentWebhook.test.ts`, `replyMessages.test.ts` | concluído (#784) |
| Clarificação de período pendente | `resumo` → lista `Hoje`/`Ontem`/`Esta semana`/`Este mês` (ou texto `ontem`) | pendência `period_report_clarification` em `whatsappPendingOperations` resolvida pelo gate central (`periodReportClarification.ts`) | nenhum | lista interativa com callback opaco; fallback textual resolve a mesma pendência pelo mesmo serviço | 1 pergunta (lista) + 1 resposta | lista/botões de período (#782) | `periodReportClarification.test.ts`, `whatsappIntentWebhook.test.ts` | concluído (#782/#784) |
| Água por texto | `300 ml de água` | intent webhook → `executeWhatsappTextIntent` | 1 water log | formatter canônico com quantidade, total, meta e data no timezone do perfil | 1 resposta funcional | diferença `consumo - meta`; ausência de meta é explícita | `waterFoodText.test.ts`, `userMeasurementReplyContext.test.ts`, baseline | concluído |
| Água + alimento na mesma mensagem | `300ml água\n1 pão` | intent webhook divide (`splitWhatsAppWaterAndFoodText`) e repassa alimento | água 1x + refeição 1x | blocos centrais compostos antes do envio final | 1 resposta funcional consolidada | uma sequência coordenada do contrato central | `whatsappIntentWebhook.test.ts`, `waterFoodText.test.ts` | concluído (#785) |
| Água por texto no fallback base | água detectada no webhook base | base webhook (`detectWaterLogFromMessage`) | 1 water log | formatter canônico e delivery lógico central | 1 resposta funcional | mesmo contrato do intent, sem builder paralelo | `whatsappWebhook.test.ts` | concluído |
| Peso por texto | `pesei 82,5 kg` | intent/base webhook → `ensureWhatsAppWeightEntry` | peso persistido no máximo 1x | formatter canônico recebe variação do registro anterior e timezone do perfil | 1 resposta funcional | variação neutra; primeiro registro explícito | `weightIdempotency.test.ts`, `userMeasurementReplyContext.test.ts`, `whatsappWebhook.test.ts` | concluído |
| Peso sem valor | `quero registrar meu peso` | intent webhook | nenhum registro | clarificação sanitizada | 1 mensagem | nenhuma mutação sem valor válido | baseline | concluído |
| Imagem de água com legenda | foto + legenda `500 ml de água` | idempotency webhook (`handleWaterImageMessage`) | 1 water log (ou clarificação sem registro) | formatter canônico de água; clarificação central | 1 resposta funcional | mesmo formato de texto e timezone do perfil | `whatsappWebhook.image.water.test.ts` | concluído |
| Notificação de exercício (Strava) | activity webhook Strava | `strava/exercises.ts` | exercício upserted (idempotente por `strava:<id>`); reimportação não duplica calorias no contexto de meta (`goalProgressContext.ts`) | ✅ migrado: `buildWhatsAppCanonicalExerciseReply` + CTA `Ver exercício` via `replyTransport` | 1 mensagem proativa | contrato central; não informar efeito na meta (#756) | `modules/healthIntegrations/strava/*.test.ts`, `whatsappImageIdempotencyWebhook.test.ts` | concluído (#787) |

### Imagem, áudio e multimodal (migração: #785)

| Fluxo | Entrada | Cadeia | Efeito de domínio | Builder/transporte atuais | Outbound atual | Resposta desejada | Testes existentes | Lacuna |
|---|---|---|---|---|---|---|---|---|
| Imagem de refeição | foto de prato | annotated webhook | 1 refeição + consolidação; mídia vinculada | resposta lógica central com texto primário e imagem auxiliar | read receipt + ack apenas se lento + resposta funcional | uma resposta lógica; falha da mídia não repete domínio | `whatsappAnnotatedImageWebhook.test.ts`, `annotatedImage.test.ts`, baseline | concluído (#785) |
| Imagem não reconhecida | foto ruim | webhook multimodal (`MealInferenceError`) | nenhum registro | `mediaReplyMessages` | somente resposta final no fast path; ack único se lento | erro central sem detalhe técnico | `whatsappAnnotatedImageWebhook.test.ts`, `processingAcknowledgement.test.ts` | concluído |
| Falha ao gerar/enviar anotada | idem imagem | annotated webhook | refeição já registrada; sem re-execução | resposta lógica central; falha da anotada gera somente evento operacional (`whatsapp.annotated_image_skipped`/`_reply_failed`) | resposta funcional (+ mídia auxiliar quando disponível), sem outbound extra | mídia auxiliar opcional, sem segunda resposta funcional | `whatsappAnnotatedImageWebhook.test.ts` | concluído (#785) |
| Áudio | áudio "comi 2 ovos" | base webhook (transcrição → intent ou nutricional) | refeição/água/peso conforme transcrição | mesmos builders do texto e erros centrais de áudio | resposta final; ack único apenas no caminho lento | resposta final da ação correspondente, sem transcrição exibida | `whatsappWebhook.audioTranscription.test.ts`, `whatsappAudioHydrationWebhook.test.ts` | concluído (#785) |
| Falha de transcrição | áudio corrompido | base webhook | nenhum registro | erros centrais de mídia (`mediaReplyMessages.ts`) | 1 resposta (ack só no caminho lento) | erro central | `whatsappWebhook.audioTranscription.test.ts` | — |
| Multimodal (imagem+áudio) | imagem + áudio | base webhook | 1 refeição única | builders de refeição | 1 resposta lógica (texto + anotada; ack só no caminho lento) | uma resposta lógica; legenda não gera segunda resposta | `whatsappWebhook.mediaIntent.test.ts` | — |

### IA estruturada, perguntas e sugestões (migração: #786)

| Fluxo | Entrada | Cadeia | Efeito de domínio | Builder/transporte atuais | Outbound atual | Resposta desejada | Testes existentes | Lacuna |
|---|---|---|---|---|---|---|---|---|
| Pergunta livre `/` | `/quanto posso jantar?` | gate de precedência (`messageRouter` → `aiQuestionAssistant`) em todos os entrypoints | nenhum registro | resposta gerada pela IA (texto livre) | 1 mensagem | continua iniciada por `/`; transporte central | `aiQuestionRouting.test.ts`, `whatsappWebhook.aiQuestion.test.ts`, `messageRouter.test.ts` | exceção deliberada da #786: resposta conversacional de `/` passa pelo contrato outbound central e não muta dados |
| Intent estruturada via LLM | `troque o queijo por ricota` | intent webhook → `llmIntentActions` → ações canônicas | ação executada 1x; substituição/ajuste claros executam direto; ambiguidade cria seleção persistente (`meal_item_selection`) | ✅ migrado: builders centrais (`buildWhatsAppMealActionReplyMessage` etc.); saída da IA não contém texto final | 1 mensagem (ou pergunta interativa em ambiguidade) | respostas estruturadas usam formatadores centrais | `llmIntentActions.test.ts`, `intentValidation.test.ts`, `whatsappIntentWebhook.llm.test.ts`, `aiToolContract.test.ts` | concluído (#786) |
| Fallback nutricional com hint | texto ambíguo → `intentHint` | intent webhook repassa `passthroughText`+hint ao pipeline de imagem/nutricional | 1 refeição | builders de refeição | 1 resposta (sem resposta dupla do classificador) | idem refeições | `whatsappIntentWebhook.llm.test.ts` | concluído (#786) |
| Sugestão de lanche | `sugestão de lanche` | intent/foodAssistant | nenhum registro automático | `buildWhatsAppSnackSuggestionReplyMessage` | 1 mensagem | sugestões não registram alimentos | `replyMessages.test.ts`, `foodAssistant.test.ts` | — |

### Onboarding, profissionais, segurança e erros (migração: #787)

| Fluxo | Entrada | Cadeia | Efeito de domínio | Builder/transporte atuais | Outbound atual | Resposta desejada | Testes existentes | Lacuna |
|---|---|---|---|---|---|---|---|---|
| Lead sem cadastro | mensagem de telefone desconhecido | idempotency webhook (`handleOnboardingLeadMessage`) | lead criado | ✅ migrado: `buildWhatsAppOnboardingLeadReplyMessage` central + CTA `Finalizar cadastro` pelo delivery lógico | 1 mensagem | contrato central com CTA de cadastro; a sequência de duas mensagens com `/` ocorre no pós-cadastro (`webGreetingService`) | `whatsappImageIdempotencyWebhook.test.ts` | concluído (#787); sem lifecycle por não existir usuário vinculado (registrado) |
| Boas-vindas pós-cadastro (web) | conclusão de cadastro no site | `onboarding/webGreetingService` | nenhum | sequência central de duas mensagens, incluindo orientação sobre `/` | 2 mensagens físicas em 1 resposta lógica proativa | sequência do contrato central | `modules/onboarding/*.test.ts` | concluído (#788) |
| Pedido de acesso profissional | profissional solicita acesso (web) | `professionals/service` notifica paciente | pendência de autorização criada em `whatsappPendingOperations` (`type: professional_access`) além do registro próprio de acesso | botões `Autorizar`/`Recusar` (issue #782) com texto `AUTORIZAR/NEGAR <código>` mantido como fallback no corpo da mensagem | 1 mensagem proativa | ✅ migrado (#782) | `professionalPatientFlow.test.ts`, `whatsappAuthorization.test.ts`, `messageRouter.interactiveCallback.test.ts` | — |
| Decisão do paciente | botão `Autorizar`/`Recusar` (ou texto `autorizo`/`nego`) | gate central (`interactiveCallback` → `completeWhatsAppProfessionalAccessCallback`) ou intent webhook (`looksLikeProfessionalAccessDecision`) | autorização aplicada 1x; repetição (botão ou texto) não muda decisão já consumida, pois `access.status` deixa de ser `"pending"` | resposta central sanitizada; IDs internos nunca aparecem no callback opaco | 1 mensagem | ✅ migrado (#782) para o caminho por botão; matcher textual amplo do fallback continua sem alteração | `professionalPatientFlow.test.ts`, `messageRouter.interactiveCallback.test.ts` | matcher textual amplo do fallback ainda pode capturar outros textos (não migrado, fora do escopo da #782) |
| Conteúdo suspeito | prompt injection | guards em intent/annotated/base | nenhum registro | `buildSuspiciousWhatsAppContentReply` | 1 mensagem | erro de segurança central, sem detalhe técnico | `promptInjectionGuard.test.ts`, `whatsappWebhook.secret.test.ts` | concluído (#787): template central único enviado pelo delivery lógico em todos os entrypoints |
| Erro de processamento | exceção na cadeia | catch de cada wrapper | nenhum efeito adicional; `processedAt` finaliza | erros centrais (`mediaReplyMessages`/`buildWhatsAppRecoverableErrorReplyMessage`), preservando clarificação de domínio quando existir | 1 mensagem | erro central sem detalhe técnico | `whatsappImageIdempotencyWebhook.failure.test.ts`, `whatsappWebhook.quantityExpressionClarification.test.ts`, baseline | concluído (#787) |
| Canal errado (outro `phone_number_id`) | mensagem fora do canal oficial | base webhook | nenhum | sem resposta (log) | 0 mensagens | manter silêncio | `whatsappWebhook.secret.test.ts` | — |
| Telefone sem vínculo no canal oficial | número desconhecido sem lead tratado | base webhook | nenhum | template central `Conta não identificada` (#787) | 1 mensagem | mensagem de segurança sanitizada | `whatsappWebhook.test.ts` | concluído (#787) |

### Contrato central e transporte (migração: #781 e #782; remoção de legados: #788)

| Ponto | Situação atual | Ação da epic |
|---|---|---|
| `replyMessages.ts` / `replyTemplates.ts` / `domainReplyFormatters.ts` | ✅ contrato único: texto, botões, listas, CTA e mídia (`replyContract.ts` + `replyTransport.ts`) | concluído — #781 |
| `sendAndLogTextReply` (intent webhook) | ✅ delega ao delivery lógico central (`sendWhatsAppLogicalDomainReply`) integrado ao lifecycle | concluído — #781 |
| Builders locais (intent webhook, base webhook, idempotency webhook, `webhookTextCommands`, integrações) | ✅ migrados para os formatters canônicos; `architecture:check` (`scripts/whatsapp-response-architecture.ts`) bloqueia novos caminhos paralelos | concluído — #783–#788 |
| `whatsappPendingOperations` | confirmação genérica, seleção/confirmação de exclusão, clarificação de período, autorização profissional (`professional_access`), seleção ambígua de item para ajuste de gramas/substituição (`meal_item_selection`, #783) | ✅ reutilizada para botões/listas/callbacks com validação de usuário, expiração e consumo idempotente via `interactiveCallback.ts` — #782 e #783; sem store paralelo |
| Acks e read receipts | read receipt separado; ack cancelável e nunca gravado como resposta funcional | no máximo 1 ack em processamento lento; nenhum no caminho rápido — concluído #785 |

## Contratos da #756 e riscos para a tela de Relatórios

- A configuração "exercícios aumentam a meta" (#756) é aplicada no domínio (`shared/reportsGoalAnalytics.calculateAdjustedGoalCalories` consumido pelas telas e por `goalProgressService`).
- **Risco encerrado (#784)**: o WhatsApp recebe a meta efetiva do domínio e usa somente `Meta`; o gate de arquitetura proíbe `calculateAdjustedGoalCalories`, `Meta estimada` e `Meta ajustada` nos fluxos WhatsApp.
- A tela de Relatórios (`client/`, `goals-and-reports.md`) não é tocada por esta epic; qualquer mudança em `shared/reportsGoalAnalytics` está fora de escopo das subissues de resposta.
- Critério de regressão: nenhum formatter/handler do WhatsApp pode passar a executar `calculateAdjustedGoalCalories` ou regra equivalente após a #784; a #788 adiciona proteção arquitetural para isso.

## Evidências executáveis da baseline

| Contrato protegido | Evidência |
|---|---|
| Cadeia real do entrypoint, dedup entre instâncias, falha de envio sem re-execução | `server/whatsappPersistentContextWebhook.test.ts` |
| Quantidade e ordem física por fluxo; ack separado da resposta funcional; resposta funcional gravada 1x; falha de envio não grava outbound nem repete domínio; solicitação informativa não cria registro; reentrega não repete efeitos | `server/whatsappResponseBaseline.characterization.test.ts` |
| Lease persistente e `processedAt` só no escopo bem-sucedido | `server/modules/whatsapp/messageLifecycle.processingClaim.test.ts`, `server/whatsappImageIdempotencyWebhook.failure.test.ts` |
| Callback/confirmação repetida não repete ação (compare-and-set) | `server/repositories/whatsappPendingOperationRepository.test.ts`, `server/modules/whatsapp/deleteIntent.selection.test.ts`, `server/modules/whatsapp/messageRouter.test.ts` |
| Callback de botão/lista opaco: isolamento entre usuários, expiração, adulteração, corrida e reentrega (#782) | `server/modules/whatsapp/interactiveCallback.test.ts`, `server/modules/whatsapp/messageRouter.interactiveCallback.test.ts`, `server/whatsappIntentWebhook.interactiveCallback.test.ts` |
| Wrappers não desviam para fallback nutricional após tratar intenção | `server/whatsappIntentWebhook.test.ts`, `server/whatsappIntentWebhook.llm.test.ts` |
| Isolamento entre usuários nas intents destrutivas | `server/modules/whatsapp/deleteIntent.test.ts`, `server/modules/whatsapp/learningSecurity.test.ts` |
| Builders centrais atuais (formato legado, será substituído) | `server/modules/whatsapp/replyMessages.*.test.ts`, `server/modules/whatsapp/replyTemplates.test.ts` |

## Ordem e dependências da migração

1. #781 depende só desta baseline (contrato/transporte tocam `sendAndLogTextReply` e os pontos de envio inventariados acima).
2. #782 depende de #781 (botões/listas precisam do contrato) e reutiliza `whatsappPendingOperations`.
3. #783–#787 migram os fluxos por domínio na ordem da epic; cada uma remove os builders locais do seu domínio, mantendo adapters até #788.
4. #788 remove legados e adiciona checagem arquitetural (nenhum `fetch` à Cloud API fora do transporte central; nenhum `calculateAdjustedGoalCalories` em formatters do WhatsApp).

Riscos que orientam a ordem: o resumo de período (regra #756 duplicada) e os builders duplicados de água/peso são os pontos com maior chance de regressão silenciosa; ambos ficam protegidos por caracterização antes de #784.


### Fechamento da auditoria da epic #779

- O relatório por período consome metas efetivas diárias do bundle canônico. Falha ou ausência de um valor não é convertida em zero nem em `meta atual × dias`.
- A data lógica de meta, água, peso, consultas e intenções estruturadas usa o timezone do perfil, com fallback documentado para `America/Sao_Paulo`.
- Ambiguidades enumeráveis da IA criam `whatsappPendingOperations` e lista interativa, preservando refeição, índice do item e ação; nenhuma mutação ocorre antes da seleção.
- O onboarding em duas mensagens persiste quantas partes foram entregues e retoma somente as partes pendentes após falha parcial.
- Telefone sem conta vinculada recebe orientação sanitizada pelo delivery central.
- Erros de imagem e áudio têm templates distintos; acknowledgement é cancelável, não entra no lifecycle funcional e não é enviado no caminho rápido.
- `architecture:check` bloqueia transporte direto, payload bruto, builders locais, nomenclatura legada, regra paralela de meta e texto final em contratos estruturados da IA.
