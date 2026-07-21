# Design técnico: persistência e banco

## Fonte de verdade

`drizzle/schema.ts` e os schemas de domínio em `drizzle/*-schema.ts` são a fonte de verdade do modelo relacional. Migrações em `drizzle/` devem refletir mudanças de schema e ser aplicadas antes de validar fluxos em produção.

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
| `inferenceLogs`                       | Logs seguros de inferência                                                 |
| `appSecrets`                          | Segredos operacionais criptografados                                       |
| `professionalConversations`           | Conversa canônica por autorização profissional                             |
| `professionalMessages`                | Mensagens lógicas, autoria, origem, resposta e estado                      |
| `professionalMessageDeliveryAttempts` | Tentativas físicas e claims idempotentes de entrega                        |

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

## Catálogo global de alimentos

A migration `0000_global_food_catalog.sql` cria a primeira estrutura dedicada ao catálogo alimentar global:

- `food_sources` registra fonte, versão e metadados de origem, como TACO/TBCA ou curadoria interna.
- `foods` concentra alimentos globais e personalizados, com nutrientes principais por 100 g, `nutrients_json`, `status` e `merged_into_food_id`.
- `food_aliases` permite busca por nomes alternativos normalizados.
- `food_portions` registra porções e medidas caseiras ligadas ao alimento.

A estratégia inicial contra duplicidade usa `foods_source_code_unique` para impedir repetição de `source_id` + `source_food_code` quando a fonte disponibiliza código estável.

## Snapshot nutricional de refeições

A migration `0001_meal_item_nutrition_snapshot.sql` adiciona em `mealItems` os campos `foodId`, `grams`, macros calculados, `fiberG`, `sodiumMg` e `foodSnapshotJson`.

Quando um item é registrado com `foodId`, o backend calcula os nutrientes a partir dos valores por 100 g do catálogo e da gramagem consumida. O snapshot grava nome, fonte, versão, status e nutrientes usados no cálculo para preservar o histórico mesmo se o alimento global for corrigido, depreciado ou mesclado depois.

## Dados sincronizados de integrações

A migration `0002_health_synced_records.sql` cria `healthSyncedRecords` para persistir registros importados de providers externos, como Strava.

A tabela armazena `provider`, `externalRecordId`, `dataType`, `measuredAt`, `value`, `unit`, detalhes opcionais de atividade/energia e `metadataJson`. O índice único por usuário, provider, identificador externo e tipo de dado permite sincronizações idempotentes, atualizando registros já conhecidos sem duplicar histórico.

O router de integrações grava os registros retornados por `sync`, consulta primeiro o histórico persistido para a tela de dados sincronizados e remove os registros do provider quando o usuário desconecta a integração. Dados transitórios em memória seguem como fallback quando o banco não está disponível ou ainda não há histórico persistido.

## Fundação persistente da Área Profissional

A migration `0026_professional_persistence_foundation.sql` cria o modelo canônico de perfil, autorização, acompanhamento e eventos de transição.

Durante a fundação iniciada pela migration `0026_professional_persistence_foundation.sql`, perfil, autorizações e acompanhamento foram migrados de quatro preferências JSON temporárias para estruturas canônicas. A janela de compatibilidade foi encerrada pela issue #815:

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
- a preferência `patient_professional_goal_suggestions_v1` é importada de forma idempotente e recebe dual-write temporário durante a janela de rollout;
- comentários, sugestões de refeição e eventos que existiam apenas na memória de uma instância antes do deploy não possuem fonte recuperável e não podem ser migrados retroativamente;
- o fallback em memória continua restrito à execução sem banco usada pelos testes e pelo modo local permitido, nunca como fonte autoritativa quando `getDb()` retorna uma conexão.

A aplicação da estrutura segue esta ordem:

1. aplicar migrations com `pnpm db:push`;
2. executar `pnpm db:migrate:professionals` para o backfill completo; o comando falha quando não existe conexão com o banco;
3. repetir o comando para comprovar idempotência antes do rollout;
4. manter a importação lazy e o dual-write somente para compatibilidade externa durante a janela de migração;
5. remover o dual-write depois de confirmar que não existem consumidores externos das preferências JSON.

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

## Validação

- Rodar `pnpm db:check-integrity` quando houver `DATABASE_URL` disponível.
- Rodar `pnpm docs:check` após alterar schema ou docs geradas.
- Rodar `pnpm db:migrate:professionals` mais de uma vez em homologação para confirmar idempotência antes do rollout em produção.
- O workflow `Professional persistence TiDB gate` executa `pnpm db:push`, verifica estabilidade dos metadados Drizzle e cobre backfill, vínculo assimétrico, concorrência, transação de aprovação, leitura por outra instância, revogação imediata, persistência de comentários/sugestões/histórico e decisão idempotente de sugestão.

## Aposentadoria do legado profissional

A experiência profissional atual é a única interface funcional. O endereço `/professional/legacy` existe apenas como redirecionamento de bookmark para `/professional` e não carrega componentes, estado ou APIs antigos. Perfil, autorizações e acompanhamento usam exclusivamente as tabelas canônicas em runtime; leitura, migração e remoção das três chaves JSON antigas são permitidas somente pelos comandos operacionais documentados em `docs/runbooks/professional-legacy-retirement.md`.
