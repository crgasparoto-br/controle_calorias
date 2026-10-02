# Design técnico: persistência e banco

## Fonte de verdade

`drizzle/schema.ts` e os schemas de domínio em `drizzle/*-schema.ts` são a fonte de verdade do modelo relacional. Migrações em `drizzle/` devem refletir mudanças de schema e ser aplicadas antes de validar fluxos em produção.


## Direção de persistência para Food Intelligence V2

O ADR `adr-food-intelligence-resolver-v2.md` define a consolidação futura do conhecimento alimentar.

A decisão atual é **remodelar o domínio alimentar antes de consolidar o V2**, aproveitando o volume reduzido atual para eliminar a duplicidade estrutural em vez de mantê-la indefinidamente.

Durante a migração, `foods`, `food_aliases`, `food_portions`, `food_sources`, `foodCatalog`, `whatsappLearningArtifacts` e estruturas legadas ainda podem coexistir por compatibilidade. Essa coexistência é temporária.

Modelo lógico alvo:

- `foods`: identidade/família canônica, sem ser a fonte direta de macros;
- `food_variants`: identidade concreta resolvível, genérica ou comercial;
- `food_variant_sources`: identidade da variante em fontes externas;
- `food_nutrition_profiles`: nutrição versionada e governada;
- `food_variant_classifications`: classificação versionada usada por relatórios/qualidade;
- `food_aliases`: aliases globais governados;
- `user_food_aliases`: aprendizado pessoal isolado;
- `food_portions`: medidas/gramaturas por variante e procedência;
- `food_barcodes`: identidade comercial exata;
- `food_evidence`: evidência normalizada com retenção/LGPD;
- `food_review_cases` + `food_review_events`: governança administrativa;
- `food_resolution_events`: rastreabilidade sanitizada do resolvedor.


### Modelo físico alvo e consolidação

O modelo físico base foi fechado no ADR e passa a orientar as futuras migrations do Food Intelligence V2.

| Estrutura | Papel alvo |
| --- | --- |
| `foodBrands` | Marca; permanece como cadastro de referência |
| `food_sources` | Origem/versionamento de fontes |
| `foods` | Família/identidade canônica, sem macros |
| `food_variants` | Identidade concreta resolvível |
| `food_variant_sources` | Chave/URL de identidade da variante em fontes externas |
| `food_nutrition_profiles` | Única fonte persistente de nutrição canônica por variante, com versão/status/vigência |
| `food_variant_classifications` | Processamento/flags usados em relatórios, versionados separadamente |
| `food_aliases` | Alias global apontando para variante |
| `user_food_aliases` | Memória pessoal de alias |
| `food_portions` | Única tabela canônica de porções por variante |
| `food_barcodes` | Barcode único apontando para variante |
| `food_evidence` | Evidência sanitizada e auditável |
| `food_review_cases` / `food_review_events` | Governança global e histórico append-only |
| `food_resolution_events` | Rastreabilidade sanitizada com retenção |
| `user_food_favorites` | Único modelo de favoritos, por variante |
| `user_food_usage_stats` | Frequência/recência por variante |
| `mealItems` | Referências opcionais a variante/perfil/porção + snapshot imutável |

Duplicidades a aposentar no cutover:

- `foodCatalog`;
- `portions` ligada a `foodCatalog`;
- `foodFavorites`;
- macros e nutrientes persistidos diretamente em `foods`;
- FKs simultâneas `foodId + foodCatalogId + portionId` em `mealItems`;
- conjunto duplicado de macros `calories/protein/carbs/fat` versus `caloriesKcal/proteinG/carbG/fatG`;
- uso alimentar permanente de `whatsappLearningArtifacts`.

A migração deve preservar `processingLevel`, `isFruit`, `isVegetable` e `isUltraProcessed` em `food_variant_classifications` e no snapshot histórico quando esses valores forem usados por relatórios.

Novas tabelas do domínio alimentar devem privilegiar colunas tipadas para campos usados em busca, join, ranking, status e integridade. JSON fica restrito a nutrientes de cauda longa, qualificadores não indexados e payloads sanitizados de auditoria.

`mealItems` deve convergir para um único conjunto de nutrientes de snapshot: `grams`, `caloriesKcal`, `proteinG`, `carbG`, `fatG`, `fiberG` e `sodiumMg`, preservando `foodSnapshotJson` como prova do valor efetivamente usado.


Regras para novas mudanças:

- novos alimentos, aliases, porções, variantes e evidências não devem ganhar arrays/constantes TypeScript como fonte permanente;
- `foodCatalog` e `portions` ligados a ele são legado a aposentar, não destinos para novos recursos;
- macros não devem permanecer acoplados à identidade quando a migração V2 separar perfis nutricionais;
- uma nova fonte persistente que responda à mesma pergunta alimentar exige plano explícito de consolidação, compatibilidade e aposentadoria;
- memória pessoal e conhecimento global devem permanecer distinguíveis;
- snapshots históricos de refeição não podem ser reescritos quando o conhecimento global for corrigido;
- `mealItems` deve migrar para referências de variante/perfil preservando o snapshot usado no cálculo;
- não manter dual-write indefinido entre V1 e V2;
- migrações do Food Intelligence V2 deverão atualizar também `docs/generated/db-schema.md`.

## Tabelas críticas

| Tabela                                | Papel                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `users`                               | Identidade interna e papel                                                 |
| `userProfiles`                        | Perfil nutricional e onboarding                                            |
| `nutritionGoals`                      | Metas e exceções                                                           |
| `food_sources`                        | Fontes nutricionais, versão e código de origem do catálogo global          |
| `foods`                               | Catálogo alimentar global e alimentos personalizados por usuário           |
| `food_aliases`                        | Nomes alternativos normalizados para busca no catálogo                     |
| `food_portions`                       | Porções e medidas caseiras por alimento do catálogo                        |
| `meals`                               | Cabeçalho da refeição                                                      |
| `mealItems`                           | Itens nutricionais por refeição, incluindo snapshot nutricional histórico  |
| `mealMedia`                           | Referências de mídia                                                       |
| `mealInferences`                      | Rascunhos e inferências de IA                                              |
| `habitMemories`                       | Memória de hábitos alimentares                                             |
| `healthSyncedRecords`                 | Histórico persistido de dados importados de integrações de saúde           |
| `professionalProfiles`                | Perfil profissional adicional à conta pessoal                              |
| `professionalPatientAuthorizations`   | Consentimento e revogação do acesso profissional aos dados do paciente     |
| `professionalPatientTrackings`        | Situação operacional do acompanhamento, separada da autorização            |
| `professionalPatientTrackingEvents`   | Histórico auditável das transições do acompanhamento                       |
| `professionalComments`                | Comentários internos do profissional, isolados por profissional e paciente |
| `professionalGoalSuggestions`         | Sugestões de meta com estado, versão e conteúdo nutricional                |
| `professionalMealSuggestions`         | Sugestões de refeição/plano com estado e versão                            |
| `professionalHistoryEvents`           | Linha do tempo profissional sem payload clínico bruto                      |
| `professionalOfficialGoals`           | Versões oficiais com autoria, vigência, exceções e controle único          |
| `professionalGoalReviewRequests`      | Solicitações idempotentes de revisão feitas pelo paciente                  |
| `professionalGoalNotifications`       | Estado e tentativas de notificação da ativação pelo WhatsApp               |
| `whatsappConnections`                 | Vínculo telefone do usuário ↔ usuário interno                             |
| `whatsappPendingOperations`           | Estado durável de interações multietapas antes de qualquer outbound        |
| `inferenceLogs`                       | Logs seguros de inferência                                                 |
| `appSecrets`                          | Segredos operacionais criptografados                                       |
| `professionalConversations`           | Conversa canônica por autorização profissional                             |
| `professionalMessages`                | Mensagens lógicas, autoria, origem, resposta e estado                      |
| `professionalMessageDeliveryAttempts` | Tentativas físicas e claims idempotentes de entrega                        |
| `billingProducts`                     | Identidade estável das famílias comerciais                                 |
| `billingPlans`                        | Versões comerciais contratáveis e históricas                               |
| `billingCoupons`                      | Revisões de política de cupom                                              |
| `billingCouponRedemptions`            | Reserva/uso idempotente de cupom por contratação                           |
| `billingCommercialAuditEvents`        | Auditoria administrativa de produto, versão e cupom                        |

## Regras

- Toda FK de dados do usuário deve preservar isolamento por `userId`.
- Exclusão de usuário deve apagar dados dependentes sempre que a relação tiver `onDelete: cascade`.
- Dados sensíveis textuais devem ter política explícita de retenção antes de novos usos.
- `server/db.ts` ainda concentra funções legadas; novas áreas devem preferir repositories por domínio.
- Alimentos globais usam `foods.owner_user_id = null` e devem ser visíveis para todos os usuários.
- Alimentos personalizados usam `foods.owner_user_id = <user_id>` e devem ser filtrados pelo usuário dono.
- Refeições futuras devem salvar consumo real em itens de refeição com snapshot nutricional, sem duplicar dados globais do catálogo.
- Alterações futuras em `foods` não devem recalcular refeições antigas silenciosamente.
- Dados sincronizados de integrações de saúde devem ser apagados quando o usuário desconectar o provider correspondente.
- Revogação de autorização profissional prevalece sobre a situação operacional do acompanhamento.
- Uma autorização aprovada pode ter somente um acompanhamento canônico e cada transição deve registrar ator, data e motivo quando informado.
- `userProfiles.timezone` usa `America/Sao_Paulo` como default persistido; `UTC` e qualquer IANA válido já salvo são preservados.
- Decisões de data lógica devem consumir o contrato de `docs/design-docs/timezone.md`; não criar fallback local nem limites fixos em meia-noite UTC.
- Mensagens profissionais não reutilizam payload bruto do WhatsApp. Cada retry acrescenta uma tentativa sanitizada sem duplicar a mensagem lógica.
- Uma operação pendente do WhatsApp deve ser persistida em `whatsappPendingOperations` antes de enviar pergunta, botão ou solicitação que dependa desse contexto. Falha de criação impede o outbound e qualquer mutação de domínio.
- `server/repositories/whatsappPendingOperationRepository.ts` pode usar memória do processo somente em testes ou desenvolvimento não produtivo com `ALLOW_MEMORY_PERSISTENCE=true`. Em produção, banco ausente ou falhando retorna resultados fail-closed para criação, leitura, claim e transições; memória local nunca é tratada como persistência durável.

## Catálogo global de alimentos — baseline produtivo transitório

> Esta seção descreve o runtime/schema atual antes do cutover do Food Intelligence V2. Ela não define o modelo físico alvo.

A migration `0000_global_food_catalog.sql` cria a primeira estrutura dedicada ao catálogo alimentar global:

- `food_sources` registra fonte, versão e metadados de origem, como TACO/TBCA ou curadoria interna.
- `foods` concentra alimentos globais e personalizados, com nutrientes principais por 100 g, `nutrients_json`, `status` e `merged_into_food_id`.
- `food_aliases` permite busca por nomes alternativos normalizados.
- `food_portions` registra porções e medidas caseiras ligadas ao alimento.

A estratégia inicial contra duplicidade usa `foods_source_code_unique` para impedir repetição de `source_id` + `source_food_code` quando a fonte disponibiliza código estável.

## Snapshot nutricional de refeições — baseline produtivo transitório

> O princípio de snapshot imutável permanece no V2, mas as FKs e colunas duplicadas atuais serão consolidadas conforme o ADR.

A migration idempotente `0035_meal_item_nutrition_snapshot_repair.sql` garante em `mealItems` os campos `foodId`, `grams`, macros calculados, `fiberG`, `sodiumMg` e `foodSnapshotJson` mesmo em ambientes com histórico antigo de migrations.

Quando um item é registrado com `foodId`, o backend calcula os nutrientes a partir dos valores por 100 g do catálogo e da gramagem consumida. O snapshot grava nome, fonte, versão, status e nutrientes usados no cálculo para preservar o histórico mesmo se o alimento global for corrigido, depreciado ou mesclado depois.

## Dados sincronizados de integrações

A migration `0002_health_synced_records.sql` cria `healthSyncedRecords` para persistir registros importados de providers externos, como Strava.

A tabela armazena `provider`, `externalRecordId`, `dataType`, `measuredAt`, `value`, `unit`, detalhes opcionais de atividade/energia e `metadataJson`. O índice único por usuário, provider, identificador externo e tipo de dado permite sincronizações idempotentes, atualizando registros já conhecidos sem duplicar histórico.

O router de integrações grava os registros retornados por `sync`, consulta primeiro o histórico persistido para a tela de dados sincronizados e remove os registros do provider quando o usuário desconecta a integração. Dados transitórios em memória seguem como fallback quando o banco não está disponível ou ainda não há histórico persistido.

## Fundação persistente da Área Profissional

A migration `0026_professional_persistence_foundation.sql` cria o modelo canônico de perfil, autorização, acompanhamento e eventos de transição.

Durante a fundação iniciada pela migration `0026_professional_persistence_foundation.sql`, perfil, autorizações, acompanhamento e sugestões profissionais de meta foram migrados de quatro preferências JSON temporárias para estruturas canônicas. A janela de compatibilidade foi encerrada pela issue #815:

- runtime profissional lê e escreve somente `professionalProfiles`, `professionalPatientAuthorizations`, `professionalPatientTrackings` e `professionalGoalSuggestions`;
- as chaves `professional_profile_v1`, `professional_accesses_v1`, `patient_professional_access_requests_v1` e `patient_professional_goal_suggestions_v1` não são consultadas nem atualizadas por fluxos web, WhatsApp ou tRPC;
- maps em memória permanecem apenas como fallback de teste/desenvolvimento quando não existe conexão; produção falha com erro sanitizado;
- migração e remoção das preferências antigas existem somente nos comandos operacionais explícitos;
- o modo de aplicação destrutiva compara identidade, campos imutáveis, marcos temporais, progressão de estado e conteúdo das sugestões antes de excluir qualquer linha;
- divergência, JSON inválido ou cobertura incompleta interrompe a operação sem remover dados;
- a ordem de rollout e rollback está em `docs/runbooks/professional-legacy-retirement.md` e o inventário verificável em `docs/testing/professional-legacy-retirement-regression.md`.

A migration `0028_professional_actor_deletion_safety.sql` altera as referências de ator das transições para `ON DELETE SET NULL`: a autoria é preservada enquanto a conta existir, e a exclusão do titular não fica bloqueada por eventos históricos.

As migrations `0027_professional_content_persistence.sql` e `0029_professional_goal_decision_lock.sql` eliminam a dependência de arrays locais para comentários, sugestões de meta/refeição e histórico profissional:

- `server/repositories/professionalContentRepository.ts` é a fonte canônica para criação, leitura e transição desses registros;
- comentário ou sugestão e seu evento de criação são gravados na mesma transação;
- decisões de sugestão usam reserva persistente temporária (`decisionLockId`/`decisionLockedAt`) e comparação otimista; somente a operação reservada aplica a meta, falhas liberam a reserva e retries com o mesmo resultado permanecem idempotentes sem regressão para outro estado final;
- listagens usam ordem estável por `createdAt` e `id`, limite padrão de 100 e máximo de 200, com cursor interno para paginação;
- o histórico guarda somente ator, profissional, paciente, tipo, entidade e data, sem copiar comentário, justificativa, meta ou conteúdo de refeição;
- a preferência `patient_professional_goal_suggestions_v1` foi importada por backfill global idempotente; após a issue #815, somente comandos operacionais explícitos podem lê-la e nenhum fluxo canônico faz dual-write;
- comentários, sugestões de refeição e eventos que existiam apenas na memória de uma instância antes do deploy não possuem fonte recuperável e não podem ser migrados retroativamente;
- o fallback em memória continua restrito à execução sem banco usada pelos testes e pelo modo local permitido, nunca como fonte autoritativa quando `getDb()` retorna uma conexão.

A aposentadoria da compatibilidade segue esta ordem:

1. aplicar migrations com `pnpm db:push` ou o comando operacional vigente;
2. executar `pnpm db:migrate:professionals` para o backfill global das quatro preferências; o comando falha quando não existe conexão com o banco;
3. repetir o backfill para comprovar idempotência;
4. executar `pnpm db:retire-professional-legacy` em dry-run e interromper diante de qualquer divergência;
5. publicar e validar a versão canônica sem lazy migration nem dual-write;
6. executar `pnpm db:retire-professional-legacy:apply` somente conforme o runbook, depois de encerrar instâncias antigas.

## Metas profissionais oficiais

A migration `0032_professional_official_goals.sql` cria o modelo versionado da issue #809:

- `professionalOfficialGoals` referencia autorização e acompanhamento, guarda alvo nutricional, exceções, regra de exercício, vigência, justificativa, versão anterior e motivo de encerramento;
- `professionalOfficialGoals_active_patient_uq` usa uma chave anulável por paciente para impedir dois controles profissionais oficiais simultâneos sem limitar o histórico;
- a consulta `professionalOfficialGoals_patient_effective_idx` resolve a versão aplicável por paciente e data sem varrer metas de outros usuários;
- revisão encerra a janela anterior, cria a próxima versão, resolve solicitações abertas, grava histórico e enfileira notificação dentro de uma transação;
- `professionalGoalReviewRequests_open_uq` torna o pedido aberto idempotente por paciente e versão da meta;
- `professionalGoalNotifications_idempotency_uq`, `status`, `claimToken` e `claimedAt` coordenam retry entre instâncias. Falha externa nunca desfaz a meta já persistida;
- pausa não altera a janela da meta. Encerramento e revogação limpam a chave ativa e encerram a vigência na mesma transação da mudança de acompanhamento/autorização;
- sugestões existentes em `professionalGoalSuggestions` continuam independentes e não alimentam esse modelo por migration ou backfill.

## Catálogo comercial versionado

A migration `0041_billing_catalog_versioning.sql` evolui a fundação de billing sem trocar os IDs já referenciados por `billingSubscriptions.planId`:

- `billingProducts` introduz o código estável da família comercial;
- `billingPlans` permanece como alvo das FKs existentes, mas cada linha passa a representar uma versão imutável com `versionCode`, número, vigência, estado, recursos do pagador, recursos do paciente coberto e meios de pagamento; registros legados da fundação recebem `version = 0`, ficam inativos para novas vendas e preservam seus IDs para assinaturas existentes;
- publicar versão nova não altera `planId` de assinatura existente;
- `billingCoupons` mantém revisões históricas e somente uma revisão ativa por código;
- `billingCouponRedemptions.contractKey` impede acumular dois cupons na mesma contratação e torna retry idempotente; os limites de uso são contabilizados pelo código lógico em todas as revisões, sem zerar ao revisar a política;
- reservas de cupom bloqueiam a linha do usuário antes da resolução do `contractKey`, serializando tentativas concorrentes da mesma contratação/usuário;
- mutações administrativas revalidam e bloqueiam a linha `users` do ator como `admin` dentro da transação antes de qualquer alteração comercial;
- limite total e por usuário considera reservas e confirmações dentro da mesma transação que bloqueia a revisão ativa;
- `billingCommercialAuditEvents` preserva ator, motivo, entidade e ação sem payload financeiro bruto.

O seed canônico pode ser reexecutado. Definição já existente precisa coincidir integralmente com preço, ciclo, capacidade, recursos e meios autorizados; drift falha em vez de sobrescrever histórico.

## Validação

- Rodar `pnpm db:check-integrity` quando houver `DATABASE_URL` disponível. O verificador mantém uma allowlist explícita e não destrutiva para as quatro chaves JSON legadas profissionais (`professional_profile_v1`, `professional_accesses_v1`, `patient_professional_access_requests_v1` e `patient_professional_goal_suggestions_v1`): registros órfãos dessas chaves são reportados como retenção intencional até a aposentadoria segura, enquanto qualquer outra preferência órfã continua reprovando o gate. Nenhum dado é excluído automaticamente.
- A migration `0037_professional_message_idempotency_scope.sql` adiciona `professionalMessages.requestedAction` e reconstrói a ação histórica de mensagens profissionais a partir do estado e das tentativas WhatsApp. A criação idempotente usa esse campo para aceitar apenas repetição semanticamente equivalente e rejeitar reutilização da chave em outro profissional, autorização, paciente ou payload. A mensagem e o evento de criação são gravados na mesma transação; `send_web` já nasce em `sent`, enquanto replay de `send_whatsapp` pendente retoma a mesma mensagem lógica. O endpoint de retry aceita somente mensagem WhatsApp em `failed` com tentativa física anterior.
- Rodar `pnpm docs:check` após alterar schema ou docs geradas.
- Rodar `pnpm db:migrate:professionals` mais de uma vez em homologação para confirmar idempotência antes do rollout em produção.
- `server/repositories/whatsappPendingOperationRepository.productionFallback.test.ts` cobre indisponibilidade do banco em produção, reinício/segunda instância, exceção do provider e preservação do fallback apenas em teste.
- `server/modules/whatsapp/foodQuantityClarification.persistenceFailure.test.ts` chama o adapter real e comprova que indisponibilidade impede a pergunta funcional.
- O workflow `Professional persistence TiDB gate` executa `pnpm db:push`, verifica estabilidade dos metadados Drizzle e cobre backfill, vínculo assimétrico, concorrência, transação de aprovação, leitura por outra instância, revogação imediata, persistência de comentários/sugestões/histórico, decisão idempotente de sugestão e aposentadoria segura das quatro preferências.

## Aposentadoria do legado profissional

A experiência profissional atual é a única interface funcional. O endereço `/professional/legacy` existe apenas como redirecionamento de bookmark para `/professional` e não carrega componentes, estado ou APIs antigos. Perfil, autorizações, acompanhamento e sugestões profissionais de meta usam exclusivamente as tabelas canônicas em runtime; leitura, migração e remoção das quatro chaves JSON antigas são permitidas somente pelos comandos operacionais documentados em `docs/runbooks/professional-legacy-retirement.md`.
