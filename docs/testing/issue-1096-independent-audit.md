# Issue #1096 — parecer independente de auditoria

## Identificação da auditoria

Esta rodada inicial foi executada por um revisor independente da implementação, sem alterações no repositório durante a inspeção. O snapshot histórico da rodada 1 era `develop@88848424a7dceee0c84f92fde636c3142bc919fa`. A auditoria verificou a issue #1096, a documentação de reachability, o teste complementar, a composição dos handlers e os testes reproduzíveis das issues #1094, #1095 e #1072.

## Rodada 1 — parecer inicial

**Resultado: PARTIAL.** Os requisitos comportamentais estavam verdes e a decisão de não remover wrappers era segura, mas a auditoria não aprovou a implantação porque faltavam evidências auditáveis em quatro pontos: SHA atual de `develop`, relatório independente separado, métricas operacionais before/after e prova runtime de composição além de inspeção textual.

| Critério | Resultado | Evidência independente | Pendência |
| --- | --- | --- | --- |
| SHA de `develop` e revalidação F0-05/F0-06/F0-08 | PARTIAL | `docs/testing/issue-1096-bridge-reachability.md` registrava o SHA-base e a referência F0, mas não `develop@88848424a7dceee0c84f92fde636c3142bc919fa`. | Registrar o snapshot atual, data/comando e repetir a revalidação. |
| F0-05 `keep` e fachada preservada | PASS | A fachada `server/whatsappWebhook.ts` permaneceu presente; a matriz e os testes mantiveram `verifyWhatsAppWebhook` e o fallback. | Nenhuma. |
| Registro de substituto/consumidores/reachability por remoção | PASS | O conjunto de remoções aprovado era vazio; a matriz de wrappers mantinha owners, consumidores, substitutos, reachability e testes. | Nenhuma enquanto não houver remoções. |
| Nenhuma remoção por similaridade ou delegação fina | PASS | Não houve remoção de produção; F0-06/F0-08 continuavam `defer`. | Nenhuma. |
| Bridges de #1095 somente após migração | PASS | `recoverCanonicalCommercialIdentity` e `prepareCountableFoodRegistration` permaneciam como adaptadores com condições de aposentadoria. | Nenhuma. |
| Round-trips removidos usam transporte estruturado | PASS | Nenhum round-trip foi removido nesta fase; o design registra transporte estruturado e delta zero. | Nenhuma. |
| Precedência, idempotência, mídia e fallback equivalentes | PASS | A caracterização pública #1094 passou 17/17 e as suítes focadas passaram. | Manter os golden flows; complementar a composição com prova runtime. |
| Contagens não aumentam | PARTIAL | A caracterização possui contadores e asserts por cenário, mas a evidência não apresentava relatório comparativo before/after para `processMealInput`, `NUTRITION_SEARCH`, persistências, claims e round-trips. | Criar relatório com métricas, comandos, snapshots e deltas. |
| Golden flows #1094 e regressões #1072 verdes | PASS | Execução independente reproduziu #1094 em 17/17, #1072 em 30/30 e `pnpm check` verde. | Registrar outputs e versionamento no relatório. |
| Wrappers mantidos têm owner e aposentadoria | PASS | A matriz em `docs/testing/issue-1096-bridge-reachability.md` fornecia owner, responsabilidade, consumidor, decisão e condição de aposentadoria. | Complementar checks textuais com runtime. |
| Composição documentada coerente com código | PARTIAL | A cadeia documentada correspondia às importações, mas `server/issue1096.bridgeReachability.test.ts` apenas lia arquivos e aplicava regex/string matching. | Adicionar teste runtime de delegação nos limites produtivos. |

## Correções aplicadas após a rodada 1

Foram aplicadas somente correções de evidência e testes, sem remover wrappers e sem alterar comportamento de produção:

1. `docs/testing/issue-1096-bridge-reachability.md` passou a registrar `develop@88848424a7dceee0c84f92fde636c3142bc919fa`, a captura em `2026-09-17T11:34:43Z`, o comando usado, os testes runtime e os links para este parecer e para o relatório de métricas.
2. `docs/design-docs/nutrition-engine.md` foi reconciliado com o snapshot atual e passou a apontar para as evidências executáveis.
3. `server/issue1096.bridgeReachability.runtime.test.ts` prova, por POST HTTP real, a entrada pública e a delegação do wrapper persistente até o limite de idempotência.
4. `server/issue1096.bridgeReachability.downstream.runtime.test.ts` prova a delegação runtime do wrapper de intenção para a fachada/implementação de anotação com uma imagem.
5. `server/issue1096.bridgeReachability.fallback.runtime.test.ts` prova o fallback runtime da implementação de anotação para a fachada nutricional quando não há mensagens.
6. `docs/testing/issue-1096-metrics.md` registra os comandos, as contagens reproduzidas e delta operacional zero.

## Rodada 2 — reauditoria de aprovação

A reauditoria independente foi executada sobre o commit versionado `b85002287df055f1bdfb700e8f54efb066792a42`, cujo pai é `develop@88848424a7dceee0c84f92fde636c3142bc919fa`. O auditor confirmou que os artefatos estavam rastreados, que a branch não possuía alterações locais e que os testes focados, golden flows e typecheck foram reproduzidos sem serviços externos.

**Resultado final: APROVADO.** Os onze critérios de aceite foram avaliados como `PASS`, sem pendência bloqueadora. A limitação dos testes runtime — doubles determinísticos nos limites de provider, banco, Cloud API e efeitos externos — é não bloqueadora porque os golden flows locais da #1094 cobrem o comportamento produtivo e os testes específicos cobrem os wrappers e seus contratos. A aprovação vale para o escopo versionado: preservação dos wrappers, evidência de reachability e correções documentais/testes da Fase 3; não autoriza remover a fachada F0-05 nem os adaptadores históricos sem nova prova.

### Evidências da aprovação

O auditor confirmou `4 arquivos/8 testes` nos testes da #1096, `17/17` na caracterização #1094, `12/12` na matriz #1095, `30/30` nas regressões #1072, `54/54` nos wrappers/intents/mídia/idempotência e `pnpm check` verde. Também confirmou `git diff --check`, a rastreabilidade dos oito artefatos e o delta operacional zero do relatório de métricas.

## Rodada 3 — revalidação da correção documental

Após a auditoria independente identificar que os artefatos não apontavam para o snapshot corrente, foram atualizados a matriz de reachability, o relatório de métricas, o design do motor nutricional e o teste estrutural. A revalidação desta rodada foi executada contra `develop@dacff30479007a0413232c2a22ebf7ac9a9c191d`, capturado em `2026-09-17T12:29:22Z` por `git rev-parse origin/develop`. O teste estrutural agora exige esse SHA no conjunto de evidências e no design do motor nutricional.

Os testes específicos da #1096, os golden flows da #1094, as regressões da #1072, as suítes da #1095, a suíte focada de WhatsApp, o typecheck, os checks de arquitetura e documentação e a suíte completa foram reexecutados. Não foram observadas novas pendências.

**Resultado final: APROVADO.** A pendência documental da rodada anterior foi corrigida e os artefatos agora registram o snapshot correto da `develop` auditada. A aprovação permanece limitada à preservação dos wrappers e à evidência de reachability; não autoriza remover a fachada F0-05 ou os adaptadores históricos sem nova prova.
