# Validacao de backend do WhatsApp

## Contexto

A issue #412 adiciona uma camada de validacao antes de qualquer acao persistente disparada pela interpretacao estruturada da IA.

Essa camada complementa:

- o schema runtime da IA;
- o schema canonico da #411;
- a politica de autonomia da #436;
- o roteamento seguro antes do fallback nutricional da #398/#408.

## Objetivo da primeira entrega

A primeira entrega protege as escritas ja executadas pelo backend atual do WhatsApp:

- criar refeicao por `add_foods_to_meal`;
- atualizar refeicao ao adicionar alimentos;
- preparar a validacao de troca/correcao antes de persistencia futura.

Antes de chamar `createManualMeal` ou `updateMeal`, o executor valida:

- schema estruturado do intent runtime;
- status de validacao retornado pelo interpretador;
- decisao de autonomia;
- intencao permitida para persistencia;
- confianca minima;
- refeicao alvo;
- alimento extraido;
- quantidade e unidade claras;
- alvo de troca/correcao quando aplicavel.

## Comportamento seguro

Quando a validacao falha:

- nenhuma ferramenta de leitura/escrita de refeicao e chamada;
- o usuario recebe pedido de esclarecimento;
- a auditoria registra `fallbackReason: backend_validation_failed`;
- a auditoria registra `errorCode` com o primeiro motivo bloqueante.

## Limites desta etapa

Esta entrega ainda nao implementa a validacao completa de:

- multiplas acoes com sucesso parcial;
- midia, rotulo nutricional e transcricao;
- datas relativas com fusos diferentes;
- alteracoes de meta/plano/sugestoes profissionais;
- fluxo duravel de confirmacao multi-turn.

Esses pontos seguem como proximas partes da #397, pois dependem das subissues de contexto, midia, propostas e confirmacao.
