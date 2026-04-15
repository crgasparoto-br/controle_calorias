# Modelo de Dados

## Diagrama ER (simplificado)

```
Users ──────────── UserGoal (1:1)
  │
  ├── Meals ──── MealItems ──── FoodItems
  │                                │
  │                             FoodAliases
  ├── UserHabits
  ├── UserEmbeddings
  ├── MessageLogs ──── PromptVersions
  ├── AuditLogs
  ├── UserSessions
  ├── Subscriptions
  └── DailySummaries
```

## Tabelas Principais

### users
| Campo                 | Tipo      | Descrição                                    |
|-----------------------|-----------|----------------------------------------------|
| id                    | UUID PK   | Identificador único                          |
| phone                 | TEXT UNIQUE | Número WhatsApp formato E.164              |
| name                  | TEXT?     | Nome do usuário (do perfil WhatsApp)         |
| email                 | TEXT?     | Email para acesso ao painel web              |
| timezone              | TEXT      | Fuso horário (padrão: America/Sao_Paulo)     |
| locale                | TEXT      | Idioma (padrão: pt-BR)                       |
| is_active             | BOOL      | Usuário ativo                                |
| is_verified           | BOOL      | Número verificado                            |
| onboarding_completed  | BOOL      | Onboarding concluído                         |
| created_at            | TIMESTAMPTZ |                                            |
| updated_at            | TIMESTAMPTZ |                                            |

### user_goals
| Campo            | Tipo    | Descrição                               |
|------------------|---------|-----------------------------------------|
| id               | UUID PK |                                         |
| user_id          | UUID FK | FK → users                              |
| calories_per_day | INT     | Meta de calorias diárias (kcal)         |
| protein_per_day  | FLOAT   | Meta de proteínas diárias (g)           |
| carbs_per_day    | FLOAT   | Meta de carboidratos (g)                |
| fat_per_day      | FLOAT   | Meta de gorduras (g)                    |
| fiber_per_day    | FLOAT   | Meta de fibras (g)                      |
| water_per_day    | FLOAT   | Meta de água (ml)                       |
| weight_goal_kg   | FLOAT?  | Peso alvo (kg)                          |
| current_weight_kg| FLOAT?  | Peso atual (kg)                         |
| height_cm        | FLOAT?  | Altura (cm)                             |
| age              | INT?    | Idade                                   |
| gender           | ENUM    | MALE / FEMALE / OTHER                   |
| activity_level   | ENUM    | SEDENTARY / LIGHTLY_ACTIVE / ...        |
| goal_type        | ENUM    | LOSE_WEIGHT / MAINTAIN / ...            |

### meals
| Campo              | Tipo       | Descrição                              |
|--------------------|------------|----------------------------------------|
| id                 | UUID PK    |                                        |
| user_id            | UUID FK    | FK → users                             |
| date               | DATE       | Data da refeição (sem hora)            |
| meal_type          | ENUM       | BREAKFAST / LUNCH / DINNER / ...       |
| total_calories     | FLOAT      | Total de calorias (calculado)          |
| total_protein      | FLOAT      | Total de proteína (g)                  |
| total_carbs        | FLOAT      | Total de carboidratos (g)              |
| total_fat          | FLOAT      | Total de gorduras (g)                  |
| confirmed_by_user  | BOOL       | Confirmado pelo usuário                |
| source_type        | ENUM       | TEXT / AUDIO / IMAGE                   |
| message_log_id     | UUID FK?   | FK → message_logs                      |

### meal_items
| Campo             | Tipo    | Descrição                                  |
|-------------------|---------|--------------------------------------------|
| id                | UUID PK |                                            |
| meal_id           | UUID FK | FK → meals                                 |
| food_item_id      | UUID FK?| FK → food_items (quando encontrado no DB)  |
| food_name         | TEXT    | Nome como identificado pelo AI             |
| quantity          | FLOAT   | Quantidade                                 |
| unit              | TEXT    | Unidade (g, ml, unidade, etc.)             |
| quantity_grams    | FLOAT?  | Quantidade normalizada em gramas           |
| calories          | FLOAT   | Calorias calculadas                        |
| protein           | FLOAT   | Proteína (g)                               |
| carbs             | FLOAT   | Carboidratos (g)                           |
| fat               | FLOAT   | Gorduras (g)                               |
| confidence_score  | FLOAT   | Score de confiança AI (0-1)                |
| source            | ENUM    | AI_ESTIMATED / NUTRITIONAL_DB / USER_CONFIRMED |

### food_items
| Campo            | Tipo     | Descrição                                |
|------------------|----------|------------------------------------------|
| id               | UUID PK  |                                          |
| external_id      | TEXT?    | ID externo (USDA FDC ID, TACO código)    |
| external_source  | TEXT?    | "USDA", "TACO", "custom"                 |
| name             | TEXT     | Nome do alimento                         |
| name_normalized  | TEXT     | Nome sem acentos e em minúsculas (busca) |
| category         | TEXT?    | Categoria (Carnes, Frutas, etc.)         |
| calories         | FLOAT    | Calorias por 100g                        |
| protein          | FLOAT    | Proteína por 100g (g)                    |
| carbs            | FLOAT    | Carboidratos por 100g (g)                |
| fat              | FLOAT    | Gorduras por 100g (g)                    |
| fiber            | FLOAT    | Fibras por 100g (g)                      |
| sodium           | FLOAT    | Sódio por 100g (mg)                      |
| serving_size_g   | FLOAT?   | Porção típica em gramas                  |
| serving_unit     | TEXT?    | Unidade da porção ("porção", "fatia")    |
| is_verified      | BOOL     | Dado verificado/confiável                |

### message_logs
| Campo               | Tipo       | Descrição                             |
|---------------------|------------|---------------------------------------|
| id                  | UUID PK    |                                       |
| user_id             | UUID FK    | FK → users                            |
| whatsapp_message_id | TEXT UNIQUE| ID da mensagem no WhatsApp            |
| direction           | ENUM       | INBOUND / OUTBOUND                    |
| media_type          | ENUM       | TEXT / AUDIO / IMAGE / DOCUMENT       |
| raw_content         | TEXT?      | Conteúdo original do texto            |
| media_url           | TEXT?      | URL S3 do arquivo de mídia            |
| transcription       | TEXT?      | Transcrição do áudio (se aplicável)   |
| processing_status   | ENUM       | PENDING/PROCESSING/COMPLETED/FAILED   |
| response_text       | TEXT?      | Texto enviado de volta ao usuário     |
| confidence_score    | FLOAT?     | Score médio de confiança              |
| processing_ms       | INT?       | Tempo de processamento em ms          |
| prompt_version_id   | UUID FK?   | FK → prompt_versions                  |

### user_habits
| Campo       | Tipo     | Descrição                                  |
|-------------|----------|--------------------------------------------|
| id          | UUID PK  |                                            |
| user_id     | UUID FK  | FK → users                                 |
| habit_type  | ENUM     | FREQUENT_FOOD / MEAL_PATTERN / NAMED_MEAL  |
| data        | JSONB    | Dados flexíveis do hábito                  |
| frequency   | INT      | Quantas vezes ocorreu                      |
| last_seen_at| TIMESTAMPTZ |                                         |

### user_embeddings
| Campo      | Tipo       | Descrição                                 |
|------------|------------|-------------------------------------------|
| id         | UUID PK    |                                           |
| user_id    | UUID FK    | FK → users                                |
| content    | TEXT       | Texto que foi embeddado                   |
| embedding  | VECTOR(1536)| Vetor gerado (pgvector)                  |
| type       | ENUM       | MEAL_DESCRIPTION / NAMED_MEAL / CORRECTION|
| metadata   | JSONB?     | Metadados adicionais (mealId, etc.)       |

### prompt_versions
| Campo     | Tipo     | Descrição                                  |
|-----------|----------|--------------------------------------------|
| id        | UUID PK  |                                            |
| name      | TEXT     | Nome do prompt (ex: "food-extraction")     |
| version   | TEXT     | Versão semântica (ex: "v1.0")              |
| content   | TEXT     | Template do prompt                         |
| model     | TEXT     | Modelo AI (ex: "gpt-4o")                   |
| is_active | BOOL     | Versão em uso                              |

## Índices Importantes

```sql
-- Refeições por usuário e data (query mais comum)
CREATE INDEX meals_user_date ON meals(user_id, date);

-- Busca textual em alimentos (pg_trgm)
CREATE INDEX food_items_name_trgm ON food_items USING GIN (name_normalized gin_trgm_ops);

-- Busca vetorial de embeddings (pgvector)
CREATE INDEX user_embeddings_vector ON user_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Auditoria por usuário e data
CREATE INDEX audit_logs_user_date ON audit_logs(user_id, created_at);
```
