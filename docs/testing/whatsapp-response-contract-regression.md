# Matriz de regressão do contrato de respostas do WhatsApp

Issue: #780 (baseline da epic #779). Esta matriz inventaria todos os pontos que produzem ou enviam respostas pelo WhatsApp antes da migração para o contrato único de resposta, e associa cada fluxo à subissue responsável pela migração (#781–#788).

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

Integrações fora do módulo chamam essas mesmas funções: `server/modules/onboarding/webGreetingService.ts`, `server/modules/professionals/service.ts`, `server/modules/healthIntegrations/strava/exercises.ts`. Não há outra chamada direta a `graph.facebook.com` fora de `webhookUtils.ts`.

`simulateWhatsappInbound` ([server/modules/whatsapp/service.ts](../../server/modules/whatsapp/service.ts), via tRPC) percorre a cadeia de intents e **retorna** `reply` para o chamador web — não envia pela Cloud API.

## Inventário de fluxos

Colunas: entrada representativa → entrypoint/wrappers → efeito de domínio → builder/transporte atuais → composição outbound atual → resposta desejada (#779) → testes existentes → lacuna → subissue.

### Refeições e ações sobre alimentos (migração: #783)

**Status: migrado.** Todos os fluxos de refeição/alimento abaixo reutilizam os mesmos blocos centrais de item e total de `replyTemplates.ts` (`buildWhatsAppFoodLines`/`buildWhatsAppMealTotalLines`) via `buildWhatsAppMealActionReplyMessage`/`buildWhatsAppConsolidatedMealReplyMessage` (`replyMessages.ts`), recarregando sempre o estado atual da refeição (`listMeals`/`updateMeal`/`removeMeal`) antes de responder. Nenhuma mudança em seleção temporal, consolidação, catálogo, cálculo nutricional, persistência ou na regra de meta ajustada da #756.

| Fluxo | Entrada | Cadeia | Efeito de domínio | Builder/transporte atuais | Outbound atual | Resposta desejada | Testes existentes | Lacuna |
|---|---|---|---|---|---|---|---|---|
| Registro por texto (fallback nutricional) | `100g arroz branco` | idempotency → intent (não trata) → annotated (sem imagem) → base | 1 refeição criada + consolidação | `buildWhatsAppMealReplyMessage`/`buildWhatsAppConsolidatedMealReplyMessage` (blocos centrais desde #781) + botão quick edit | ack de texto + 1 resposta funcional | padrão único de refeição, sem ack no caminho rápido | `whatsappWebhook.test.ts`, `whatsappPersistentContextWebhook.test.ts` | ordem/quantidade física e ack fora do lifecycle — coberto pela baseline (fora do escopo da #783) |
| Adição a refeição existente (intent) | `adiciona 1 banana no almoço` | intent webhook (`datedFoodAdditionIntent` → `executeWhatsappTextIntent`) | item adicionado 1x, refeição recarregada | ✅ migrado: `buildWhatsAppMealActionReplyMessage` (mesmo bloco do registro); `buildMealFullSummary` local removido de `whatsappIntentWebhook.ts` (duplicava a resposta) | 1 mensagem | repetir todos os itens e totais no formato central | `datedFoodAdditionIntent.test.ts`, `whatsappIntentWebhook.test.ts` | concluído |
| Listagem de refeição | `o que registrei no almoço?` | intent webhook (`mealListIntent`) | nenhum (consulta ao banco) | ✅ migrado: `mealListIntent.ts` usa `buildWhatsAppFoodLines`/`buildWhatsAppMealTotalLines` (mesmo bloco do registro) | 1 mensagem | mesmo padrão visual do registro | `mealListIntent.test.ts`, `whatsappIntentWebhook.mealList.test.ts` | concluído |
| Substituição contextual | `não era arroz, era batata` | intent webhook (`contextualFoodReplacementIntent`) | substituição aplicada direto (sem confirmação), refeição(ões) recarregada(s) | ✅ migrado: `buildWhatsAppMealActionReplyMessage` por refeição afetada (builders locais `formatMealSummary`/`formatTotalsLine` removidos) | 1 mensagem (ou 1 bloco por refeição quando a substituição atinge mais de uma) | aplicar direto + repetir itens/totais | `contextualFoodReplacementIntent.test.ts`, `whatsappIntentWebhook.test.ts` | concluído |
| Ajuste de gramas/quantidade | `muda o arroz para 150g` | intent webhook (`gramsAdjustmentIntent`/`gramsIncrementIntent`) | update no registro correto, refeição recarregada | ✅ já usava `buildWhatsAppMealActionReplyMessage` (bloco central) | 1 mensagem | aplicar direto + repetir itens/totais | `gramsAdjustmentIntent*.test.ts`, `gramsIncrementIntent.test.ts` | concluído |
| Exclusão de alimento | `apaga a banana` → botão `Confirmar` (ou texto `sim`) | precedence gate + `deleteIntent` + `interactiveCallback` + `whatsappPendingOperations` | exclusão só após confirmação; recarrega a refeição e mostra itens restantes; se era o último item, remove a refeição e responde com confirmação coerente (sem inventar refeição vazia) | ✅ migrado: `buildWhatsAppMealActionReplyMessage` com os itens restantes após recarregar via `listMeals` | 1 pergunta (botões) + 1 confirmação | mostrar itens restantes e totais atuais | `deleteIntent*.test.ts`, `deleteIntent.confirmation.test.ts`, `whatsappIntentWebhook.delete.test.ts`, `whatsappIntentWebhook.interactiveCallback.test.ts` | concluído |
| Exclusão de refeição | `exclua o almoço` → botão `Confirmar` (ou texto `sim`) | precedence gate + `deleteIntent` + `interactiveCallback` + `whatsappPendingOperations` | exclusão só após confirmação; consumo compare-and-set (botão ou texto resolvem a mesma pendência); não tenta renderizar o registro removido | botões `Confirmar`/`Cancelar` (issue #782) com fallback textual `sim`/`cancelar` mantido; confirmação final em texto simples (não há refeição para mostrar) | 1 pergunta (botões) + 1 confirmação | ✅ migrado (#782); confirmação de remoção não lista refeição inexistente | `deleteIntent*.test.ts`, `whatsappIntentWebhook.delete.test.ts`, `whatsappIntentWebhook.interactiveCallback.test.ts`, `messageRouter.interactiveCallback.test.ts` | concluído |
| Exclusão via legenda de imagem | foto com legenda `apague o almoço` | annotated webhook desvia para `deleteIntent` | nenhuma refeição criada da imagem | reply do deleteIntent (já migrado acima) | ack + 1 resposta | sem duplicidade, resposta central | `whatsappWebhook.mediaIntent.test.ts` | ack antes de desvio de intenção — fora do escopo da #783 (tratado na #785) |
| Alimento ausente do catálogo / estimado pela IA | `1 bisnaguinha xpto` | intent webhook / fluxo de registro segue para estimativa da IA (sem pedir macros manualmente) | item estimado incluído na refeição e nos totais | ✅ migrado: `buildWhatsAppFoodLines` (`replyTemplates.ts`) inclui `WHATSAPP_ESTIMATED_NUTRITION_WARNING` ("⚠️ Valores nutricionais estimados pela IA.") logo abaixo de cada item com `source !== "catalog"`; itens de catálogo não recebem o aviso | 1 mensagem | seguir direto para estimativa da IA; aviso individual abaixo do item estimado; totais incluem o item estimado | `replyMessages.estimatedNutrition.test.ts`, `whatsappIntentWebhook.test.ts` (substituição com item estimado) | concluído |
| Link de edição rápida | refeição registrada/atualizada com CTA disponível | `buildWhatsAppMealReplyMessage`/`buildWhatsAppMealActionReplyMessage` anexam o CTA quando o link é gerado com sucesso | nenhum efeito de domínio adicional | CTA opaco (`sendWhatsAppInteractiveUrlButtonMessage`, #781) com fallback textual | mantido como estava | preservado; falha ao gerar não bloqueia a resposta nutricional (comportamento já existente, não alterado nesta issue) | testes de quick edit existentes (`replyMessages.*.test.ts`) | fora do escopo de alteração — apenas verificado, integração já central desde #781 |

### Resumos, metas, água, peso e exercícios (migração: #784)

| Fluxo | Entrada | Cadeia | Efeito de domínio | Builder/transporte atuais | Outbound atual | Resposta desejada | Testes existentes | Lacuna |
|---|---|---|---|---|---|---|---|---|
| Resumo/relatório de período | `resumo de hoje` | intent webhook → `buildExerciseAwarePeriodReportReply` (builder local) | nenhum (consulta) | builder local com `Meta estimada`/`Meta ajustada` e **chamada própria a `calculateAdjustedGoalCalories`** | 1 mensagem | somente `Meta`, diferença `consumo - meta`, macros `P`/`C`/`G` com `•`; meta final vem do domínio (#756) | `whatsappIntentWebhook.test.ts` (parcial) | **risco #756**: regra da meta duplicada no webhook; formato legado congela `Meta estimada/ajustada` |
| Clarificação de período pendente | `resumo` → `ontem` | pendência `period_report_clarification` em `whatsappPendingOperations` | nenhum | texto de clarificação | 1 + 1 mensagens | lista/botões de período (#782) | `whatsappIntentWebhook.test.ts` | pendência textual |
| Água por texto | `300 ml de água` | intent webhook → `executeWhatsappTextIntent` (water_logged) | 1 water log | reply do intent (`replyMessages.buildWhatsAppWaterLoggedReplyMessage` ou texto do intent) | 1 mensagem | diferença em relação à meta de água | `waterFoodText.test.ts`, baseline | formato sem meta |
| Água + alimento na mesma mensagem | `300ml água\n1 pão` | intent webhook divide (`splitWhatsAppWaterAndFoodText`) e repassa alimento | água 1x + refeição 1x | `buildMixedWaterReply` local + resposta da refeição | 2 respostas funcionais (água e refeição) | uma sequência coordenada do contrato central | `whatsappIntentWebhook.test.ts`, `waterFoodText.test.ts` | duas respostas lógicas para uma entrada |
| Água por texto no fallback base | água detectada só no webhook base | base webhook (`detectWaterLogFromMessage`) | 1 water log | `webhookTextCommands.buildWaterLogReply` | ack + 1 resposta | caminho único (intent), formato central | `whatsappWebhook.test.ts` | builder duplicado de água |
| Peso por texto | `pesei 82,5 kg` | intent webhook (`detectWeightLogFromText`) | peso atualizado 1x | builder local `buildWeightLogReply` (duplicado no base webhook) | 1 mensagem | variação sem juízo de valor, formato central | baseline; `whatsappWebhook.test.ts` | builders duplicados; sem variação |
| Peso sem valor | `quero registrar meu peso` | intent webhook | nenhum registro | texto local de clarificação | 1 mensagem | clarificação central | baseline | builder local |
| Imagem de água com legenda | foto + legenda `500 ml de água` | idempotency webhook (`handleWaterImageMessage`) | 1 water log (ou clarificação sem registro) | builders locais no idempotency webhook | 1 mensagem, sem ack | formato central de água | `whatsappWebhook.image.water.test.ts` | builder local fora do módulo |
| Notificação de exercício (Strava) | activity webhook Strava | `strava/exercises.ts` | exercício upserted (idempotente por `strava:<id>`) | texto local + botão `Ver exercício` | 1 mensagem proativa | contrato central; não informar efeito na meta (#756) | `modules/healthIntegrations/strava/*.test.ts`, `docs/strava-exercise-idempotency.md` | builder local; texto pode citar meta |

### Imagem, áudio e multimodal (migração: #785)

| Fluxo | Entrada | Cadeia | Efeito de domínio | Builder/transporte atuais | Outbound atual | Resposta desejada | Testes existentes | Lacuna |
|---|---|---|---|---|---|---|---|---|
| Imagem de refeição | foto de prato | annotated webhook | 1 refeição + consolidação; mídia vinculada | `buildWhatsAppMealReplyMessage`/consolidado + quick edit; `sendWhatsAppImageMessage`/buffer para anotada | read receipt + ack + resposta funcional + imagem anotada (ou fallback textual) | uma resposta lógica: texto final + mídia auxiliar; ack apenas em processamento lento | `whatsappAnnotatedImageWebhook.test.ts`, `annotatedImage.test.ts`, baseline | ordem física e ack fora do lifecycle — coberto pela baseline |
| Imagem não reconhecida | foto ruim | annotated webhook (`MealInferenceError`) | nenhum registro | texto local | ack + 1 resposta | erro central sem detalhe técnico | `whatsappAnnotatedImageWebhook.test.ts` | builder local |
| Falha ao gerar/enviar anotada | idem imagem | annotated webhook | refeição já registrada; sem re-execução | textos locais `ANNOTATED_IMAGE_*` | ack + resposta funcional + fallback textual da anotada | mídia auxiliar opcional, sem segunda resposta funcional | `whatsappAnnotatedImageWebhook.test.ts` | fallback textual da anotada é gravado como outbound extra |
| Áudio | áudio "comi 2 ovos" | base webhook (transcrição → intent ou nutricional) | refeição/água/peso conforme transcrição | mesmos builders do texto | ack + 1 resposta funcional (sem transcrição exibida) | resposta final da ação correspondente | `whatsappWebhook.audioTranscription.test.ts`, `whatsappAudioHydrationWebhook.test.ts` | ack obrigatório mesmo no caminho rápido |
| Falha de transcrição | áudio corrompido | base webhook | nenhum registro | `buildWhatsAppAudioTranscriptionFailureReplyMessage` | ack + 1 resposta | erro central | `whatsappWebhook.audioTranscription.test.ts` | — |
| Multimodal (imagem+áudio) | imagem + áudio | base webhook | 1 refeição única | builders de refeição | ack + resposta + anotada | uma resposta lógica; legenda não gera segunda resposta | `whatsappWebhook.mediaIntent.test.ts` | — |

### IA estruturada, perguntas e sugestões (migração: #786)

| Fluxo | Entrada | Cadeia | Efeito de domínio | Builder/transporte atuais | Outbound atual | Resposta desejada | Testes existentes | Lacuna |
|---|---|---|---|---|---|---|---|---|
| Pergunta livre `/` | `/quanto posso jantar?` | gate de precedência (`messageRouter` → `aiQuestionAssistant`) em todos os entrypoints | nenhum registro | resposta gerada pela IA (texto livre) | 1 mensagem | continua iniciada por `/`; transporte central | `aiQuestionRouting.test.ts`, `whatsappWebhook.aiQuestion.test.ts`, `messageRouter.test.ts` | prompt pode produzir texto final fora dos formatadores |
| Intent estruturada via LLM | `tira o pão do café` (ambíguo) | intent webhook → `llmIntentActions` → ações canônicas | ação executada 1x pelos mesmos executores | replies dos executores + textos do próprio módulo LLM | 1 mensagem | respostas estruturadas usam formatadores centrais | `llmIntentActions.test.ts`, `whatsappIntentWebhook.llm.test.ts`, `aiToolContract.test.ts` | textos paralelos no módulo LLM |
| Fallback nutricional com hint | texto ambíguo → `intentHint` | intent webhook repassa `passthroughText`+hint ao pipeline de imagem/nutricional | 1 refeição | builders de refeição | 1 resposta (sem resposta dupla do classificador) | idem refeições | `whatsappIntentWebhook.llm.test.ts` | wrapper não pode desviar após tratar intenção |
| Sugestão de lanche | `sugestão de lanche` | intent/foodAssistant | nenhum registro automático | `buildWhatsAppSnackSuggestionReplyMessage` | 1 mensagem | sugestões não registram alimentos | `replyMessages.test.ts`, `foodAssistant.test.ts` | — |

### Onboarding, profissionais, segurança e erros (migração: #787)

| Fluxo | Entrada | Cadeia | Efeito de domínio | Builder/transporte atuais | Outbound atual | Resposta desejada | Testes existentes | Lacuna |
|---|---|---|---|---|---|---|---|---|
| Lead sem cadastro | mensagem de telefone desconhecido | idempotency webhook (`handleOnboardingLeadMessage`) | lead criado | texto local + botão `Finalizar cadastro` (fallback texto+URL) | 1 mensagem | onboarding em duas mensagens, informar `/`; contrato central | `whatsappImageIdempotencyWebhook.test.ts` | fora do lifecycle (sem usuário); builder local |
| Boas-vindas pós-cadastro (web) | conclusão de cadastro no site | `onboarding/webGreetingService` (2 envios) | nenhum | textos locais | 2 mensagens proativas | sequência do contrato central | `modules/onboarding/*.test.ts` | builder local |
| Pedido de acesso profissional | profissional solicita acesso (web) | `professionals/service` notifica paciente | pendência de autorização criada em `whatsappPendingOperations` (`type: professional_access`) além do registro próprio de acesso | botões `Autorizar`/`Recusar` (issue #782) com texto `AUTORIZAR/NEGAR <código>` mantido como fallback no corpo da mensagem | 1 mensagem proativa | ✅ migrado (#782) | `professionalPatientFlow.test.ts`, `whatsappAuthorization.test.ts`, `messageRouter.interactiveCallback.test.ts` | — |
| Decisão do paciente | botão `Autorizar`/`Recusar` (ou texto `autorizo`/`nego`) | gate central (`interactiveCallback` → `completeWhatsAppProfessionalAccessCallback`) ou intent webhook (`looksLikeProfessionalAccessDecision`) | autorização aplicada 1x; repetição (botão ou texto) não muda decisão já consumida, pois `access.status` deixa de ser `"pending"` | resposta central sanitizada; IDs internos nunca aparecem no callback opaco | 1 mensagem | ✅ migrado (#782) para o caminho por botão; matcher textual amplo do fallback continua sem alteração | `professionalPatientFlow.test.ts`, `messageRouter.interactiveCallback.test.ts` | matcher textual amplo do fallback ainda pode capturar outros textos (não migrado, fora do escopo da #782) |
| Conteúdo suspeito | prompt injection | guards em intent/annotated/base | nenhum registro | `buildSuspiciousWhatsAppContentReply` | 1 mensagem | erro de segurança central, sem detalhe técnico | `promptInjectionGuard.test.ts`, `whatsappWebhook.secret.test.ts` | três pontos de envio distintos |
| Erro de processamento | exceção na cadeia | catch de cada wrapper | nenhum efeito adicional; `processedAt` finaliza | `PROCESSING_ERROR_REPLY` locais (2 variantes) | 1 mensagem | erro central sem detalhe técnico | `whatsappImageIdempotencyWebhook.failure.test.ts`, baseline | textos duplicados por wrapper |
| Canal/telefone não vinculado | mensagem de canal errado | base webhook | nenhum | sem resposta (log) | 0 mensagens | manter silêncio | `whatsappWebhook.secret.test.ts` | — |

### Contrato central e transporte (migração: #781 e #782; remoção de legados: #788)

| Ponto | Situação atual | Ação da epic |
|---|---|---|
| `replyMessages.ts` / `replyTemplates.ts` | builders centrais parciais | evoluir para contrato único (texto, botões, listas, links, mídia) — #781 |
| `sendAndLogTextReply` (intent webhook) | quase-transporte central: envia, loga, grava outbound, marca processado | base para o transporte central integrado ao lifecycle — #781 |
| Builders locais (intent webhook, base webhook, idempotency webhook, `webhookTextCommands`, integrações) | duplicam água/peso/resumo/refeição | migrar e remover — #783–#787, remoção final #788 |
| `whatsappPendingOperations` | confirmação genérica, seleção/confirmação de exclusão, clarificação de período, autorização profissional (`professional_access`) | ✅ reutilizada para botões/listas/callbacks com validação de usuário, expiração e consumo idempotente via `interactiveCallback.ts` — #782; sem store paralelo |
| Acks e read receipts | ack em imagem sempre; ack no base webhook para texto/áudio; nunca gravados como resposta funcional | no máximo 1 ack em processamento lento; nenhum no caminho rápido — #785 |

## Contratos da #756 e riscos para a tela de Relatórios

- A configuração "exercícios aumentam a meta" (#756) é aplicada no domínio (`shared/reportsGoalAnalytics.calculateAdjustedGoalCalories` consumido pelas telas e por `goalProgressService`).
- **Risco mapeado**: `buildExerciseAwarePeriodReportReply` em `whatsappIntentWebhook.ts` chama `calculateAdjustedGoalCalories` diretamente e formata `Meta estimada`/`Meta ajustada`. A #784 deve passar a receber a meta final do domínio, sem recalcular, e usar somente `Meta`.
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
