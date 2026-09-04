# Matriz de regressão do contrato de respostas do WhatsApp

Este arquivo continua sendo o ponto de entrada canônico da matriz de regressão do WhatsApp. O inventário histórico fechado da epic #779 e das migrações #781–#788/#855/#856 foi preservado **sem alteração** em [whatsapp-response-contract-regression.baseline.md](./whatsapp-response-contract-regression.baseline.md). O anexo é histórico, não uma segunda fonte normativa; regressões novas e a cadeia vigente ficam registradas aqui.

## Cadeia vigente relevante

`POST /api/whatsapp/webhook` → `handleWhatsAppPersistentContextWebhook` → `handleWhatsAppWebhookWithImageIdempotency` → `handleWhatsAppWebhookWithTextIntent` → `handleWhatsAppWebhookWithAnnotatedImages` → `handleWhatsAppWebhook`.

No registro textual normal, `handleWhatsAppWebhookWithTextIntent` preserva os handlers de maior precedência e só então aplica a resolução contável ao fragmento que efetivamente seguirá ao pipeline nutricional. Quando `prepareWhatsappCountableFoodRegistration` retorna `ready`, o `registrationText` em gramas segue pelo mecanismo existente de `textOverrides`; a procedência da medida permanece disponível para a resposta lógica diferida. Consumidores diretos de `executeWhatsappTextIntent` mantêm o próprio preflight.

## Regressão #1037 — medida contável resolvida no passthrough

| Fluxo | Entrada | Cadeia protegida | Efeito esperado | Resposta/procedência | Testes | Estado |
|---|---|---|---|---|---|---|
| Registro por texto com medida contável resolvida | `3 fatias de presunto` / `2 fatias de mussarela` | intent webhook → resolução contável após handlers de maior precedência → `textOverrides` → webhook nutricional base | uma única execução lógica do preflight; gramatura resolvida chega ao motor nutricional; macros são proporcionais à referência compatível, sem perfil genérico `150/6/15/5` | medida original e gramatura usada permanecem relacionadas; resoluções aproximadas continuam sinalizadas como estimativa | `whatsappIntentWebhook.issue1037.test.ts`, `whatsappIntentWebhook.issue1037.additional.test.ts`, `intentActions.issue1037.test.ts`, `nutritionEngine.issue1037.test.ts` | concluído (#1037) |
| Água + alimento contável | `300 ml de água\n3 fatias de presunto` | split de água → registro único da água → resolução contável somente do fragmento alimentar → passthrough nutricional | água registrada uma vez; alimento convertido antes do fallback; nenhuma segunda refeição/água por duplicação | prefixo diferido de água é preservado junto da procedência da medida alimentar | `whatsappIntentWebhook.issue1037.test.ts` | concluído (#1037) |
| Adição a refeição existente | `Adicionar 3 fatias de presunto ao café da manhã` | parser/intent canônico de adição antes do passthrough de registro normal | comando permanece no handler específico e não cria nova refeição por fallback | resposta do fluxo canônico de adição | `whatsappIntentWebhook.issue1037.additional.test.ts` | concluído (#1037) |
| Consumidor direto do intent textual | chamada direta de `executeWhatsappTextIntent` com medida contável | preflight interno do executor permanece ativo fora do wrapper textual | proteção contável continua disponível para áudio transcrito/retomadas e outros consumidores diretos; texto já em gramas não repete a resolução | clarificação/resultado canônico do executor | `intentActions.issue1037.test.ts` | concluído (#1037) |

## Controles específicos da #1037

- O caso explícito não depende de `nutritionFallback` ou classificação contextual para acionar a resolução contável.
- Vários segmentos contáveis podem ser resolvidos dentro de uma única invocação do gate da mensagem.
- O webhook não mantém gramaturas próprias: a fonte continua sendo `prepareWhatsappCountableFoodRegistration` / `prepareCountableFoodRegistrationResolved`.
- O motor nutricional continua sendo a única fonte de composição nutricional; o webhook apenas transporta a gramatura resolvida.
- Resoluções aproximadas são apresentadas como estimativas; a conversão para gramas não apaga a medida original.
- O anexo histórico permanece disponível para os demais contratos de resposta, idempotência, mídia, onboarding, profissionais, segurança e migrações anteriores.

## Regressão #1043 — estimativa contextual persistida e aprendizado

| Cenário | Entrada/estado | Efeito esperado | Evidência automatizada |
|---|---|---|---|
| Referência única compatível | `3 fatias de presunto`, uma única fonte verificável com relação `1 fatia = 18 g` | `contextual_estimate`, `54 g`, procedência preservada e persistida | `householdMeasureResolution.issue1043.test.ts` |
| Categoria ampla/incompatível | fonte de `embutido` para pedido específico de presunto | clarificação; nenhuma persistência de estimativa | `householdMeasureResolution.issue1043.test.ts` |
| Medida/evidência insegura | `pedaço` isolado ou trecho sem relação quantidade-unidade-gramas | clarificação | `householdMeasureResolution.issue1043.test.ts` |
| Duas fontes coerentes | referências independentes de 18 g e 20 g por fatia | `usual_average`, valor central coerente | `householdMeasureResolution.issue1043.test.ts` |
| Duas fontes conflitantes | referências de 18 g e 42 g | clarificação; nenhum cherry-pick | `householdMeasureResolution.issue1043.test.ts` |
| Restart/múltiplas instâncias | resolução válida já persistida em `userPreferences` | reuse sem chamada ao provedor; tipo/evidência/fontes mantidos | `householdMeasureResolution.issue1043.test.ts`, `householdMeasureResolutionStore.issue1043.test.ts` |
| Transparência de adição | `contextual_estimate` ou `user_learned` | medida original preservada e gramatura exibida como `aprox.` | `canonicalFoodAdditionResolution.issue1043.test.ts` |
| Aprendizado após correção | item original `4 fatias`; usuário corrige para `80 g`; update da refeição conclui | upsert `user_learned` somente depois da mutação | `gramsAdjustmentHandlers.issue1043.test.ts`, `householdMeasureResolutionStore.issue1043.test.ts` |
| Falha/ambiguidade | update falha ou há dois alvos compatíveis | zero aprendizado | `gramsAdjustmentHandlers.issue1043.test.ts` |
| Retry e nova correção | mesma relação reenviada / valor corrigido novamente | upsert idempotente; sem duplicata; valor mais recente substitui o anterior | `householdMeasureResolutionStore.issue1043.test.ts` |
| Isolamento | usuários ou marcas/variantes diferentes | registros independentes; nenhuma referência pessoal atravessa escopo | `householdMeasureResolutionStore.issue1043.test.ts` |
| Precedência | resolução pesquisada exata persistida junto de referências menos fortes | `researched_exact` vence `user_learned`, `usual_average` e `contextual_estimate`; massa/volume explícito nem entra no resolvedor contável | `householdMeasureResolution.issue1043.test.ts` |
| Regressões anteriores | presunto, mussarela, passthrough textual, água+alimento e adição | contratos #1016/#1037 continuam válidos | suítes existentes `householdMeasureResolution.*`, `whatsappIntentWebhook.issue1037*`, `intentActions.issue1037*`, `nutritionEngine.issue1037*` |

### Controles específicos da #1043

- Não existe tabela ou mapa paralelo de gramaturas no webhook/intent; o resolvedor canônico continua dono da decisão de quantidade.
- Resoluções pesquisadas e aprendidas usam a infraestrutura persistente existente de `userPreferences`, com chave por identidade alimentar, marca/variante, unidade e tipo; `userId` permanece parte do escopo persistente.
- `researched_exact`, `usual_average` e `contextual_estimate` têm validade temporal; registro expirado é miss e pode disparar nova pesquisa.
- `user_learned` só nasce de correção explícita com contexto original preservado e mutação concluída; parse, cancelamento, ambiguidade e falha não ensinam.
- O formatter não apresenta `contextual_estimate`, `usual_average` ou `user_learned` como medida exata.
- As validações finais da entrega executam a suíte completa para detectar regressão dos fluxos de presunto/mussarela e dos gates anteriores.
