# Inventário de remoção da configuração legada de IA — #960

## Identidade

- Issue: #960
- Base revisada: `develop@203639557c85f6d1dffec42dd25248febbef79cc`
- Branch de implementação: `codex/issue-960-remove-ai-legacy-config`
- Contrato canônico após esta mudança: `AI_<CAPABILITY>_*` + defaults versionados do resolver por capacidade.
- Configuração operacional: a evidência sanitizada vinculada à #962 confirmou que o roteamento por capacidade já estava configurado e operacional em produção antes desta remoção. Esta mudança não altera segredos nem valores de produção.

## Inventário e classificação

| Item | Classificação | Decisão / evidência |
| --- | --- | --- |
| `AI_VISION_PROVIDER` | remove | Não participa mais do resolver. `MEAL_TEXT`, `MEAL_VISION` e `WHATSAPP_INTENT` usam exclusivamente `AI_<CAPABILITY>_PROVIDER`; `imageGeneration.ts` foi migrado para `IMAGE_ANNOTATION`. |
| `OPENAI_MODEL` | remove | Não participa mais de resolução de modelo. Defaults/capability models permanecem no resolver canônico. |
| `GEMINI_MODEL` | remove | Não participa mais de resolução de modelo. Defaults/capability models permanecem no resolver canônico. |
| `OPENAI_TRANSCRIPTION_MODEL` | remove | `TRANSCRIPTION` usa `AI_TRANSCRIPTION_MODEL` ou o default versionado `whisper-1`. |
| `OPENAI_IMAGE_MODEL` | remove | `IMAGE_ANNOTATION` usa `AI_IMAGE_ANNOTATION_MODEL` ou o default versionado `gpt-image-1`. |
| `OPENAI_WHATSAPP_INTENT_MODEL` | remove | `WHATSAPP_INTENT` usa `AI_WHATSAPP_INTENT_MODEL` ou seu default versionado. |
| `OPENAI_TEXT_MODEL` | remove | Não participa mais da seleção de `WHATSAPP_INTENT`. |
| `OPENAI_WHATSAPP_INTENT_TIMEOUT_MS` | remove | A política usa `AI_WHATSAPP_INTENT_TIMEOUT_MS`; sem override, preserva baseline de 8 s. |
| `OPENAI_WHATSAPP_INTENT_RETRIES` | remove | A política usa `AI_WHATSAPP_INTENT_MAX_ATTEMPTS`; sem override, preserva baseline de 2 tentativas. |
| `ENV.aiVisionProvider` | remove | Getter removido; não existe seleção global de provider. |
| `ENV.visionModel` e getters de modelos globais | remove | Getters removidos; modelo é pareado com provider pelo resolver por capacidade. |
| `createAiProvider()`, `getAiProvider()`, `setAiProviderFactory()`, `resetAiProviderFactory()` | remove | O último consumidor produtivo (`imageGeneration.ts`) foi migrado para `resolveCapabilityConfig("IMAGE_ANNOTATION")` + `executeResolvedCapability`. |
| `OPENAI_API_KEY` | retain-nonlegacy | Credencial do adapter OpenAI/OpenAI-compatible; não é seletor legado. |
| `GEMINI_API_KEY` | retain-nonlegacy | Credencial do adapter Gemini; não é seletor legado. |
| `OPENAI_BASE_URL` | retain-nonlegacy | Endpoint do adapter OpenAI-compatible; não é seletor legado. |
| `usedLegacyVariables` | retain-nonlegacy | Campo de resultado tipado mantido temporariamente como forma estável para fixtures; desde #960 é literal `false` e não representa branch de compatibilidade. |
| `.audit/entregar-issue/**` | historical-only | Snapshots/evidências de auditorias anteriores preservam o estado histórico e não são fonte operacional atual. |
| documentos históricos/analíticos que mostram configuração anterior | historical-only | Podem preservar exemplos antigos quando claramente históricos; não devem ser usados como instrução operacional atual. |

## Migração de consumidores

### `imageGeneration.ts`

Antes da #960, o helper chamava a factory global e selecionava explicitamente `ENV.openaiImageModel`. Isso mantinha um caminho real dependente da configuração legada.

Após a #960:

1. resolve `IMAGE_ANNOTATION` pelo resolver canônico;
2. executa provider/model pareados por `executeResolvedCapability`;
3. propaga `AbortSignal`, retry e fallback conforme a política existente da capacidade;
4. mantém o fallback PNG local quando a capacidade está indisponível ou a execução externa falha;
5. não introduz selector helper específico do consumidor.

A equivalência semântica é explícita: `IMAGE_ANNOTATION` já exige `image_generation` e `image_edit`, as duas operações exercidas por `imageGeneration.ts` conforme exista ou não imagem original.

## Baselines preservados

- `MEAL_TEXT`, `MEAL_VISION`, `QUESTION`, `NUTRITION_SEARCH`: defaults versionados existentes, sem inferência por alias global.
- `WHATSAPP_INTENT`: 8.000 ms e 2 tentativas quando os overrides canônicos estão ausentes.
- `TRANSCRIPTION`: `whisper-1` quando `AI_TRANSCRIPTION_MODEL` está ausente.
- `IMAGE_ANNOTATION`: `gpt-image-1` quando `AI_IMAGE_ANNOTATION_MODEL` está ausente.
- fallback e cross-provider: sem mudança de regra; continuam isolados por capacidade.

## Varredura e classificação de ocorrências

Termos antigos pesquisados no repositório: `AI_VISION_PROVIDER`, `OPENAI_MODEL`, `GEMINI_MODEL`, `OPENAI_TRANSCRIPTION_MODEL`, `OPENAI_IMAGE_MODEL`, `OPENAI_WHATSAPP_INTENT_MODEL`, `OPENAI_TEXT_MODEL`, `OPENAI_WHATSAPP_INTENT_TIMEOUT_MS`, `OPENAI_WHATSAPP_INTENT_RETRIES`, `openaiImageModel`, `getAiProvider`, `createAiProvider`, `setAiProviderFactory`, `resetAiProviderFactory` e `[deprecated]` associado ao resolver.

Categorias aplicadas às ocorrências:

- **contrato atual**: resolver/executor por capacidade, credenciais e endpoint válidos;
- **legado aposentado**: removido de runtime, configuração ativa e testes dedicados de compatibilidade;
- **histórica**: `.audit/entregar-issue/**` e análises explicitamente retrospectivas;
- **teste discriminante**: aliases podem aparecer apenas como entradas deliberadamente ignoradas, com expectativa explícita de não influenciar a resolução;
- **contradição**: documentação viva que ainda indique precedência/uso operacional do alias deve ser atualizada na mesma entrega.

A verificação final deve repetir a busca no SHA candidato e manter `unresolved_contradictions=[]` antes do handoff.

## Segurança e operação

Nenhum segredo, valor real de modelo em produção ou conteúdo sensível foi registrado neste inventário. A mudança não remove `OPENAI_API_KEY`, `GEMINI_API_KEY` ou `OPENAI_BASE_URL`, não habilita cross-provider fallback e não altera configuração do Render.
