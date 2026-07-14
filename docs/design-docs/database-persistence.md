# Design técnico: persistência e banco

## Fonte de verdade

`drizzle/schema.ts` e os schemas de domínio em `drizzle/*-schema.ts` são a fonte de verdade do modelo relacional. Migrações em `drizzle/` devem refletir mudanças de schema e ser aplicadas antes de validar fluxos em produção.

## Tabelas críticas

| Tabela | Papel |
|---|---|
| `users` | Identidade interna e papel |
| `userProfiles` | Perfil nutricional e onboarding |
| `nutritionGoals` | Metas e exceções |
| `food_sources` | Fontes nutricionais, versão e código de origem do catálogo global |
| `foods` | Catálogo alimentar global e alimentos personalizados por usuário |
| `food_aliases` | Nomes alternativos normalizados para busca no catálogo |
| `food_portions` | Porções e medidas caseiras por alimento do catálogo |
| `meals` | Cabeçalho da refeição |
| `mealItems` | Itens nutricionais por refeição, incluindo snapshot nutricional histórico |
| `mealMedia` | Referências de mídia |
| `mealInferences` | Rascunhos e inferências de IA |
| `habitMemories` | Memória de hábitos alimentares |
| `healthSyncedRecords` | Histórico persistido de dados importados de integrações de saúde |
| `professionalProfiles` | Perfil profissional adicional à conta pessoal |
| `professionalPatientAuthorizations` | Consentimento e revogação do acesso profissional aos dados do paciente |
| `professionalPatientTrackings` | Situação operacional do acompanhamento, separada da autorização |
| `professionalPatientTrackingEvents` | Histórico auditável das transições do acompanhamento |
| `whatsappConnections` | Vínculo telefone do usuário ↔ usuário interno |
| `inferenceLogs` | Logs seguros de inferência |
| `appSecrets` | Segredos operacionais criptografados |

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

A migration `0024_professional_persistence_foundation.sql` cria o modelo canônico de perfil, autorização, acompanhamento e eventos de transição.

Durante o rollout, `server/repositories/professionalRepository.ts` mantém compatibilidade com as preferências legadas `professional_profile_v1`, `professional_accesses_v1` e `patient_professional_access_requests_v1`:

- a leitura canônica importa preferências mais recentes de forma idempotente;
- o `updatedAt` da preferência funciona como versão da origem para impedir que uma cópia antiga sobrescreva uma versão canônica mais nova;
- escritas canônicas fazem dual-write temporário no JSON para consumidores ainda não migrados;
- vínculos assimétricos podem ser reconciliados a partir da cópia do profissional;
- JSON inválido é ignorado com evento sanitizado, sem registrar o conteúdo bruto;
- uma chave única para o par profissional-paciente impede solicitações equivalentes concorrentes enquanto o vínculo está pendente ou aprovado.

A aplicação da estrutura segue esta ordem:

1. aplicar migrations com `pnpm db:push`;
2. executar `pnpm db:migrate:professionals` para o backfill completo;
3. manter a importação lazy e o dual-write durante a migração dos consumidores;
4. remover a dependência dos JSONs somente após todas as leituras e escritas profissionais usarem o repository canônico.

## Validação

- Rodar `pnpm db:check-integrity` quando houver `DATABASE_URL` disponível.
- Rodar `pnpm docs:check` após alterar schema ou docs geradas.
- Rodar `pnpm db:migrate:professionals` mais de uma vez em homologação para confirmar idempotência antes do rollout em produção.
