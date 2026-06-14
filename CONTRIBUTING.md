# Guia de contribuição

Este projeto usa um gate de validação antes de merge para reduzir regressões em áreas sensíveis. A regra principal é: rode o menor conjunto suficiente para a mudança e use o gate completo quando a alteração tocar autenticação, segredos, banco, integrações ou fluxo nutricional.

## Gate mínimo por tipo de mudança

| Tipo de mudança | Validação obrigatória antes de pedir merge |
|---|---|
| Documentação comum, textos ou notas que não mudam contratos | `pnpm docs:check` quando a mudança afetar documentação gerada, links ou documentação operacional |
| Documentação operacional, `AGENTS.md`, este guia ou instruções usadas por agentes | `pnpm docs:check` e `pnpm agent:check` |
| Ajuste visual isolado no frontend, sem regra de negócio | `pnpm check` e `pnpm build`; adicione `pnpm test` se houver lógica, estado ou componente testável |
| Backend, tRPC, serviços, schemas Zod ou regra de negócio | `pnpm check`, `pnpm test`, `pnpm architecture:check` e `pnpm build` |
| Schema, migrations, persistência ou contratos documentados | `pnpm check`, `pnpm test`, `pnpm docs:check`, `pnpm architecture:check`, `pnpm build` e validação de banco aplicável |
| Áreas sensíveis | `pnpm agent:check` e `pnpm build`, além de smoke/manual check específico da área afetada |

Áreas sensíveis incluem, no mínimo:

- autenticação e sessão;
- segredos e variáveis de ambiente;
- banco de dados, schema e migrations;
- WhatsApp e webhooks;
- OpenAI, IA e processamento de mensagens;
- Strava e integrações de saúde;
- cálculo nutricional, refeições e fluxo alimentar;
- billing ou assinaturas, quando existirem.

## O que cada comando cobre

| Comando | Quando usar | Observação |
|---|---|---|
| `pnpm check` | Mudanças em TypeScript, backend, frontend, scripts ou testes | Verifica tipos sem gerar build |
| `pnpm test` | Mudanças de comportamento, domínio, integrações, hooks ou componentes com lógica | Inclua testes novos quando o risco da mudança justificar |
| `pnpm architecture:check` | Mudanças em camadas, módulos, imports ou organização de backend/frontend | Protege fronteiras arquiteturais do monólito |
| `pnpm docs:check` | Mudanças em schema, tRPC, documentação gerada/manualizada ou instruções operacionais | Confirma que docs geradas continuam sincronizadas |
| `pnpm build` | Mudanças que podem afetar empacotamento, frontend, backend de produção ou dependências | Deve passar antes de merge em PRs de produto |
| `pnpm agent:check` | Gate completo para áreas sensíveis e mudanças operacionais usadas por agentes | Combina `pnpm check`, `pnpm test`, `pnpm architecture:check` e `pnpm docs:check` |
| `pnpm db:check-integrity` | Mudanças de persistência ou dados quando houver `DATABASE_URL` disponível para validação | Se o ambiente não tiver banco configurado, registre isso na PR |

Não documente nem exija comando novo como obrigatório sem adicioná-lo ao `package.json` ou explicar qual comando existente é equivalente.

## Validação local, manual e CI

A validação local deve ser registrada na PR com os comandos executados e o resultado. Quando uma validação depender de serviço externo, credencial, banco ou webhook indisponível, registre a limitação e descreva o impacto. Falha por dependência externa não deve ser tratada como sucesso silencioso.

Além dos comandos automatizados, use smoke tests manuais quando a mudança tocar fluxos de usuário ou integrações externas. Exemplos: login/logout para autenticação, envio e recebimento de webhook para WhatsApp, OAuth/callback para Strava, inferência de refeição para OpenAI ou cálculo de metas/refeições para o fluxo nutricional.

O CI atual executa o workflow `Agent-first gate` em PRs e valida TypeScript, testes, arquitetura, documentação, build e `pnpm agent:check`. O projeto também usa Vercel para preview/deploy check. A validação `pnpm db:check-integrity` é condicionada à disponibilidade de `DATABASE_URL`; quando o CI pular esse passo, a PR deve informar se houve validação de banco em outro ambiente.

Se algum gate crítico deixar de existir no CI ou não cobrir um comando obrigatório, registre a lacuna na PR e abra uma issue separada para automatizar o check antes de tratar a automação como garantida.

## Antes de abrir ou aprovar PR

1. Confirme se a mudança toca alguma área sensível.
2. Rode o gate correspondente à tabela acima.
3. Atualize documentação gerada/manualizada quando alterar schema, router, contratos ou comportamento operacional.
4. Registre na PR os comandos executados, checks de CI observados, smoke tests manuais e limitações.
5. Não faça merge com comando obrigatório falhando sem explicitar causa, impacto e plano de correção.