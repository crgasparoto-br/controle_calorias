# Guia de contribuição

Este projeto usa um gate de validação antes de merge para reduzir regressões em áreas sensíveis. A regra principal é: rode o menor conjunto suficiente para a mudança e use o gate completo quando a alteração tocar autenticação, segredos, banco, integrações ou fluxo nutricional.

## Gate mínimo por tipo de mudança

| Tipo de mudança | Validação obrigatória antes de pedir merge |
|---|---|
| Documentação comum, textos ou notas que não mudam contratos | `pnpm docs:check` quando a mudança afetar documentação gerada, links ou documentação operacional |
| Documentação operacional, `AGENTS.md`, este guia ou instruções usadas por agentes | `pnpm docs:check` e `pnpm agent:check` |
| Ajuste visual isolado no frontend, sem regra de negócio | `pnpm check` e `pnpm build`; execute testes relacionados quando houver lógica, estado ou componente testável |
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

## Gate obrigatório de `main` e validação automática de `develop`

PRs contra `main` e `develop` devem aguardar o status check obrigatório `Agent-first gate`. Esse continua sendo o único nome que precisa permanecer configurado em branch protection ou ruleset. Internamente, o workflow usa a classificação determinística **Delivery V2** para escolher o menor gate seguro para o diff.

Em PRs, a cadeia é:

1. `Delivery V2 risk` lê somente a lista de arquivos alterados e classifica a mudança sem IA;
2. `Merge preview integration` valida compatibilidade TypeScript do merge preview quando há código, mas **não repete a suíte Vitest**;
3. `Agent-first gate` faz checkout explícito do `head_sha` da PR e executa o perfil efetivo;
4. o manifesto e o bundle de evidência continuam vinculados ao `head_sha` exato.

### Perfis Delivery V2

| Perfil | Quando | Gate da PR |
|---|---|---|
| **FAST** | mudança conhecida e localizada de baixo risco, como UI isolada ou documentação comum | `pnpm check` quando há código, testes explícitos/relacionados com `vitest related`, `pnpm build` quando há código e `pnpm docs:check` quando a documentação exigir |
| **STANDARD** | backend ou comportamento não sensível | `pnpm check`, suíte equivalente a `pnpm test` uma vez, `pnpm architecture:check`, `pnpm build` e docs quando aplicável |
| **CRITICAL** | workflow, auth, segurança, banco/migration, WhatsApp, IA, billing, nutrição/refeições, shared, lockfiles ou caminho desconhecido | gate completo atual no `head_sha`: suíte completa uma vez, arquitetura, docs, build, `pnpm agent:check` e banco quando disponível |

A classificação é fail-closed. Um perfil solicitado por configuração pode aumentar o rigor, mas nunca reduzir o risco observado. Caminhos desconhecidos viram `CRITICAL`. A variável opcional de repositório `DELIVERY_V2_RISK_PROFILE` pode solicitar `auto`, `fast`, `standard` ou `critical`; `auto` é o comportamento padrão.

O ganho de performance do piloto vem principalmente de duas regras: a suíte completa não roda mais no merge preview e no exact head da mesma PR; e um `FAST` usa somente regressão relacionada. Este piloto ainda mantém os 24 shards sequenciais para a suíte completa, evitando misturar otimização de cobertura com paralelização na mesma mudança.

Push para `main` ou `develop` é sempre tratado como regressão completa (`CRITICAL`), independentemente do perfil que uma PR tenha recebido. Assim, FAST e STANDARD mantêm uma rede de regressão pós-merge.

A proteção preferencial para `develop` é bloquear push direto por branch protection ou ruleset e exigir PR com `Agent-first gate` verde. Como essa configuração depende de permissão administrativa no GitHub e não é versionada neste repositório, a decisão implementada aqui é adicionar `develop` ao gatilho `push.branches` do workflow. Assim, push direto para `develop` executa o workflow `Agent-first gate`, mantendo cobertura automática verificável mesmo quando a proteção administrativa ainda não estiver aplicada.

Push direto para `develop` deve continuar sendo exceção operacional. Quando acontecer, a execução do workflow deve ser acompanhada e qualquer falha precisa ser corrigida antes de novas integrações nessa base.

Para áreas sensíveis, a PR deve registrar:

- classificação Delivery V2 e status do check `Agent-first gate`;
- comandos relevantes executados pelo workflow ou localmente;
- se `pnpm db:check-integrity` foi executado ou pulado;
- validação alternativa ou risco residual quando `DATABASE_URL` não estiver disponível;
- status do preview/deploy Vercel, quando existir.

Vercel preview/deploy é evidência complementar. Ele não substitui o `Agent-first gate`. Os comandos obrigatórios são determinados pelo perfil Delivery V2 e pela tabela de gate mínimo acima; áreas sensíveis continuam exigindo o gate completo.

## O que cada comando cobre

| Comando | Quando usar | Observação |
|---|---|---|
| `pnpm check` | Mudanças em TypeScript, backend, frontend, scripts ou testes | Verifica tipos sem gerar build |
| `pnpm test` | Mudanças de comportamento, domínio, integrações, hooks ou componentes com lógica | Inclua testes novos quando o risco da mudança justificar; FAST pode executar apenas testes relacionados |
| `pnpm architecture:check` | Mudanças em camadas, módulos, imports ou organização de backend/frontend | Protege fronteiras arquiteturais do monólito |
| `pnpm docs:check` | Mudanças em schema, tRPC, documentação gerada/manualizada ou instruções operacionais | Confirma que docs geradas continuam sincronizadas |
| `pnpm build` | Mudanças que podem afetar empacotamento, frontend, backend de produção ou dependências | Deve passar antes de merge em PRs de produto com código |
| `pnpm agent:check` | Gate completo para áreas sensíveis e mudanças operacionais usadas por agentes | Combina TypeScript, testes, arquitetura, checks operacionais e documentação; no CI CRITICAL a suíte Vitest anterior é sinalizada por `CI_SHARDED_TESTS_COMPLETE=1` para não ser repetida |
| `pnpm exec tsx scripts/check-ci-gate-docs.ts` | Mudanças em workflow, guia de contribuição ou template de PR | Garante alinhamento entre documentação, template e workflow `Agent-first gate`; o CI executa no perfil CRITICAL |
| `pnpm db:check-integrity` | Mudanças de persistência ou dados quando houver `DATABASE_URL` disponível para validação | Se o ambiente não tiver banco configurado, registre isso na PR |

Não documente nem exija comando novo como obrigatório sem adicioná-lo ao `package.json` ou explicar qual comando existente é equivalente.

### Credenciais para testes reais de IA no GitHub Actions

Todo teste ou smoke versionado que faça chamadas reais a OpenAI ou Gemini deve usar os secrets de repositório já padronizados `OPENAI_API_KEY` e `GEMINI_API_KEY`. Não crie aliases específicos por issue ou workflow, como `AI_SMOKE_OPENAI_API_KEY` ou `AI_SMOKE_GEMINI_API_KEY`.

As credenciais devem ser referenciadas somente no `env` do passo que executa a chamada externa. Checkout, setup, instalação de dependências, variáveis no nível do job e artefatos não podem receber esses secrets. O workflow deve falhar de forma explícita quando a chave necessária estiver ausente. Em execução local, use os mesmos nomes de ambiente.

## Validação local, manual e CI

A validação local deve ser registrada na PR com os comandos executados e o resultado. Quando uma validação depender de serviço externo, credencial, banco ou webhook indisponível, registre a limitação e descreva o impacto. Falha por dependência externa não deve ser tratada como sucesso silencioso.

Além dos comandos automatizados, use smoke tests manuais quando a mudança tocar fluxos de usuário ou integrações externas. Exemplos: login/logout para autenticação, envio e recebimento de webhook para WhatsApp, OAuth/callback para Strava, inferência de refeição para OpenAI ou cálculo de metas/refeições para o fluxo nutricional.

O CI executa o workflow `Agent-first gate` em PRs, em push para `main` e em push para `develop`. Em PRs, `Delivery V2 risk` determina `FAST`, `STANDARD` ou `CRITICAL`; `Merge preview integration` verifica compatibilidade do merge preview sem executar Vitest; e o required status `Agent-first gate` valida o `head_sha` exato com o conjunto correspondente ao risco. O manifesto registra `checkoutSha`, `headSha` e `riskProfile` e falha se o checkout divergir do head. O projeto também usa Vercel para preview/deploy check. A validação `pnpm db:check-integrity` permanece obrigatória para o caminho CRITICAL quando `DATABASE_URL` estiver disponível; quando o CI pular esse passo, a PR deve informar validação alternativa ou risco residual quando aplicável.

Em push para `develop/main`, a regressão completa permanece obrigatória. Portanto, reduzir o custo de uma PR FAST não elimina a verificação integral do branch integrado.

Se algum gate crítico deixar de existir no CI ou não cobrir um comando obrigatório, registre a lacuna na PR e abra uma issue separada para automatizar o check antes de tratar a automação como garantida.

## Antes de abrir ou aprovar PR

1. Confirme se a mudança toca alguma área sensível.
2. Confira a classificação Delivery V2 e rode localmente o gate correspondente à tabela acima.
3. Atualize documentação gerada/manualizada quando alterar schema, router, contratos ou comportamento operacional.
4. Registre na PR os comandos executados, checks de CI observados, smoke tests manuais e limitações.
5. Não faça merge com comando obrigatório falhando sem explicitar causa, impacto e plano de correção.
