# Matriz de regressão do contexto conversacional do WhatsApp

Issue: #768. Esta matriz é o gate de promoção do contexto persistente criado em #763–#767.

## Fronteira executada

O POST `/api/whatsapp/webhook` registra `handleWhatsAppPersistentContextWebhook`, que envolve o gateway real `handleWhatsAppWebhookWithImageIdempotency` e a cadeia já existente:

1. intenção textual;
2. imagem anotada;
3. webhook nutricional base.

Texto, imagem, áudio e multimodal passam pelo mesmo lifecycle persistente antes de qualquer efeito de domínio. O `message.id` da Meta identifica a entrada; um lease atômico concede propriedade a uma única instância. Caches locais permanecem somente como fast-path e ignoram uma entrada quando a requisição possui claim persistente válido. `processedAt` é finalizado apenas quando todo o escopo do entrypoint termina com sucesso; exceções preservam a possibilidade de retry pelo lease.

## Evidências automatizadas

| Contrato | Evidência executável |
|---|---|
| Entrypoint HTTP canônico com payloads no formato Meta | `server/whatsappPersistentContextWebhook.test.ts` |
| Texto → imagem → áudio sobre persistência compartilhada | `server/whatsappPersistentContextWebhook.test.ts` |
| Reinício dos caches e alternância A/B entre instâncias | `server/whatsappPersistentContextWebhook.test.ts` |
| Reentrega de imagem/áudio sem repetir domínio | `server/whatsappPersistentContextWebhook.test.ts` |
| Falha da Meta após persistência e retry em outra instância | `server/whatsappPersistentContextWebhook.test.ts` |
| Lease persistente, retry abandonado e finalização somente após sucesso | `server/modules/whatsapp/messageLifecycle.processingClaim.test.ts`, `server/whatsappImageIdempotencyWebhook.failure.test.ts` |
| Claim persistente prevalece sobre cache local | `server/modules/whatsapp/messageDeduplicationCache.test.ts` |
| Imagem/áudio enriquecem a mesma mensagem inbound | `server/modules/whatsapp/webhookMediaPipeline.test.ts`, `server/repositories/whatsappConversationMessageEnrichmentRepository.test.ts` |
| Seleção `o segundo` → confirmação `sim` no webhook real | `server/whatsappIntentWebhook.selection.test.ts` |
| Seleção persistente e execução única no módulo destrutivo | `server/modules/whatsapp/deleteIntent.selection.test.ts` |
| Shadow, ativação por fluxo/percentual e rollback sem apagar dados | `server/modules/whatsapp/conversationContextRollout.test.ts`, `server/modules/whatsapp/intentContext.rollout.test.ts` |
| Janela, profundidade e resumo progressivo | `server/modules/whatsapp/conversationContextBudget.test.ts`, `server/modules/whatsapp/conversationSummaryService.test.ts`, `server/modules/whatsapp/intentContext.test.ts` |
| Consumo concorrente de pendências | `server/repositories/whatsappPendingOperationRepository.test.ts`, `server/modules/whatsapp/messageRouter.test.ts` |
| Retenção sem apagar domínio nutricional | `server/modules/whatsapp/conversationRetentionService.test.ts`, `server/repositories/accountRepository.test.ts` |
| Migrations e integridade em TiDB | `.github/workflows/whatsapp-context-tidb.yml` |

## Matriz funcional consolidada

| Cenário | Evidência principal | Resultado obrigatório |
|---|---|---|
| Texto → texto | testes de intenção/contexto | consulta usa banco atual; nenhuma refeição nova |
| Texto → imagem | regressão do entrypoint canônico | duas entradas ordenadas na mesma conversa |
| Imagem → texto | entrypoint + contexto | pergunta posterior usa dados persistidos da imagem |
| Imagem com legenda | pipeline/annotated image | uma entrada lógica, sem duplicar legenda |
| Áudio → texto | entrypoint + pipeline | transcrição sanitizada na mesma entrada |
| Texto → áudio | entrypoint + contexto | correção resolve alvo atual ou pede clarificação |
| Texto → imagem → áudio → texto | regressão multicanal + contexto | continuidade única; valores vêm do domínio |
| Seleção/confirmação | webhook de seleção | `o segundo` seleciona; somente `sim` muta; execução única |
| Reentrega texto/imagem/áudio | lifecycle/entrypoint | uma entrada e um efeito de domínio |
| Reinício | entrypoint com caches zerados | continuidade preservada no mesmo armazenamento |
| Duas instâncias | runtimes A/B independentes | uma propriedade de processamento por mensagem |
| Nova mensagem antes da resposta anterior | ordenação/claim | mensagens não se sobrescrevem e usam `occurredAt` + `id` |
| Mídia não reconhecida | pipeline existente | erro controlado; nenhuma refeição falsa |
| Mídia atrasada | ordenação existente | associação não usa horário de conclusão do download |
| Falha de resumo | summary service | fallback para janela recente + banco |
| Conteúdo bloqueado | guard de segurança | conteúdo não vira memória confiável |
| Mudança de data/refeição | intent actions/delete guard | alvo revalidado no banco antes da mutação |
| Retenção | retention service | contexto expira; refeições/água/peso/exercícios permanecem |

## Rollout operacional

### Configuração

O modo global é definido por:

- `WHATSAPP_CONTEXT_READ_MODE=legacy|write_only|shadow|persistent`;
- `WHATSAPP_CONTEXT_ROLLOUT_PERCENT=0..100`.

Cada fluxo pode sobrescrever os valores globais:

- `WHATSAPP_CONTEXT_READ_MODE_TEXT`;
- `WHATSAPP_CONTEXT_READ_MODE_IMAGE`;
- `WHATSAPP_CONTEXT_READ_MODE_AUDIO`;
- `WHATSAPP_CONTEXT_READ_MODE_MULTIMODAL`;
- `WHATSAPP_CONTEXT_ROLLOUT_PERCENT_<FLOW>`.

Sem configuração explícita, o código usa `write_only` e 0% de leitura persistente. A persistência continua sendo alimentada, mas a ativação da leitura nova exige configuração consciente. Quando o modo `persistent` está ativo e não há turnos persistidos disponíveis, a leitura cai com segurança para o contexto legado.

### Etapas

1. `write_only`: grava persistência, mantém leitura legada;
2. `shadow`: monta os dois contextos, usa legado e registra apenas contagens/equivalência;
3. `persistent` com percentual baixo para texto;
4. ampliar texto e ativar imagem/áudio/multimodal separadamente;
5. manter 100% somente após critérios da janela controlada.

Eventos operacionais não incluem conteúdo: `contextMode`, `contextFlow`, origem escolhida, elegibilidade, contagens e divergência booleana.

### Critérios mensuráveis

Durante a janela definida pela operação:

- duplicação de refeição/água/peso/exercício atribuível ao contexto = 0;
- ação destrutiva ambígua sem confirmação = 0;
- divergência funcional crítica antigo × persistente = 0;
- falha de contexto sempre termina em fallback ou clarificação segura;
- latência permanece dentro do orçamento do ambiente;
- logs e métricas passam na revisão de privacidade;
- gates do repositório e TiDB estão verdes.

## Rollback

Alterar o fluxo afetado para `legacy` ou `write_only` e manter escrita persistente. O rollback:

- não apaga mensagens, resumos, pendências ou vínculos;
- não executa migration reversa;
- mantém a possibilidade de shadow para diagnóstico;
- preserva retenção e auditoria;
- pode ser aplicado por fluxo e percentual.

`server/modules/whatsapp/intentContext.rollout.test.ts` demonstra que a leitura volta ao legado e que as mensagens persistidas continuam intactas.

## Fallbacks locais ainda presentes

Os caches criados por `createMessageDeduplicationCache` continuam no repositório por compatibilidade e fast-path. Eles não decidem um retry quando o lease persistente concedeu propriedade à requisição. A remoção física desses caches fica condicionada a uma rodada posterior de busca no repositório e evidência de produção; não é necessária para a correção distribuída desta issue.

O fallback em memória de `whatsappPendingOperationRepository` continua apenas quando não há banco configurado. Ele serve ao desenvolvimento local e não oferece garantia multi-instância; produção deve usar TiDB.

## Gate TiDB

`.github/workflows/whatsapp-context-tidb.yml`:

1. inicia uma versão fixada do TiDB;
2. cria o banco de validação;
3. aplica as migrations do repositório;
4. executa `pnpm db:check-integrity`;
5. executa a regressão persistente sem misturar o banco temporário com os fallbacks controlados dos testes.

## Checklist de staging

Esta lista exige ambiente integrado e deve ser anexada à PR antes da promoção para produção:

- [ ] payload Meta real de texto;
- [ ] payload Meta real de imagem com e sem legenda;
- [ ] payload Meta real de áudio;
- [ ] alternância entre duas instâncias do serviço;
- [ ] reinício entre mensagens;
- [ ] reentrega do mesmo `message.id` para texto, imagem e áudio;
- [ ] falha controlada de resumo;
- [ ] resposta da Meta falhando após persistência;
- [ ] observação shadow antigo × novo;
- [ ] logs sem conteúdo sensível;
- [ ] limpeza do contexto sem alterar dados nutricionais;
- [ ] rollback para `legacy` sem downgrade do banco.

## Gates do repositório

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm build
pnpm agent:check
```

A PR só pode sair de draft quando os gates automatizados, o job TiDB e o checklist aplicável ao ambiente de staging estiverem documentados como concluídos.
