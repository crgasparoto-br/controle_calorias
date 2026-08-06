# Plano de migracao: IA do sistema para OpenAI e fundação multi-provider

Status: concluído e redirecionado — a arquitetura multi-provider por capacidade foi consolidada nas issues #921–#927. O rollout atual é governado por `docs/runbooks/multi-provider-rollout.md` e `docs/benchmarks/multi-provider/README.md`.

Este documento registra a estratégia para migrar a camada de IA do sistema, primeiro consolidando um provider OpenAI isolado no backend (fases 1-7, concluídas) e, a partir da fase 8, evoluindo a seleção de IA de global (`AI_VISION_PROVIDER`) para configuração independente por capacidade de produto (épica #917). Não adicione novas etapas operacionais a este plano histórico. Alterações futuras devem atualizar as fontes canônicas de arquitetura, benchmark e runbook.

## Leitura obrigatória

1. `AGENTS.md`
2. `ARCHITECTURE.md`
3. `docs/product-specs/meal-registration.md`
4. `docs/design-docs/nutrition-engine.md`
5. `docs/product-specs/whatsapp-flow.md`
6. `docs/design-docs/whatsapp-ingestion.md`
7. `docs/PRIVACY_LGPD.md`
8. `docs/SECURITY.md`
9. `docs/RELIABILITY.md`
10. `docs/generated/db-schema.md`
11. `docs/generated/trpc-routes.md`

## Escopo

Migrar transcrição, análise de imagem, inferência nutricional e geração visual auxiliar para um provider OpenAI isolado no backend.

Fora de escopo: autenticação externa legada, troca de banco, troca de frontend, criação de microserviços e alteração de schema sem necessidade comprovada.

## Invariantes

- Preservar o monólito React, Express, tRPC e Drizzle.
- Manter regra de negócio no backend.
- Manter o router fino.
- Validar respostas de IA com Zod.
- Preservar rascunho revisável antes da confirmação.
- Não registrar conteúdo sensível em logs.
- Manter credenciais apenas no ambiente de backend.
- Não expor credenciais no navegador.
- Garantir erro controlado quando o provider externo falhar.

## Arquitetura alvo

Criar e manter uma camada de provider no backend:

```text
server/_core/openaiClient.ts
server/_core/aiProvider.ts
server/_core/voiceTranscription.ts
server/_core/imageGeneration.ts
```

Serviços de domínio devem depender da interface interna do provider, não do SDK diretamente.

## Andamento atual

- Fase 1 concluída: inventário e testes de caracterização adicionados.
- Fase 2 concluída: SDK oficial, cliente backend e interface interna de provider foram isolados no backend.
- Fase 3 concluída: `server/_core/voiceTranscription.ts` usa o provider interno da OpenAI com validação de formato e tamanhn.
- Fase 4 concluída: texto e imagem no núcleo nutricional usam a Responses API com JSON estruturado validado por Zod e totais recalculados no backend.
- Fase 5 concluída: a geração visual auxiliar foi migrada para helper OpenAI opcional e não bloqueante.
- Fase 6 concluída: transcrição e inferência nutricional ficaram livres do provider legado; o único uso legado remanescente ficou documentado no assistente educativo.
- Fase 7 está preparada: checklist operacional e smoke tests foram organizados para Render, Vercel e validação de canais.
- Fase 8 concluída para a fundação (#921): registro, matriz vinculada aos métodos dos adapters, resolvedor fail-closed, executor, cancelamento propagado e Gemini com `responseJsonSchema`.
- Fase 9 implementa #922: `MEAL_TEXT`, `MEAL_VISION` e `WHATSAPP_INTENT` usam a fundação comum; NOVA permanece embutida e `FOOD_CLASSIFICATION` segue sem consumidor externo.
- Fase 10 implementa #923: `QUESTION`, `NUTRITION_SEARCH` e `EMBEDDING` usam a fundação comum; Gemini passa a anunciar `web_search` via Google Search Grounding.

## Fases

### Fase 1 - Inventário e testes

Mapear usos atuais de IA interna, transcrição, geração de imagem, análise de foto e processamento de rascunho. Adicionar testes de caracterização sem chamadas externas reais.

### Fase 2 - Provider OpenAI isolado

Adicionar SDK oficial, cliente backend e interface interna de provider, configuração de ambiente e documentação. O build não deve exigir configuração real quando testes usam mocks.

### Fase 3 - Transcrição

Migrar `voiceTranscription` para o provider. Validar formato e tamanho do arquivo antes do envio. Manter retorno compatível.

### Fase 4 - Inferência nutricional

Migrar texto e imagem para a Responses API com JSON estruturado validado por Zod. Recalcular totais no backend a partir dos itens validados.

### Fase 5 - Geração visual auxiliar

Status: concluída.

- `server/_core/imageGeneration.ts` passou a usar o provider OpenAI.
- O helper visual é opcional. Se a OpenAI não estiver configurada ou falhar, o fluxo continua sem bloquear refeição.
- `server/modules/photoAnalysis/service.ts` agora registra aviso sanitizado quando o visual auxiliar falha e segue com a análise principal.

### Fase 6 - Remoção do legado

Status: concluída no fluxo principal.

- Transcrição e inferência nutricional não dependem mais da camada legada.
- O helper visual auxiliar também saiu do Forge.
- O legado remanescente está restrito ao assistente educativo em `server/modules/assistant/service.ts` via `server/_core/llm.ts`, fora do fluxo principal de refeição.

### Fase 7 - Rollout

Status: preparado para execução operacional.

Checklist histórico em `docs/runbooks/openai-rollout-checklist.md`; procedimento atual em `docs/runbooks/multi-provider-rollout.md`.

Objetivos do rollout:

- configurar `OPENAI_*` apenas no backend do Render;
- manter frontend/Vercel sem `OPENAI_API_KEY`;
- validar web e WhatsApp com smoke tests;
- monitorar somente erros sanitizados;
- confirmar que dashboard e relatórios permanecem consistentes.

### Fase 8 - Fundação multi-provider por capacidade (#921, épica #917)

Status: implementação corretiva preparada; aguarda auditoria independente do SHA final. Migração de consumidores é escopo das subissues seguintes de #917.

- `capabilities.ts` registra todas as capabilidades. `QUESTION` exige `text` e `web_search` conforme o consumidor real; `NUTRITION_SEARCH` exige `text`, `structured_output` e `web_search`; `EMBEDDING` exige somente `embeddings` e, naquele estágio, ainda possuía consumidor legado direto (migrado na fase 10/#923); `FOOD_CLASSIFICATION` permanece reservada.
- `supportMatrix.ts` representa métodos e tradções existentes nos adapters. OpenAI possui métodos explícitos para texto/multimodal, embeddings, transcrição e imagem. Gemini declara texto, visão e Structured Output nesta fase; pesquisa web e embeddings não são anunciados antes de tradução/método dedicado e teste.
- `configResolver.ts` resolve adapter antes do modelo, aplica variável nova > variável legada compatível > default, preserva `OPENAI_MODEL`/`GEMINI_MODEL`, rejeita modelo vazio e valores inválidos, e seleciona modelo próprio para fallback.
- `OPENAI_BASE_URL` não vazio é tratado automaticamente como `openai-compatible`. Nenhuma operação é assumida até constar em `AI_OPENAI_COMPATIBLE_OPERATIONS`.
- `policyExecutor.ts` bloqueia estados `invalid`/`disabled`, limites inválidos e fallback habilitado sem callback antes de qualquer outbound. Depois disso, centraliza classificação de erros HTTP/SDK/rede, saída vazia, JSON inválido e payload inválido. Erro desconhecido é não recuperável e �^ão aciona fallback.
- Cada tentativa recebe `AbortSignal`; `AiProvider`, `OpenAiProvider` e `GeminiProvider` propagam o sinal até a chamada do SDK. Retry ou fallback somente inicia após a tentativa anterior encerrar localmente; cancelamento não reconhecido termina fail-closed sem nova chamada.
- Requests comuns são fail-closed. O Gemini rejeita `tools` antes da rede enquanto a tradução para Google Search não existir; nenhum campo operacional é descartado silenciosamente.
- O fallback permanece desabilitado por padrão, isolado por capacidade, com no máximo uma chamada após as tentativas do primário e sem cadeia.
- `geminiProvider.ts` usa `@google/genai`, `models.generateContent` e `responseJsonSchema`, preservando nulabilidade, `additionalProperties: false` i limites presentes nos schemas reais. O consumidor legado de refeição é exercitado pelo entrypoint `mealAiExtraction` nas variantes textual e visual, usando o data URL inline produzido pelo WhatsApp.
- `OpenAiProvider.createEmbeddings` fecha o suporte declarado pela matriz e normaliza vetores/usage. O consumidor legado de embeddings permanece sem migração para o novo resolvedor.
- `AiProviderTextResponse.usage` e `AiProviderEmbeddingResponse.usage` normalizam metadados de tokens quando disponíveis.
- `mealAiExtraction` e `intentInterpreter` foram migrados em #922. `aiQuestionAssistant`, `catalogSemanticSearch`, transcrição, imagem e `assistant/service.ts` permanecem nas fases/subissues próprias. `AI_PROVIDER` u o assistente Forge legado não foram alterados.
- Variáveis legadas continuam funcionando. Consumidores migrados recebem configuração já pareada por provider/modelo; `OPENAI_WHATSAPP_INTENT_MODEL` só é aplicável a adapters OpenAI/OpenAI-compatible. Diagnósticos `[deprecated]` permanecem sanitizados.
- Degradação funcional local permanece responsabilidade do consumidor e é distinta de fallback entre provideres.

Próximas subissues de #917 devem migrar cada consumidor individualmente para `resolveCapabilityConfig` + `executeResolvedCapability`, uma capacidade por vez. A operação fornecida ao executor deve encaminhar `context.signal` para as opções do método `AiProvider`; `executeWithPolicy` permanece uma primitiva interna de baixo nível e não deve ser chamada diretamente pelos consumidores. Cada migração deve manter validação da saída e teste discriminante pelo entrypoint real.

### Fase 9 - Refeição e intenção por capacidade (#922)

Status: implementada na PR da issue; sujeita aos gates e auditoria controller-adversarial do SHA congelado.

- `MEAL_TEXT`, `MEAL_VISION` e `WHATSAPP_INTENT` usam `resolveCapabilityConfig` e `executeResolvedCapability`.
- Zod continua a fronteira final depois de primário ou fallback.
- A classificação NOVA permanece no mesmo Structured Output; o backfill histórico não executa nova inferência.
- A fronteira de domínio remove `raw` dos SDKs.
- Precedência conversacional e contratos persistentes do WhatsApp não foram alterados.

### Fase 10 - Pergunta, pesquisa nutricional e embedding por capacidade (#923)

Status: implementada na PR da issue; sujeita aos gates e auditoria controller-adversarial do SHA congelado.

- `QUESTION` (`aiQuestionAssistant`), `NUTRITION_SEARCH` (`findPackagedSnackByWebSearch` em `catalogSemanticSearch.ts`) e `EMBEDDING` (busca semântica de catálogo) usam `resolveCapabilityConfig` e `executeResolvedCapability`.
- O contrato interno de ferramenta de pesquisa web (`{ type: "web_search" }`) é traduzido pelo Gemini via Google Search Grounding e pelo OpenAI via `web_search`. A matriz valida também a combinação por modelo: Gemini 2.5 permanece elegível para `QUESTION`, mas é recusado em `NUTRITION_SEARCH` porque Structured Output + ferramenta integrada na mesma chamada exige Gemini 3 explicitamente configurado; a #927 preservou o baseline por falta de evidência live integrada suficiente.
- `EMBEDDING` preserva `text-embedding-3-small` da OpenAI como default e permanece inelegível no Gemini (sem método `embeddings` no adapter): cross-provider fallback para `EMBEDDING` fica indisponível mesmo com opt-in explícito, porque o provider de destino nunca passa na validação de operações suportadas.
- Fallback continua desabilitado por padrão e isolado por capacidade para as três capacidades migradas; cross-provider fallback para `QUESTION`/`NUTRITION_SEARCH` segue exigindo `AI_<CAPABILITY>_CROSS_PROVIDER_FALLBACK_ENABLED=true` e permanece fail-closed em produção (AI-CROSS-PROVIDER-PROD-001).
- Fonte insuficiente, grounding sem vínculo com a evidência ou incompatibilidade/ambiguidade de marca, produto, sabor, peso ou embalagem em `findPackagedSnackByWebSearch` degrada para o fallback canônico local (sem inventar dado e sem disparar fallback externo indevido); JSON/payload estruturalmente inválido é rejeitado dentro da tentativa para permitir o retry/fallback operacional configurado; ausência de `EMBEDDING` degrada para busca textual/canônica.
- Zod e a validação de payload de embeddings continuam a fronteira final depois de primário ou fallback.

## Gates

Cada fase deve rodar:

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm agent:check
```

Quando houver banco disponível, rodar também:

```bash
pnpm db:check-integrity
```

## Critérios finais

- Texto, imagem e áudio criam rascunhos revisáveis.
- Confirmação manual persiste dados consistentes.
- Web e WhatsApp usam o mesmo núcleo.
- Falhas externas são tratadas sem corromper dados.
- Credenciais ficam apenas no backend.
- Documentação e testes estão atualizados.
- `pnpm agent:check` passa.

## Instrução para Codex

Leia AGENTS.md, ARCHITECTURE.md e este plano. Implemente somente a próxima fase pendente. Não pule fases. Não misture autenticação com esta migração. Preserve o monólito atual. Valide toda saída de IA com Zod. Não registre conteúdo sensível em logs. Atualize documentação e testes. Rode `pnpm agent:check`.
