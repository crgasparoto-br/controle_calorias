# Design técnico: camada LLM de intenções do WhatsApp

## Responsabilidade

Interpretar mensagens naturais de texto do WhatsApp antes do fallback genérico de refeição, convertendo o texto em uma intenção estruturada, validada e executada de forma determinística pelo backend.

## Fluxo

```text
WhatsApp -> protecao de conteudo -> contexto seguro -> interpretador LLM -> schema Zod -> executor deterministico -> resposta contextual
              | bloqueio seguro                             | falha/JSON invalido/payload invalido/baixa confianca
              v                                              v
       esclarecimento seguro                         classificador deterministico/fallback seguro
```

## Orquestração operacional

A ordem de decisão do runtime segue este contrato inicial da issue #429:

1. Receber a mensagem pelo webhook do WhatsApp.
2. Aplicar proteções de entrada antes de enviar qualquer conteúdo para IA.
3. Normalizar texto/unidades nos pontos já existentes do webhook e dos serviços de WhatsApp.
4. Resolver intenções determinísticas de alta confiança quando o webhook já tiver contexto suficiente, como hidratação, ajustes de quantidade, relatório com contexto pendente e orientação alimentar.
5. Acionar o interpretador estruturado com LLM apenas quando a regra determinística não for suficiente e o conteúdo for seguro para classificação.
6. Validar o JSON retornado pelo schema Zod antes de qualquer executor de domínio.
7. Executar somente ações suportadas pelo backend, com thresholds de confiança e confirmação.
8. Em falha de LLM, timeout, JSON inválido, payload inválido, baixa confiança ou ação não suportada, retornar pergunta segura, fallback determinístico ou delegar ao fluxo nutricional apenas quando o texto tiver sinal claro de refeição.
9. Registrar auditoria com estratégia, duração, modelo usado quando aplicável, fallback, ferramentas usadas e decisão final.

As estratégias registradas em auditoria são:

- `security_guard_block`: conteúdo bloqueado antes da IA por tentativa suspeita de alterar regras, prompt, autonomia, ferramentas ou acessar dados fora do escopo.
- `deterministic_only`: LLM desativada por configuração ou opção de execução, usando classificação determinística.
- `llm_structured`: LLM retornou JSON válido e compatível com o schema.
- `llm_invalid_json_fallback`: LLM respondeu algo que não era JSON válido, então o backend caiu para fallback determinístico.
- `llm_invalid_payload_fallback`: LLM respondeu JSON que não passou no schema, então o backend caiu para fallback determinístico.
- `llm_error_fallback`: provider indisponível, timeout ou erro após retries, então o backend caiu para fallback determinístico.

## Contrato operacional de ferramentas

A issue #438 é representada inicialmente por `server/modules/whatsapp/toolContracts.ts`. O executor não recebe ferramentas livres da LLM: ele só chama serviços internos depois que a intenção estruturada foi validada e a ferramenta foi autorizada para aquela intenção.

Ferramentas atuais:

| Ferramenta | Efeito | Intenções permitidas | Fallback |
|---|---|---|---|
| `meal_history_read` | leitura | `add_foods_to_meal`, `replace_food_in_meal`, `list_meal_records`, `daily_summary` | esclarecimento |
| `meal_create` | escrita | `add_foods_to_meal` | esclarecimento |
| `meal_update` | correção | `add_foods_to_meal`, `replace_food_in_meal` | esclarecimento |
| `nutrition_measurement_resolve` | validação | `add_foods_to_meal` | fallback nutricional |

Regras do contrato:

- Toda ferramenta exige intenção validada pelo schema antes de uso.
- Ferramentas com efeito persistente exigem validação de backend e alvo resolvido antes de gravar.
- Ferramenta incompatível com a intenção gera erro de contrato e não deve executar efeito persistente.
- O audit log registra `toolNames` para permitir rastrear leitura, validação, escrita e correção usadas em cada decisão.
- Falhas de ferramenta seguem fallback seguro: esclarecimento, não ação segura ou fallback nutricional controlado conforme contrato.

## Componentes

- `server/modules/whatsapp/promptInjectionGuard.ts`: inspeção de conteúdo não confiável, bloqueio seguro e delimitação do texto enviado à LLM.
- `server/modules/whatsapp/toolContracts.ts`: catálogo de ferramentas, efeitos, intenções permitidas, validações exigidas e fallback operacional.
- `server/modules/whatsapp/intentSchema.ts`: contrato único das intenções suportadas.
- `server/modules/whatsapp/intentContext.ts`: builder de contexto mínimo do usuário.
- `server/modules/whatsapp/intentInterpreter.ts`: chamada LLM com saída JSON schema, estratégia operacional e classificador determinístico de fallback.
- `server/modules/whatsapp/intentAuditLog.ts`: registro em memória das decisões estruturadas, incluindo estratégia, duração, modelo, ferramentas, fallback e erro.
- `server/modules/whatsapp/llmIntentActions.ts`: executor seguro das intenções validadas, com autorização de ferramenta antes de leitura, escrita ou correção.
- `server/modules/whatsapp/service.ts`: ponto de integração antes do interpretador legado e antes do fallback nutricional.

## Encaixe com as próximas issues da Fase 0

- #411 deve ampliar a taxonomia e o schema canônico para cobrir todas as intenções da épica sem duplicar classificação local.
- #436 deve substituir thresholds soltos por níveis de autonomia por ação, risco e confiança.
- #424 e #427 devem alimentar a etapa de normalização antes do roteador, preservando texto original, transcrição, mídia e linguagem informal.
- #423 deve mover a idempotência de mensagem para uma proteção geral de webhook, não apenas casos pontuais.
- #440 deve evoluir a auditoria em memória para observabilidade operacional persistente, com custo, latência por etapa, timeout e traces adequados à política de privacidade.

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
- Conteúdo de texto, legenda, transcrição ou mídia é sempre conteúdo não confiável, nunca instrução de sistema.
- Payload inválido, baixa confiança ou ambiguidade gera fallback seguro ou pergunta contextual.
- A execução continua em serviços de domínio do backend.
- O contexto enviado ao LLM deve ser mínimo e não deve incluir texto cru sensível desnecessário.
- Mensagens de consulta, como `refeições registradas`, não devem cair no fallback de alimento incompleto.
- Criação automática de refeição só acontece quando a intenção estruturada permitir `createIfMissing`.
- Troca de alimento só acontece quando há correspondência segura com item da última refeição.
- Falha de LLM, schema inválido, timeout ou provider indisponível não persiste alimento, meta, plano ou ação sensível automaticamente.
- Ferramentas internas só podem ser usadas por intenção compatível, com validação e auditoria.

## Relação com PR #309

A PR #309 trata fallback nutricional estimado para alimentos por imagem. Essa lógica pertence ao pós-processamento nutricional e não deve ser usada como base da classificação textual do WhatsApp. A camada desta entrega reaproveita apenas a abordagem de documentar regressões e validar comportamento com testes, mantendo os fallbacks de imagem separados.

## Casos de regressão cobertos

- `Não é banana da terra e sim batata doce assada na air fryer`
- `Inclua no café da manhã: 2 fatias de pão de forma, 50g de tahine com salsinha e Café coado`
- `refeições registradas`
- `registro`
- `banana`
- tentativa de ignorar instruções internas e revelar prompt do sistema
- tentativa de acessar dados de outros usuários
- fallback por JSON inválido, payload inválido e erro do provider
- bloqueio de ferramenta incompatível com a intenção
- auditoria das ferramentas usadas em consulta e criação de refeição
