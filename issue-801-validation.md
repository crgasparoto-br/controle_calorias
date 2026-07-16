# Issue 801 final validation

Commit validated: fa938f89b6a4daf523ee3eb69f9f3da6f3886c37

The official Agent-first workflow was restored before running the commands.

| Command | Exit code |
|---|---:|
| `pnpm check` | 0 |
| `pnpm test` | 0 |
| `pnpm architecture:check` | 0 |
| `pnpm docs:check` | 0 |
| `pnpm build` | 0 |
| `pnpm agent:check` | 0 |
| `pnpm exec tsx scripts/check-ci-gate-docs.ts` | 0 |

Overall exit code: 0

Database integrity: validated by the separate WhatsApp context TiDB gate.

## /tmp/check.log
```text

> controle_calorias@1.0.0 check /home/runner/work/controle_calorias/controle_calorias
> tsc --noEmit

```

## /tmp/test.log
```text
[22m[39m[TimeZone] Effective timezone fallback applied { reason: [32m'profile_missing'[39m }

 [32m✓[39m server/modules/whatsapp/intentActions.netQuantity.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 59[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/mealItemTargetMatcher.test.ts [2m([22m[2m7 tests[22m[2m)[22m[90m 11[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/mealConsolidationService.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 39[2mms[22m[39m
 [32m✓[39m server/modules/meals/nutritionSourceSelection.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/userMeasurementReplyContext.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 28[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/intentSchema.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 10[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/deleteIntent.test.ts [2m([22m[2m13 tests[22m[2m)[22m[90m 17[2mms[22m[39m
 [32m✓[39m server/nutritionEngine.compositeFallback.test.ts [2m([22m[2m2 tests[22m[2m)[22m[33m 418[2mms[22m[39m
   [33m[2m✓[22m[39m nutritionEngine composite text fallback[2m > [22mnao reduz alimento composto com preparo ao ingrediente isolado [33m410[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/intent/mealTargetResolution.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 83[2mms[22m[39m
 [32m✓[39m server/safeMessages.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 7[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/intent/dateTime.test.ts [2m([22m[2m8 tests[22m[2m)[22m[90m 120[2mms[22m[39m
[90mstderr[2m | server/modules/whatsapp/mealContextContract.test.ts[2m > [22m[2missue #783 — bloco canônico de contexto da refeição[2m > [22m[2mreutiliza o mesmo bloco na consulta da refeição
[22m[39m[TimeZone] Effective timezone fallback applied { reason: [32m'profile_missing'[39m }

 [32m✓[39m server/repositories/whatsappConversationMessageEnrichmentRepository.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 8[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/mealContextContract.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 49[2mms[22m[39m
 [32m✓[39m server/modules/meals/service.relativeDate.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 40[2mms[22m[39m
 [32m✓[39m server/modules/appSecrets/encryption.test.ts [2m([22m[2m7 tests[22m[2m)[22m[90m 11[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/foodIcons.test.ts [2m([22m[2m35 tests[22m[2m)[22m[90m 15[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/intentContext.currentMessage.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 4[2mms[22m[39m
 [32m✓[39m server/nutritionEngine.lowCalorieBeverages.test.ts [2m([22m[2m4 tests[22m[2m)[22m[33m 360[2mms[22m[39m
   [33m[2m✓[22m[39m nutritionEngine low-calorie beverage handling[2m > [22mtrata cafe sem acucar por xicara como caloria praticamente nula [33m340[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/replyMessages.estimatedNutrition.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 38[2mms[22m[39m
 [32m✓[39m server/modules/goals/schemas.test.ts [2m([22m[2m9 tests[22m[2m)[22m[90m 16[2mms[22m[39m
 [32m✓[39m server/modules/professionals/schemas.test.ts [2m([22m[2m7 tests[22m[2m)[22m[90m 12[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/conversationRetentionService.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 9[2mms[22m[39m
[90mstderr[2m | server/modules/whatsapp/intentActions.multipleItems.test.ts[2m > [22m[2mexecuteWhatsappTextIntent multiple food additions[2m > [22m[2madiciona dois itens distintos com marcas ao jantar de ontem
[22m[39m[TimeZone] Effective timezone fallback applied { reason: [32m'profile_missing'[39m }

 [32m✓[39m server/modules/whatsapp/intentActions.multipleItems.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 94[2mms[22m[39m
 [32m✓[39m server/whatsappImageIdempotencyWebhook.failure.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 10[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/contextualFoodReplacementIntent.multipleAmbiguities.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 14[2mms[22m[39m
 [32m✓[39m server/modules/insights/schemas.test.ts [2m([22m[2m8 tests[22m[2m)[22m[90m 8[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/foodAssistant.test.ts [2m([22m[2m12 tests[22m[2m)[22m[90m 10[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/processingAcknowledgement.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 9[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/conversationContextRollout.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/quantityUnitVocabulary.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 5[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/mealConsolidation.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 35[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/deleteIntent.selection.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 43[2mms[22m[39m
[90mstderr[2m | server/modules/whatsapp/annotatedImage.test.ts[2m > [22m[2mgenerateAnnotatedMealImage[2m > [22m[2mdoes not call the image generation provider when local overlay fails for an original meal photo
[22m[39m[WhatsAppAnnotatedImage] Local overlay failed; skipping generated-image fallback for original meal photo. sharp unavailable

 [32m✓[39m server/modules/whatsapp/annotatedImage.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 13[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/logicalReplyDelivery.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/mealCommandParser.targetMealRegression.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 35[2mms[22m[39m
 [32m✓[39m server/modules/goals/nutritionGoalService.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 9[2mms[22m[39m
 [32m✓[39m server/modules/onboarding/service.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 32[2mms[22m[39m
 [32m✓[39m client/src/pages/GoalsPage.timeZoneFallback.test.tsx [2m([22m[2m1 test[22m[2m)[22m[33m 372[2mms[22m[39m
   [33m[2m✓[22m[39m GoalsPage timezone fallback[2m > [22mrenderiza metas e inicia a consulta quando o fallback degradado está resolvido [33m370[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/intentContextUsage.inventory.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 5[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/domainReplyFormatters.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 35[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/replyMessages.standard.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m server/modules/insights/reportMetrics.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 7[2mms[22m[39m
 [32m✓[39m server/breadVariationMatching.test.ts [2m([22m[2m6 tests[22m[2m)[22m[90m 84[2mms[22m[39m
 [32m✓[39m server/modules/admin/logs.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 8[2mms[22m[39m
 [32m✓[39m server/whatsappWebhook.secret.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 5[2mms[22m[39m
 [32m✓[39m client/src/features/meals/habitRecordViewModels.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 35[2mms[22m[39m
 [32m✓[39m server/repositories/accountRepository.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 4[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/timeZoneContext.test.ts [2m([22m[2m7 tests[22m[2m)[22m[90m 26[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/replyMessages.auxiliary.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 6[2mms[22m[39m
[90mstderr[2m | server/_core/imageGeneration.fallback.test.ts[2m > [22m[2mgenerateImage fallback[2m > [22m[2mgera uma imagem PNG local quando o provider de imagem não está configurado
[22m[39m[ImageGeneration] OpenAI image generation is not configured; using local fallback image.

 [32m✓[39m server/_core/imageGeneration.fallback.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 68[2mms[22m[39m
 [32m✓[39m server/privacy.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 7[2mms[22m[39m
 [32m✓[39m server/modules/mealSchedules/service.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 31[2mms[22m[39m
 [32m✓[39m server/modules/meals/mealItemDeduplication.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 8[2mms[22m[39m
 [32m✓[39m server/nutritionEngine.productNamePreservation.test.ts [2m([22m[2m1 test[22m[2m)[22m[33m 503[2mms[22m[39m
   [33m[2m✓[22m[39m nutritionEngine product name preservation[2m > [22mpreserva nome especifico informado quando a IA retorna referencia generica [33m502[2mms[22m[39m
 [32m✓[39m server/_core/rateLimit.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m client/src/pages/foodsPageState.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/replyMessages.mealAction.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 34[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/mealCommandParser.relativeDatePunctuation.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 20[2mms[22m[39m
 [32m✓[39m client/src/lib/dateTime.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 52[2mms[22m[39m
 [32m✓[39m server/modules/timeZone/service.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 25[2mms[22m[39m
 [32m✓[39m server/modules/meals/mealImageAssociations.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/messageDeduplicationCache.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m client/src/components/ProfileWhatsappGreetingVisibility.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 5[2mms[22m[39m
 [32m✓[39m server/modules/foods/customFoodSchemas.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 12[2mms[22m[39m
 [32m✓[39m server/privacy.webhookPayload.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 5[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/weightIdempotency.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m server/auth.logout.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 8[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/textIntentPipelinePolicy.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 4[2mms[22m[39m
 [32m✓[39m server/repositories/memoryFallback.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 7[2mms[22m[39m
 [32m✓[39m server/nutritionSafety.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 7[2mms[22m[39m
 [32m✓[39m server/nutritionEngineTextFallback.test.ts [2m([22m[2m1 test[22m[2m)[22m[33m 341[2mms[22m[39m
   [33m[2m✓[22m[39m nutritionEngine.processMealInput text fallback[2m > [22musa o texto informado quando a imagem retorna sem itens [33m339[2mms[22m[39m
 [32m✓[39m server/modules/quickEdit/schemas.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 10[2mms[22m[39m
 [32m✓[39m server/nutritionEngine.panco.test.ts [2m([22m[2m1 test[22m[2m)[22m[33m 466[2mms[22m[39m
   [33m[2m✓[22m[39m nutritionEngine Panco bisnaguinha catalog support[2m > [22mreconhece 1 bisnaguinha Panco como item de catálogo com porção unitária [33m465[2mms[22m[39m
[90mstderr[2m | server/analyticsService.test.ts[2m > [22m[2mAnalyticsService[2m > [22m[2mdoes not throw when the provider fails
[22m[39m[Analytics] Tracking skipped { event: [32m'meal_created'[39m, reason: [32m'provider unavailable'[39m }

 [32m✓[39m server/analyticsService.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 12[2mms[22m[39m
 [32m✓[39m server/_core/sdk.session.test.ts [2m([22m[2m1 test[22m[2m)[22m[33m 317[2mms[22m[39m
   [33m[2m✓[22m[39m sdk session payload[2m > [22msigns and verifies session with only local auth fields [33m315[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/waterFoodText.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m server/modules/foods/portionConversion.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 5[2mms[22m[39m
 [32m✓[39m server/_core/openaiClient.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 7[2mms[22m[39m
 [32m✓[39m client/src/components/DashboardLayout.integrations.test.tsx [2m([22m[2m1 test[22m[2m)[22m[33m 500[2mms[22m[39m
   [33m[2m✓[22m[39m DashboardLayout integrations navigation[2m > [22mexibe Integrações e Dados sincronizados no menu sem o rótulo antigo [33m499[2mms[22m[39m
 [32m✓[39m client/src/features/meals/components/MealItemEditor.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 5[2mms[22m[39m
 [32m✓[39m server/modules/timeZone/civilInput.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 49[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/intentResult.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 3[2mms[22m[39m
 [32m✓[39m client/src/features/meals/components/RegisteredMealGroups.test.tsx [2m([22m[2m2 tests[22m[2m)[22m[33m 519[2mms[22m[39m
   [33m[2m✓[22m[39m RegisteredMealGroups[2m > [22maciona os callbacks de grupo no cabeçalho sem escolher a refeição mais recente [33m426[2mms[22m[39m
 [32m✓[39m client/src/pages/AdminPage.test.tsx [2m([22m[2m1 test[22m[2m)[22m[33m 1409[2mms[22m[39m
   [33m[2m✓[22m[39m AdminPage[2m > [22mpermite digitar um novo token, salvar pela mutation e manter apenas o valor mascarado visível na interface [33m1407[2mms[22m[39m
 [32m✓[39m client/src/pages/SyncedHealthDataPage.test.tsx [2m([22m[2m4 tests[22m[2m)[22m[33m 1584[2mms[22m[39m
   [33m[2m✓[22m[39m SyncedHealthDataPage[2m > [22mrenderiza dados, aplica filtros de origem, tipo, dia selecionado e busca [33m1231[2mms[22m[39m
 [32m✓[39m client/src/hooks/useEffectiveUserTimeZone.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 17[2mms[22m[39m

[2m Test Files [22m [1m[32m261 passed[39m[22m[90m (261)[39m
[2m      Tests [22m [1m[32m1516 passed[39m[22m[90m (1516)[39m
[2m   Start at [22m 22:48:41
[2m   Duration [22m 48.77s[2m (transform 6.89s, setup 0ms, collect 53.66s, tests 27.42s, environment 3.81s, prepare 23.09s)[22m

```

## /tmp/architecture.log
```text

> controle_calorias@1.0.0 architecture:check /home/runner/work/controle_calorias/controle_calorias
> tsx scripts/check-architecture.ts

Arquitetura validada com sucesso.
```

## /tmp/docs.log
```text

> controle_calorias@1.0.0 docs:check /home/runner/work/controle_calorias/controle_calorias
> tsx scripts/generate-db-schema-doc.ts --check && tsx scripts/generate-trpc-routes-doc.ts --check && tsx scripts/check-docs-freshness.ts

docs/generated/db-schema.md está atualizado.
docs/generated/trpc-routes.md está atualizado.
Documentação validada com sucesso.
```

## /tmp/build.log
```text

> controle_calorias@1.0.0 build /home/runner/work/controle_calorias/controle_calorias
> vite build && esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist

[36mvite v7.1.9 [32mbuilding for production...[36m[39m
transforming...
[32m✓[39m 2900 modules transformed.
rendering chunks...
computing gzip size...
[2m../dist/public/[22m[32mindex.html                                                          [39m[1m[2m  1.64 kB[22m[1m[22m[2m │ gzip:   0.67 kB[22m
[2m../dist/public/[22m[2massets/[22m[32mpremium_app_icon_for_a_smart_calorie_control_2-DHnx8LoS.png  [39m[1m[2m827.62 kB[22m[1m[22m
[2m../dist/public/[22m[2massets/[22m[35mindex-tif3NwpT.css                                           [39m[1m[2m134.61 kB[22m[1m[22m[2m │ gzip:  21.00 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mskeleton-DHkFVsUz.js                                         [39m[1m[2m  0.29 kB[22m[1m[22m[2m │ gzip:   0.23 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mdateTime-BdlEi1F-.js                                         [39m[1m[2m  0.35 kB[22m[1m[22m[2m │ gzip:   0.22 kB[22m
[2m../dist/public/[22m[2massets/[22m[36msafeMessages-txLdHCHS.js                                     [39m[1m[2m  0.46 kB[22m[1m[22m[2m │ gzip:   0.31 kB[22m
[2m../dist/public/[22m[2massets/[22m[36museEffectiveUserTimeZone-BiV5p6K-.js                         [39m[1m[2m  0.51 kB[22m[1m[22m[2m │ gzip:   0.32 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mprogress-04p4JVDU.js                                         [39m[1m[2m  0.59 kB[22m[1m[22m[2m │ gzip:   0.36 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mSummaryPill-Dv9ZWIVd.js                                      [39m[1m[2m  0.81 kB[22m[1m[22m[2m │ gzip:   0.41 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mReportsPage-CJfV0KYy.js                                      [39m[1m[2m  0.93 kB[22m[1m[22m[2m │ gzip:   0.51 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mcheckbox-D6Lqs9WH.js                                         [39m[1m[2m  1.08 kB[22m[1m[22m[2m │ gzip:   0.51 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mpopover-CV5iSiLF.js                                          [39m[1m[2m  1.19 kB[22m[1m[22m[2m │ gzip:   0.52 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mRegisteredMealGroupsLazy-B6okzWW6.js                         [39m[1m[2m  1.20 kB[22m[1m[22m[2m │ gzip:   0.62 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mbadge-B9CrFLF-.js                                            [39m[1m[2m  1.31 kB[22m[1m[22m[2m │ gzip:   0.63 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mReportsWeightTrendChart-BzodYWas.js                          [39m[1m[2m  1.38 kB[22m[1m[22m[2m │ gzip:   0.55 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mReportsMacroDistributionChart-XIbCg9pg.js                    [39m[1m[2m  1.57 kB[22m[1m[22m[2m │ gzip:   0.56 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mtabs-B6XE6560.js                                             [39m[1m[2m  1.58 kB[22m[1m[22m[2m │ gzip:   0.65 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mUXState-DPDahoc-.js                                          [39m[1m[2m  1.65 kB[22m[1m[22m[2m │ gzip:   0.69 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mReportTrendChart-Bk20RLTH.js                                 [39m[1m[2m  1.73 kB[22m[1m[22m[2m │ gzip:   0.64 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mPageIntro-DctSpijU.js                                        [39m[1m[2m  1.82 kB[22m[1m[22m[2m │ gzip:   0.71 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mmealViewModels-Bb1WjtgM.js                                   [39m[1m[2m  2.42 kB[22m[1m[22m[2m │ gzip:   1.05 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mRegisterPage-DoDkNw0U.js                                     [39m[1m[2m  2.77 kB[22m[1m[22m[2m │ gzip:   1.02 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mtimeZone-Qq9M-h-N.js                                         [39m[1m[2m  3.33 kB[22m[1m[22m[2m │ gzip:   1.40 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mAuthShell-C3BZTVl8.js                                        [39m[1m[2m  3.73 kB[22m[1m[22m[2m │ gzip:   1.10 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mLoginPage-B7WftzJJ.js                                        [39m[1m[2m  3.75 kB[22m[1m[22m[2m │ gzip:   1.39 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mcalendar-Bo5IHCKy.js                                         [39m[1m[2m  5.05 kB[22m[1m[22m[2m │ gzip:   1.72 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mNotFound-5NNubRAa.js                                         [39m[1m[2m  5.31 kB[22m[1m[22m[2m │ gzip:   1.55 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mMealLabelInput-Brj7Dccl.js                                   [39m[1m[2m  5.34 kB[22m[1m[22m[2m │ gzip:   1.72 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mmeasurementUnits-BLLa6kUc.js                                 [39m[1m[2m  6.08 kB[22m[1m[22m[2m │ gzip:   1.86 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mReportsSupportInsightsSectionContent-6SKI3xMm.js             [39m[1m[2m  8.37 kB[22m[1m[22m[2m │ gzip:   2.15 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mQuickEditExercisePage-CcdIYxKu.js                            [39m[1m[2m  9.42 kB[22m[1m[22m[2m │ gzip:   2.45 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mHealthIntegrationsPage-4tXGSUSn.js                           [39m[1m[2m  9.46 kB[22m[1m[22m[2m │ gzip:   2.70 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mPeriodScopeSelector-C4SbFAdd.js                              [39m[1m[2m 10.22 kB[22m[1m[22m[2m │ gzip:   2.61 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mQuickEditMealPage-CYgssqal.js                                [39m[1m[2m 10.98 kB[22m[1m[22m[2m │ gzip:   3.06 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mWhatsappOnboardingPage-GXIhIF_Z.js                           [39m[1m[2m 15.94 kB[22m[1m[22m[2m │ gzip:   4.15 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mReportAnalyticsSections-D0wttFkB.js                          [39m[1m[2m 16.16 kB[22m[1m[22m[2m │ gzip:   3.08 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mMealItemEditor-B8sm7X_q.js                                   [39m[1m[2m 16.36 kB[22m[1m[22m[2m │ gzip:   3.97 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mRegisteredMealGroups-HACkfzC4.js                             [39m[1m[2m 16.90 kB[22m[1m[22m[2m │ gzip:   4.11 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mChannelsPage-DQj9qxYf.js                                     [39m[1m[2m 19.39 kB[22m[1m[22m[2m │ gzip:   4.33 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mSyncedHealthDataPage-CFMDJllW.js                             [39m[1m[2m 21.92 kB[22m[1m[22m[2m │ gzip:   6.78 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mHome-D7zM9Bxu.js                                             [39m[1m[2m 23.30 kB[22m[1m[22m[2m │ gzip:   6.14 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mFoodsPage-Dx6qeGyW.js                                        [39m[1m[2m 25.88 kB[22m[1m[22m[2m │ gzip:   6.08 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mDashboardLayout-DyD2otck.js                                  [39m[1m[2m 26.08 kB[22m[1m[22m[2m │ gzip:   6.41 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mAdminPage-COqqTdK1.js                                        [39m[1m[2m 28.63 kB[22m[1m[22m[2m │ gzip:   6.52 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mRegisteredMealsPage-BwjDCiHk.js                              [39m[1m[2m 36.12 kB[22m[1m[22m[2m │ gzip:   7.92 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mGoalsPage-BlDPgg7S.js                                        [39m[1m[2m 38.54 kB[22m[1m[22m[2m │ gzip:   9.26 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mReportsExperience-BsFOP552.js                                [39m[1m[2m 41.51 kB[22m[1m[22m[2m │ gzip:  11.00 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mOnboardingPage-BcJKzdyK.js                                   [39m[1m[2m 45.16 kB[22m[1m[22m[2m │ gzip:  10.59 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mLogMealPage-Dk_5WNbm.js                                      [39m[1m[2m 46.95 kB[22m[1m[22m[2m │ gzip:   9.56 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mProfessionalReportsPage-Dd5cGR4n.js                          [39m[1m[2m 49.07 kB[22m[1m[22m[2m │ gzip:  10.11 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mvendor-charts-JuSb-lhA.js                                    [39m[1m[2m 68.52 kB[22m[1m[22m[2m │ gzip:  22.59 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mindex-CcsHAT92.js                                            [39m[1m[2m 70.23 kB[22m[1m[22m[2m │ gzip:  18.65 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mvendor-data-BKY_3XdK.js                                      [39m[1m[2m 73.21 kB[22m[1m[22m[2m │ gzip:  21.00 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mvendor-react-DexXuOcV.js                                     [39m[1m[2m 89.85 kB[22m[1m[22m[2m │ gzip:  29.23 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mvendor-ui-CK5ETL_R.js                                        [39m[1m[2m117.93 kB[22m[1m[22m[2m │ gzip:  33.42 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mvendor-DpiD4X3f.js                                           [39m[1m[2m137.12 kB[22m[1m[22m[2m │ gzip:  47.45 kB[22m
[2m../dist/public/[22m[2massets/[22m[36mvendor-react-dom-Cy752G0q.js                                 [39m[1m[2m493.91 kB[22m[1m[22m[2m │ gzip: 132.30 kB[22m
[32m✓ built in 6.84s[39m

  dist/index.js  1.4mb ⚠️

⚡ Done in 59ms
```

## /tmp/agent.log
```text
 [32m✓[39m server/modules/whatsapp/intent/mealTargetResolution.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 84[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/intent/dateTime.test.ts [2m([22m[2m8 tests[22m[2m)[22m[90m 135[2mms[22m[39m
 [32m✓[39m server/safeMessages.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 11[2mms[22m[39m
[90mstderr[2m | server/modules/whatsapp/mealContextContract.test.ts[2m > [22m[2missue #783 — bloco canônico de contexto da refeição[2m > [22m[2mreutiliza o mesmo bloco na consulta da refeição
[22m[39m[TimeZone] Effective timezone fallback applied { reason: [32m'profile_missing'[39m }

 [32m✓[39m server/modules/whatsapp/mealContextContract.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 39[2mms[22m[39m
 [32m✓[39m server/repositories/whatsappConversationMessageEnrichmentRepository.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 10[2mms[22m[39m
 [32m✓[39m server/modules/meals/service.relativeDate.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 27[2mms[22m[39m
 [32m✓[39m server/modules/appSecrets/encryption.test.ts [2m([22m[2m7 tests[22m[2m)[22m[90m 9[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/foodIcons.test.ts [2m([22m[2m35 tests[22m[2m)[22m[90m 20[2mms[22m[39m
 [32m✓[39m server/nutritionEngine.lowCalorieBeverages.test.ts [2m([22m[2m4 tests[22m[2m)[22m[33m 334[2mms[22m[39m
   [33m[2m✓[22m[39m nutritionEngine low-calorie beverage handling[2m > [22mtrata cafe sem acucar por xicara como caloria praticamente nula [33m319[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/intentContext.currentMessage.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 5[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/replyMessages.estimatedNutrition.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 35[2mms[22m[39m
 [32m✓[39m server/modules/goals/schemas.test.ts [2m([22m[2m9 tests[22m[2m)[22m[90m 15[2mms[22m[39m
 [32m✓[39m server/modules/professionals/schemas.test.ts [2m([22m[2m7 tests[22m[2m)[22m[90m 8[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/conversationRetentionService.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 9[2mms[22m[39m
[90mstderr[2m | server/modules/whatsapp/intentActions.multipleItems.test.ts[2m > [22m[2mexecuteWhatsappTextIntent multiple food additions[2m > [22m[2madiciona dois itens distintos com marcas ao jantar de ontem
[22m[39m[TimeZone] Effective timezone fallback applied { reason: [32m'profile_missing'[39m }

 [32m✓[39m server/modules/whatsapp/intentActions.multipleItems.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 66[2mms[22m[39m
 [32m✓[39m server/modules/insights/schemas.test.ts [2m([22m[2m8 tests[22m[2m)[22m[90m 10[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/contextualFoodReplacementIntent.multipleAmbiguities.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 14[2mms[22m[39m
 [32m✓[39m server/whatsappImageIdempotencyWebhook.failure.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 10[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/foodAssistant.test.ts [2m([22m[2m12 tests[22m[2m)[22m[90m 13[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/processingAcknowledgement.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 12[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/conversationContextRollout.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 4[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/quantityUnitVocabulary.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 5[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/deleteIntent.selection.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 36[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/mealConsolidation.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 26[2mms[22m[39m
[90mstderr[2m | server/modules/whatsapp/annotatedImage.test.ts[2m > [22m[2mgenerateAnnotatedMealImage[2m > [22m[2mdoes not call the image generation provider when local overlay fails for an original meal photo
[22m[39m[WhatsAppAnnotatedImage] Local overlay failed; skipping generated-image fallback for original meal photo. sharp unavailable

 [32m✓[39m server/modules/whatsapp/annotatedImage.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 13[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/logicalReplyDelivery.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/mealCommandParser.targetMealRegression.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 28[2mms[22m[39m
 [32m✓[39m server/modules/goals/nutritionGoalService.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 9[2mms[22m[39m
 [32m✓[39m server/modules/onboarding/service.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 34[2mms[22m[39m
 [32m✓[39m client/src/pages/GoalsPage.timeZoneFallback.test.tsx [2m([22m[2m1 test[22m[2m)[22m[33m 366[2mms[22m[39m
   [33m[2m✓[22m[39m GoalsPage timezone fallback[2m > [22mrenderiza metas e inicia a consulta quando o fallback degradado está resolvido [33m365[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/intentContextUsage.inventory.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 7[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/domainReplyFormatters.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 23[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/replyMessages.standard.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m server/modules/insights/reportMetrics.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 8[2mms[22m[39m
 [32m✓[39m server/modules/admin/logs.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 12[2mms[22m[39m
 [32m✓[39m server/breadVariationMatching.test.ts [2m([22m[2m6 tests[22m[2m)[22m[90m 126[2mms[22m[39m
 [32m✓[39m client/src/features/meals/habitRecordViewModels.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 33[2mms[22m[39m
 [32m✓[39m server/repositories/accountRepository.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m server/whatsappWebhook.secret.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 5[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/timeZoneContext.test.ts [2m([22m[2m7 tests[22m[2m)[22m[90m 39[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/replyMessages.auxiliary.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 6[2mms[22m[39m
[90mstderr[2m | server/_core/imageGeneration.fallback.test.ts[2m > [22m[2mgenerateImage fallback[2m > [22m[2mgera uma imagem PNG local quando o provider de imagem não está configurado
[22m[39m[ImageGeneration] OpenAI image generation is not configured; using local fallback image.

 [32m✓[39m server/_core/imageGeneration.fallback.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 68[2mms[22m[39m
 [32m✓[39m server/privacy.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 7[2mms[22m[39m
 [32m✓[39m server/modules/mealSchedules/service.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 31[2mms[22m[39m
 [32m✓[39m server/modules/meals/mealItemDeduplication.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 11[2mms[22m[39m
 [32m✓[39m server/nutritionEngine.productNamePreservation.test.ts [2m([22m[2m1 test[22m[2m)[22m[33m 540[2mms[22m[39m
   [33m[2m✓[22m[39m nutritionEngine product name preservation[2m > [22mpreserva nome especifico informado quando a IA retorna referencia generica [33m538[2mms[22m[39m
 [32m✓[39m server/_core/rateLimit.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 5[2mms[22m[39m
 [32m✓[39m client/src/pages/foodsPageState.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/replyMessages.mealAction.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 47[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/mealCommandParser.relativeDatePunctuation.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 28[2mms[22m[39m
 [32m✓[39m server/modules/timeZone/service.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 22[2mms[22m[39m
 [32m✓[39m client/src/lib/dateTime.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 53[2mms[22m[39m
 [32m✓[39m server/modules/meals/mealImageAssociations.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m client/src/components/ProfileWhatsappGreetingVisibility.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 5[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/messageDeduplicationCache.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 7[2mms[22m[39m
 [32m✓[39m server/modules/foods/customFoodSchemas.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 11[2mms[22m[39m
 [32m✓[39m server/privacy.webhookPayload.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 5[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/weightIdempotency.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 4[2mms[22m[39m
 [32m✓[39m server/auth.logout.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 4[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/textIntentPipelinePolicy.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 4[2mms[22m[39m
 [32m✓[39m server/repositories/memoryFallback.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 5[2mms[22m[39m
 [32m✓[39m server/nutritionSafety.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 7[2mms[22m[39m
 [32m✓[39m server/nutritionEngineTextFallback.test.ts [2m([22m[2m1 test[22m[2m)[22m[33m 375[2mms[22m[39m
   [33m[2m✓[22m[39m nutritionEngine.processMealInput text fallback[2m > [22musa o texto informado quando a imagem retorna sem itens [33m373[2mms[22m[39m
 [32m✓[39m server/modules/quickEdit/schemas.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 10[2mms[22m[39m
 [32m✓[39m server/_core/sdk.session.test.ts [2m([22m[2m1 test[22m[2m)[22m[90m 296[2mms[22m[39m
 [32m✓[39m server/nutritionEngine.panco.test.ts [2m([22m[2m1 test[22m[2m)[22m[33m 428[2mms[22m[39m
   [33m[2m✓[22m[39m nutritionEngine Panco bisnaguinha catalog support[2m > [22mreconhece 1 bisnaguinha Panco como item de catálogo com porção unitária [33m426[2mms[22m[39m
[90mstderr[2m | server/analyticsService.test.ts[2m > [22m[2mAnalyticsService[2m > [22m[2mdoes not throw when the provider fails
[22m[39m[Analytics] Tracking skipped { event: [32m'meal_created'[39m, reason: [32m'provider unavailable'[39m }

 [32m✓[39m server/analyticsService.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 7[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/waterFoodText.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m server/modules/foods/portionConversion.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 5[2mms[22m[39m
 [32m✓[39m server/_core/openaiClient.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m client/src/components/DashboardLayout.integrations.test.tsx [2m([22m[2m1 test[22m[2m)[22m[33m 493[2mms[22m[39m
   [33m[2m✓[22m[39m DashboardLayout integrations navigation[2m > [22mexibe Integrações e Dados sincronizados no menu sem o rótulo antigo [33m491[2mms[22m[39m
 [32m✓[39m client/src/features/meals/components/MealItemEditor.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 5[2mms[22m[39m
 [32m✓[39m server/modules/timeZone/civilInput.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 48[2mms[22m[39m
 [32m✓[39m server/modules/whatsapp/intentResult.test.ts [2m([22m[2m2 tests[22m[2m)[22m[90m 8[2mms[22m[39m
 [32m✓[39m client/src/features/meals/components/RegisteredMealGroups.test.tsx [2m([22m[2m2 tests[22m[2m)[22m[33m 431[2mms[22m[39m
   [33m[2m✓[22m[39m RegisteredMealGroups[2m > [22maciona os callbacks de grupo no cabeçalho sem escolher a refeição mais recente [33m376[2mms[22m[39m
 [32m✓[39m client/src/pages/AdminPage.test.tsx [2m([22m[2m1 test[22m[2m)[22m[33m 1430[2mms[22m[39m
   [33m[2m✓[22m[39m AdminPage[2m > [22mpermite digitar um novo token, salvar pela mutation e manter apenas o valor mascarado visível na interface [33m1428[2mms[22m[39m
 [32m✓[39m client/src/pages/SyncedHealthDataPage.test.tsx [2m([22m[2m4 tests[22m[2m)[22m[33m 1596[2mms[22m[39m
   [33m[2m✓[22m[39m SyncedHealthDataPage[2m > [22mrenderiza dados, aplica filtros de origem, tipo, dia selecionado e busca [33m1262[2mms[22m[39m
 [32m✓[39m client/src/hooks/useEffectiveUserTimeZone.test.ts [2m([22m[2m3 tests[22m[2m)[22m[90m 17[2mms[22m[39m

[2m Test Files [22m [1m[32m261 passed[39m[22m[90m (261)[39m
[2m      Tests [22m [1m[32m1516 passed[39m[22m[90m (1516)[39m
[2m   Start at [22m 22:49:46
[2m   Duration [22m 48.90s[2m (transform 6.69s, setup 0ms, collect 53.62s, tests 27.49s, environment 3.86s, prepare 22.83s)[22m


> controle_calorias@1.0.0 architecture:check /home/runner/work/controle_calorias/controle_calorias
> tsx scripts/check-architecture.ts

Arquitetura validada com sucesso.

> controle_calorias@1.0.0 docs:check /home/runner/work/controle_calorias/controle_calorias
> tsx scripts/generate-db-schema-doc.ts --check && tsx scripts/generate-trpc-routes-doc.ts --check && tsx scripts/check-docs-freshness.ts

docs/generated/db-schema.md está atualizado.
docs/generated/trpc-routes.md está atualizado.
Documentação validada com sucesso.
```

## /tmp/ci_docs.log
```text
Gate de CI documentado e alinhado com o workflow.
```
