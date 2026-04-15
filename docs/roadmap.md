# Roadmap: MVP para Produção

## Fase 0 – Fundação (Semanas 1-2)
**Objetivo:** Infraestrutura e banco de dados funcionando

- [ ] Setup do repositório e monorepo
- [ ] Docker Compose: PostgreSQL + Redis
- [ ] Migrações Prisma iniciais
- [ ] Seed com alimentos básicos brasileiros (TACO)
- [ ] CI/CD básico (GitHub Actions: lint + test + build)
- [ ] Configuração de ambientes (dev, staging, prod)

**Entregável:** `npm run docker:up && npm run dev:api` funciona

---

## Fase 1 – WhatsApp + Usuários (Semanas 3-4)
**Objetivo:** Receber mensagens e criar usuários

- [ ] WhatsApp Cloud API configurada (Meta developer account)
- [ ] Webhook funcionando (verificação + recebimento)
- [ ] Upsert automático de usuário pelo número
- [ ] Fluxo de onboarding básico
- [ ] Mensagens de boas-vindas
- [ ] Logging estruturado (Pino)

**Entregável:** Usuário envia "oi" e recebe resposta de boas-vindas

---

## Fase 2 – Processamento Textual (Semanas 5-6)
**Objetivo:** Registrar refeições por texto

- [ ] Integração OpenAI GPT-4o
- [ ] Prompt de extração de alimentos
- [ ] Banco de alimentos TACO (seed completo)
- [ ] Criação de Meal + MealItems
- [ ] Cálculo de resumo diário
- [ ] Resposta com feedback nutricional
- [ ] Cache com Redis (metas, resumo)
- [ ] Sistema de filas BullMQ

**Entregável:** Usuário registra refeição por texto e recebe feedback

---

## Fase 3 – Áudio e Imagem (Semanas 7-8)
**Objetivo:** Processamento multimodal completo

- [ ] Integração Whisper para transcrição de áudio
- [ ] Pipeline de download de mídia do WhatsApp
- [ ] Armazenamento no AWS S3
- [ ] Análise de imagens com GPT-4o Vision
- [ ] Detecção de rótulos de alimentos
- [ ] Confirmação via botões interativos

**Entregável:** Usuário pode registrar por foto ou áudio

---

## Fase 4 – Personalização e Memória (Semanas 9-10)
**Objetivo:** Sistema aprende com o usuário

- [ ] pgvector configurado
- [ ] Pipeline de embeddings (refeições)
- [ ] Suporte a refeições nomeadas
- [ ] Rastreamento de hábitos e frequência
- [ ] TDEE automático (dados biométricos)
- [ ] Sugestão de confirmação por similaridade

**Entregável:** "meu café da manhã de sempre" funciona

---

## Fase 5 – Admin Panel e Observabilidade (Semanas 11-12)
**Objetivo:** Visibilidade operacional

- [ ] Next.js admin panel com autenticação
- [ ] Dashboard: usuários, mensagens, processamento
- [ ] Prometheus + Grafana configurados
- [ ] Sentry para error tracking
- [ ] Alertas para falhas de processamento
- [ ] Trilha de auditoria completa
- [ ] Versionamento de prompts na UI

**Entregável:** Admin consegue monitorar o sistema

---

## Fase 6 – SaaS e Monetização (Semanas 13-16)
**Objetivo:** Modelo de negócio e escala

- [ ] Planos de assinatura (FREE / BASIC / PREMIUM)
- [ ] Integração de pagamento (Stripe ou Pagar.me)
- [ ] Limites por plano (mensagens/dia, funcionalidades)
- [ ] Painel do usuário web (opcional)
- [ ] Exportação de dados (LGPD)
- [ ] Exclusão de dados a pedido
- [ ] Rate limiting por usuário/plano

**Entregável:** Sistema pronto para receita

---

## Fase 7 – Escala e Produção (Semanas 17-20)
**Objetivo:** Alta disponibilidade e performance

- [ ] Deploy em cloud (Railway / Render / AWS ECS)
- [ ] Load balancer e múltiplas instâncias
- [ ] Backup automático do banco de dados
- [ ] CDN para assets do admin
- [ ] Teste de carga (k6 ou Artillery)
- [ ] SLA de 99.9% uptime
- [ ] Documentação de API pública (Swagger)
- [ ] Política de privacidade e termos de uso (LGPD)

**Entregável:** Produto em produção com SLA

---

## Critérios de Sucesso do MVP (Fase 2)

| Métrica                        | Meta MVP      |
|-------------------------------|---------------|
| Usuários ativos                | 50            |
| Mensagens processadas/dia      | 200           |
| Taxa de sucesso de extração    | >80%          |
| Latência de resposta           | <5 segundos   |
| Precisão calórica (±20%)       | >75% das msgs |
| NPS (Net Promoter Score)       | >40           |

## Riscos e Mitigações

| Risco                          | Probabilidade | Impacto | Mitigação                        |
|-------------------------------|---------------|---------|----------------------------------|
| Custo OpenAI alto              | Médio         | Alto    | Cache de extrações, LLM + DB     |
| Imprecisão nutricional         | Alto          | Médio   | Confirmação pelo usuário         |
| Ban WhatsApp Business          | Baixo         | Alto    | Seguir guidelines Meta           |
| LGPD não conformidade          | Baixo         | Alto    | Auditoria e DPO desde o início   |
| Escalabilidade de filas        | Baixo         | Médio   | Migrar para Kafka se necessário  |
