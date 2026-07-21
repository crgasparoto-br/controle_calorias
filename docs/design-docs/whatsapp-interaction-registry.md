# Registro executável de interações do WhatsApp

## Objetivo

A issue #858 centraliza a apresentação, validação, resolução e reapresentação das decisões fechadas alcançáveis pelo WhatsApp, reutilizando `whatsappPendingOperations` como única persistência operacional.

O registro executável está em `server/modules/whatsapp/interactionRegistry.ts`. Ele não cria um segundo store nem copia payloads de domínio. Cada entrada associa o tipo e o `target` canônico já persistidos a:

- identificador estável da interação;
- origem e entrypoints alcançáveis;
- classificação `open` ou `closed`;
- ações canônicas em ordem determinística;
- componente esperado;
- estratégia de reconstrução;
- comportamento para resposta inválida e estado obsoleto;
- efeitos permitidos e proibidos.

## Regra de apresentação

A apresentação é construída por `interactionPresentation.ts`:

- perguntas abertas permanecem em texto;
- decisões fechadas com até três ações no total usam botões;
- decisões fechadas com quatro ou mais ações usam lista;
- a contagem inclui **Cancelar**;
- rótulos são truncados nos limites do provedor;
- callbacks usam IDs opacos assinados e nunca expõem IDs de usuário, refeição ou item.

Consequentemente:

- Confirmar + Cancelar: dois botões;
- dois candidatos + Cancelar: três botões;
- três candidatos + Cancelar: lista com quatro linhas.

## Interações registradas

O registro cobre:

1. confirmação e seleção de exclusão;
2. seleção de item para substituição ou ajuste;
3. confirmação genérica;
4. reclassificação ambígua entre registros compatíveis e todos os recentes;
5. período de resumo;
6. autorização profissional;
7. clarificação genérica de intenção;
8. clarificações alimentares `quantity`, `confirmation` e `selection` produzidas pela issue #855.

Os produtores expõem ações estruturadas e reutilizam `buildWhatsappClosedDecisionReply`. Os testes impedem que os produtores principais voltem a chamar `buttonsReply` ou `listReply` diretamente.

## Gate central

`messageRouter.ts` resolve callbacks antes de qualquer classificador ou fallback. O callback é validado por:

- assinatura e formato;
- usuário proprietário;
- canal/telefone ativo quando aplicável;
- tipo registrado;
- ação permitida para o `target` persistido;
- versão;
- estado;
- expiração.

Depois do claim compare-and-set, o registro despacha para o resolvedor canônico do domínio. Clique repetido, reentrega, corrida, callback adulterado ou callback de outro usuário não repetem a mutação.

## Respostas textuais e reapresentação

`foodClarificationGate.ts` mantém o nome legado por compatibilidade, mas atua como gate transversal de todas as pendências registradas.

- Resposta compatível resolve a mesma operação e ação canônica do callback.
- Resposta inválida mantém a pendência ativa e reconstrói as mesmas ações, ordem e rótulos.
- A reapresentação não cria pendência equivalente.
- Novo comando completo incompatível marca a pendência anterior como `superseded` e segue o fluxo normal.
- Tipo não registrado falha de forma fechada e bloqueia fallback nutricional.
- Pendência expirada, consumida, cancelada ou com recurso obsoleto responde indisponibilidade sem recriação silenciosa.

No webhook real, `whatsapp.interaction.pending_represented` preserva a pendência em vez de executar a limpeza genérica de contexto.

## Clarificação genérica

A pergunta “registrar, corrigir ou consultar?” é uma decisão fechada com quatro ações:

1. Registrar alimento;
2. Corrigir refeição;
3. Consultar registros;
4. Cancelar.

A mensagem original é persistida no `target`. Escolher Registrar alimento cria uma pergunta aberta específica e nunca persiste a palavra de comando como alimento. Clarificações genéricas produzidas por baixa confiança do LLM usam o mesmo contrato e componente.

## Clarificação alimentar

Os contratos alimentares da issue #855 são consumidos sem reimplementar catálogo, correção ortográfica, porção ou persistência nutricional:

- `quantity` é aberta e permanece textual;
- `confirmation` é fechada e usa botões;
- `selection` é fechada e escolhe botões ou lista pela cardinalidade total;
- texto original e candidato normalizado permanecem separados;
- referência genérica de 100 g não vira porção implícita de uma unidade.

## Paridade de entrypoints

- webhook textual e callbacks: `resolveWhatsAppPrecedenceGate`;
- áudio transcrito: retorna ao mesmo pipeline textual do webhook;
- simulador: executa o mesmo gate persistente antes de `processMealDraft`;
- autorização enviada fora do webhook: usa o mesmo builder e contrato de ações.

## Observabilidade

Eventos e dados estruturados registram, sem conteúdo sensível:

- `interactionId`;
- origem;
- classificação;
- componente;
- quantidade de ações, incluindo cancelamento;
- ciclo de vida: criada, reapresentada, cancelada, consumida ou bloqueada;
- motivo de resposta inválida ou callback bloqueado.

## Evolução segura

`interactionRegistry.test.ts` descobre os valores exportados como `PENDING_*_TYPE` nos módulos alcançáveis e exige correspondência exata com o registro. O teste também impede listas ou switches paralelos no `messageRouter.ts` e compara as ações do registro com os builders estruturados dos produtores.
