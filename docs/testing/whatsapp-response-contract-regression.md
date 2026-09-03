# Matriz de regressão do contrato de respostas do WhatsApp

Este arquivo continua sendo o ponto de entrada canônico da matriz de regressão do WhatsApp. O inventário histórico fechado da epic #779 e das migrações #781–#788/#855/#856 foi preservado **sem alteração** em [whatsapp-response-contract-regression.baseline.md](./whatsapp-response-contract-regression.baseline.md). O anexo é histórico, não uma segunda fonte normativa; regressões novas e a cadeia vigente ficam registradas aqui.

## Cadeia vigente relevante

`POST /api/whatsapp/webhook` → `handleWhatsAppPersistentContextWebhook` → `handleWhatsAppWebhookWithImageIdempotency` → `handleWhatsAppWebhookWithTextIntent` → `handleWhatsAppWebhookWithAnnotatedImages` → `handleWhatsAppWebhook`.

No registro textual normal, `handleWhatsAppWebhookWithTextIntent` preserva os handlers de maior precedência e só então aplica a resolução contável ao fragmento que efetivamente seguirá ao pipeline nutricional. Quando `prepareWhatsappCountableFoodRegistration` retorna `ready`, o `registrationText` em gramas segue pelo mecanismo existente de `textOverrides`; a procedência da medida permanece disponível para a resposta lógica diferida. Consumidores diretos de `executeWhatsappTextIntent` mantêm o próprio preflight.

## Regressão #1037 — medida contável resolvida no passthrough

| Fluxo | Entrada | Cadeia protegida | Efeito esperado | Resposta/procedência | Testes | Estado |
|---|---|---|---|---|---|---|
| Registro por texto com medida contável resolvida | `3 fatias de presunto` / `2 fatias de mussarela` | intent webhook → resolução contável após handlers de maior precedência → `textOverrides` → webhook nutricional base | uma única execução lógica do preflight; gramatura resolvida chega ao motor nutricional; macros são proporcionais à referência compatível, sem perfil genérico `150/6/15/5` | medida original e gramatura usada permanecem relacionadas; `usual_average` continua sinalizada como aproximação/estimativa | `whatsappIntentWebhook.issue1037.test.ts`, `whatsappIntentWebhook.issue1037.additional.test.ts`, `intentActions.issue1037.test.ts`, `nutritionEngine.issue1037.test.ts` | concluído (#1037) |
| Água + alimento contável | `300 ml de água\n3 fatias de presunto` | split de água → registro único da água → resolução contável somente do fragmento alimentar → passthrough nutricional | água registrada uma vez; alimento convertido antes do fallback; nenhuma segunda refeição/água por duplicação | prefixo diferido de água é preservado junto da procedência da medida alimentar | `whatsappIntentWebhook.issue1037.test.ts` | concluído (#1037) |
| Adição a refeição existente | `Adicionar 3 fatias de presunto ao café da manhã` | parser/intent canônico de adição antes do passthrough de registro normal | comando permanece no handler específico e não cria nova refeição por fallback | resposta do fluxo canônico de adição | `whatsappIntentWebhook.issue1037.additional.test.ts` | concluído (#1037) |
| Consumidor direto do intent textual | chamada direta de `executeWhatsappTextIntent` com medida contável | preflight interno do executor permanece ativo fora do wrapper textual | proteção contável continua disponível para áudio transcrito/retomadas e outros consumidores diretos; texto já em gramas não repete a resolução | clarificação/resultado canônico do executor | `intentActions.issue1037.test.ts` | concluído (#1037) |

## Controles específicos da #1037

- O caso explícito não depende de `nutritionFallback` ou classificação contextual para acionar a resolução contável.
- Vários segmentos contáveis podem ser resolvidos dentro de uma única invocação do gate da mensagem.
- O webhook não mantém gramaturas próprias: a fonte continua sendo `prepareWhatsappCountableFoodRegistration` / `prepareCountableFoodRegistrationResolved`.
- O motor nutricional continua sendo a única fonte de composição nutricional; o webhook apenas transporta a gramatura resolvida.
- Resoluções `usual_average` são apresentadas como estimativas; a conversão para gramas não apaga a medida original.
- O anexo histórico permanece disponível para os demais contratos de resposta, idempotência, mídia, onboarding, profissionais, segurança e migrações anteriores.
