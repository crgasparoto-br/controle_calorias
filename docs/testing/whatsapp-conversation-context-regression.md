# Matriz de regressÃ£o do contexto conversacional do WhatsApp

Issue: #768. Esta matriz Ã© o gate de promoÃ§Ã£o do contexto persistente criado em #763â€“#767.

## Fronteira executada

O POST `/api/whatsapp/webhook` registra `handleWhatsAppPersistentContextWebhook`, que envolve o gateway real `handleWhatsAppWebhookWithImageIdempotency` e a cadeia jÃ¡ existente:

1. intenÃ§Ã£o textual;
2. imagem anotada;
3. webhook nutricional base.

Texto, imagem, Ã¡udio e multimodal passam pelo mesmo lifecycle persistente antes de qualquer efeito de domÃ­nio. O `message.id` da Meta identifica a entrada; um lease atÃ´mico concede propriedade a uma Ãºnica instÃ¢ncia. Caches locais permanecem somente como fast-path e ignoram uma entrada quando a requisiÃ§Ã£o possui claim persistente vÃ¡lido. `processedAt` Ã© finalizado apenas quando todo o escopo do entrypoint termina com sucesso; exceÃ§Ãµes preservam a possibilidade de retry pelo lease.

## EvidÃªncias automatizadas

| Contrato | EvidÃªncia executÃ¡vel |
|---|---|
| Entrypoint HTTP canÃ´nico com payloads no formato Meta | `server/whatsappPersistentContextWebhook.test.ts` |
| Texto â†’ imagem â†’ Ã¡udio sobre persistÃªncia compartilhada | `server/whatsappPersistentContextWebhook.test.ts` |
| ReinÃ­cio dos caches e alternÃ¢ncia A/B entre instÃ¢ncias | `server/whatsappPersistentContextWebhook.test.ts` |
| Reentrega de imagem/Ã¡udio sem repetir domÃ­nio | `server/whatsappPersistentContextWebhook.test.ts` |
| Falha da Meta apÃ³s persistÃªncia e retry em outra instÃ¢ncia | `server/whatsappPersistentContextWebhook.test.ts` |
| Lease persistente, retry abandonado e finalizaÃ§Ã£o somente apÃ³s sucesso | `server/modules/whatsapp/messageLifecycle.processingClaim.test.ts`, `server/whatsappImageIdempotencyWebhook.failure.test.ts` |
| Claim persistente prevalece sobre cache local | `server/modules/whatsapp/messageDeduplicationCache.test.ts` |
| Imagem/Ã¡udio enriquecem a mesma mensagem inbound | `server/modules/whatsapp/webhookMediaPipeline.test.ts`, `server/repositories/whatsappConversationMessageEnrichmentRepository.test.ts` |
| SeleÃ§Ã£o `o segundo` â†’ confirmaÃ§Ã£o `sim` no webhook real | `server/whatsappIntentWebhook.selection.test.ts` |
| SeleÃ§Ã£o persistente e execuÃ§Ã£o Ãºnica no mÃ³dulo destrutivo | `server/modules/whatsapp/deleteIntent.selection.test.ts` |
| Shadow, ativaÃ§Ã£o por fluxo/percentual e rollback sem apagar dados | `server/modules/whatsapp/conversationContextRollout.test.ts`, `server/modules/whatsapp/intentContext.rollout.test.ts` |
| Janela, profundidade e resumo progressivo | `server/modules/whatsapp/conversationContextBudget.test.ts`, `server/modules/whatsapp/conversationSummaryService.test.ts`, `server/modules/whatsapp/intentContext.test.ts` |
| SeguranÃ§a da janela da rota `/`: reinspeÃ§Ã£o, exclusÃ£o de conteÃºdo bloqueado, delimitaÃ§Ã£o de inbound e neutralizaÃ§Ã£o de marcadores | `server/modules/whatsapp/aiQuestionAssistant.history.test.ts`, `server/modules/whatsapp/aiQuestionAssistant.persistedHistorySecurity.test.ts` |
| Consumo concorrente de pendÃªncias | `server/repositories/whatsappPendingOperationRepository.test.ts`, `server/modules/whatsapp/messageRouter.test.ts` |
| RetenÃ§Ã£o sem apagar domÃ­nio nutricional | `server/modules/whatsapp/conversationRetentionService.test.ts`, `server/repositories/accountRepository.test.ts` |
| Migrations e integridade em TiDB | `.github/workflows/whatsapp-context-tidb.yml` |

## Matriz funcional consolidada

| CenÃ¡rio | EvidÃªncia principal | Resultado obrigatÃ³rio |
|---|---|---|
| Texto â†’ texto | testes de intenÃ§Ã£o/contexto | consulta usa banco atual; nenhuma refeiÃ§Ã£o nova |
| Texto â†’ imagem | regressÃ£o do entrypoint canÃ´nico | duas entradas ordenadas na mesma conversa |
| Imagem â†’ texto | entrypoint + contexto | pergunta posterior usa dados persistidos da imagem |
| Imagem com legenda | pipeline/annotated image | uma entrada lÃ³gica, sem duplicar legenda |
| Ãudio â†’ texto | entrypoint + pipeline | transcriÃ§Ã£o sanitizada na mesma entrada |
| Texto â†’ Ã¡udio | entrypoint + contexto | correÃ§Ã£o resolve alvo atual ou pede clarificaÃ§Ã£o |
| Texto â†’ imagem â†’ Ã¡udio â†’ texto | regressÃ£o multicanal + contexto | continuidade Ãºnica; valores vÃªm do domÃ­nio |
| SeleÃ§Ã£o/confirmaÃ§Ã£o | webhook de seleÃ§Ã£o | `o segundo` seleciona; somente `sim` muta; execuÃ§Ã£o Ãºnica |
| Reentrega texto/imagem/Ã¡udio | lifecycle/entrypoint | uma entrada e um efeito de domÃ­nio |
| ReinÃ­cio | entrypoint com caches zerados | continuidade preservada no mesmo armazenamento |
| Duas instÃ¢ncias | runtimes A/B independentes | uma propriedade de processamento por mensagem |
| Nova mensagem antes da resposta anterior | ordenaÃ§Ã£o/claim | mensagens nÃ£o se sobrescrevem e usam `occurredAt` + `id` |
| MÃ­dia nÃ£o reconhecida | pipeline existente | erro controlado; nenhuma refeiÃ§Ã£o falsa |
| MÃ­dia atrasada | ordenaÃ§Ã£o existente | associaÃ§Ã£o nÃ£o usa horÃ¡rio de conclusÃ£o do download |
| Falha de resumo | summary service | fallback para janela recente + banco |
| ConteÃºdo bloqueado | guard de seguranÃ§a + regressÃ£o da rota `/` | conteÃºdo nÃ£o vira memÃ³ria confiÃ¡vel, resumo ou turno recente enviado ao OpenAI; o outbound de bloqueio permanece apenas como contexto citado |
| FalsificaÃ§Ã£o de delimitador | regressÃ£o da rota `/` | marcadores enviados pelo usuÃ¡rio sÃ£o neutralizados antes da composiÃ§Ã£o do prompt |
| MudanÃ§a de data/refeiÃ§Ã£o | intent actions/delete guard | alvo revalidado no banco antes da mutaÃ§Ã£o |
| RetenÃ§Ã£o | retention service | contexto expira; referÃªncias/Ã¡gua/peso/exercÃ­cios permanecem |

## Rollout operacional

### ConfiguraÃ§Ã£o

O modo global Ã© definido por:

- `WHATSAPP_CONTEXT_READ_MODE=legacy|write_only|shadow|persistent`;
- `WHATSAPP_CONTEXT_ROLLOUT_PERCENT=0..100`.

Cada fluxo pode sobrescrever os valores globais:

- `WHATSAPP_CONTEXT_READ_MODE_TEXT`
- `WHATSAPP_CONTEXT_READ_MODE_IMAGE`;
- `WHATSAPP_CONTEXT_READ_MODE_AUDIO`;
- `WHATSAPP_CONTEXT_READ_MODE_MULTIMODAL`;
- `WHATSAPP_CONTEXT_ROLLOUT_PERCENT_<FLOW>`.

Sem configuraÃ§Ã£o explÃ­cita, o cÃ³digo usa `write_only` e 0% de leitura persistente. A persistÃªncia continua sendo alimentada, mas a ativaÃ§Ã£o da leitura nova exige configuraÃ§Ã£o consciente. Quando o modo `persistent` estÃ¡ ativo e nÃ£o hÃ¡ turnos persistidos disponÃ­veis, a leitura cai com seguranÃ§a para o contexto legado.

### Etapas

1. `write_only`: grava persistÃªncia, mantÃ©m leitura legada;
2. `shadow`: monta os dois contextos, usa legado e registra apenas contagens/equivalÃªncia;
3. `persistent` com percentual baixo para texto;
4. ampliar texto e ativar imagem/Ã¡udio/multimodal separadamente;
5. manter 100% somente apÃ³s critÃ©rios da janela controlada.

Eventos operacionais nÃ£o incluem conteÃºdo: `contextMode`, `contextFlow`, origem escolhida, elegibilidade, contagens e divergÃªncia booleana.

### CritÃ©rios mensurÃ¡veis

Durante a janela definida pela operaÃ§Ã£o:

- duplicaÃ§Ã£o de refeiÃ§Ã£o/Ã¡gua/peso/exercÃ­cio atribuÃ­vel ao contexto = 0;
- aÃ§Ã£o destrutiva ambÃ­gua sem confirmaÃ§Ã£o = 0;
- divergÃªncia funcional crÃ­tica antigo Ã— persistente = 0;
- falha de contexto sempre termina em fallback ou clarificaÃ§Ã£o;
- latÃªncia permanece dentro do orÃ§amento do ambiente;
- logs e mÃ©tricas passam na revisÃ£o de privacidade;
- gates do repositÃ³rio e TiDB estÃ£o verdes.

## Rollback

Alterar o fluxo afetado para `legacy` ou `write_only` u manter escrita persistente. O rollback:

- nÃ£o apaga mensagens, resumos, pendÃªncias ou vÃ­culos;
- nÃ£o executa migration reversa;
- mantÃ©m a possibilidade de shadow para diagnÃ³stico;
- preserva retenÃ§Ã£o e auditoria;
- pode ser aplicado por fluxo e percentual.

`server/modules/whatsapp/intentContext.rollout.test.ts` demonstra que a leitura volta ao legado e que as mensagens persistidas continuam intactas.

## Fallbacks locais ainda presentes

Os caches ccriados por `createMessageDeduplicationCache` continuam no repositÃ³rio por compatibilidade e fast-path. Eles nÃ£o decidem um retry]X[™ÈÈX\ÙH\œÚ\İ[HÛÛ˜ÙY]H›ÜšYYYH0è™\]Z\ÚpéğèÛËˆH™[[ğéğèÛÈ°ë\ÚXØH\ÜÙ\ÈØXÚ\ÈšXØHÛÛ™XÚ[Û˜YHH[XH›ÙYHÜİ\š[ÜˆH\ØØH›È™\ÜÚ]0ìÜš[ÈH]šY0ê›˜ÚXHH›ÙpéğèÛÎÈ°èÛÈ0êH™XÙ\Üğè\šXH\˜HHÛÜœ™péğèÛÈ\İšXpëYH\İH\ÜİYK‚‚“È˜[˜XÚÈ[HY[pìÜšXHHÚ]Ø\[™[™ÓÜ\˜][Û”™\ÜÚ]ÜXÛÛ[XH\[˜\È]X[™È°èÛÈ0èH˜[˜ÛÈÛÛ™šYİ\˜YËˆ[HÙ\™H[È\Ù[›Ûš[Y[ÈØØ[H°èÛÈÙ™\™XÙHØ\˜[XH][KZ[œİ0è›˜ÚXNÈ›ÙpéğèÛÈ]™H\Ø\ˆQ‹‚‚ˆÈÈØ]HQ‚‚˜™Ú]X‹İÛÜšÙ›İÜËİÚ]Ø\XÛÛ^]Y‹[[‚‚ŒKˆ[šXÚXH[XH™\œğèÛÈš^YHÈQÂŒ‹ˆÜšXHÈ˜[˜ÛÈH˜[YpéğèÛÎÂŒËˆ\XØH\ÈZYÜ˜][ÛœÈÈ™\ÜÚ]0ìÜš[ÎÂˆ^Xİ]HœH˜ÚXÚËZ[YÜš]XÂKˆ^Xİ]HH™YÜ™\ÜğèÛÈ\œÚ\İ[HÙ[HZ\İ\˜\ˆÈ˜[˜ÛÈ[\Ü°è\š[ÈÛÛHÜÈ˜[˜XÚÜÈÛÛ›ÛYÜÈÜÈ\İ\Ë‚‚ˆÈÈÚXÚÛ\İHİYÚ[™Â‚‘\İH\İH^YÙH[XšY[H[YÜ˜YÈH]™HÙ\ˆ[™^YH0èˆ[\ÈH›Û[ğéğèÛÈ\˜H›ÙpéğèÛÎ‚‚‹HÈH^[ØYY]H™X[H^ÎÂ‹HÈH^[ØYY]H™X[H[XYÙ[HÛÛHHÙ[HYÙ[™NÂ‹HÈH^[ØYY]H™X[H0è]Y[ÎÂ‹HÈH[\›°è›˜ÚXH[™HX\È[œİ0è›˜ÚX\ÈÈÙ\špéÛÎÂ‹HÈH™Z[°ëXÚ[È[™HY[œØYÙ[œÎÂ‹HÈH™Y[™YØHÈY\Û[ÈY\ÜØYÙKšY\˜H^Ë[XYÙ[HH0è]Y[ÎÂ‹HÈH˜[HÛÛ›ÛYHH™\İ[[ÎÂ‹HÈH™\ÜÜİHHY]H˜[[™È\0ìÜÈ\œÚ\İ0ê›˜ÚXNÂ‹HÈHØœÙ\˜péğèÛÈÚYİÈ[YÛÈ0åÈ›İ›ÎÂ‹HÈHÙÜÈÙ[HÛÛpî™ÈÙ[œğë]™[Â‹HÈH[\^˜HÈÛÛ^ÈÙ[H[\˜\ˆYÜÈ]šXÚ[Û˜Z\ÎÂ‹HÈH›Û˜XÚÈ\˜HYØXŞXÙ[HİÛ™Ü˜YHÈ˜[˜ÛË‚‚ˆÈÈØ]\ÈÈ™\ÜÚ]0ìÜš[Â‚˜˜\ÚœœHÚXÚÂœœH\İœœH\˜Ú]Xİ\™N˜ÚXÚÂœœHØÜÎ˜ÚXÚÂœœHZ[œœHYÙ[˜ÚXÚÂ˜‚HˆğìÈÙHØZ\ˆH˜Y]X[™ÈÜÈØ]\È]]ÛX]^˜YÜËÈ›ØˆQˆHÈÚXÚÛ\İ\Xğè]™[[È[XšY[HHİYÚ[™È\İ]™\™[HØİ[Y[YÜÈÛÛ[ÈÛÛ˜ÛpëYÜË‚