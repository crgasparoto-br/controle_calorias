# Observabilidade de IA e catálogo de preços

## Objetivo

Toda execução feita por `executeResolvedCapability` emite um evento técnico normalizado por tentativa. O evento permite auditar capacidade, provider/modelo efetivos, retry, fallback, ferramentas, latência, resultado, usage e custo estimado sem persistir prompt, conteúdo, mídia, URL assinada, resposta, reasoning textual, erro bruto ou objeto nativo de SDK.

A implementação reutiliza `logInferenceEvent` com `eventType=ai.inference_call`. Não cria tabela, migration, router ou fonte concorrente. O detalhe persistido é JSON versionado, sanitizado e válido, limitado a 4096 caracteres; o corte de 500 caracteres permanece exclusivo das mensagens livres. O evento segue a retenção e audiência dos logs técnicos existentes.

## Fronteira normalizada

`server/_core/ai/providerBoundary.ts` envolve o adapter resolvido antes de entregá-lo ao consumidor. A fronteira:

- remove `raw` da resposta e de `usage` em runtime;
- normaliza input, cache, output, reasoning, áudio, imagem e total quando o SDK os fornece;
- captura usage e ferramenta executada imediatamente após o retorno do provider, antes de o domínio projetar ou descartar metadados;
- converte exceções do SDK para a taxonomia comum sem preservar mensagem, payload ou causa nativa;
- mantém uma tentativa configurada equivalente a no máximo uma chamada outbound, bloqueando a segunda chamada antes de alcançar o adapter bruto.

Os adapters legados podem continuar usando tipos internos com `raw`, mas esse conteúdo não atravessa a fronteira executável, não chega aos serviços de domínio e não entra em observabilidade.

## Contrato do evento

`server/_core/ai/observability.ts` define `AiInferenceEvent` schema 1. Cada tentativa registra:

- `executionId`, capacidade, origem e fluxo de baixa cardinalidade;
- provider/modelo configurados e efetivamente chamados;
- papel `primary`, `retry`, `fallback` ou `escalation`;
- índice, total de tentativas, latência da tentativa e latência total;
- resultado normalizado: `success`, `timeout`, `rate_limit`, `external_error`, `safety_block`, `empty_output`, `invalid_json`, `invalid_payload` ou `invalid_configuration`;
- usage numérico, ferramenta realmente executada e unidade faturável disponível;
- custo estimado da tentativa e da execução em USD ou `null`, versão e data efetiva do catálogo;
- política de fallback, incluindo same/cross-provider, elegibilidade derivada da mesma taxonomia do executor, razão e contadores;
- degradação local separada de fallback e correlação técnica sanitizada. Degradação só é marcada quando a execução externa termina em falha e o consumidor realmente segue por alternativa local.

O hook roda após validação comum e semântica. Falha do sink é best effort e nunca altera retry, fallback ou o resultado funcional.

## Fallback local da inferência de refeição

O pipeline nutricional registra decisões locais de degradação com `eventType=meal.inference_fallback`, reutilizando o mesmo `logInferenceEvent`. Esse evento não substitui nem replica `ai.inference_call`: chamadas externas, retries e fallback entre providers continuam sendo descritos exclusivamente pela telemetria canônica de provider.

Os motivos de baixa cardinalidade suportados são:

- `ai_unavailable_or_error`: a extração por IA ficou indisponível e o texto fonte foi usado localmente;
- `ai_empty_items`: a IA respondeu sem itens e o texto fonte foi usado;
- `ai_items_rejected`: todos os itens retornados pela IA foram rejeitados pelas salvaguardas do domínio e o texto fonte foi usado;
- `catalog_miss`: não houve referência compatível no catálogo local/TACO para o item processado;
- `generic_nutrition_fallback`: a estimativa nutricional genérica foi efetivamente usada após o miss de catálogo.

O detalhe contém somente `schemaVersion`, `reason`, `stage` e `count`. Não deve incluir texto fonte, transcrição, prompt, nome livre de alimento, mídia/URL, reasoning, payload ou erro bruto. A escrita é best effort: falha de observabilidade não pode bloquear nem alterar o rascunho nutricional produzido.

## Catálogo versionado

`server/_core/ai/pricingCatalog.ts` é a fonte versionada. Cada entrada registra provider, snapshot/modelo canônico, aliases, unidade, preço USD e fonte oficial. A versão atual é `2026-08-05.3`, efetiva em `2026-08-05`.

Regras:

1. alias novo ou mudança de preço exige nova versão e data efetiva;
2. atualizar apenas a partir da página oficial do provider, preservando a URL em cada tarifa;
3. preços não são obtidos por scraping em runtime;
4. a estimativa usa oito casas decimais e não representa cobrança ou fatura;
5. cache é subtraído do input comum e tarifado separadamente;
6. áudio usa duração; imagem separa tokens de entrada de texto e imagem quando a tarifa diverge e usa tokens ou unidade de saída sem dupla contagem;
7. usage de geração e edição por GPT Image é extraído na fronteira normalizada antes de `raw` ser descartado, preservando `input_tokens`, `input_tokens_details.image_tokens`, `output_tokens` e total quando fornecidos;
8. tokens de raciocínio seguem a semântica de cada provider: OpenAI já os inclui em `outputTokens`, enquanto Gemini os informa separadamente e o catálogo os soma à saída faturável;
9. ferramenta só é somada quando `executed=true`; OpenAI exige a quantidade de chamadas concluídas, enquanto Gemini 2.5 deriva uma unidade `grounded_prompt` da execução confirmada, sem inferir custo pela quantidade de queries ou chunks;
10. preço, modelo ou usage necessário ausente resulta em `null`, inclusive quando uma ferramenta foi executada; cache multimodal sem atribuição por modalidade também retorna `null`, em vez de presumir a tarifa mais barata.

O custo total soma primário, retries e fallback efetivamente executados. Se qualquer tentativa não tiver dados suficientes, o total permanece `null`.

## Privacidade e operação

Correlação aceita no máximo oito escalares limitados. Chaves relacionadas a prompt, conteúdo, texto, mensagem, transcrição, áudio, imagem, mídia, payload, erro, segredo, token, header, cookie ou URL são descartadas. Objetos e arrays arbitrários também são ignorados. Datas ISO, snapshots de modelo e versões de catálogo são identificadores técnicos permitidos; valores livres continuam sujeitos à redação de e-mail, telefone e bearer token.

O contrato central define `origin` e `flow` por capacidade, e os consumidores podem sobrescrever esse contexto quando conhecem uma origem mais específica. Consumidores que detectam configuração indisponível antes da execução emitem evento de tentativa zero. Embeddings e anotação podem marcar degradação local apenas no encerramento externo malsucedido; retry ou fallback que recupera a execução mantém `degradation=none`.

Consulta operacional: filtrar `eventType=ai.inference_call` e agrupar por `capability`, `outcome`, provider/modelo efetivo, `callRole`, `fallback.kind` e versão do catálogo. Para degradações locais da refeição, filtrar `eventType=meal.inference_fallback` e agrupar por `reason` e `stage`. Antes de usar os dados em relatórios financeiros, validar volume, cardinalidade, ausência de conteúdo sensível e percentual de custos `null`.
