# 🥗 Controle Calorias

**SaaS de controle de calorias e nutrientes com WhatsApp como frontend principal.**

Usuários registram refeições via WhatsApp em texto, áudio ou foto. O sistema identifica alimentos, estima nutrientes, compara com metas diárias e responde com acompanhamento nutricional personalizado.

---

## Documentação

| Documento | Descrição |
|-----------|-----------|
| [Arquitetura](docs/architecture.md) | Visão geral, módulos, decisões técnicas |
| [Stack Tecnológica](docs/tech-stack.md) | Tecnologias, APIs externas, estimativas de custo |
| [Modelo de Dados](docs/data-model.md) | Esquema do banco, tabelas, índices |
| [Contratos de API](docs/api-contracts.md) | Endpoints REST, payloads, exemplos |
| [Fluxos Principais](docs/flows.md) | Fluxos de texto, áudio, imagem, confirmação |
| [Roadmap](docs/roadmap.md) | MVP → produção, fases, critérios de sucesso |
| [Histórias de Usuário](docs/user-stories.md) | Backlog completo com critérios de aceite |

---

## Estrutura do Projeto

```
controle_calorias/
├── services/
│   ├── api/                    # Backend principal (Node.js + TypeScript + Fastify)
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── whatsapp/   # Webhook + integração WhatsApp Cloud API
│   │   │   │   ├── ai/         # Processamento multimodal (texto/áudio/imagem)
│   │   │   │   ├── nutrition/  # Motor nutricional + banco de alimentos
│   │   │   │   ├── users/      # Usuários, metas, perfil
│   │   │   │   ├── meals/      # Refeições e itens
│   │   │   │   └── habits/     # Hábitos e personalização
│   │   │   ├── shared/
│   │   │   │   ├── database/   # Prisma client
│   │   │   │   ├── cache/      # Redis
│   │   │   │   ├── queue/      # BullMQ
│   │   │   │   ├── logger/     # Pino
│   │   │   │   └── metrics/    # Prometheus
│   │   │   └── workers/        # Processadores de fila
│   │   └── prisma/
│   │       ├── schema.prisma   # Esquema do banco de dados
│   │       └── seed.ts         # Seed com alimentos brasileiros
│   └── admin/                  # Painel administrativo (Next.js)
├── infra/
│   ├── docker-compose.yml      # PostgreSQL + Redis + Grafana
│   ├── postgres/init.sql       # Extensões pgvector, pg_trgm
│   └── monitoring/             # Prometheus config
├── docs/                       # Documentação completa
├── .env.example                # Variáveis de ambiente necessárias
└── package.json                # Workspace root (npm workspaces)
```

---

## Quick Start (Desenvolvimento)

### Pré-requisitos
- Node.js >= 20
- Docker + Docker Compose
- Conta Meta Developers (WhatsApp Business API)
- Chave de API OpenAI

### 1. Clone e instale dependências
```bash
git clone <repo-url>
cd controle_calorias
npm install
```

### 2. Configure as variáveis de ambiente
```bash
cp .env.example .env
# Edite .env com suas credenciais
```

### 3. Suba a infraestrutura
```bash
npm run docker:up
```

### 4. Rode as migrações e seed
```bash
npm run db:migrate
npm run db:seed
```

### 5. Inicie o servidor de desenvolvimento
```bash
npm run dev:api
```

A API estará disponível em `http://localhost:3000`.
Documentação Swagger: `http://localhost:3000/docs`

---

## Stack Tecnológica

| Componente       | Tecnologia                            |
|------------------|---------------------------------------|
| Backend API      | Node.js + TypeScript + Fastify        |
| Banco de dados   | PostgreSQL 16 + pgvector + pg_trgm    |
| Cache / Queue    | Redis + BullMQ                        |
| ORM              | Prisma                                |
| AI               | OpenAI GPT-4o + Whisper + Embeddings  |
| WhatsApp         | Meta Cloud API v19                    |
| Admin Panel      | Next.js 14 + Tailwind CSS             |
| Monitoramento    | Prometheus + Grafana + Sentry         |

---

## Variáveis de Ambiente Necessárias

Veja [.env.example](.env.example) para a lista completa.

**Obrigatórias:**
- `DATABASE_URL` – Connection string PostgreSQL
- `REDIS_URL` – Connection string Redis
- `WHATSAPP_PHONE_NUMBER_ID` – ID do número WhatsApp Business
- `WHATSAPP_ACCESS_TOKEN` – Token de acesso Meta
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` – Token de verificação do webhook
- `OPENAI_API_KEY` – Chave da API OpenAI
- `JWT_SECRET` – Segredo para assinar JWTs (mín. 32 chars)

---

## Segurança e LGPD

- Dados sensíveis nunca são expostos em logs (redaction automático)
- Trilha de auditoria completa em todas as operações
- Endpoints para exportação e exclusão de dados (LGPD Art. 18)
- JWT para autenticação da API administrativa
- Rate limiting configurável
- HTTPS obrigatório em produção
