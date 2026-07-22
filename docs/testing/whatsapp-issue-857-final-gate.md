# Gate final da épica #857

## Escopo

Este documento consolida o gate executável da épica corretiva #857 e complementa o inventário canônico de `interactionRegistry.ts` e a matriz de regressão do WhatsApp.

O inventário versionado permanece a única fonte de verdade para decisões abertas e fechadas. O gate não mantém uma segunda lista funcional: ele valida os identificadores e contratos exportados pelo próprio registro.

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

## Cobertura automatizada

O gate `server/modules/whatsapp/issue857FinalGate.test.ts` valida:

- unicidade e cobertura estrutural dos identificadores do inventário;
- entrypoints, efeitos permitidos/proibidos e política de estado obsoleto;
- cardinalidade `texto/botões/lista`;
- reapresentação obrigatória das decisões fechadas;
- fallback de botões, listas e CTA sem exposição de IDs opacos;
- ausência do aviso visual com preservação dos nutrientes estimados.

Os testes de `logicalReplyDelivery.test.ts` validam separadamente a ordem `texto -> CTA -> imagem`, o corpo curto do CTA, a ausência de repetição do resumo, o fallback quando o link não é gerado e a não interferência em listas interativas.

Os testes dos webhooks textual, de intenção e de áudio validam o resumo primário sem depender da última mensagem física, preservando o CTA auxiliar e a paridade dos entrypoints publicados.

## Evidência de branch e artefato

- branch de implementação: `fix/857-whatsapp-regression-gate`;
- branch-base: `develop`;
- o commit auditado deve ser o `head_sha` registrado na PR;
- o workflow oficial da PR é a evidência do artefato construído para esse commit;
- validação em ambiente publicado deve registrar explicitamente o SHA implantado antes do encerramento da épica.

A épica não deve ser fechada com SHA implantado divergente do SHA aprovado pelo workflow.

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
