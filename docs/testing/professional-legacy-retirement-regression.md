# Aposentadoria do legado profissional: inventário e regressão

## Objetivo

Manter a evidência versionada do gate final da issue #815. Este documento relaciona cada artefato legado ao substituto canônico e define a regressão executada por `pnpm test`, `pnpm professional-retirement:check` e pelo workflow TiDB.

## Inventário de artefatos legados

| Categoria         | Artefato legado                                                                          | Consumidores inventariados                   | Substituição ou decisão                                                        | Evidência de remoção/retensão                         |
| ----------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Página            | `client/src/pages/ProfessionalPage.tsx`                                                  | rota profissional antiga e testes históricos | removida; experiência atual em `ProfessionalWorkspacePage` e páginas dedicadas | arquivo ausente e gate estático                       |
| URL               | `/professional/legacy`                                                                   | favoritos, cache e sessões antigas           | redirecionamento seguro para `/professional`                                   | `App.professionalNavigation.test.tsx`                 |
| Navegação         | botão “Experiência legada”                                                               | sidebar profissional antiga                  | descontinuado                                                                  | ausência em `ProfessionalLayout.tsx`                  |
| tRPC              | `nutrition.professionals.askPatientQuestion`                                             | workspace de IA antigo                       | `professionalRecord.ai.generate`                                               | router/schema sem contrato antigo; testes da IA atual |
| Serviço           | `answerProfessionalPatientQuestion` e parsing do provider antigo                         | procedure removida                           | `aiService.ts` com contexto canônico, segurança e rastreabilidade              | busca estática e suíte de IA                          |
| Schemas           | `professionalPatientQuestionSchema` / resposta antiga                                    | procedure removida                           | schemas de `aiSchemas.ts`                                                      | gate estático e docs geradas                          |
| Maps              | `profiles` e `accesses` em `service.ts`                                                  | fallback de processo da fachada antiga       | repositories canônicos                                                         | ausência no serviço; TiDB entre instâncias            |
| Reconciliação     | `reconcilePatientAccessRequests`, `persistAccessForBothSides` e estado assimétrico local | leituras profissionais e WhatsApp            | autorização canônica única                                                     | testes de vínculo, concorrência e WhatsApp            |
| Adapter           | `writeLegacyProfile`                                                                     | gravação de perfil                           | `professionalProfiles`                                                         | ausência no repository                                |
| Adapter           | `writeLegacyAuthorization`                                                               | solicitação, decisão e revogação             | `professionalPatientAuthorizations`                                            | ausência no repository                                |
| Migração lazy     | `migrateLegacyUser` / `migrateRelatedAuthorizations`                                     | leituras de perfil e vínculo                 | comando explícito `db:migrate:professionals`                                   | teste TiDB prova ausência antes do backfill           |
| Preferência JSON  | `professional_profile_v1`                                                                | perfil antigo                                | `professionalProfiles`                                                         | verificação integral antes de limpeza                 |
| Preferência JSON  | `professional_accesses_v1`                                                               | lado profissional do vínculo                 | `professionalPatientAuthorizations`                                            | verificação integral antes de limpeza                 |
| Preferência JSON  | `patient_professional_access_requests_v1`                                                | lado paciente do vínculo e WhatsApp          | autorização canônica única                                                     | teste de vínculo assimétrico e callback               |
| Preferência JSON  | `patient_professional_goal_suggestions_v1`                                               | sugestões antigas do paciente                | `professionalGoalSuggestions`                                                  | migração global explícita, sem lazy/dual-write        |
| Teste obsoleto    | `service.reconciliation.test.ts`                                                         | maps e reconciliação removidos               | testes canônicos e TiDB                                                        | arquivo removido                                      |
| Documento gerado  | lista parcial de `professionalRecord`                                                    | consumidores de contrato                     | grupos aninhados de mensagens, alertas, IA e configurações                     | `docs:generate:trpc`                                  |
| Preferência ativa | `professional_settings_v1`                                                               | configurações atuais da issue #814           | mantida; não pertence à experiência aposentada                                 | documentada como contrato atual, não removida         |

## Matriz de regressão reproduzível

| Área/cenário                                                 | Ação crítica comprovada                                                        | Evidência executável                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| Paciente — Hoje                                              | renderiza metas, consumo, exercícios e água                                    | `nutritionPages.test.tsx`                      |
| Paciente — Registrar                                         | carrega registro multimodal, água, exercício e peso                            | `nutritionPages.test.tsx`                      |
| Paciente — Registros                                         | renderiza registros e detalhes operacionais                                    | `nutritionPages.test.tsx`                      |
| Paciente — Metas                                             | renderiza meta geral, exceções e soma semanal                                  | `nutritionPages.test.tsx` e navegação de metas |
| Paciente — Relatórios                                        | renderiza contratos canônicos de período e indicadores                         | `nutritionPages.test.tsx`                      |
| Paciente — Configurações                                     | mantém perfil, vínculos e solicitações                                         | `nutritionPages.test.tsx`                      |
| Profissional — URL antiga/cache                              | acessa bookmark antigo e termina na experiência atual, sem UI legada           | `App.professionalNavigation.test.tsx`          |
| Profissional — perfil inativo                                | bloqueia workspace e não exibe contexto                                        | `App.professionalNavigation.test.tsx`          |
| Profissional — autorização                                   | revalida backend antes de abrir paciente                                       | `App.professionalNavigation.test.tsx`          |
| Profissional — revogação/cache                               | falha de revalidação impede abertura de contexto antigo                        | `App.professionalNavigation.test.tsx`          |
| Profissional — carteira/prontuário/metas                     | usa páginas e procedures atuais com isolamento                                 | suíte profissional e `professionalRecord`      |
| Profissional — alertas/mensagens/relatórios/IA/configurações | usa routers aninhados e componentes dedicados                                  | testes dos componentes e docs tRPC geradas     |
| WhatsApp — vínculo                                           | botão autoriza/recusa uma vez e não reativa estado consumido                   | `messageRouter.interactiveCallback.test.ts`    |
| Migração parcial                                             | runtime não lê JSON; backfill explícito torna dados visíveis                   | `test-professional-persistence-tidb.ts`        |
| Migração incompatível                                        | canônico mais novo, porém incompleto, bloqueia `--apply` e preserva JSON       | `test-professional-persistence-tidb.ts`        |
| Idempotência                                                 | backfills repetidos não duplicam nem reescrevem estado atual                   | workflow Professional persistence TiDB         |
| Rollout                                                      | limpeza ocorre somente após deploy canônico saudável                           | runbook de aposentadoria                       |
| Rollback                                                     | tabelas canônicas e backup são preservados; não há restauração parcial de JSON | runbook de aposentadoria                       |

## Execução

`pnpm agent:check` executa type-check, suíte completa, arquitetura, este gate e documentação. O workflow **Professional persistence TiDB gate** executa schema real, migração explícita, cenário adversarial de cobertura, dry-run, aplicação, idempotência e integridade referencial.

No ambiente alvo, registre conforme o runbook: SHA publicado, saída JSON do dry-run e do modo `--apply`, resultado da matriz funcional e decisão de prosseguir ou reverter.
