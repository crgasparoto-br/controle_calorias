# Design técnico: camada LLM de intenções do WhatsApp

## Responsabilidade

Interpretar mensagens naturais de texto do WhatsApp antes do fallback genérico de refeição, convertendo o texto em uma intenção estruturada, validada e executada de forma determinística pelo backend.

## Fluxo

```text
WhatsApp -> contexto seguro -> interpretador LLM -> schema Zod -> executor determinístico -> resposta contextual
                                  | falha/JSON inválido/baixa confiança
                                  v
                           classificador determinístico/fallback seguro
```

## Componentes

- `server/modules/whatsapp/intentSchema.ts`: contrato único das intenções suportadas.
- `server/modules/whatsapp/intentContext.ts`: builder de contexto mínimo do usuário.
- `server/modules/whatsapp/intentInterpreter.ts`: chamada LLM com saída JSON schema e classificador determinístico de fallback.
- `server/modules/whatsapp/llmIntentActions.ts`: executor seguro das intenções validadas.
- `server/modules/whatsapp/service.ts`: ponto de integração antes do interpretador legado e antes do fallback nutricional.

## Intenções iniciais

- `add_foods_to_meal`
- `replace_food_in_meal`
- `edit_food_quantity`
- `list_meal_records`
- `daily_summary`
- `add_water`
- `add_exercise`
- `open_records_link`
- `help`
- `ambiguous`
- `unknown`

## Invariantes

- O LLM nunca grava dados, chama serviços diretamente ou executa ações livres.
- A saída do LLM precisa passar pelo schema antes de qualquer ação.
- Payload inválido, baixa confiança ou ambiguidade gera fallback seguro ou pergunta contextual.
- A execução continua em serviços de domínio do backend.
- O contexto enviado ao LLM deve ser mínimo e não deve incluir texto cru sensível desnecessário.
- Mensagens de consulta, como `refeições registradas`, não devem cair no fallback de alimento incompleto.
- Criação automática de refeição só acontece quando a intenção estruturada permitir `createIfMissing`.
- Troca de alimento só acontece quando há correspondência segura com item da última refeição.

## Relação com PR #309

A PR #309 trata fallback nutricional estimado para alimentos por imagem. Essa lógica pertence ao pós-processamento nutricional e não deve ser usada como base da classificação textual do WhatsApp. A camada desta entrega reaproveita apenas a abordagem de documentar regressões e validar comportamento com testes, mantendo os fallbacks de imagem separados.

## Casos de regressão cobertos

- `Não é banana da terra e sim batata doce assada na air fryer`
- `Inclua no café da manhã: 2 fatias de pão de forma, 50g de tahine com salsinha e Café coado`
- `refeições registradas`
- `registro`
- `banana`
