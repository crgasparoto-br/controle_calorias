# Validacao de backend do WhatsApp

## Contexto

A issue #412 adiciona uma camada de validacao antes de qualquer acao persistente disparada pela interpretacao estruturada da IA.

Essa camada complementa:

- o schema runtime da IA;
- o schema canonico da #411;
- a politica de autonomia da #436;
- o roteamento seguro antes do fallback nutricional da #398/#408;
- o contrato de ferramentas da #438.

## Objetivo da primeira entrega

A primeira entrega protege as escritas ja executadas pelo backend atual do WhatsApp:

- criar refeicao por `add_foods_to_meal`;
- atualizar refeicao ao adicionar alimentos;
- preparar a validacao de troca/correcao antes de persistencia futura.

Antes de chamar `createManualMeal` ou `updateMeal`, o executor valida:

- schema estruturado do intent runtime;
- status de validacao retornado pelo interpretador;
- intencao permitida para persistencia;
- confianca minima;
- decisao de autonomia da politica canonica;
- refeicao alvo;
- alimento extraido;
- quantidade e unidade claras;
- alvo de troca/correcao quando aplicavel.

## Comportamento seguro

Quando a validacao falha:

- nenhuma ferramenta de consulta ou escrita de refeicao e chamada pelo executor persistente;
- o usuario recebe pedido de esclarecimento;
- a auditoria registra `fallbackReason: backend_validation_failed`;
- a auditoria registra `errorCode` com o primeiro motivo bloqueante;
- a resposta usa `clarification_request`, que nao possui efeito persistente.

## Integracao no executor

`executeWhatsappLlmIntent` chama `validateWhatsappRuntimeIntentForPersistence` somente para intencoes persistentes atuais:

- `add_foods_to_meal`;
- `replace_food_in_meal`;
- `edit_food_quantity`.

Intencoes de leitura, ajuda e link continuam fora dessa validacao pesada porque nao gravam dados. O contrato de ferramentas segue validando permissao, idempotencia e `backendValidated` nas chamadas persistentes.

## Regras iniciais

- Registro alimentar automatico precisa de schema valido, `validationStatus = valid`, confianca suficiente, refeicao alvo, item, quantidade e unidade.
- Registro com alimento sem quantidade ou unidade pede esclarecimento e nao consulta nem grava refeicao.
- Intencao nao persistente tentando passar pelo fluxo de persistencia e bloqueada.
- Troca/correcao exige alvo claro e autonomia executavel; no MVP, troca de alimento sem aceite explicito e bloqueada para evitar alterar o alvo errado.
- Baixa confianca ou autonomia que exige confirmacao/revisao bloqueia a execucao automatica.

## Limites desta etapa

Esta entrega ainda nao implementa a validacao completa de:

- multiplas acoes com sucesso parcial;
- midia, rotulo nutricional e transcricao;
- datas relativas com fusos diferentes;
- alteracoes de meta/plano/sugestoes profissionais;
- fluxo duravel de confirmacao multi-turn;
- fila de revisao de baixa confianca.

Esses pontos seguem como proximas partes da #397, pois dependem das subissues de contexto, midia, propostas, confirmacao, revisao e aprendizado.

## Testes

`server/modules/whatsapp/intentValidation.test.ts` cobre:

- payload valido para registro alimentar;
- schema invalido;
- alimento sem quantidade/unidade;
- intencao somente leitura tentando persistir;
- payload estruturado nao validado;
- confianca abaixo da politica de autonomia;
- troca sem aceite explicito.

`server/modules/whatsapp/llmIntentActions.test.ts` cobre a integracao para impedir que uma intencao alimentar invalida consulte ou escreva refeicao.
