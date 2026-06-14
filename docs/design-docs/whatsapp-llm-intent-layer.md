# Design técnico: camada LLM de intenções do WhatsApp

## Responsabilidade

Interpretar mensagens naturais do WhatsApp antes do fallback genérico de refeição, convertendo texto, áudio, imagem e legenda em uma entrada estruturada, validada e executada de forma determinística pelo backend.

## Fluxo

```text
WhatsApp -> normalizacao multimodal -> protecao de conteudo -> contexto seguro -> interpretador LLM -> schema Zod -> politica de autonomia -> executor deterministico -> resposta contextual
              | midia sem contexto       | bloqueio seguro                             | falha/JSON invalido/payload invalido/baixa confianca
              v                           v                                              v
       esclarecimento seguro       esclarecimento seguro                         classificador deterministico/fallback seguro
```

## Orquestração operacional

A ordem de decisão do runtime segue este contrato inicial da issue #429, evoluído pela #424:

1. Receber a mensagem pelo webhook do WhatsApp.
2. Normalizar a entrada multimodal em texto roteável e metadados estruturados de mídia.
3. Aplicar proteções de entrada antes de enviar qualquer conteúdo para IA.
4. Normalizar texto/unidades nos pontos já existentes do webhook e dos serviços de WhatsApp.
5. Resolver intenções determinísticas de alta confiança quando o webhook já tiver contexto suficiente, como hidratação, ajustes de quantidade, relatório com contexto pendente e orientação alimentar.
6. Acionar o interpretador estruturado com LLM apenas quando a regra determinística não for suficiente e o conteúdo for seguro para classificação.
7. Validar o JSON retornado pelo schema Zod antes de qualquer executor de domínio.
8. Avaliar a política de autonomia por intenção, confiança, segurança e validação.
9. Executar somente ações suportadas pelo backend, com thresholds de confiança, validação e confirmação.
10. Em falha de LLM, timeout, JSON inválido, payload inválido, baixa confiança, autonomia insuficiente, mídia ambígua ou ação não suportada, retornar pergunta segura, fallback determinístico ou delegar ao fluxo nutricional apenas quando o texto tiver sinal claro de refeição.
11. Registrar auditoria com estratégia, duração, modelo usado quando aplicável, fallback, ferramentas usadas, autonomia aplicada, mídia normalizada e decisão final.

As estratégias registradas em auditoria são:

- `security_guard_block`: conteúdo bloqueado antes da IA por tentativa suspeita de alterar regras, prompt, autonomia, ferramentas ou acessar dados fora do escopo.
- `deterministic_only`: LLM desativada por configuração ou opção de execução, usando classificação determinística.
- `llm_structured`: LLM retornou JSON válido e compatível com o schema.
- `llm_invalid_json_fallback`: LLM respondeu algo que não era JSON válido, então o backend caiu para fallback determinístico.
- `llm_invalid_payload_fallback`: LLM respondeu JSON que não passou no schema, então o backend caiu para fallback determinístico.
- `llm_error_fallback`: provider indisponível, timeout ou erro após retries, então o backend caiu para fallback determinístico.

## Normalização multimodal

A issue #424 é representada por `server/modules/whatsapp/multimodalNormalizer.ts`. Essa etapa roda antes do roteador e transforma texto, áudio, imagem e imagem com legenda em um contrato comum.

Contrato normalizado:

- `inputModality`: `texto`, `audio`, `imagem` ou `imagem_com_legenda`.
- `originalText`: texto recebido diretamente, quando existir.
- `normalizedText` e `routerText`: texto seguro para os roteadores atuais, com unidades normalizadas.
- `transcribedText`: texto transcrito de áudio, quando existir.
- `mediaContext`: `mediaId`, legenda, tipo de mídia, MIME type e confiança de extração.
- `extraction`: extração realizada (`none`, `audio_transcription`, `image_classification`), confiança e fonte usada.
- `needsClarification`: indica quando a mídia não tem contexto suficiente para roteamento seguro.

Regras iniciais:

- Texto puro segue para o roteador depois de normalizar unidades.
- Áudio usa transcrição informada ou provider injetável; sem transcrição, pede esclarecimento.
- Imagem com legenda usa a legenda como contexto de classificação.
- Imagem de alimento e imagem de rótulo nutricional geram textos roteáveis diferentes.
- Imagem ambígua, sem legenda ou sem descrição suficiente, pede esclarecimento e não gera registro inseguro.
- Rótulo nutricional é encaminhado como intenção/contexto próprio para posterior extração rastreável de fonte específica; persistência final ainda depende de validação de backend e das próximas issues.
- O simulador registra evento `whatsapp.multimodal.normalized`; a persistência operacional detalhada de traces, custo, latência e mídia fica para a #440.

## Schema canônico de intenções

A issue #411 é representada por `server/modules/whatsapp/canonicalIntentSchema.ts`. Esse contrato define a taxonomia ampla em português e a saída estruturada versionada `whatsapp-intent-schema/v1`.

O schema canônico cobre:

- identificadores e modalidade de entrada: `message_id`, `input_modality`, texto original, texto normalizado, transcrição e contexto de mídia;
- intenção, confiança, segurança e autonomia: `intent`, `confidence`, `safety_level`, `autonomy_level` e `autonomy_reason`;
- ator e alvo: `actor_type`, `actor_id`, `target_user_id`, `professional_id`;
- pendências e contexto: confirmação, contexto pendente, proposta pendente, período solicitado e fuso do usuário;
- entidades e ações: itens extraídos, ações ordenadas, cálculos e recomendação de fonte;
- esclarecimento e auditoria: opções de esclarecimento, estratégia de processamento, avisos e motivo de ambiguidade.

A taxonomia inicial cobre registro/correção/exclusão alimentar, resumos, relatórios, gráficos, sugestões, perguntas de saúde, mídia, interação profissional-paciente, confirmações, seleção de opção, pendências, mensagens ambíguas e mensagens não relacionadas.

O runtime atual ainda usa `intentSchema.ts` para preservar compatibilidade com o executor existente. Enquanto a #398 não migrar o roteador para consumir diretamente o contrato canônico, `buildCanonicalIntentOutputFromRuntime()` adapta a intenção runtime atual para o schema canônico e permite validar fixtures, auditoria e evolução de contrato sem trocar todo o fluxo de uma vez.

## Política de autonomia

A issue #436 é representada por `server/modules/whatsapp/autonomyPolicy.ts`. A política centraliza o nível permitido por intenção e evita que thresholds soltos decidam ações sensíveis.

Níveis de autonomia:

| Nível | Uso | Resultado operacional |
|---|---|---|
| `automatico` | ações simples, validadas e de baixo impacto | pode executar quando confiança e validação atingirem o mínimo |
| `requer_confirmacao` | correções, exclusões, cálculos, sugestões e ações dependentes de contexto | pede confirmação ou esclarecimento antes de gravar |
| `requer_revisao` | dados sensíveis, rótulos extraídos, saúde/dieta e sugestões profissionais | não executa automaticamente; exige revisão ou aceite explícito |
| `bloqueado` | urgência de saúde, mensagem fora do domínio ou validação bloqueada | não executa e retorna resposta segura |

Regras principais:

- Registro alimentar simples (`add_foods_to_meal`, `adicionar_alimento`) pode executar automaticamente apenas com confiança mínima e validação válida.
- Consulta, resumo, ajuda e link de registros são ações de leitura e podem responder diretamente com confiança menor.
- Correção, troca, soma, cálculo e exclusão exigem confirmação explícita, mesmo quando a LLM estiver confiante.
- Alteração de meta ou plano exige confirmação forte e proposta pendente válida; a política não permite aplicar esse tipo de mudança por texto livre.
- Sugestões profissionais e perguntas médicas sensíveis entram em revisão/aceite explícito.
- Validação inválida ou bloqueada sempre impede execução automática.
- A auditoria registra `autonomyLevel`, `autonomyOutcome` e `autonomyReason` junto de confiança, estratégia, ferramentas e fallback.

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

- `server/modules/whatsapp/multimodalNormalizer.ts`: normalização de texto, áudio, imagem e legenda antes do roteador para #424.
- `server/modules/whatsapp/promptInjectionGuard.ts`: inspeção de conteúdo não confiável, bloqueio seguro e delimitação do texto enviado à LLM.
- `server/modules/whatsapp/canonicalIntentSchema.ts`: taxonomia canônica e schema versionado de saída estruturada para #411.
- `server/modules/whatsapp/autonomyPolicy.ts`: matriz de autonomia por intenção, confiança, segurança e validação para #436.
- `server/modules/whatsapp/toolContracts.ts`: catálogo de ferramentas, efeitos, intenções permitidas, validações exigidas e fallback operacional.
- `server/modules/whatsapp/intentSchema.ts`: contrato runtime atual das intenções suportadas pelo executor existente.
- `server/modules/whatsapp/intentContext.ts`: builder de contexto mínimo do usuário.
- `server/modules/whatsapp/intentInterpreter.ts`: chamada LLM com saída JSON schema, estratégia operacional e classificador determinístico de fallback.
- `server/modules/whatsapp/intentAuditLog.ts`: registro em memória das decisões estruturadas, incluindo estratégia, duração, modelo, ferramentas, autonomia, fallback e erro.
- `server/modules/whatsapp/llmIntentActions.ts`: executor seguro das intenções validadas, com política de autonomia e autorização de ferramenta antes de leitura, escrita ou correção.
- `server/modules/whatsapp/service.ts`: ponto de integração antes do interpretador legado e antes do fallback nutricional.

## Encaixe com as próximas issues da Fase 0

- #398 deve migrar o roteador para produzir/consumir a taxonomia canônica em runtime antes do processamento nutricional.
- #427 deve alimentar a etapa de normalização textual informal, aproveitando o contrato multimodal preservando texto original, transcrição, mídia e linguagem informal.
- #423 deve mover a idempotência de mensagem para uma proteção geral de webhook, não apenas casos pontuais.
- #440 deve evoluir a auditoria em memória para observabilidade operacional persistente, com custo, latência por etapa, timeout, autonomia, mídia e traces adequados à política de privacidade.

## Intenções runtime atuais

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
- Payload inválido, baixa confiança, ambiguidade, mídia sem contexto ou autonomia insuficiente gera fallback seguro ou pergunta contextual.
- A execução continua em serviços de domínio do backend.
- O contexto enviado ao LLM deve ser mínimo e não deve incluir texto cru sensível desnecessário.
- Mensagens de consulta, como `refeições registradas`, não devem cair no fallback de alimento incompleto.
- Criação automática de refeição só acontece quando a intenção estruturada permitir `createIfMissing` e a política de autonomia autorizar execução.
- Troca de alimento só acontece quando houver confirmação explícita e correspondência segura com item da última refeição.
- Falha de LLM, schema inválido, timeout, provider indisponível ou política de autonomia restritiva não persiste alimento, meta, plano ou ação sensível automaticamente.
- Imagem ambígua ou áudio não transcrito não geram registro alimentar automático.
- Ferramentas internas só podem ser usadas por intenção compatível, com validação e auditoria.
- Alterações futuras no contrato canônico devem preservar `schema_version` ou declarar uma nova versão/migração.

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
- validação do schema canônico para mídia, datas, autonomia, ações e mensagens ambíguas
- política de autonomia para registro simples, correção, remoção, meta e sugestão profissional
- normalização multimodal para texto, áudio transcrito, imagem com legenda, rótulo nutricional e imagem sem legenda
