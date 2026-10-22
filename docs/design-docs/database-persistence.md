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

O modelo físico base está consolidado no ADR, seção 8.7. O mapeamento dos estados estrutural/de governança e do ciclo de revisão foi aprovado em 2026-10-05 (seções 12.1, 14.8 e 25, item 31). Variantes/aliases separam disponibilidade de `governance_status`; perfis e porções mantêm o estado de governança existente sem coluna duplicada. Casos usam `open | in_review | closed`, com resultado separado por ciclo e evento idempotente; aprovação é por artefato/versão e fechamento de tarefa não publica conhecimento. Constraints, transições e efeitos atômicos têm definição única no ADR, não neste resumo. Este fechamento é documental: não declara migrations executadas nem dispensa as permissões/políticas e os demais gates ainda abertos.

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
| `food_lexicon_entries` | Léxico exclusivamente global; não armazena vocabulário privado |
| `user_food_lexicon_entries` | Léxico pessoal com proprietário obrigatório |
| `food_portions` | Única tabela canônica de porções por variante |
| `food_barcodes` | Barcode único apontando para variante |
| `food_evidence` | Evidência sanitizada e auditável |
| `food_review_cases` / `food_review_events` | Governança global e histórico append-only |
| `food_resolution_events` | Rastreabilidade sanitizada com retenção |
| `user_food_favorites` | Único modelo de favoritos, por variante |
| `user_food_usage_stats` | Frequência/recência por variante |
| `mealItems` | Referências opcionais a variante/perfil/porção + snapshot imutável |

As chaves correntes, a precedência de leitura e os critérios de isolamento/revogação do léxico são definidos somente na seção 8.7 do ADR. Não criar armazenamento misto de vocabulário pessoal na tabela global nem uma segunda regra de unicidade neste resumo.

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

### B2 — Reconciliação conservadora e revisão (#1302)

**AUD-1302-026 — vínculo de revisão da fonte:** `food_nutrition_profiles.source_version` e `food_portions.source_version` armazenam a revisão da fonte vinculada aos nutrientes e gramaturas, e a leitura compara esse valor à `food_sources.version` com concessão vigente. Uma nova autorização do mesmo `source_id` não revalida silenciosamente valores antigos. Campos `NULL` representam proveniência não demonstrada e ficam inelegíveis até revisão específica; não há backfill automático nem alteração de snapshots históricos. O estágio B2 grava a versão autorizada no artefato novo, mantendo-o provisório e sujeito à revisão. Para uma revisão nova, criar ou revisar o perfil/porção apropriados em vez de carimbar a versão atual sobre registros legados.


O contrato B2 de cache provisório exige que o recurso HTTPS seja o mesmo URL autorizado em `food_sources.source_url` (origem, caminho e query), e não apenas outro SKU no mesmo domínio. Uma autorização ampla de domínio deve ser modelada e aprovada explicitamente em etapa própria, nunca presumida pela origem. Todo hit revalida o grant por versão, a validade, o escopo do usuário, a referência e o `content_hash` contra o payload nutricional recuperado; alterações de macros não passam silenciosamente. Perfil governado não utiliza `license_reference` como referência nutricional: ausência de URL HTTPS da fonte (ou do recurso exato comprovado para SKU comercial) impede o match. Marca/código de barras informados pelo usuário exigem declaração compatível de identidade na candidata externa. Mesmo quando somente a marca é informada, sem barcode, a candidata precisa declarar o nome compatível do produto; um nome contraditório é rejeitado inclusive no cache. Mesmo compatível, a candidata segue `provisional`, sem certificar SKU ou promover conhecimento global.

A leitura de conhecimento V2 exige escopo explícito `global` ou um proprietário pessoal compatível; `owner_user_id = NULL` isoladamente nunca converte um alimento pessoal em global. Falha do banco governado é indisponibilidade explícita, não ausência de alimento. Nutrição de SKU comercial só é elegível quando perfil e fonte estão vinculados à variante e há evidência global de rótulo/fabricante com identidade exata compatível.

A reconciliação V1 → V2 expõe `preview` e `stage` e exige proveniência de fonte licenciada por versão. Para `foodCatalog`, somente um vínculo rastreável com `foods` por código da mesma fonte, marca, nome, URL e macros equivalentes permite estágio; as demais linhas continuam em quarentena, não são descartadas. Aliases e porções com procedência aprovada são vinculados à variante draft sem alterar o valor nutricional histórico; os demais recebem caso de revisão. Barcodes vinculados são importados revogados, com caso de revisão, até comprovação independente do SKU. Nenhum estágio ativa leitura produtiva, verificação global ou cutover.

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

## Fase B1 — migração estrutural V2 (#1301)

A migration `drizzle/0055_food_intelligence_v2_persistence.sql` materializa 16 novas tabelas de conhecimento, léxico, evidência e governança, acrescenta chaves V2 ao catálogo legado e inclui referências opcionais em `mealItems`. O modelo correspondente está em `drizzle/food-intelligence-v2-schema.ts`, registrado em `drizzle.config.ts` e no snapshot/journal 0055. A geração de `docs/generated/db-schema.md` passa a incluir esse schema.

**Compatibilidade:** o esquema B1 mantém `foods.scope`, `foods.canonical_name` e `foods.canonical_key` anuláveis e sem default implícito para permitir `INSERT` dos escritores V1 enquanto o cutover está proibido. O backfill da migration atribui identidade e escopo corretos somente às linhas preexistentes; novas linhas legadas permanecem explicitamente sem identidade/escopo V2 até reconciliação transacional antes de habilitar leitores V2. `canonical_key` preenchida segue protegida por índice único. **Nunca selecionar linhas com chave/escopo V2 nulos para publicação/resolução global.** O teste integrado exige dois inserts legados depois da migration, nenhum escopo global implícito e rejeição de chaves V2 explícitas duplicadas. Não há `DELETE`, `DROP` produtivo nem reescrita de `mealItems`; suas macros e `foodSnapshotJson` registrados continuam sendo o snapshot histórico. A FK das novas referências é `RESTRICT`: uma variante/perfil/porção já referenciada por refeições não deve desaparecer. `foodCatalog`, `portions`, `foodFavorites` e as colunas nutricionais em `foods` permanecem legados até Gate B e a subissue de cutover (#1313). As colunas `food_id`/gramas obrigatórias nas tabelas legadas `food_aliases` e `food_portions` e o `food_id` dos sinais pessoais ainda não foram aposentados: o uso produtivo V2 fica proibido até a migração de dados/contratos correspondente, para não gerar linhas incompatíveis com leitores V1.

**Concorrência e governança:** as chaves de identidade, versão, idempotência e `current_slot` possuem índices únicos no banco. O contrato da escrita V2 deve marcar `current_slot=1` apenas na versão corrente, liberando a anterior dentro da mesma transação; `NULL` representa histórico. O índice evita dois registros correntes com slot marcado, mas sozinho não autentica atores nem garante que serviços não omitam essa marcação. `active` permanece estrutural e não equivale a `verified`; eventos de revisão guardam ciclo, chave idempotente, ator, alvo, hash e resultado separados do status de tarefa. A operação transacional/autorizada e a política de promoção pertencem às issues #1302/#1309 e aos itens `OPEN` do ADR; não foram ativadas nesta migration. O caráter append-only de eventos deverá ser garantido pela fronteira de escrita/autorizações, não por memória de processo.

**Aplicação e reversão:** execute em banco de homologação compatível com MySQL/TiDB após backup; aplique `pnpm db:push`, confira `pnpm db:check-integrity` e faça testes de constraints, múltiplas conexões e leitura histórica. O script `drizzle/rollback/0055_food_intelligence_v2_persistence.sql` oferece reversão **somente antes de aceitar dados V2 ou ativar seus writers**. Como DDL MySQL/TiDB pode realizar commits implícitos, rollback não é uma transação atômica: backup/restauração e reconciliação explícita são exigidos em caso de falha ou cutover. Nunca execute a reversão em ambiente contendo conhecimento V2 a preservar. A retirada de tabelas/bridges legadas exige critérios completos de §8.13 da ADR e PR/migration separada (#1313).

**Índices de leitura B1 (AUD-1301-006):** além das chaves únicas de identidade e versão, o schema e a migration incluem índices compostos para variante por `brand_id + normalized_name + status`, perfil nutricional por `food_variant_id + status + valid_from + valid_to`, fila de revisão por `status + priority_score + cycle_opened_at + id` e eventos de resolução por `user_id + created_at` e `food_variant_id + created_at`. A verificação de contrato compara SQL e snapshot Drizzle; o gate TiDB verifica em `INFORMATION_SCHEMA.STATISTICS` a presença, a ordem das colunas e o caráter não único após executar a migration real. Esses índices não ativam leitores V2 nem substituem medição de planos de consulta sob volume representativo em fase posterior.

**Cobertura automática:** `server/foodIntelligenceV2Persistence.issue1301.test.ts` verifica inventário de tabelas, índices/estados, isolamento pessoal, histórico e contrato de rollback. Esses testes de contrato **não substituem** o teste real de migration/contenção na homologação. Na ausência de `DATABASE_URL` de validação, a integridade e a concorrência reais devem ser reportadas como não verificadas; nenhuma ativação/cutover está autorizada por esse motivo.

**Pré-requisito obrigatório do TiDB (gate fail-closed):** execute `pnpm db:check:food-v2-checks` contra `DATABASE_URL` do destino antes de autorizar a migration; o comando consulta o estado global em modo somente leitura e rejeita OFF ou ausência da variável.  a variável global `tidb_enable_check_constraint` precisa estar em `ON` no ambiente de execução da V2. TiDB 8.5 pode estar em `OFF` por padrão e então aceita definições `CHECK` sem efetivamente validá-las. Antes de aprovar a implantação, consultar `SHOW GLOBAL VARIABLES LIKE 'tidb_enable_check_constraint'` com usuário read-only e obter autorização administrativa específica caso precise ser alterada. Em nenhum caso o serviço da aplicação ou a migration deve ligar essa configuração global automaticamente no cluster de produção. O workflow `food-v2-migration-tidb.yml` habilita a variável **somente no container isolado de CI**, e o runner de teste recusa prosseguir quando não está habilitada. Sem enforcement, os `CHECK` de estado, versão e escopo não são garantidos por constraints físicas; **não aprovar cutover ou aceite B1**.

**Limite MySQL/TiDB de `CHECK` sobre chave `AUTO_INCREMENT`:** ambos os bancos recusam checks que comparam `merged_into_variant_id` ou `superseded_by_case_id` diretamente com a coluna `id` autoincremental. As duas verificações de auto-referência/ciclo permanecem exigência da operação transacional do serviço de governança (#1309) e de testes de promoção, **não** uma constraint de DDL neste estágio. As FKs `RESTRICT` continuam preservadas. Não aprovar promoção V2 enquanto a lógica anti-ciclo não estiver verificada.

**Guardas estruturais de retenção e supersessão (AUD-1301-003/004):** o TiDB 8.5.1 comprovadamente rejeita `CHECK` direto que leia colunas de FK, inclusive `ON DELETE NO ACTION` (`ER_CHECK_CONSTRAINT_CLAUSE_USING_FK_REFER_ACTION_COLUMN`). Para preservar as FKs `RESTRICT` sem relaxar o contrato, as colunas computadas `retention_guard` e `supersession_guard` são `GENERATED ALWAYS ... VIRTUAL NOT NULL`: produzem `NULL` nas combinações inválidas, de modo que o próprio banco rejeita INSERT/UPDATE de evidência pessoal sem TTL e caso `superseded` sem sucessor. O gate TiDB testa rejeição, atualização e caminhos válidos; a coluna computada não é fornecida pelo escritor. Auto-referência/ciclos entre casos, autenticação, política LGPD, vigência e decisões transacionais completas continuam exigidas em #1303/#1309, antes de ativar qualquer escritor V2. Além disso, `tidb_enable_check_constraint=ON` continua obrigatório para os demais `CHECK` de estado e versionamento; sua verificação deve ocorrer no ambiente de destino.


### Food Intelligence V2 — B2 / issue #1302 (camada governada, sem cutover)

A camada de leitura isolada `server/modules/foodIntelligenceV2/knowledgeRead.ts` utiliza `server/modules/foodIntelligenceV2/repository.ts` como única porta V2 de identidade, variante, perfil, fonte, alias, porção e barcode. O resolvedor produtivo V1 não é redirecionado: Gate A, shadow mode e migração dos leitores históricos pertencem às fases posteriores da ADR (§8.14, §20).

A migration aditiva `drizzle/0056_food_v2_source_governance.sql` cria `food_source_read_grants` e índice de idempotência da evidência provisória pessoal. Cada concessão é por `food_sources.id + versão`; estado padrão `pending`, permissões zero. A leitura falha fechada sem aprovação nominal, licença, versão compatível, validade, ou quando revogada. Um grant sozinho não aprova um alimento ou SKU. Fontes de variantes, aliases, porções e identidades por barcode acessíveis globalmente exigem também a permissão específica de publicação global; autorização de leitura isolada só serve ao acesso restrito permitido.

A precedência da porta é barcode exato com evidência íntegra → alias pessoal confirmado e compatível (se nenhuma marca explícita foi informada) → variante exata → alias global verificado → família genérica. Um alias pessoal confirmado com perfil nutricional inválido/revogado encerra a leitura com no_governed_profile; cache, fonte externa ou homônimo genérico não substituem silenciosamente sua identidade (AUD-1302-022). Uma marca explícita nunca se transforma silenciosamente em variante genérica; um alias pessoal já confirmado pode recuperar a variante comercial exata sem repetir a marca. Comprovação nutricional de SKU exige que a evidência de fabricante/rótulo coincida com o recurso exato do produto vinculado à variante, não apenas com o domínio da marca. O payload normalizado exige `foodVariantId`, `sourceId`, `sourceItemCode` (ou `null` se ausente), `sourceReference` e `nutrition` (unidade, quantidade base e quatro macros). A leitura recalcula o SHA-256 `contentHash` e confere nutrientes e identidade contra o perfil corrente; digest apenas preenchido, SKU irmão e valores divergentes não comprovam o perfil. Perfis e porções exigem fonte vigente; conflitos materiais retornam conflito explícito. Nenhum acesso B2 recalcula `mealItems` históricos.

**Integridade de identidade por barcode (AUD-1302-015/016/023):** barcode ativo só é elegível quando a evidência vinculada (evidence_id) comprova o mesmo código exato, inclusive zeros à esquerda, com payload_json contendo barcode como string (e identity.barcode igual quando presente), foodVariantId, sourceId, sourceItemCode e sourceReference vinculados à variante, ao mapeamento ativo e ao URL HTTPS exato de produto em food_variant_sources.source_url, content_hash SHA-256 do JSON normalizado e mesma origem autorizada em food_sources.source_url. URL genérica sem mapeamento SKU específico ou SKU irmão não serve como prova de barcode. Evidência ausente, adulterada, expirada, de outro proprietário/variante/fonte ou com código divergente não habilita perfil nutricional. Se a entrada fornecer também nome, a variante só é elegível quando ele corresponder ao nome governado da família/variante, a alias pessoal confirmado para o titular ou a alias global verificado e autorizado; uma divergência explícita retorna conflito antes de consultar cache ou fonte externa. Candidata externa com nome e barcode informados precisa declarar ambos de maneira compatível, sem elevar a resposta de provisional a verified. Esses guards permanecem isolados no V2 até os gates de cutover.

**Escopo de evidência de barcode (AUD-1302-024):** um código de barras compartilhado ligado a variante/família global somente pode sustentar a leitura governada quando a própria prova de identidade não possui proprietário pessoal, além das autorizações de publicação exigidas para a fonte. Provas de barcode pertencentes a um usuário são elegíveis apenas para variantes privadas do mesmo titular; um grant global da fonte não converte automaticamente a prova pessoal em conhecimento global.

Em cache miss, `readThroughGovernedKnowledge` pode chamar provider externo uma vez, devolvendo candidato `provisional` somente com identidade alimentar compatível explicitamente declarada. Cache hit também deve comprovar identidade, URL, grant, hash, versão e TTL. Cache persistente exige usuário e versão de consulta/resolvedor/política, revalida permissão, origem HTTPS autorizada, URL da evidência, versão e TTL em toda leitura e nunca promove implicitamente nem concede `verified`. Armazenamento requer concessão e prazo finito. Na leitura, a validade efetiva é o menor prazo entre `retention_until` persistido e `captured_at + retention_days` da concessão vigente; redução de retenção revoga imediatamente cache antigo, mesmo sem regravação ou mudança de versão. Captura ausente/inválida falha fechada. O UPSERT idempotente também reduz o prazo usando a captura original no próprio banco. Reenvio idempotente não reinicia a retenção a partir da primeira captura: o prazo persistido somente pode ser reduzido por política mais restritiva; uma evidência já vencida não é considerada recém-persistida. O gate de #1303 (§19.8) permanece pendente: não ativar retenção real/importação pública sem aprovação, expurgo operacional, licença e revisão.

A reconciliação `reconcileLegacyFoodKnowledge("preview" | "stage")` e seu planejador `planLegacyKnowledgeReconciliation` classificam cada linha: `mapped + merged + quarantined = input`. Sem identidade de família/marca, fonte/versão/licença ou nutrição, a linha é quarentenada. O estágio grava apenas variantes `draft`, perfis `provisional`, mapas de fonte e casos de revisão: não faz dual-write, não altera refeições históricas e não publica registros pessoais. `foodCatalog` sem vínculo comprovado permanece em quarentena. As porções legadas de `portions` passam por inventário separado no retorno `catalogPortions` (`mapped + merged + quarantined = input`); medidas válidas e vinculadas à fonte são copiadas como `food_portions` provisórias, preservando o código de origem, e medidas inválidas ou conflitantes criam casos de quarentena sem promoção global. Registros pessoais ou de escopo ausente/indeterminado (`scope = NULL`) não entram na fila global: somente `scope = global` com proprietário nulo constitui identidade global comprovada. Os demais registros e suas porções são segregados na quarentena privada/órfã, sem nomes, macros ou URLs.

**Operação:** executar a prévia antes do estágio, comprovar direitos e privacidade (#1303), conferir migração TiDB, retenção e casos de quarentena. Não ativar a leitura produtiva até os gates da ADR. Dataset acima do limite de leitura é rejeitado para não esconder inventário incompleto; backfill operacional exige paginação e curadoria.


### B2 — remediação AUD-1302-019/020/021 (pré-cutover)

- A porta `readThroughGovernedKnowledge` rejeita candidatos externos/cache de alimento
  genérico sem afirmação de nome normalizado compatível. URL e concessão de fonte
  não substituem identidade alimentar. Quando válida, a resposta permanece
  `provisional`, sem publicação/`verified` automática.
- A reconciliação `preview|stage` mantém exclusões **pessoais e órfãs** numa tabela
  interna isolada `food_personal_reconciliation_quarantine` (migration 0056),
  nunca em `food_review_cases` global. Salva somente origem/tipo, ID legado,
  titular quando conhecido, motivo e expiração de 180 dias; não copia nome,
  conteúdo nutricional, mídia nem URL. Vinculações conhecidas são removidas
  em cascata quando o usuário é excluído. Retentativa não prolonga o prazo.
  Registros órfãos sem titular permanecem restritos ao staging interno e exigem
  purga por vencimento, ainda bloqueada operacionalmente pelos gates da #1303.
- Uma prova comercial pessoal pode sustentar **somente leitura provisória** de
  variante pertencente ao mesmo titular, enquanto fonte, hash, SKU, URL e prazo
  ainda forem válidos. Nunca valida um SKU global nem altera perfil histórico.
- **Bloqueio de ativação:** a tabela nova e o `stage` são somente preparação
  técnica. Não executar staging com dados reais, importar evidências pessoais
  nem liberar publicação sem autorizações de fonte, retenção/expurgo e LGPD da
  issue #1303; sem cutover da V1 ou alteração de `mealItems` históricos.
