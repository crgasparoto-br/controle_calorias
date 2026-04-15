# Stack Tecnológica

## Backend API

| Categoria         | Tecnologia              | Versão  | Justificativa                                      |
|-------------------|-------------------------|---------|----------------------------------------------------|
| Runtime           | Node.js                 | >=20    | LTS, ótima performance async, grande ecossistema   |
| Linguagem         | TypeScript              | ^5.5    | Type safety, manutenibilidade, DX superior         |
| Framework HTTP    | Fastify                 | ^4.27   | 3-5x mais rápido que Express, TS nativo, plugins   |
| ORM               | Prisma                  | ^5.14   | Migrações, type safety, great DX                   |
| Validação         | Zod                     | ^3.23   | Runtime validation com TypeScript inference        |
| Filas / Queue     | BullMQ                  | ^5.8    | Redis-based, retry automático, monitoring          |
| Cache             | Redis (ioredis)         | ^5.4    | Sub-ms latência, TTL, pub/sub                      |
| AI - LLM          | OpenAI GPT-4o           | API     | Melhor custo-benefício para food extraction        |
| AI - ASR          | OpenAI Whisper          | API     | Transcrição de áudio em PT, integrado              |
| AI - Vision       | OpenAI GPT-4o Vision    | API     | Análise de imagens de alimentos                    |
| AI - Embeddings   | OpenAI text-embedding-3 | API     | 1536 dims, alta qualidade                          |
| Vetor DB          | pgvector                | ext     | PostgreSQL nativo, ACID, sem custo extra           |
| Logging           | Pino                    | ^9.3    | JSON structured, 5x mais rápido que Winston        |
| Métricas          | prom-client             | ^15.1   | Prometheus nativo, Grafana integration             |
| Auth              | @fastify/jwt            | ^8.0    | JWT RS256, stateless                               |

## Banco de Dados

| Banco       | Versão   | Uso                                                    |
|-------------|----------|--------------------------------------------------------|
| PostgreSQL  | 16       | Dados relacionais, pgvector, pg_trgm                   |
| Redis       | 7        | Cache, BullMQ queues, rate limiting                    |

## WhatsApp Integration

| Opção              | Escolha | Justificativa                                      |
|--------------------|---------|-----------------------------------------------------|
| Meta Cloud API     | ✅ MVP  | Oficial Meta, gratuito até 1000 conv/mês, direto    |
| Twilio WhatsApp    | Backup  | Abstração maior, mais caro, fallback confiável      |
| Evolution API      | Skip    | Self-hosted, risco de ban                           |

## Admin Panel

| Categoria     | Tecnologia          | Justificativa                                |
|---------------|---------------------|----------------------------------------------|
| Framework     | Next.js 14          | App Router, SSR/SSG, React Server Components |
| Styling       | Tailwind CSS        | Produtividade, utilitário, manutenível       |
| State/Data    | TanStack Query      | Cache, invalidação, loading states           |
| Charts        | Chart.js + react-chartjs-2 | Leve, flexível, boa performance       |
| Icons         | Lucide React        | Leve, TypeScript, tree-shakeable             |

## Infraestrutura

| Categoria         | Tecnologia         | Justificativa                                |
|-------------------|--------------------|----------------------------------------------|
| Containers        | Docker + Compose   | Reproducibilidade, portabilidade             |
| Monitoramento     | Prometheus + Grafana | Métricas, alertas, dashboards              |
| Armazenamento     | AWS S3             | Mídia (áudio/imagem) do WhatsApp             |
| Error Tracking    | Sentry             | Error capture, performance, alertas          |

## APIs Externas Necessárias

| Serviço                    | URL                                         | Uso                              | Custo          |
|----------------------------|---------------------------------------------|----------------------------------|----------------|
| Meta WhatsApp Business API | https://developers.facebook.com             | Envio/recebimento mensagens      | Grátis (1k/mês)|
| OpenAI API                 | https://platform.openai.com                 | GPT-4o, Whisper, Embeddings      | Por uso        |
| USDA FoodData Central API  | https://fdc.nal.usda.gov/api-guide.html     | Banco nutricional USDA           | Grátis         |
| AWS S3                     | https://aws.amazon.com/s3                   | Armazenar mídia do WhatsApp      | Por uso        |
| Sentry                     | https://sentry.io                           | Error tracking                   | Freemium       |

## Estimativa de Custo (100 usuários/mês)

| Serviço       | Estimativa/mês | Notas                                         |
|---------------|----------------|-----------------------------------------------|
| OpenAI GPT-4o | ~$15-30        | ~5 mensagens/dia/usuário × 100 usuários       |
| OpenAI Whisper| ~$2-5          | ~1 áudio/dia × 100 usuários                   |
| OpenAI Embed  | ~$0.5          | Embeddings de refeições                       |
| AWS S3        | ~$1            | Mídia do WhatsApp                             |
| PostgreSQL    | ~$7 (PlaaSaaS) | Supabase/Neon/Railway                         |
| Redis         | ~$5            | Upstash ou Railway                            |
| **Total**     | **~$30-50/mês**|                                               |
