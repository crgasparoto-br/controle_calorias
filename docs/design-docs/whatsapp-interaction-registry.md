# Registro executável de interações do WhatsApp

## Objetivo

A issue #858 centraliza apresentação, validação, resolução e reapresentação das decisões fechadas alcançáveis pelo WhatsApp, reutilizando `whatsappPendingOperations` como única persistência operacional.

O registro executável está em `server/modules/whatsapp/interactionRegistry.ts`. Ele não cria um segundo store nem copia payloads de domínio. Cada entrada associa o tipo e o `target` canônico persistidos a:

- identificador estável, origem e entrypoints;
- classificação `open` ou `closed`;
- ações canônicas em ordem determinística;
- efeitos permitidos e proibidos;
- classificador e resolvedor textual;
- builder de reapresentação;
- resolvedor de callback;
- comportamento para resposta inválida e estado obsoleto.

`foodClarificationGate.ts` não conhece tipos concretos de pendência. Ele localiza a entrada e executa `classifyText`, `resolveText` ou `rebuild`. `messageRouter.ts` valida o callback e delega a `completeCallback`. Assim, adicionar somente uma constante ou uma entrada incompleta não é suficiente para passar os testes estruturais.

## Regra de apresentação

A apresentação é construída por `interactionPresentation.ts`:

- perguntas abertas permanecem em texto;
- decisões fechadas com até três ações no total usam botões;
- decisões fechadas com quatro ou mais ações usam lista;
- a contagem inclui **Cancelar**;
- rótulos são truncados nos limites do provedor;
- callbacks usam IDs opacos autenticados e não expõem IDs de usuário, refeição ou item.

Consequentemente:

- Confirmar + Cancelar: dois botões;
- dois candidatos + Cancelar: três botões;
- três candidatos + Cancelar: lista com quatro linhas.

## Interações registradas

O registro cobre:

1. confirmação e seleção de exclusão;
2. seleção de item para substituição ou ajuste;
3. confirmação genérica;
4. reclassificação ambígua entre registros compatíveis e todos os apresentados;
5. período de resumo;
6. autorização profissional;
7. clarificação genérica de intenção;
8. clarificações alimentares `quantity`, `confirmation` e `selection` da issue #855.

Os produtores expõem ações estruturadas e reutilizam `buildWhatsappClosedDecisionReply`. Os testes impedem que produtores principais voltem a chamar `buttonsReply` ou `listReply` diretamente.

## Gate central

`messageRouter.ts` resolve callbacks antes de classificadores e fallback. O callback é validado por:

- assinatura e formato;
- usuário proprietário;
- canal/telefone ativo, quando aplicável;
- tipo e ação registrados;
- versão, estado e expiração.

Depois do claim compare-and-set, a entrada do registro chama o resolvedor canônico do domínio. Clique repetido, reentrega, corrida, adulteração ou callback de outro usuário não repetem a mutação.

## Respostas textuais e reapresentação

`foodClarificationGate.ts` mantém o nome legado por compatibilidade, mas atua como gate transversal:

- resposta compatível resolve a mesma operação canônica do callback;
- resposta inválida mantém a pendência e reconstrói ações, ordem e rótulos;
- reapresentação não cria pendência equivalente;
- comando completo incompatível marca a anterior como `superseded` e segue o fluxo normal;
- tipo não registrado falha de forma fechada e bloqueia fallback nutricional;
- recurso obsoleto não é substituído silenciosamente.

No webhook textual, `whatsapp.interaction.pending_represented` preserva a mesma pendência ativa.

## Clarificação genérica

A pergunta “registrar, corrigir ou consultar?” é uma decisão fechada com quatro ações:

1. Registrar alimento;
2. Corrigir refeição;
3. Consultar registros;
4. Cancelar.

A mensagem original é persistida no `target`. Ao escolher Registrar alimento, o sistema tenta retomar esse texto pelos parsers canônicos. Se ele já contiver alimento suficiente, o fluxo continua ou cria a clarificação alimentar específica; caso contrário, é feita uma pergunta aberta de alimento e quantidade. A palavra de comando isolada nunca é persistida como alimento.

## Reclassificação

A interação persiste `mealIds` e, quando aplicável, `allMealIds`. A confirmação reconsulta exatamente esses IDs, valida propriedade, origem e classificação e só então executa a alteração. Uma refeição criada depois da pergunta não entra silenciosamente no conjunto confirmado.

## Clarificação alimentar

Os contratos da issue #855 são consumidos sem reimplementar catálogo, correção, porção ou persistência nutricional:

- `quantity` é aberta e permanece textual;
- `confirmation` é fechada e usa botões;
- `selection` é fechada e escolhe botões ou lista pela cardinalidade total;
- texto original e candidato normalizado permanecem separados;
- referência genérica de 100 g não vira porção implícita de uma unidade.

## Paridade de entrypoints

- webhook textual e callbacks: `resolveWhatsAppPrecedenceGate`;
- áudio transcrito: `executeWhatsappTextIntent` reconhece o escopo persistente da mensagem e executa o gate antes dos parsers;
- simulador: executa o gate persistente antes de `processMealDraft`;
- autorização enviada fora do webhook: usa o mesmo builder e contrato de ações.

## Observabilidade

Eventos e dados estruturados registram, sem conteúdo sensível:

- `interactionId`, origem, classificação e componente;
- quantidade de ações, incluindo cancelamento;
- ciclo de vida `created`, `represented`, `cancelled`, `consumed` ou `blocked`;
- motivo de resposta inválida ou callback bloqueado.

Cancelar é registrado como `cancelled`, e não como execução consumida.

## Evolução segura

`interactionRegistry.test.ts` descobre todos os valores exportados como `PENDING_*_TYPE` nos módulos alcançáveis e exige correspondência exata com o registro. Cada entrada deve oferecer ações, classificação textual, resolução textual, reapresentação e callback executáveis. O teste também impede switches ou cadeias paralelas por tipo no roteador, no gate e no registro.