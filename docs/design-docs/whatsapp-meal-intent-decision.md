# Decisão persistente: consumo x sugestão no WhatsApp

## Objetivo

Impedir a perda de contexto quando uma descrição de refeição pode representar tanto um consumo quanto um pedido de sugestão. Exemplo: `jantar com arroz, feijão e frango`.

A pergunta de decisão só pode ser enviada depois que o texto original estiver persistido em uma operação pendente reconstruível.

## Contrato

- Tipo de pendência: `meal_intent_decision`.
- Identificador estável da interação: `meal_intent_decision.consume_or_suggest`.
- Versão do contrato persistido: `1`.
- Classificação: fechada.
- Reconstrução: pelo próprio alvo persistido.
- Expiração inicial: 10 minutos.
- Componente preferencial: botões, porque existem exatamente três ações.
- Entrypoints: webhook real, webhook textual, simulador e transcrição de áudio.

A pendência preserva:

- texto original;
- texto normalizado para diagnóstico estrutural;
- identificador externo da mensagem inbound, quando disponível;
- intenção ambígua e possibilidades `add_foods_to_meal` e `meal_suggestion`;
- confiança e rótulo de refeição, quando disponíveis;
- ações permitidas.

O texto alimentar original não deve ser incluído em logs crus. A telemetria registra apenas metadados estruturais da interação.

## Ações

### Registrar

1. reivindica atomicamente a mesma pendência;
2. recupera o texto original;
3. executa somente o pipeline alimentar de criação em modo confirmado;
4. não reclassifica `Registrar` como conteúdo nutricional;
5. não permite que exclusão, água, relatório, correção ou outro domínio seja acionado pelo rótulo da ação;
6. quando faltar um dado alimentar, solicita apenas a informação específica ausente;
7. registra no máximo uma vez.

### Receber sugestão

1. reivindica atomicamente a mesma pendência;
2. usa o texto original para selecionar o contexto da sugestão;
3. responde explicitamente que nada foi registrado como consumo;
4. não cria refeição, item ou hidratação;
5. responde no máximo uma vez.

### Cancelar

1. reivindica ou cancela a pendência compatível;
2. confirma que nada foi registrado;
3. não produz efeito de domínio.

## Respostas textuais

Quando botões não estiverem disponíveis, a mesma interação aceita:

- `Registrar`, `Registre`, `Registra`, `Consumi`, `1`;
- `Sugestão`, `Receber sugestão`, `Quero sugestão`, `Sugerir`, `2`;
- `Cancelar`, `Cancela`, `Cancele`, `Não`, `0`.

Resposta curta incompatível não consome a pendência. A interação é reconstruída com as mesmas ações. Um novo comando completo pode substituir a pendência conforme a precedência central do WhatsApp.

## Falhas seguras

- Falha ao persistir: não envia botões órfãos e não executa domínio; pede que o usuário reenvie a descrição completa.
- Callback inválido, repetido, consumido, cancelado ou expirado: retorna a resposta canônica de solicitação indisponível.
- Contrato persistido inválido: bloqueia reclassificação e persistência nutricional.
- Falta de dados para registrar: solicita detalhes de quantidade ou porção, sem cair no esclarecimento genérico de intenção.

## Matriz de regressão executável

| Cenário | Entrada/ação | Resultado esperado |
|---|---|---|
| Criação | descrição ambígua | pendência criada antes do outbound; três botões |
| Registro central | pendência válida | interação fechada, reconstruível e componente `buttons` |
| Fallback textual | `Registrar`, `2`, `Cancelar` | resolve a ação correspondente |
| Resposta inválida | `talvez` | não consome; reapresenta a mesma interação |
| Sugestão | botão ou texto de sugestão | usa contexto original; `Nada foi registrado` |
| Cancelamento | botão ou texto de cancelamento | nenhum efeito de domínio |
| Idempotência | repetir o mesmo callback | primeira execução aceita; repetição indisponível |
| Persistência indisponível | falha ao criar pendência | nenhuma pergunta interativa órfã e nenhum registro |
| Novo comando completo | comando incompatível enquanto pendente | substitui a pendência conforme o gate central |
| Registro incompleto | `Registrar` sem quantidade suficiente | pergunta alimentar específica, nunca esclarecimento genérico |

A cobertura principal está em `server/modules/whatsapp/mealIntentDecisionInteraction.test.ts`; o fallback de sugestão sem produtor duplicado é coberto em `foodAssistant.test.ts`.
