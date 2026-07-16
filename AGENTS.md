# Guia para agentes

Este repositorio deve ser tratado como uma base de produto versionada para humanos e agentes. Antes de alterar codigo, leia os documentos de dominio correspondentes e mantenha documentacao, testes e checks sincronizados com a mudanca.

## Fluxo obrigatorio

1. Leia `docs/README.md` para identificar a documentacao canonica da area afetada.
2. Leia `docs/product-specs/product-experience-model.md` quando a mudanca envolver posicionamento, paciente, profissional, billing ou classificacao de backlog.
3. Leia `ARCHITECTURE.md` para entender camadas, fronteiras e convencoes.
4. Leia a especificacao de produto afetada em `docs/product-specs/`.
5. Leia o design tecnico afetado em `docs/design-docs/` quando a mudanca tocar backend, banco, IA, WhatsApp, privacidade ou persistencia.
6. Implemente a menor mudanca coerente com a arquitetura atual.
7. Atualize docs geradas/manualizadas em `docs/generated/` quando alterar schema, router ou contratos.
8. Siga o gate minimo por tipo de mudanca definido em `CONTRIBUTING.md`.
9. Rode `pnpm agent:check` antes de propor merge quando a alteracao tocar area sensivel, documentacao operacional ou instrucoes usadas por agentes.
10. Quando a mudanca depender de banco, migration ou dados, aplique o fluxo do projeto com `pnpm db:push` quando necessario e valide integridade com `pnpm db:check-integrity` quando houver `DATABASE_URL` disponivel.

## Mapas rapidos

| Mudanca | Leia primeiro |
|---|---|
| Posicionamento, areas do produto ou classificacao de issues | `docs/product-specs/product-experience-model.md` |
| Registro de refeicao, rascunho ou confirmacao | `docs/product-specs/meal-registration.md`, `docs/design-docs/nutrition-engine.md` |
| WhatsApp, webhook ou resposta conversacional | `docs/product-specs/whatsapp-flow.md`, `docs/design-docs/whatsapp-ingestion.md` |
| Migracao da IA para OpenAI | `docs/exec-plans/active/migrate-ai-to-openai.md`, `docs/design-docs/nutrition-engine.md`, `docs/PRIVACY_LGPD.md`, `docs/SECURITY.md` |
| Metas, dashboard ou relatorios do paciente | `docs/product-specs/goals-and-reports.md`, `docs/product-specs/product-experience-model.md` |
| Area Profissional, pacientes, prontuario ou comunicacao profissional | `docs/product-specs/product-experience-model.md`, `docs/product-specs/professionals.md` |
| Billing, planos, assinatura ou elegibilidade | `docs/product-specs/product-experience-model.md`, issue/epica de billing vigente |
| Exportacao, exclusao, logs, midia ou IA | `docs/product-specs/privacy-export-deletion.md`, `docs/PRIVACY_LGPD.md`, `docs/SECURITY.md` |
| Strava, OAuth ou integracoes de saude | `docs/product-specs/health-integrations.md`, `docs/PRIVACY_LGPD.md`, `docs/SECURITY.md` |
| Schema, migrations ou persistencia | `docs/design-docs/database-persistence.md`, `docs/generated/db-schema.md` |
| tRPC e contratos de API | `docs/generated/trpc-routes.md` |

## Fronteiras das areas de experiencia

- A Area do Paciente corresponde a experiencia atual e deve funcionar com ou sem profissional.
- A Area Profissional e um ambiente separado de trabalho para o nutricionista, integrado aos mesmos servicos de dominio.
- Profissional continua sendo uma capacidade adicional da mesma conta; nao criar um segundo tipo de identidade.
- A Area Profissional nao pode usar impersonacao nem importar paginas pessoais para simular a conta do paciente.
- Toda operacao profissional deve validar perfil, vinculo, consentimento, ator e paciente no backend.
- A tela profissional atual com abas e uma linha de base a preservar durante a migracao, nao o desenho final do modulo.

## Classificacao de issues

Antes de ampliar o escopo de uma issue, classifique-a em um unico fluxo principal:

1. **Experiencia atual do paciente**: Hoje, Registrar, Registros, Relatorios, Metas, alimentos, peso, exercicios e uso pessoal do WhatsApp.
2. **Plataforma compartilhada**: autenticacao, timezone, persistencia, privacidade, transporte do WhatsApp, IA e contratos de dominio usados pelas duas areas.
3. **Programa da Area Profissional**: navegacao, dashboard de carteira, pacientes, prontuario, acompanhamento, metas profissionais, orientacoes, mensagens e relatorios da carteira.
4. **Comercial e billing**: planos, checkout, assinatura, elegibilidade, limites e administracao comercial.

Regras:

- nao adicionar dashboard, prontuario ou gestao profissional a uma issue corretiva do produto atual;
- nao mover issue preexistente para a epica profissional apenas porque menciona profissional ou paciente;
- quando a mesma fundacao atender as duas areas, manter a issue compartilhada e criar subissue separada para a interface profissional;
- billing e experiencia profissional devem permanecer em epicas distintas, com dependencias explicitas;
- preservar o escopo e os criterios de aceite ja aprovados, salvo conflito real com decisao de produto documentada.

## Regras de implementacao

- Preserve o monolito React + Express + tRPC + Drizzle; nao introduza microservicos sem plano aprovado em `docs/exec-plans/active/`.
- Nao coloque regra de negocio em paginas React. Regra de negocio deve viver em `server/modules/<dominio>/service.ts` ou em helpers compartilhados.
- Validacao de entrada deve ficar em `server/modules/<dominio>/schemas.ts`.
- O router tRPC deve apenas compor autenticacao, schema, chamada de servico e eventos analiticos seguros.
- Dados de saude, textos crus, transcricoes, midia e prompts sao sensiveis. Nao registrar valores crus em logs, analytics ou mensagens de erro.
- Toda alteracao em IA, WhatsApp, storage, privacidade, banco ou autenticacao deve atualizar documentacao e avaliar riscos em `docs/RELIABILITY.md`, `docs/SECURITY.md` ou `docs/PRIVACY_LGPD.md`.
- Nao crie documentos paralelos de planejamento quando a informacao puder ser incorporada a uma especificacao canonica, design doc, runbook ou plano ativo existente. Planos temporarios devem ser removidos ou arquivados quando forem implementados.
- Novas telas profissionais devem consumir servicos e contratos compartilhados sem duplicar calculos de metas, relatorios, timezone ou autorizacao.
- Alteracoes profissionais relevantes devem preservar autoria e historico auditavel.

## Comando de validacao para agentes

```bash
pnpm agent:check
```

Esse comando combina TypeScript, testes, checks de arquitetura e checks de documentacao. Ele e obrigatorio para areas sensiveis e para mudancas que alterem documentacao operacional usada por agentes. Para os demais tipos de mudanca, use o gate minimo por tipo descrito em `CONTRIBUTING.md` e registre na PR os comandos executados, validacoes manuais e limitacoes de ambiente.