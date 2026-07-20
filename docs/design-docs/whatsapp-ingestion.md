# Design técnico: ingestão WhatsApp

## Responsabilidade

Receber payloads da Meta, identificar usuário por telefone de origem, processar conteúdo multimodal e responder pelo número oficial da solução.

## Componentes

- Webhook HTTP para validação e inbound.
- Serviço de WhatsApp em `server/modules/whatsapp/service.ts`.
- Interpretação de comandos de texto em `server/modules/whatsapp/intentActions.ts`.
- Formatação de respostas nutricionais em `server/modules/whatsapp/replyMessages.ts`.
- Contrato central de resposta em `server/modules/whatsapp/replyContract.ts` e transporte central em `server/modules/whatsapp/replyTransport.ts` (epic #779, issue #781) — ver seção "Contrato central de resposta" abaixo.
- Edição rápida pública em `server/modules/quickEdit/*`, com token opaco, hash persistido e rota web `/quick-edit/:token`.
- Wrapper de idempotência de imagens em `server/whatsappImageIdempotencyWebhook.ts`, responsável por absorver reentregas do mesmo `message.id` de imagem antes do processamento pesado.
- Wrapper do webhook real em `server/whatsappIntentWebhook.ts`, executado antes do fallback de inferência nutricional.
- Wrapper de imagens anotadas em `server/whatsappAnnotatedImageWebhook.ts`, responsável por devolver e persistir a imagem auxiliar gerada após a análise visual.
- Schemas em `server/modules/whatsapp/schemas.ts`.
- Normalização compartilhada de unidades em `shared/measurementUnits.ts`, aplicada antes da interpretação textual do WhatsApp.
- Configuração por variáveis `WHATSAPP_*`.
- Persistência de vínculo em `whatsappConnections`.
- Enriquecimento pós-download/transcrição em `server/modules/whatsapp/webhookMediaPipeline.ts`, que atualiza a mesma mensagem inbound pelo `message.id` da Meta.

## Invariantes

- O número oficial é configuração de ambiente, nunca dado do usuário final.
- O campo `from` identifica o contato do usuário final.
- Tokens e IDs de operação não podem aparecer em logs crus.
- Links de edição rápida enviados no WhatsApp devem conter somente token opaco e não devem expor IDs internos de usuário/refeição.
- Tokens de edição rápida devem ser armazenados como hash, vinculados a usuário e refeição, expirar inicialmente em 24 horas e falhar com resposta genérica quando inválidos ou expirados.
- A tela pública de edição rápida só pode ler ou alterar a refeição associada ao token validado.
- Falha ao gerar link de edição rápida deve gerar aviso operacional e não deve bloquear o registro da refeição nem a resposta nutricional principal.
- Simulações devem usar dados controlados e não depender de chamadas externas reais.
- Mensagens suportadas de texto, imagem e áudio devem ser marcadas como lidas no WhatsApp antes do processamento pesado.
- Texto não recebe acknowledgement. Imagem e áudio recebem no máximo um acknowledgement somente quando o processamento ultrapassa o limiar configurado; o caminho rápido envia diretamente a resposta final.
- Reentregas do mesmo `message.id` de imagem devem ser absorvidas antes do fluxo nutricional para evitar acknowledgements e refeições duplicadas enquanto a reserva de idempotência estiver ativa.
- Apenas mensagens de texto puro, sem imagem e sem áudio, podem ser tratadas pelo interpretador de ações antes do acknowledgement e antes do fluxo nutricional.
- Áudios sem imagem podem ser transcritos e, depois da resposta inicial de processamento, a transcrição pode ser tratada pelo mesmo interpretador de ações antes da inferência nutricional.
- Captions de imagem continuam no caminho multimodal normal e não devem ser interceptadas como intenção, para não perder a análise visual da foto.
- Depois do download ou da transcrição, a linha inbound já criada deve ser enriquecida pela chave idempotente `whatsapp:inbound:<message.id>` com transcrição sanitizada e referência opaca da mídia persistida; esse enriquecimento não cria um segundo turno.
- Quando o storage falhar, a transcrição válida ainda deve enriquecer a mensagem persistida. Falha no banco de contexto não bloqueia inferência ou domínio e não pode gerar confirmação falsa de persistência contextual.
- Textos recebidos pelo WhatsApp devem passar por normalização segura de unidades antes da interpretação estruturada, do interpretador determinístico e do fallback nutricional. Exemplos: `mo` com quantidade numérica pode ser corrigido para `ml`, `grs` para `g` e `kgs` para `kg`.
- Conversões massa-volume só devem ser automáticas quando houver densidade confiável para o alimento ou bebida. Exemplo: leite integral pode converter `g` para `ml` usando densidade documentada; alimentos sólidos sem densidade não devem ser convertidos silenciosamente.
- Textos que descrevem apenas consumo de água com quantidade explícita devem atualizar hidratação, não criar refeição ou item alimentar.
- Textos de hidratação com data relativa, como `ontem` ou `anteontem`, devem registrar o consumo no dia interpretado em `America/Sao_Paulo`.
- Textos de hidratação sem quantidade explícita devem pedir esclarecimento, não criar refeição.
- Itens identificados por análise de imagem como água potável (`água`, `água mineral`, com ou sem gás, com marca, `garrafa de água`) devem ser separados do resultado de `processMealInput` em `server/modules/whatsapp/waterItemClassification.ts` antes de `createPendingMealInference`/`confirmPendingMeal`, e registrados como hidratação via `createUserWaterLog` em vez de item de refeição. `água de coco`, `água tônica` e `água saborizada` não entram nessa classificação.
- A separação de água só ocorre quando o item tiver volume resolvível em `ml` (via `quantity`/`unit` ou `portionText`); água sem volume válido não gera hidratação, não é inventada como 0 ml e não é persistida como alimento — o usuário deve ser questionado sobre o volume consumido.
- Quando a imagem tiver apenas água com volume válido, nenhuma refeição ou rascunho é criado. Quando houver água e alimentos na mesma imagem, a água é registrada como hidratação e removida da lista de itens antes do recálculo dos totais e da criação da refeição com os itens restantes. Múltiplos recipientes de água na mesma mensagem são somados em um único registro de hidratação.
- Textos que pedem redução de gramas devem ajustar uma refeição existente quando houver contexto suficiente, preservando proporção nutricional do item ajustado.
- Textos que pedem incremento de gramas, como `somar 45 g ao arroz`, devem ajustar uma refeição existente quando houver contexto suficiente, preservando proporção nutricional do item ajustado.
- Quando o ajuste de gramas não citar alimento, o sistema pode usar o último item da refeição mais recente; quando citar alimento, deve buscar item compatível na última refeição.
- Textos que corrigem quantidade em contexto curto, como `Trocar 330ml por 600ml` ou `Não é 330ml é 600ml`, devem buscar item compatível na refeição mais recente e atualizar automaticamente quando houver apenas um candidato.
- Quando a correção curta de quantidade encontrar mais de um item compatível ou nenhum item compatível, o sistema deve pedir esclarecimento curto antes de alterar qualquer registro.
- Textos que adicionam alimento com quantidade em gramas a uma refeição indicada, como `Adicionar 300g de amendoim japonês Elma Chips ao jantar de ontem`, devem atualizar a refeição indicada no dia relativo em vez de criar nova refeição por fallback.
- Quando o pedido de adição de alimento em gramas indicar uma refeição que não existe no dia interpretado, o sistema deve pedir esclarecimento antes de alterar qualquer registro.
- Textos que adicionam café sem açúcar a uma refeição existente, como `Adicionar 3 xícaras de café sem açúcar a refeição café da manhã`, devem atualizar a refeição indicada e não criar uma nova refeição por fallback.
- Quando a refeição indicada para adicionar café não existir ou faltar quantidade/refeição, o sistema deve pedir esclarecimento antes de alterar qualquer registro.
- Pedidos de sugestão de lanche devem responder diretamente ao usuário com opções simples, sem criar refeição por fallback.
- Pedidos de resumo, relatório ou balanço devem exigir período explícito, aceitar períodos como `hoje`, `ontem`, `semana`, `mês`, `últimos 7 dias` ou intervalo `01/06 a 03/06`, e responder com totais do período.
- Quando um pedido de resumo vier sem período, o sistema deve manter contexto temporário para que a próxima mensagem textual curta, como `hoje`, `ontem` ou `semana`, complete o pedido em vez de cair no fluxo de registro de refeição.
- Relatórios por WhatsApp devem resumir quantidade de refeições, calorias e macronutrientes consumidos, além de comparação simples com a meta estimada do período quando a meta estiver disponível.
- Quando um exercício novo for importado automaticamente do Strava para um usuário com WhatsApp vinculado, o usuário deve receber a resposta canônica de exercício com atividade, duração, calorias, data, indicação de estimativa quando aplicável e botão `Ver exercício`.
- Quando o comando não tiver contexto suficiente, o sistema deve pedir esclarecimento em vez de criar ou alterar registro incorreto.
- Uma mensagem contendo apenas uma palavra de continuidade/comando (`registrar`, `confirmar`, `cancelar`, `editar`, `consultar`, `sim`, `não`, `ok`, um número isolado) nunca pode ser tratada como nome de alimento nem alcançar `processMealDraft`/`processMealInput`. Sem pendência compatível, o sistema responde que não há operação pendente e pede a mensagem completa. Frases completas com a mesma palavra, como `registrar 100 g de arroz`, continuam funcionando normalmente (issue #855).
- Quando o interpretador de texto tratar a mensagem ou transcrição, o webhook real deve registrar evento de inferência com `origin: "whatsapp"`, responder com a mensagem interpretada e impedir que o mesmo conteúdo crie refeição por fallback.
- Respostas finais de refeição no WhatsApp devem usar linguagem simples, sem títulos técnicos como `Alimentos e macros`, e devem listar alimentos, porções, calorias, proteína, carboidratos e gorduras por item.
- Respostas finais de refeição devem mostrar o total da refeição e, quando houver meta disponível, um resumo curto de meta diária com calorias consumidas, meta e quanto falta ou excedeu.
- Respostas finais de refeição podem incluir um bloco curto `Editar: <url>` quando a refeição tiver link de edição rápida disponível.
- Falha ao carregar a meta diária não deve bloquear o registro da refeição nem a resposta nutricional principal.
- Falha ao marcar a mensagem como lida ou enviar a resposta inicial deve gerar aviso operacional, mas não deve bloquear o processamento principal.
- Falha ao enviar resposta de intenção interpretada deve gerar aviso operacional, mas não deve reprocessar a mensagem como refeição.
- Imagens recebidas pelo WhatsApp devem ser baixadas pelo backend e enviadas inline para a inferência nutricional, sem depender de URL pública ou assinada do storage para a IA ler a mídia.
- Quando uma refeição for registrada a partir de imagem e a preferência `whatsapp_annotated_image_enabled` for exatamente `true`, o WhatsApp deve enviar uma imagem auxiliar anotada com legendas dos alimentos, calorias e macronutrientes por item, baseada na foto original recebida.
- A preferência usa `userPreferences`, é autenticada por usuário, aceita booleano no contrato tRPC e persiste a representação canônica `true`/`false`. Ausência, valor diferente de `true` ou falha de leitura aplica o fallback desabilitado antes da geração.
- A imagem auxiliar anotada gerada para uma refeição habilitada deve ser salva no storage e vinculada à mesma refeição em `mealMedia`, junto com a imagem original, para deixar claro quais alimentos foram identificados a partir daquela imagem. Com a preferência desabilitada, somente a política vigente da mídia original é aplicada.
- Desativação intencional não produz warning de geração ou envio. Falha de leitura registra somente o evento sanitizado `whatsapp.annotated_image_preference_read_failed` e preserva o processamento nutricional.
- Falha ao gerar, persistir ou enviar a imagem auxiliar anotada deve gerar no máximo aviso operacional e não deve bloquear o registro da refeição nem a resposta textual com os macros.
- Áudios recebidos pelo WhatsApp devem ser baixados pelo backend e enviados inline para transcrição, sem depender de URL pública assinada do storage para o provider ler a mídia.
- A URL persistida da mídia deve continuar sendo a URL do storage quando o storage estiver disponível, não a data URL inline usada apenas durante inferência ou transcrição.
- Falha ao persistir mídia no storage deve gerar aviso operacional, mas não deve bloquear análise de imagem, transcrição de áudio ou registro de refeição quando a mídia já tiver sido baixada da Meta.
- Quando o processamento da mídia falhar, a resposta automática deve ser genérica e não deve expor token, URL assinada, telefone completo, conteúdo cru ou detalhe interno do provider.
- Refeições criadas por texto, imagem ou áudio no WhatsApp devem passar pela mesma consolidação lógica por usuário, dia, origem `whatsapp` e rótulo de refeição antes de serem tratadas como blocos separados.
- O wrapper de imagem anotada deve usar a mesma consolidação pós-salvamento do webhook principal para evitar que uma foto enviada depois de uma refeição abra bloco separado apenas pelo horário.
- Comandos destrutivos por alimento devem procurar no contexto lógico seguro do dia/refeição e considerar `foodName`, `canonicalName` e nomes originais/preservados quando existirem, pedindo confirmação quando houver múltiplos candidatos.
- O campo `occurredAt` deve continuar disponível como metadado de ocorrência para horário exibido, ordenação, auditoria e interpretação temporal, mas não deve ser usado sozinho como identidade da refeição lógica.

## Contrato central de resposta

A epic #779 centraliza os envios funcionais em um contrato tipado e em um único transporte. Refeições, resumos, água, peso, exercícios, mídia, IA, onboarding e profissionais já usam essa infraestrutura; chamadas diretas à Cloud API ficam restritas aos adaptadores de transporte e acknowledgement.

### Dois níveis

- **Mensagem outbound** (`WhatsAppOutboundMessage`, em `replyContract.ts`): uma unidade física enviada à Cloud API — `text`, `cta_url` (link/CTA, inclusive edição rápida), `buttons` (até 3 botões de resposta), `list` (lista interativa por seções) ou imagem (`image_url`/`image_buffer`).
- **Resposta lógica** (`WhatsAppLogicalReply`): a sequência ordenada de mensagens físicas que pertence à mesma ação funcional, com um `kind`:
  - `functional`: resolve a mensagem do usuário; é a única gravada no `messageLifecycle`.
  - `acknowledgement`: "estou processando"; nunca é gravada como resposta funcional.

Builders de domínio (`replyMessages.ts`, `replyTemplates.ts`) continuam existindo e retornando `string`; `logicalReplyFromLegacyText` adapta esse texto para uma mensagem de texto do contrato sem exigir migração imediata dos fluxos que ainda os consomem diretamente.

### Transporte central

`replyTransport.sendWhatsAppLogicalReply(to, reply, lifecycle?)` é o único serializador de uma resposta lógica:

- Valida restrições do provedor (`validateWhatsAppOutboundMessage`, ex.: máximo de 3 botões, título de até 20 caracteres) antes de qualquer chamada de rede; uma mensagem rejeitada nunca chega à Cloud API e o detalhe de validação nunca é enviado ao usuário.
- Envia cada mensagem física na ordem definida pelo array `messages`, reutilizando as funções de envio já concentradas em `webhookUtils.ts` (`sendWhatsAppTextMessage`, `sendWhatsAppInteractiveUrlButtonMessage`, `sendWhatsAppInteractiveButtonsMessage`, `sendWhatsAppInteractiveListMessage`, `sendWhatsAppImageMessage`/`sendWhatsAppImageBufferMessage`) — não há nova chamada direta a `graph.facebook.com` fora desse módulo.
- Grava a resposta funcional no `messageLifecycle` (`recordOutboundReply`) exatamente uma vez por resposta lógica, dependendo apenas do sucesso da mensagem primária (índice 0). Falha em mídia auxiliar (ex.: imagem anotada) não impede a gravação nem repete a mutação de domínio já concluída; falha na mensagem primária não grava outbound e o chamador não deve reexecutar a mutação de domínio nem desviar para outro intent.
- Quando chamado sem `lifecycle` (ex.: `simulateWhatsappInbound`, que apenas retorna `reply` ao chamador tRPC), não tenta gravar nada — o transporte não cria persistência paralela.

### Compatibilidade incremental

- Um fluxo não pode enviar simultaneamente pelo adapter antigo (`sendWhatsAppTextMessage`/`sendAndLogTextReply` chamados diretamente pelo handler) e pelo novo transporte para a mesma ação; a migração de cada domínio substitui o caminho por completo na subissue correspondente.
- Formatters de meta que forem adaptados ao contrato central devem receber o valor final calculado pelo domínio e não podem chamar `calculateAdjustedGoalCalories` nem recalcular a regra da #756; o formatter legado `buildWhatsAppGoalProgressLines` ainda faz esse cálculo e será corrigido na migração de resumos/metas (#784), não nesta issue.
- Adapters legados (`logicalReplyFromLegacyText`, exports antigos de `replyMessages.ts`/`replyTemplates.ts`, funções de envio direto em `webhookUtils.ts`) só são removidos na #788, depois que todos os domínios migrarem.

### Botões, listas e callbacks idempotentes (issue #782)

A epic #779 estende o contrato central para perguntas interativas com botões e listas, resolvidas com a mesma persistência e idempotência já usadas para confirmação/seleção por texto — `whatsappPendingOperations` continua sendo a única fonte de verdade; não existe store paralelo para callbacks.

- **Reconhecimento inbound**: `server/modules/whatsapp/webhookUtils.ts` reconhece `interactive.button_reply`/`interactive.list_reply` e expõe `getWhatsAppInteractiveReplyId(message)`. Uma mensagem interativa nunca é reinterpretada como texto livre nem cai no fallback nutricional: `canInterpretTextIntent` em `whatsappIntentWebhook.ts` a admite mesmo sem `text.body`, e o gate de precedência resolve o callback antes de qualquer classificação de intenção.
- **ID opaco assinado**: `server/modules/whatsapp/interactiveCallback.ts` gera e valida IDs de callback (`buildWhatsAppCallbackId`/`parseWhatsAppCallbackId`) assinados por HMAC (chave derivada de `JWT_SECRET`). O ID carrega apenas o ID da pendência e a ação escolhida — nunca `userId`, `mealId`, `itemId` ou qualquer dado sensível — e uma assinatura adulterada é rejeitada antes de qualquer consulta ao banco.
- **Claim central**: `claimWhatsAppInteractiveCallback` valida usuário, telefone/canal ativo, tipo da pendência, ação permitida, estado e expiração antes do compare-and-set. Reentrega, clique duplo ou corrida resultam em no máximo um consumo bem-sucedido; rejeições anteriores ao claim não consomem a pendência.

### Retry após mutação

O inbound só é concluído depois que uma resposta funcional primária é entregue e persistida. Se a mutação de domínio terminou mas o envio falhou, os vínculos `mealId`, `waterLogId` e `weightEntryId` permitem reconstruir a resposta a partir do estado persistido, sem repetir a mutação. A chave de idempotência da resposta outbound é derivada do inbound, garantindo no máximo uma resposta funcional armazenada por mensagem.
- **Despacho por domínio**: `server/modules/whatsapp/messageRouter.ts` reivindica o callback uma única vez e despacha pelo `type` persistido em `whatsappPendingOperations` para o resolvedor do domínio (exclusão, confirmação genérica de reclassificação, autorização profissional), que revalida o recurso atual no banco antes de mutar e nunca consome a pendência de novo. Um recurso que não corresponde mais ao estado esperado (ex.: ação `confirm` sobre uma pendência de seleção já superada) recebe a mensagem central `⚠️ Registro não encontrado`.
- **Fluxos obrigatórios**: exclusão exibe `Confirmar`/`Cancelar` e nunca executa antes da confirmação; uma seleção ambígua com mais de uma opção usa lista interativa (com linha `Cancelar`) e, ao ser escolhida, avança para a confirmação por botões em vez de excluir silenciosamente; autorização profissional exibe `Autorizar`/`Recusar` vinculados à mesma pendência criada ao notificar o profissional, mantendo o texto `AUTORIZAR <código>`/`NEGAR <código>` como fallback compatível — os dois caminhos resolvem a mesma decisão e a repetição não muda uma decisão já aplicada, pois o recurso (`access.status`) deixa de estar `"pending"` após a primeira aplicação.
- **Transporte**: `server/modules/whatsapp/webhookUtils.ts` ganhou `sendWhatsAppInteractiveButtonsMessage`/`sendWhatsAppInteractiveListMessage`; o envio efetivo passa por `replyTransport.sendWhatsAppLogicalReply`, que grava a resposta funcional no lifecycle exatamente uma vez por resposta lógica, igual aos demais fluxos migrados ao contrato central.

### Unificação de refeições e ações sobre alimentos (issue #783)

A epic #779 unifica todos os pontos que registram, atualizam, consultam ou excluem refeições/alimentos por WhatsApp para reutilizar os mesmos blocos de item e total (`buildWhatsAppFoodLines`/`buildWhatsAppMealTotalLines` em `replyTemplates.ts`), acessados via `buildWhatsAppMealActionReplyMessage`/`buildWhatsAppConsolidatedMealReplyMessage`/`buildWhatsAppMealReplyMessage` (`replyMessages.ts`).

- **Fonte de verdade pós-mutação**: `datedFoodAdditionIntent.ts`, `contextualFoodReplacementIntent.ts`, `gramsAdjustmentIntent.ts`, `gramsIncrementIntent.ts` e `deleteIntent.ts` recarregam a refeição (`listMeals`/`updateMeal`/`removeMeal`) antes de montar a resposta; nenhum desses fluxos monta a resposta a partir do payload anterior à mutação.
- **Builders locais removidos**: `buildMealFullSummary` (duplicado em `whatsappIntentWebhook.ts`, que produzia uma segunda seção "Resumo da refeição" logo abaixo da resposta central de `datedFoodAdditionIntent.ts`) e `formatMealSummary`/`formatTotalsLine` (duplicados em `contextualFoodReplacementIntent.ts`) foram removidos; ambos os fluxos agora produzem uma única seção com os blocos centrais.
- **Substituição e ajuste de quantidade diretos**: quando o alvo é inequívoco, a mutação é aplicada sem pedido de confirmação.
- **Ambiguidade por botões/lista**: `server/modules/whatsapp/mealItemSelectionCallback.ts` generaliza o padrão de seleção ambígua da exclusão (#782) para ajuste de gramas, correção de quantidade em contexto curto e substituição de alimento. Cada candidato preserva `mealId`, rótulo, índice e nome do item; duplicidades na mesma refeição permanecem candidatos distintos.
- **Encadeamento completo e ordenado**: mensagens com uma ação clara e uma ou mais ações ambíguas não escrevem antes da última escolha. Substituições e ajustes de gramas preservam todas as ações seguintes em `remainingSelections`, incluindo destino, delta e quantidade específicos de cada ação.
- **Caminhos equivalentes**: `recordAdjustmentIntent.ts`, `gramsAdjustmentIntent.ts` e `gramsIncrementIntent.ts`, inclusive quando exercitados pelo simulador, delegam aos mesmos handlers canônicos e mantêm os metadados de pendência e consulta fresca.
- **Operações multirrefeição**: `mealBatchMutation.ts` mantém o pipeline canônico de `updateMeal` e aplica compensação em ordem inversa se qualquer atualização falhar. A compensação inclui a chamada que lançou erro, pois ela pode ter persistido a refeição antes de falhar em um efeito complementar. Sucesso só é respondido depois de todas as gravações.
- **Entrega lógica única**: `logicalReplyDelivery.ts` compõe texto, CTA opaco e imagem auxiliar em uma única `WhatsAppLogicalReply`; os webhooks enviam a resposta funcional pelo transporte central e registram somente o conteúdo primário no lifecycle.
- **CTA após callbacks**: resultados interativos preservam `data.mealId`; quando a refeição ainda existe, a resposta final mantém a edição rápida.
- **Exclusão de alimento**: após a confirmação (botões `Confirmar`/`Cancelar` da #782), `deleteIntent.ts` recarrega a refeição e mostra os itens restantes com `buildWhatsAppMealActionReplyMessage`; quando o item excluído era o último, a refeição é removida e a resposta é uma confirmação textual simples (não há refeição para exibir).
- **Exclusão de refeição**: a confirmação final continua textual, já que não existe registro remanescente para renderizar nos blocos centrais.
- **Alimento estimado pela IA**: `buildWhatsAppFoodLines` inclui `WHATSAPP_ESTIMATED_NUTRITION_WARNING` (`⚠️ Valores nutricionais estimados pela IA.`) abaixo dos itens `heuristic` e `hybrid`; itens `catalog` não recebem o aviso, e os totais incluem os itens estimados.
- **Fora de escopo**: seleção temporal, consolidação, catálogo, cálculo nutricional, schema de persistência e a regra de meta ajustada da #756 não foram alterados; o link de edição rápida (já integrado ao contrato central desde #781) foi apenas preservado.

### Bloqueio de comandos isolados sem pendência (issue #855)

Evidência do bug: `1 iogurte natual desnatado` caía em clarificação genérica de intenção (o erro ortográfico "natual" e a ausência de unidade explícita faziam duas heurísticas não sincronizadas — `FOOD_REGISTRATION_WORDS`/`FOOD_OR_MEAL_WORDS` em `intentRouter.ts` e `hasLikelyMealRegistrationSignal` em `llmIntentActions.ts` — discordarem sobre se a mensagem era alimentar). Como essa clarificação não persistia nenhuma pendência (nem em `whatsappPendingOperations`, nem em `conversationContext.ts`), a resposta seguinte do usuário, `registrar`, era tratada como mensagem nova e independente. `registrar` batia no regex genérico de "provável nome de alimento sem quantidade" em `intentInterpreter.ts` (`classifyWhatsappMessageDeterministically`) e, dependendo da classificação do LLM para essa palavra isolada, podia alcançar `processMealDraft`/`processMealInput` cru, criando o item fantasma "Registrar — 1 porção (aprox. 100 g)" via o fallback genérico de 100 g (`GENERIC_ESTIMATED_FOOD_REFERENCE`).

Correção aplicada (escopo desta issue, não o contrato completo de pendência persistente do item 2/3 da especificação original, que fica para trabalho futuro):

- `server/modules/whatsapp/standaloneCommandWords.ts` centraliza a lista de palavras que só fazem sentido como resposta a uma pendência (`registrar`, `confirmar`, `cancelar`, `editar`, `consultar`, `sim`, `não`, `ok`, número isolado) e expõe `isStandaloneWhatsappCommandWord`, que só reconhece a mensagem inteira — frases completas como `registrar 100 g de arroz` não são afetadas.
- `server/modules/whatsapp/llmIntentActions.ts` (`executeWhatsappLlmIntent`) bloqueia essas palavras **antes de qualquer chamada ao LLM**, sempre que não há pendência ativa em `whatsappPendingOperations` — essa é a rede de segurança determinística compartilhada pelo webhook real (`whatsappIntentWebhook.ts`) e pelo simulador (`service.ts`), já que os dois consomem a mesma função.
- `server/modules/whatsapp/intentInterpreter.ts` (`classifyWhatsappMessageDeterministically`) exclui essas palavras do regex genérico que as tratava como possível nome de alimento sem quantidade.
- `server/modules/whatsapp/intentRouter.ts` (usado só pelo simulador) bloqueia essas palavras antes de `isLikelyFoodMessage`, com mensagem específica; `registrar`/`confirmar` continuam resolvendo uma pendência `confirmation` explícita (`registrar` confirma; não resolve pendência `quantity`/`selection`).
- `server/modules/whatsapp/service.ts` (`simulateWhatsappInbound`) tem uma rede de segurança final equivalente, imediatamente antes do fallback `processMealDraft`.

Fora do escopo desta correção pontual (permanece como lacuna documentada, não resolvida): pendência persistente para a clarificação genérica ambígua (contrato completo dos itens 2/3 da issue #855, consumível pela #858), porção canônica vs. fallback de 100 g para contagens (`1 iogurte`), e correção ortográfica leve (`natual` → `natural`).

### Gate destrutivo antes do fallback nutricional (issue #856)

O webhook real (`server/whatsappIntentWebhook.ts`) já chamava `executeWhatsappDeleteIntent` antes do parser nutricional e do LLM. O simulador tRPC (`nutrition.whatsapp.simulateInbound` → `simulateWhatsappInbound` em `server/modules/whatsapp/service.ts`) não compartilhava essa precedência: alcançava `deleteIntent.ts` apenas de forma indireta e tardia, através de um parser simplificado próprio em `recordAdjustmentIntent.ts`, depois de `executeWhatsappDatedFoodAdditionIntent`, `executeWhatsappGramsAdjustmentIntent` e `executeWhatsappGramsIncrementIntent`. Um comando destrutivo cujo alvo textual coincidisse com um nome reconhecido por esses parsers anteriores (ex.: exclusão de um item legado chamado `Registrar`) podia ser desviado para clarificação nutricional em vez do executor canônico de exclusão.

`simulateWhatsappInbound` agora chama `executeWhatsappDeleteIntent` diretamente logo após a decisão de acesso profissional e antes de qualquer parser de registro/ajuste alimentar, replicando a ordem do webhook real. `deleteIntent.ts` continua a única implementação de detecção/execução destrutiva (`detectWhatsappDeleteIntent`/`executeWhatsappDeleteIntent`); nenhum parser novo foi criado.

**Diagnóstico confirmado**: `detectWhatsappDeleteIntent` reconhece corretamente `Excluir o Registrar` isoladamente (verbo destrutivo + alvo `registrar`); o problema nunca foi de regex. A divergência era estrutural entre os dois pipelines descritos acima. Não há acesso, nesta correção, a logs do ambiente de produção para confirmar qual commit está de fato implantado; a comparação disponível localmente é entre `main` (branch de deploy, `e38cee7` no momento desta análise) e `develop`, que já contém revisões substanciais de `deleteIntent.ts`, `service.ts` e `server/whatsappIntentWebhook.ts` ainda não promovidas a `main`. Como `simulateWhatsappInbound` é exposto apenas via `nutrition.whatsapp.simulateInbound` (tRPC, sem endpoint HTTP próprio para reentrega/wrapper de produção), a divergência de pipeline descrita aqui afeta o simulador e qualquer consumidor que o reutilize para reprocessar texto já transcrito de áudio — não existe um caminho de áudio separado dentro do simulador; a transcrição chega como texto comum e passa pelo mesmo `simulateWhatsappInbound` corrigido.



- Testar texto, imagem e áudio mockados.
- Testar que texto, imagem e áudio inbound são marcados como lidos e recebem resposta inicial de processamento quando seguem para o fluxo nutricional normal.
- Testar que imagem persistida e áudio transcrito enriquecem a mesma mensagem inbound identificada pelo `message.id`, sem criar nova mensagem ou vínculo de domínio.
- Testar que a transcrição enriquece o contexto mesmo quando o upload da mídia falha, sem persistir data URL ou token temporário.
- Testar que uma reentrega do mesmo `message.id` de imagem não reenvia acknowledgement nem delega novamente ao fluxo nutricional.
- Testar que resposta final de refeição pode incluir link de edição rápida opaco quando o token é gerado com sucesso.
- Testar que falha na geração do link de edição rápida não impede registro nem resposta principal.
- Testar leitura e salvamento da tela `/quick-edit/:token` com token válido, inválido e expirado.
- Testar que texto como `250ml de água` registra consumo de água sem chamar inferência nutricional nem criar refeição.
- Testar que texto como `300mo água` é normalizado para `300 ml de água` antes da interpretação e registra hidratação corretamente.
- Testar que texto como `500 ml de água ontem` registra o consumo no dia anterior em `America/Sao_Paulo`.
- Testar que texto como `adicionar água ontem` pede a quantidade antes de executar qualquer ação.
- Testar que imagem com apenas água e volume válido (`ml` ou `L`, com ou sem gás, com marca) registra hidratação e não cria rascunho nem refeição.
- Testar que imagem com água e alimentos registra hidratação separadamente, remove a água da lista de itens e recalcula os totais da refeição apenas com os itens restantes.
- Testar que imagem com água sem volume válido não cria hidratação nem refeição e pede o volume ao usuário.
- Testar que múltiplos recipientes de água na mesma imagem somam os volumes em um único registro de hidratação.
- Testar que `água de coco`, `água tônica` e `água saborizada` identificadas em imagem permanecem como item de refeição, não como hidratação.
- Testar que falha ao registrar hidratação de água identificada em imagem não gera resposta de sucesso nem cria a refeição associada.
- Testar que texto como `211g de leite integral` não troca `g` por `ml` diretamente; quando convertido, deve usar densidade confiável e informar a medida interpretada ao usuário.
- Testar que alimento sólido sem densidade confiável não é convertido automaticamente de `g` para `ml`.
- Testar que texto como `reduzir 50 g do arroz` ajusta o item compatível da última refeição e recalcula macros proporcionalmente.
- Testar que texto ou áudio transcrito como `somar 45 g ao arroz` ajusta o item compatível da última refeição e não chama inferência nutricional.
- Testar que texto como `diminuir 30 g` ajusta o último item da última refeição quando não há alimento explícito.
- Testar que texto como `Trocar 330ml por 600ml` corrige automaticamente um único item recente compatível e preserva a unidade da resposta.
- Testar que texto como `Não é 330ml é 600ml` corrige o último item compatível.
- Testar que correção curta com dois itens de `330ml` pede confirmação com opções numeradas.
- Testar que correção curta sem item recente de `330ml` pede esclarecimento antes de alterar registro.
- Testar que texto como `Adicionar 300g de amendoim japonês Elma Chips ao jantar de ontem` adiciona o alimento à refeição indicada no dia relativo e não chama inferência nutricional.
- Testar que pedido para adicionar alimento em gramas a refeição inexistente pede esclarecimento e não altera registros.
- Testar que texto como `Adicionar 3 xícaras de café sem açúcar a refeição café da manhã` adiciona café à refeição indicada e não cria uma nova refeição por fallback.
- Testar que pedido para adicionar café sem refeição ou sem quantidade suficiente pede esclarecimento e não altera registros.
- Testar que pedido de sugestão de lanche retorna uma sugestão e não chama inferência nutricional.
- Testar que texto como `Me envie um resumo da semana` retorna relatório do período e não chama inferência nutricional.
- Testar que pedido de relatório sem período pede esclarecimento antes de executar qualquer ação.
- Testar que a resposta ao pedido de período, como `Hoje`, mantém o contexto do resumo e não delega para criação de refeição.
- Testar que mensagem de texto comum de refeição continua delegando para o fluxo normal de inferência nutricional.
- Testar que áudio transcrito como `500 ml de água ontem` registra hidratação sem chamar inferência nutricional nem criar refeição.
- Testar que caption de imagem com texto parecido com comando continua no fluxo multimodal normal.
- Testar que resposta final de refeição no WhatsApp lista os alimentos com calorias e macros por alimento, além dos totais estimados.
- Testar que resposta final de imagem no WhatsApp usa o formato simplificado com `Itens`, `Total da refeição` e `Meta de hoje`.
- Testar que imagem inbound é enviada inline para a IA e que apenas a URL do storage é persistida no rascunho/refeição quando o storage estiver disponível.
- Testar que imagem inbound pode gerar resposta visual anotada com a foto original, alimentos identificados, calorias e macros por item.
- Testar que a preferência ausente, inválida, desabilitada ou indisponível impede geração, persistência e envio da imagem anotada sem afetar a mídia original e a resposta textual.
- Testar que a imagem anotada gerada é vinculada à refeição em `mealMedia`, junto com a imagem original recebida pelo WhatsApp.
- Testar que falha ao gerar, persistir ou enviar a imagem anotada não impede o registro da refeição nem a resposta textual.
- Testar que imagem enviada após refeição compatível no mesmo dia é consolidada na refeição lógica existente, e não mantida como novo bloco apenas pelo `occurredAt`.
- Testar que comando `Excluir o chocolate` após uma foto encontra o item compatível no contexto lógico do dia/refeição, mesmo quando a foto foi a última mensagem processada.
- Testar que nomes específicos informados pelo usuário em texto são preservados quando a IA ou catálogo usa uma referência nutricional genérica.
- Testar que áudio inbound é enviado inline para transcrição e que apenas a URL do storage é persistida no rascunho/refeição quando o storage estiver disponível.
- Testar que falha de leitura, confirmação inicial ou storage não bloqueia o processamento quando a mensagem é válida.
- Testar token ausente, telefone oficial usado como telefone de usuário e vínculo inexistente.
- Testar que resposta outbound usa sempre `WHATSAPP_PHONE_NUMBER_ID`.
- Testar que importação de exercício novo do Strava envia notificação WhatsApp com botão `Ver resumo do dia` quando houver vínculo ativo.
- Testar que o contrato central rejeita botões acima do máximo suportado ou com título longo demais antes de qualquer chamada de rede.
- Testar que o transporte central grava a resposta funcional no lifecycle exatamente uma vez por resposta lógica, mesmo com múltiplas mensagens físicas (texto + imagem auxiliar).
- Testar que acknowledgement nunca é gravado como resposta funcional pelo transporte central, mesmo com envio bem-sucedido.
- Testar que falha na mensagem primária do transporte central não grava outbound no lifecycle, e que falha apenas na mídia auxiliar não impede a gravação da resposta já entregue.
- Testar que o transporte central serializa botões e listas no formato interativo esperado pela Cloud API sem chamada real ao provedor.
- Testar que um callback de botão/lista opaco é validado (dono, estado, expiração) e consumido por compare-and-set antes de qualquer efeito de domínio, e que reentrega, clique duplo ou corrida concorrente resultam em no máximo um consumo bem-sucedido.
- Testar que um callback de outro usuário, expirado, adulterado ou de pendência inexistente retorna a mensagem central de indisponibilidade sem revelar o estado exato nem IDs internos.
- Testar que a exclusão por botão só executa após `Confirmar`, que `Cancelar` não altera o domínio, e que uma seleção ambígua por lista avança para confirmação por botões em vez de excluir diretamente.
- Testar que autorização/recusa profissional por botão aplica a decisão uma única vez e que repetir o clique ou o texto equivalente não muda uma decisão já consumida.
- Testar que o webhook real reconhece `button_reply` recebido pela Cloud API e resolve a exclusão pendente sem passar pelo fallback nutricional.


## Invariantes finais da epic #779

- Toda resposta funcional passa pelo contrato lógico e pelo delivery central; acknowledgement é operacional, cancelável e nunca substitui a resposta funcional.
- Valores de meta são calculados no domínio. Formatters não recalculam a regra da #756, não multiplicam a meta atual por dias e não transformam ausência em zero.
- Datas e períodos usam o timezone do perfil, com `America/Sao_Paulo` somente como fallback.
- Ambiguidades de ações estruturadas usam pendência persistente, callback opaco e revalidação do banco antes da mutação.
- Onboarding composto retoma apenas mensagens físicas ainda não entregues após falha parcial.
- Erros de mídia, conta não vinculada e indisponibilidade são sanitizados e não expõem provider, payload, telefone completo ou identificadores internos.
- O gate arquitetural impede novos payloads, envios e builders paralelos fora dos módulos autorizados.

## Timezone da operação

A entrada canônica cria um escopo temporal request-scoped. Após identificar o usuário e confirmar que a mensagem não é uma reentrega já processada, o sistema resolve o timezone efetivo uma vez e o propaga por todo o pipeline. O timestamp recebido permanece absoluto; data lógica, rótulo de refeição, água, peso, relatórios, perguntas com `/` e agrupamentos usam o timezone resolvido.

Falha técnica ao consultar o perfil interrompe a mensagem com erro recuperável e não aciona o fallback nutricional. A ordem de idempotência e os vínculos de domínio permanecem inalterados.
