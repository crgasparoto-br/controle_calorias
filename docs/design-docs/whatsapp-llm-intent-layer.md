# Design técnico: camada LLM de intenções do WhatsApp

## Responsabilidade

Interpretar mensagens naturais de texto do WhatsApp antes do fallback genérico de refeição, convertendo o texto em uma intenção estruturada, validada e executada de forma determinística pelo backend.

A camada decide quando usar regra local, quando chamar LLM estruturado e quando encerrar com fallback seguro. O LLM nunca executa ação diretamente e nunca é fonte única para persistir dados sensíveis.

## Fluxo de decisão

```text
Webhook WhatsApp
  -> normalização do evento e contexto mínimo
  -> guarda de conteúdo não confiável
  -> idempotência e deduplicação operacional
  -> regras determinísticas seguras
      -> executa/consulta quando a confiança é alta e não exige confirmação
  -> router de intenção contextual
  -> LLM estruturado com JSON schema
  -> validação de schema e confiança
  -> contrato de ferramenta compatível com intenção/autonomia/validação
  -> executor determinístico do backend
  -> auditoria operacional

Falha de segurança, timeout, erro de API, JSON inválido, schema inválido, ferramenta indisponível ou baixa confiança
  -> resposta segura, pergunta de esclarecimento ou fallback nutricional controlado
  -> sem gravação automática de dados sensíveis
  -> auditoria com motivo do fallback
```

## Estratégias rastreadas

Cada interpretação gera `operationalTrace` para auditoria:

- `deterministic`: regra local segura foi suficiente. Não há custo de LLM e `modelName` fica nulo.
- `llm_structured`: houve chamada ao provider com saída JSON validada pelo schema.
- `safe_fallback`: a IA não pôde ser usada com segurança ou a resposta não foi confiável.

O rastro inclui estratégia usada, modelo, latência, custo estimado em unidades de tentativa e motivo de fallback quando houver. Esses campos permitem acompanhar latência, custo, confiança, erro operacional e caminho de decisão sem armazenar texto cru da mensagem.

## Governança de ferramentas

Toda ferramenta usada pelo executor precisa estar no catálogo `server/modules/whatsapp/aiToolContract.ts`, com versão, tipo, intenções permitidas, efeito persistente, exigência de validação, exigência de idempotência, política de parâmetros, pré-condições e pós-condições.

Tipos iniciais:

- `read`: consulta dados sem alterar estado.
- `simulation`: calcula ou prepara dados em memória antes de uma ação.
- `validation`: valida contrato, alvo ou contexto.
- `write`: cria novo dado persistente.
- `correction`: altera dado existente dentro do escopo da intenção.
- `removal`: remove dado persistente, sempre com validação explícita.
- `suggestion`: orienta o usuário sem alterar estado.
- `review`: pede esclarecimento ou revisão antes de executar.

Catálogo inicial:

- `whatsapp_context_build`: leitura de contexto mínimo do usuário.
- `meal_records_list`: leitura de refeições para consulta, escrita contextual ou correção.
- `meal_item_nutrition_simulate`: simulação nutricional em memória antes de escrita/correção.
- `meal_record_create`: escrita persistente de nova refeição validada.
- `meal_record_update`: correção ou atualização persistente de refeição existente.
- `records_link_suggest`: sugestão de revisão no app ou ajuda.
- `clarification_request`: pergunta de esclarecimento/revisão sem persistência.

Regras obrigatórias:

- ferramenta fora das intenções permitidas é bloqueada com `intent_not_allowed`;
- ferramenta que exige validação não roda sem `backendValidated=true`;
- ferramenta persistente não roda sem `idempotencyKey`;
- parâmetros auditados são resumos sanitizados, nunca texto cru da mensagem;
- falha ou timeout de ferramenta gera fallback seguro e `toolTrace` com `outcome` e `failureReason`;
- a decisão final da mensagem registra quais ferramentas foram usadas, versão, resultado, decisão e resumo de parâmetros.

## Regras determinísticas antes da IA

Mensagens simples e suficientemente confiáveis não dependem do LLM. Exemplos:

- `refeições registradas` vira `list_meal_records` por regra local.
- `resumo de hoje` vira `daily_summary` por regra local.
- `ajuda` vira `help` por regra local.
- Correções no formato `não é A e sim B` viram `replace_food_in_meal` quando não exigem confirmação.
- Inclusões explícitas em refeição nomeada podem virar `add_foods_to_meal` quando os itens e quantidades estão claros.

Mensagens curtas, ambíguas, sem quantidade ou com múltiplas interpretações seguem para LLM ou esclarecimento, conforme o contexto e a configuração do ambiente.

## Fallback operacional

O sistema retorna caminho seguro quando ocorre:

- timeout do provider;
- erro de API;
- JSON inválido;
- payload fora do schema;
- baixa confiança;
- ferramenta fora do escopo da intenção;
- falha, timeout ou dado inconsistente retornado por ferramenta;
- tentativa de alterar prompt, burlar validação, mudar autonomia ou acessar dados de terceiros.

Nesses casos, a resposta pode ser uma pergunta de esclarecimento, bloqueio seguro ou fallback nutricional legado quando a mensagem parece ser um relato comum de refeição. Nenhuma falha de IA ou de ferramenta grava dados automaticamente.

## Componentes

- `server/modules/whatsapp/intentSchema.ts`: contrato único das intenções suportadas.
- `server/modules/whatsapp/intentContext.ts`: builder de contexto mínimo do usuário.
- `server/modules/whatsapp/promptInjectionGuard.ts`: guarda de conteúdo não confiável antes da IA.
- `server/modules/whatsapp/intentInterpreter.ts`: regra determinística, chamada LLM, validação e fallback seguro.
- `server/modules/whatsapp/aiToolContract.ts`: catálogo e validação operacional das ferramentas usadas pela IA.
- `server/modules/whatsapp/llmIntentActions.ts`: executor seguro das intenções validadas.
- `server/modules/whatsapp/intentAuditLog.ts`: auditoria sem texto cru, com estratégia, custo, latência, confiança, ferramenta e fallback.
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
- A execução continua em serviços de domínio do backend e ferramentas catalogadas.
- O contexto enviado ao LLM deve ser mínimo e não deve incluir texto cru sensível desnecessário.
- Mensagens de consulta, como `refeições registradas`, não devem cair no fallback de alimento incompleto.
- Criação automática de refeição só acontece quando a intenção estruturada permitir `createIfMissing`, a ferramenta estiver autorizada e houver chave de idempotência.
- Troca de alimento só acontece quando há correspondência segura com item da última refeição.

## Relação com subissues da epic

- #398: define o contrato de intenções e o schema usado pelo interpretador e pelo executor.
- #412: reforça validações do executor antes de qualquer persistência de domínio.
- #423: entra antes do interpretador e das ferramentas persistentes, garantindo idempotência e rastreabilidade do evento recebido.
- #424: normaliza texto, datas e contexto mínimo antes do roteamento.
- #427: consolida enriquecimento contextual usado pelo LLM sem expor dados além do necessário.
- #425: usa o rastro operacional e `toolTrace` para métricas de custo, latência, confiança, estratégia, ferramenta e fallback.
- #436: define os níveis de autonomia que passam a compor a autorização de ferramentas sensíveis.
- #431: promove alterações de ferramentas, prompts e regras apenas por fluxo versionado e auditável.

## Relação com PR #309

A PR #309 trata fallback nutricional estimado para alimentos por imagem. Essa lógica pertence ao pós-processamento nutricional e não deve ser usada como base da classificação textual do WhatsApp. A camada desta entrega reaproveita apenas a abordagem de documentar regressões e validar comportamento com testes, mantendo os fallbacks de imagem separados.

## Casos de regressão cobertos

- `Não é banana da terra e sim batata doce assada na air fryer`
- `Inclua no café da manhã: 2 fatias de pão de forma, 50g de tahine com salsinha e Café coado`
- `refeições registradas`
- `registro`
- `banana`
- fallback por JSON inválido
- fallback por schema inválido
- fallback por provider indisponível
- bloqueio de tentativa de prompt injection
- auditoria por estratégia determinística, LLM estruturado e fallback seguro
- catálogo de ferramentas com leitura, simulação, escrita e revisão
- ferramenta bloqueada por intenção incompatível
- ferramenta persistente bloqueada sem idempotência
- falha e timeout de ferramenta rastreados
- auditoria por ferramenta usada na decisão final
