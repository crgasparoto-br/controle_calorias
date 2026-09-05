# Passthrough de medidas contáveis no registro textual do WhatsApp

## Objetivo

Garantir que medidas contáveis resolvidas antes da inferência nutricional, como `fatia`, `unidade` e outras porções domésticas, cheguem ao pipeline nutricional na gramatura determinada pelo resolvedor canônico em vez de retornar ao texto original.

## Contrato

1. `handleWhatsAppWebhookWithTextIntent` continua sendo a fronteira responsável por decidir se uma mensagem textual foi tratada por uma intenção ou deve seguir para o webhook nutricional.
2. Depois dos handlers de maior precedência (pendências/callbacks, hidratação, adição canônica à refeição, exclusões e ajustes), o wrapper executa `prepareWhatsappCountableFoodRegistration` uma única vez para o fragmento alimentar elegível.
3. Quando o gate retorna `ready`, `registrationText` é a representação canônica que deve ser usada tanto na chamada subsequente a `executeWhatsappTextIntent` quanto no `textOverrides` enviado ao webhook base quando houver passthrough.
4. Quando o gate retorna `ready` com ao menos uma resolução válida e `executeWhatsappTextIntent` não consome o texto reescrito, essa resolução é evidência determinística suficiente de registro alimentar: o wrapper encaminha `registrationText` diretamente ao pipeline nutricional e **não chama** o classificador contextual para redescobrir a intenção.
5. Antes do gate contável, perguntas que o roteador canônico classifica como resposta segura não alimentar são preservadas como consulta. Assim, textos como `quantas calorias tem 1 banana nanica?` e `1 banana nanica tem muita caloria?` não viram registro apenas por conter quantidade + alimento.
6. O preflight interno de `executeWhatsappTextIntent` permanece ativo para consumidores diretos, como transcrições de áudio e retomadas que não passam pelo wrapper textual. No fluxo normal do wrapper ele recebe o texto já convertido em gramas e, portanto, não repete a resolução da medida contável.
7. Em mensagens `água + alimento`, a hidratação é registrada uma única vez e apenas o fragmento alimentar passa pelo gate de medida contável. O texto alimentar reescrito é o payload encaminhado ao pipeline nutricional e a resposta final permanece uma única resposta lógica composta.
8. Comandos canônicos de adição a uma refeição, como `Adicionar 2 fatias de mussarela ao café da manhã`, continuam sob responsabilidade do fluxo de adição existente e não são desviados para um segundo pipeline nutricional.

## Quantidades implícitas sem verbo operacional

O vocabulário de contagem por extenso é compartilhado entre o resolvedor contável e o contrato de clarificação (`um/uma`, `dois/duas`, `três` até `dez`). Entradas diretas como `1 banana nanica`, `uma banana nanica`, `duas bananas` e `três ovos cozidos` são sinais de registro quando o domínio consegue resolver a identidade e a porção; não é necessário acrescentar `registrar`, `adicionar` ou outro verbo operacional.

Esse sinal continua subordinado às precedências existentes de pergunta, exclusão, correção, ajuste, hidratação, peso e adição explícita a uma refeição.

## Proveniência apresentada ao usuário

`prepareWhatsappCountableFoodRegistration` preserva as resoluções produzidas por `prepareCountableFoodRegistrationResolved`. Quando uma conversão é aplicada no passthrough, a resposta lógica inclui um bloco `Medidas usadas no cálculo` com:

- alimento identificado;
- quantidade e unidade informadas originalmente;
- gramatura usada pelo pipeline nutricional;
- origem da conversão.

Conversões `usual_average` são explicitamente apresentadas como aproximação (`aprox.` / `média usual estimada`). Porções canônicas ou medidas verificadas não são rotuladas como estimativas.

## Invariantes de regressão

- Uma referência nutricional genérica de `100 g` não pode substituir silenciosamente uma medida contável resolvida.
- O passthrough normal e o fragmento alimentar de `água + alimento` devem encaminhar `registrationText`, nunca o texto contável original, quando houver resolução.
- O mesmo fragmento alimentar não pode executar duas resoluções lógicas de medida contável no wrapper.
- O classificador contextual não é dependência para o caminho explícito de medidas contáveis.
- A solução reutiliza o pipeline nutricional existente; não existe segundo mecanismo de cálculo de calorias/macronutrientes.
- `executeWhatsappTextIntent` mantém seu preflight para callers diretos.

## Cobertura

A regressão da issue #1037 é coberta por `server/whatsappIntentWebhook.issue1037.test.ts`, incluindo a fronteira wrapper → webhook nutricional, preservação de proveniência, composição `água + alimento` e o controle do preflight para consumidores diretos.

A issue #1047 amplia a mesma matriz com `1 banana nanica`, múltiplos itens, perguntas nutricionais com quantidade, alimento desconhecido e prova de que uma resolução contável positiva não chama `executeWhatsappLlmIntent`. `server/countableFoodQuantity.issue1047.test.ts` protege também as contagens numéricas e por extenso na fonte canônica.
