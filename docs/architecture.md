# Arquitetura - Controle Calorias SaaS

## Visão Geral

```
┌────────────────────────────────────────────────────────────────────────┐
│                        USUÁRIO FINAL                                   │
│                   (WhatsApp - texto/áudio/imagem)                      │
└───────────────────────────────┬────────────────────────────────────────┘
                                │
                    WhatsApp Business API
                    (Meta Cloud API v19)
                                │
┌───────────────────────────────▼────────────────────────────────────────┐
│                     WEBHOOK GATEWAY                                    │
│              POST /webhook/whatsapp (Fastify)                          │
│   • Verificação do webhook (challenge)                                 │
│   • Validação de payload (Zod)                                         │
│   • Resposta 200 imediata para o WhatsApp                              │
│   • Enfileiramento assíncrono                                          │
└───────────────────────────────┬────────────────────────────────────────┘
                                │
                          BullMQ Queue
                       (process-message)
                                │
┌───────────────────────────────▼────────────────────────────────────────┐
│                    ORQUESTRADOR DE PROCESSAMENTO                       │
│                     (ai-processor.service.ts)                          │
│                                                                        │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│   │ TEXT         │  │ AUDIO        │  │ IMAGE                     │   │
│   │ Processor    │  │ Processor    │  │ Processor                 │   │
│   │              │  │              │  │                           │   │
│   │ GPT-4o +     │  │ Whisper ASR  │  │ GPT-4o Vision            │   │
│   │ Food NER     │  │ → Text       │  │ + Caption                 │   │
│   │              │  │ → Food NER   │  │                           │   │
│   └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘   │
│          └─────────────────┴──────────────────────────┘               │
│                                    │                                   │
│                        Nutrition Engine                                │
│                   (nutrition.service.ts)                               │
│         • Match com banco nutricional (TACO/USDA)                     │
│         • Cálculo determinístico por 100g                              │
│         • Enriquecimento de dados do LLM                               │
└───────────────────────────────┬────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌───────▼──────┐  ┌─────────────▼──────┐  ┌────────────▼──────────┐
│ PostgreSQL   │  │ Redis              │  │ pgvector              │
│              │  │                    │  │                        │
│ • Users      │  │ • Cache metas      │  │ • Embeddings de        │
│ • Meals      │  │ • Cache resumo     │  │   refeições            │
│ • FoodDB     │  │ • Queue BullMQ     │  │ • Busca semântica      │
│ • Habits     │  │                    │  │ • "meu café de sempre" │
│ • Audit      │  │                    │  │                        │
└──────────────┘  └────────────────────┘  └────────────────────────┘
```

## Módulos do Sistema

### 1. WhatsApp Gateway (`modules/whatsapp/`)
Responsável pela integração com a WhatsApp Business API (Meta Cloud API).

**Responsabilidades:**
- Receber e validar webhooks do WhatsApp
- Identificar o tipo de mídia da mensagem (texto, áudio, imagem)
- Criar ou localizar o usuário pelo número de telefone
- Registrar a mensagem no banco (MessageLog)
- Enfileirar para processamento assíncrono
- Enviar mensagens de resposta
- Gerenciar respostas interativas (botões de confirmação)

### 2. AI Processor (`modules/ai/`)
Pipeline de processamento multimodal.

**Subcomponentes:**
- `text-processor.service.ts` – extração de alimentos via GPT-4o, geração de resposta
- `audio-processor.service.ts` – transcrição via Whisper + extração textual
- `image-processor.service.ts` – análise via GPT-4o Vision
- `embedding.service.ts` – geração e busca de embeddings (OpenAI + pgvector)
- `ai-processor.service.ts` – orquestrador principal do pipeline

### 3. Nutrition Engine (`modules/nutrition/`)
Motor nutricional determinístico com banco de dados.

**Responsabilidades:**
- Busca fuzzy no banco de alimentos (TACO/USDA)
- Cálculo nutricional por quantidade em gramas
- Cálculo e cache do resumo diário
- Enriquecimento dos dados do LLM com valores do banco

### 4. Users (`modules/users/`)
Gestão de usuários e metas.

**Responsabilidades:**
- Criação automática no primeiro contato WhatsApp
- Metas nutricionais personalizadas
- Cálculo automático de TDEE (Harris-Benedict)
- Onboarding guiado

### 5. Meals (`modules/meals/`)
Gestão de refeições.

**Responsabilidades:**
- CRUD de refeições e itens
- Confirmação e correção pelo usuário
- Recálculo de totais após correção

### 6. Habits & Personalization (`modules/habits/`)
Memória e personalização do usuário.

**Responsabilidades:**
- Rastrear alimentos frequentes
- Identificar padrões de refeição por horário
- Suporte a refeições nomeadas ("meu café de sempre")
- Guardar correções como padrões futuros

### 7. Infrastructure (`shared/`)
- `database/` – Prisma client singleton
- `cache/` – Redis client + helpers
- `queue/` – BullMQ queues e factories
- `logger/` – Pino logger estruturado
- `metrics/` – Prometheus metrics

## Fluxo de Dados Principais

### Fluxo Texto
```
User → WhatsApp → Webhook → MessageLog (PENDING) → Queue → 
Text Processor → Food Extraction (GPT-4o) → Nutrition DB Match → 
Meal Created → Daily Summary Updated → Feedback Generated → 
WhatsApp Response
```

### Fluxo Áudio
```
User → WhatsApp (áudio OGG) → Webhook → MessageLog (PENDING) → Queue →
Audio Download → Whisper Transcription → Text Processor →
Food Extraction → Nutrition DB Match → Meal Created → Response
```

### Fluxo Imagem
```
User → WhatsApp (foto) → Webhook → MessageLog (PENDING) → Queue →
Image Download → GPT-4o Vision → Food Extraction → Nutrition DB Match →
Meal Created → Response
```

## Decisões de Arquitetura

### Por que Fastify em vez de Express?
- Performance superior (3-5x mais requests/segundo)
- Schema validation nativo com JSON Schema
- TypeScript first-class
- Plugin system mais modular

### Por que BullMQ em vez de RabbitMQ/Kafka?
- Simplicidade operacional (usa Redis já existente)
- Suficiente para escala inicial de SaaS
- Retry automático com backoff exponencial
- Dashboard visual via Bull Board
- Para alta escala (>100k msg/dia), migrar para Kafka

### Por que pgvector em vez de Pinecone?
- Evita dependência externa para MVP
- Integração nativa com PostgreSQL (transações ACID)
- Suficiente para vetores de memória de usuário
- Para pesquisa vetorial em escala, migrar para Pinecone/Weaviate

### Por que não depender 100% de LLM para nutrição?
- Custos controlados (LLM como fallback, banco como fonte primária)
- Consistência e reprodutibilidade dos valores
- Rastreabilidade da fonte nutricional
- LGPD: dados em banco local, não enviados ao LLM quando desnecessário
