# Multi-ação no WhatsApp

## Contexto

A issue #422 adiciona uma primeira camada para mensagens com mais de uma ação no mesmo texto, como `adiciona arroz, troca o frango por peixe e remove a cerveja` ou `Não é peixe é frango, não é mandioquinha é batata doce`.

O objetivo desta entrega é impedir que apenas a primeira ação seja considerada e que correções posteriores sejam ignoradas.

## Estratégia inicial

O módulo `server/modules/whatsapp/multiAction.ts` identifica múltiplas ações somente quando há separadores explícitos e verbos de ação claros. Ele não divide listas alimentares simples como `café, pão e leite`.

A decomposição preserva a ordem original e gera trechos independentes. Cada trecho passa pelo fluxo seguro já existente:

- ajustes de registro antes de persistência nutricional;
- roteador canônico antes do fallback nutricional;
- processamento nutricional apenas quando o trecho pode seguir para alimento.

## Sucesso parcial e pendências

Uma mensagem multi-ação pode retornar sucesso parcial. A resposta informa o resultado de cada trecho.

Quando uma única ação exige seleção ou confirmação, o contexto pendente pode ser registrado para a próxima mensagem. Quando mais de uma ação exige confirmação ou seleção, o sistema não abre várias pendências simultâneas; ele pede que cada confirmação seja enviada separadamente para evitar alteração de alvo errado.

## Observabilidade

A etapa `multi_action` foi adicionada ao trace operacional com:

- quantidade de ações detectadas;
- versão da regra;
- fallback quando a mensagem é tratada como ação única.

Cada trecho também registra as etapas reutilizadas, como `record_adjustment`, `canonical_router` e `nutrition_persistence`, com o índice da ação em `metadata.multiActionIndex`.

## Limitações atuais

- A decomposição é determinística e conservadora; mensagens muito livres ainda podem seguir como ação única.
- A execução real de alterações destrutivas continua bloqueada por confirmação, conforme as regras de ajuste de registro.
- Várias confirmações na mesma mensagem não criam múltiplos contextos pendentes ao mesmo tempo.
- A camada ainda não tenta resolver dependências complexas entre ações encadeadas além da ordem textual.
