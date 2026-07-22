# Gate final da épica #857

## Escopo

Este documento consolida o gate executável da épica corretiva #857 e complementa o inventário canônico de `interactionRegistry.ts` e a matriz de regressão do WhatsApp.

O inventário versionado permanece a única fonte de verdade para decisões abertas e fechadas. A matriz `issue857RegressionMatrix.ts` é derivada diretamente de `WHATSAPP_INTERACTION_REGISTRY`; portanto, uma interação adicionada, removida ou reordenada altera automaticamente o gate e não exige uma segunda relação funcional manual.

## Contrato de interação

- perguntas abertas permanecem textuais;
- decisões fechadas com até três ações, incluindo cancelamento, usam botões;
- decisões fechadas com quatro ou mais ações usam lista;
- respostas inválidas mantêm a mesma pendência e reapresentam as mesmas ações;
- callbacks e respostas textuais resolvem a mesma operação canônica;
- callbacks nunca seguem para parser, LLM ou persistência nutricional;
- botões, listas e CTA usam o fallback derivado do mesmo outbound central;
- fallback não recria a pendência nem reexecuta mutações.

## Contrato de resposta de refeição

Quando existe link de edição rápida, a ordem física é:

1. resumo nutricional em mensagem `text`, como resposta funcional primária;
2. CTA curto `Editar refeição`, como auxiliar;
3. imagem anotada, quando habilitada e disponível, como auxiliar independente.

O CTA não repete o resumo. O `recordText` permanece o resumo canônico. Falha do CTA e de seu fallback não invalida o resumo e não impede a tentativa de imagem auxiliar independente.

O texto `⚠️ Valores nutricionais estimados pela IA.` não é exibido em outbounds. A origem, qualidade, calorias e macronutrientes dos itens continuam preservados internamente e nos totais.

## Matriz executável

`server/modules/whatsapp/issue857RegressionMatrix.ts` vincula cada interação do inventário canônico a:

- tipo de pendência e classificação aberta/fechada;
- entrypoints publicados;
- modalidades texto, callback, áudio transcrito, simulador e imagem/contexto;
- comportamentos discriminantes obrigatórios;
- arquivos de teste que percorrem entrypoints, domínio, pending operations, transporte e lifecycle.

Para decisões fechadas, o gate exige explicitamente ações canônicas, componente interativo, reapresentação após resposta inválida, expiração sem recriação silenciosa, idempotência de callback, isolamento entre usuários, fallback bem-sucedido e falha total sem registrar entrega.

Para perguntas abertas, o gate exige preservação do contexto original, solicitação apenas do dado ausente e bloqueio de palavras operacionais na persistência alimentar.

## Cobertura automatizada

O gate `server/modules/whatsapp/issue857FinalGate.test.ts` valida:

- correspondência exata, sem ausências ou duplicidades, entre inventário e matriz;
- entrypoints, modalidades, efeitos permitidos/proibidos e política de estado obsoleto;
- vínculo de cada interação aos testes de webhook real, intent webhook, áudio, transporte e domínio específico;
- cardinalidade `texto/botões/lista`;
- reapresentação obrigatória das decisões fechadas;
- fallback de botões, listas e CTA sem exposição de IDs opacos;
- presença de `GITHUB_SHA`, `GITHUB_RUN_ID` e `GITHUB_WORKFLOW` quando executado em CI;
- ausência do aviso visual com preservação dos nutrientes estimados.

Os testes de `logicalReplyDelivery.test.ts` validam separadamente a ordem `texto -> CTA -> imagem`, o corpo curto do CTA, a ausência de repetição do resumo, o fallback quando o link não é gerado e a não interferência em listas interativas.

Os testes dos webhooks textual, de intenção e de áudio validam o resumo primário sem depender da última mensagem física, preservando o CTA auxiliar e a paridade dos entrypoints publicados.

A suíte completa executa os arquivos listados na matriz. Assim, o gate falha tanto quando o inventário diverge da matriz quanto quando qualquer cenário funcional associado falha.

## Evidência de branch e artefato

- branch de implementação: `fix/857-whatsapp-regression-gate`;
- branch-base: `develop`;
- commit funcional auditado antes desta atualização documental: `432e04797c89e5f11b2002f0b4a61152a9e2f24c`;
- o commit final da PR deve ser obtido do `head_sha` e corresponder ao SHA executado pelo workflow;
- em GitHub Actions, `GITHUB_SHA` identifica o artefato de código efetivamente executado pelo ambiente de verificação;
- `GITHUB_RUN_ID` identifica a execução reproduzível e `GITHUB_WORKFLOW` identifica o gate oficial;
- o teste final exige essas três evidências em CI e falha se o SHA não tiver formato de commit Git completo.

Para esta épica, o ambiente de verificação publicado é o workflow oficial associado ao `head_sha` da PR. A aprovação exige que a consulta dos workflows do commit retorne conclusão `success` para o mesmo SHA auditado. Caso a validação seja feita também em homologação ou produção, o ambiente adicional deve expor e registrar o mesmo SHA; divergência impede o encerramento.

## Validações obrigatórias

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm agent:check
pnpm build
```

Quando houver banco configurado, executar também os gates de persistência e integridade aplicáveis ao WhatsApp.
