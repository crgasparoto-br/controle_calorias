# Arquitetura do Controle de Calorias

O projeto permanece como um monólito orientado a produto. Frontend, backend, autenticação, integrações, persistência e contratos tipados ficam no mesmo repositório para acelerar evolução, reduzir coordenação operacional e simplificar validação por agentes.

A plataforma possui duas experiências de primeira classe — Área do Paciente e Área Profissional — sobre os mesmos serviços de domínio. A separação é de navegação, autorização, casos de uso e apresentação; não representa divisão em aplicações, identidades ou microserviços independentes.

## Stack principal

| Camada                 | Tecnologia                               | Responsabilidade                                                          |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| Frontend               | React + Vite + Tailwind                  | Fluxos web, dashboard, formulários e visualizações                        |
| Backend                | Express + tRPC                           | Contratos tipados, autenticação, orquestração e casos de uso              |
| Banco                  | MySQL/TiDB + Drizzle                     | Persistência relacional, migrações e integridade referencial              |
| IA principal           | Provider OpenAI ou Gemini (selecionável) | Transcrição, inferência nutricional multimodal e visual auxiliar opcional |
| IA legada remanescente | Forge restrito ao assistente educativo   | Sugestões alimentares fora do fluxo principal de refeição                 |
| Canal externo          | WhatsApp Business Cloud API              | Entrada e saída conversacional oficial                                    |
| Testes                 | Vitest                                   | Cobertura de regras, routers e UI                                         |

## Fronteiras de camadas

```text
client/src/pages               -> composição de tela e chamadas tRPC
client/src/components          -> componentes reutilizáveis de UI
server/nutritionRouter         -> composição de routers, autenticação, schemas e serviços
server/modules/*               -> regra de negócio por domínio
server/modules/timeZone/service.ts -> resolução central do timezone efetivo por dono dos dados
server/repositories/*          -> acesso a dados reutilizável por domínio
server/_core/openaiClient.ts   -> cliente oficial da OpenAI, isolado do domínio
server/_core/geminiProvider.ts -> implementação do provider Gemini, sobre o SDK @google/genai
server/_core/aiProvider.ts     -> interface interna e factory global legada que seleciona o provider ativo (AI_VISION_PROVIDER)
server/_core/ai/               -> fundação multi-provider (#921): registro, matriz, resolvedor e execução vinculada por capacidade
server/_core/voiceTranscription.ts -> fronteira da capacidade TRANSCRIPTION para web e WhatsApp
server/_core/imageAnnotation.ts -> fronteira externa da capacidade IMAGE_ANNOTATION, isolada de MEAL_VISION
server/modules/whatsapp/localMealPhotoOverlay.ts -> compositor local determinístico da anotação sobre uma cópia da foto
server/modules/whatsapp/annotatedImage.ts -> consumidor que seleciona local, external ou off e aplica degradação explícita
server/_core/imageGeneration.ts -> helper legado de resumo visual separado; não representa anotação da foto
server/db.ts                   -> persistência legada e funções agregadoras ainda centralizadas
drizzle/schema.ts              -> fonte de verdade do modelo relacional
shared/*                       -> tipos, cálculos e mensagens sem dependência de ambiente
```

## Fronteiras das áreas de experiência

A decisão de produto canônica está em `docs/product-specs/product-experience-model.md`.

### Área do Paciente

- Corresponde à experiência pessoal já desenvolvida.
- Deve funcionar com ou sem vínculo profissional.
- É responsável por registro, revisão, histórico, metas pessoais, relatórios, peso, exercícios, integrações e configurações do próprio usuário.
- Não deve depender de perfil profissional, assinatura profissional ou existência de vínculo para executar fluxos pessoais permitidos.
- Não deve conter regras exclusivas de gestão de carteira ou prontuário profissional.

### Área Profissional

- É um contexto próprio de navegação e trabalho para usuários com perfil profissional ativo.
- Deve consumir os mesmos serviços canônicos de refeições, metas, relatórios, peso, exercícios, timezone e WhatsApp, sem duplicar cálculos.
- Deve validar no backend o perfil profissional, o vínculo vigente, o consentimento e o paciente alvo.
- Não deve importar páginas pessoais para simular a sessão do paciente nem usar impersonação.
- Toda mutação profissional deve carregar ator profissional e paciente afetado de forma separada.
- A transição foi concluída: dashboard, carteira, workspace contextual do paciente, mensagens, relatórios e configurações usam rotas próprias. As antigas telas concentradas permanecem apenas como redirecionamentos seguros e não devem ser reintroduzidas.

### Serviços compartilhados

Os domínios compartilhados continuam independentes das telas que os consomem:

- serviços de refeições não devem conhecer dashboard profissional;
- cálculos de metas e relatórios devem produzir contratos canônicos reutilizáveis;
- resolução de timezone usa sempre o dono dos dados;
- transporte e serialização do WhatsApp permanecem centrais;
- autorização profissional envolve ator e paciente, mas não deve duplicar autenticação;
- billing concede entitlements e limites, mas não define a identidade da conta nem implementa a experiência profissional.

### Auditoria e autoria

Operações profissionais que alterem ou orientem o acompanhamento devem preservar, conforme o caso:

- profissional responsável;
- paciente afetado;
- data e hora;
- estado anterior e novo estado;
- vigência;
- justificativa;
- origem da ação: manual, automática ou sugerida pela IA.

A IA não deve executar mutações profissionais automaticamente. Sugestões precisam passar por fluxo explícito e autorizado.

### Separação de entregas

- Correções da Área do Paciente não devem absorver novas telas profissionais.
- Infraestrutura compartilhada deve ser implementada uma vez e consumida pelas duas áreas.
- A evolução da Área Profissional deve possuir épica e subissues próprias.
- Billing e experiência profissional permanecem programas separados, ligados por contratos de entitlement e dependências explícitas.
- Refatoração de domínio não deve ser misturada com mudança visual ou ampliação de produto sem necessidade técnica comprovada.

### Fronteiras do webhook do WhatsApp

`server/whatsappWebhook.ts` é o orquestrador HTTP do canal (deduplicação, roteamento do fluxo por mensagem, chamada aos módulos de domínio) e deve continuar magro. Responsabilidades específicas ficam em módulos dedicados sob `server/modules/whatsapp/`:

- `webhookTextCommands.ts` -> detecção e execução de comandos por texto (água, peso, reclassificação de refeição e confirmação pendente).
- `webhookMediaPipeline.ts` -> download/persistência de mídia recebida (imagem/áudio) e preparo de texto/transcrição para inferência.
- `annotatedImage.ts` -> seleção dos modos de anotação `local`, `external` e `off`; exige a foto original e nunca substitui silenciosamente a anotação por cartão genérico.
- `localMealPhotoOverlay.ts` -> criação do PNG derivado por composição determinística, sem sobrescrever os bytes originais e sem provider externo.
- `replyFormatting.ts` -> formatação compartilhada de número e horário nas respostas do WhatsApp.
- `mealConsolidationService.ts` / `mealConsolidation.ts` -> consolidação de refeições do mesmo dia/tipo (ver #663).

A assinatura pública exportada por `server/whatsappWebhook.ts` (`handleWhatsAppWebhook`, `verifyWhatsAppWebhook`, `__resetWhatsAppWebhookDeduplicationForTests`) deve ser preservada ao mover código para esses módulos.

A deduplicação por `message.id` ocorre no orquestrador antes de `beginInboundMessage` e antes de `prepareMessageInput`. Portanto, callback duplicado não baixa mídia, não transcreve e não cria nova mutação. Essa ordem é um contrato comportamental coberto por teste no limite HTTP do webhook, não por inspeção textual de código.

Fluxos de comunicação profissional devem reutilizar o contrato central de mensagens e o transporte oficial. Não criar cliente, formatter ou fila paralela somente para a Área Profissional.

## Fundação multi-provider de IA (#921)

`server/_core/ai/` é a fundação compartilhada para evoluir a seleção de IA de global (`AI_VISION_PROVIDER`) para configuração independente por capacidade. #921 criou a fundação; #922 migrou `MEAL_TEXT`, `MEAL_VISION` e `WHATSAPP_INTENT`; #923 migrou `QUESTION`, `NUTRITION_SEARCH` e `EMBEDDING`; #924 migrou `TRANSCRIPTION`; #925 migrou o caminho externo de `IMAGE_ANNOTATION` para `resolveCapabilityConfig` + `executeResolvedCapability`, mantendo o modo local como default seguro.

- `capabilities.ts` registra `MEAL_TEXT`, `MEAL_VISION`, `WHATSAPP_INTENT`, `QUESTION`, `NUTRITION_SEARCH`, `EMBEDDING`, `TRANSCRIPTION`, `IMAGE_ANNOTATION` e `FOOD_CLASSIFICATION`. `QUESTION` exige texto e pesquisa web e envia somente o contrato interno estável `{ type: "web_search" }`; `NUTRITION_SEARCH` exige texto, Structured Output e pesquisa web; `EMBEDDING` é uma capacidade separada; `TRANSCRIPTION` exige a operação de áudio; `IMAGE_ANNOTATION` externa exige geração e edição de imagem. `FOOD_CLASSIFICATION` permanece reservada.
- `supportMatrix.ts` declara somente operações implementadas pelo adapter do projeto e valida combinações documentadas por modelo. No OpenAI, texto/visão/Structured Output/pesquisa web passam por `createTextResponse`, embeddings por `createEmbeddings`, transcrição por `createAudioTranscription` e geração/edição por `createImageGeneration`. Gemini declara texto, visão, Structured Output e pesquisa web, mas não anuncia embeddings nem transcrição.
- `openai-compatible` é fail-closed. Qualquer `OPENAI_BASE_URL` não vazio faz o resolvedor aplicar automaticamente essa identidade, e somente operações explicitamente listadas em `AI_OPENAI_COMPATIBLE_OPERATIONS` ficam disponíveis.
- `policyDefaults.ts` concentra timeout, tentativas e janela de confirmação do cancelamento.
- `configResolver.ts` seleciona primeiro o adapter e depois o modelo; aplica `AI_<CAPABILITY>_*` novo > variável legada compatível > default equivalente ao baseline; rejeita modelo vazio, operação incompatível e timeout/tentativas inválidos. O fallback possui modelo próprio do provider de destino e nunca reutiliza silenciosamente o modelo do primário em provider diferente.
- `providerResolver.ts` transforma somente um `AiProviderId` já resolvido no adapter correspondente; não consulta nome de modelo nem a seleção global legada.
- `capabilityExecutor.ts` recebe o `ResolvedCapabilityConfig` completo e vincula provider, modelo e adapter em cada tentativa. Primário e retries permanecem no alvo primário resolvido; o fallback usa somente o provider/modelo resolvido para fallback.
- `domainTextResponse.ts`, `domainAudioTranscription.ts` e a fronteira externa de `imageAnnotation.ts` removem `raw` do SDK antes de entregar resposta a consumidores.
- `policyExecutor.ts` aplica timeout, retry, fallback e classificação de erro depois que a identidade da capacidade foi vinculada. Estados `disabled` e `invalid`, limites não inteiros/positivos e fallback habilitado sem alvo executável são rejeitados antes de outbound.
- O executor classifica erros concretos de SDK/HTTP/rede e valida saída vazia, JSON inválido e payload inválido. Cada tentativa recebe `AbortSignal`; retry/fallback só começa após a chamada anterior encerrar. `MAX_ATTEMPTS` conta todas as chamadas do primário e existe no máximo uma chamada posterior de fallback.
- `AiOperationalError` representa timeout, rede, rate limit recuperável, saída vazia, JSON inválido e payload inválido. `AiNonRetryableError` cobre autenticação, modelo ausente, incompatibilidade, bloqueio de segurança, configuração inválida, cancelamento não reconhecido e erro desconhecido.
- Requests comuns são fail-closed: todo campo recebido pelo adapter deve ser traduzido integralmente ou a requisição é rejeitada antes da rede.
- Structured Output no OpenAI e Gemini passa por preflight local específico ao provider.
- Escalonamento de qualidade é política separada e permanece desativada. Degradação funcional local não é fallback externo.

### Contrato de `TRANSCRIPTION` (#924)

```text
web / WhatsApp
  -> voiceTranscription.transcribeAudio
     -> validação de URL/base64, MIME, vazio e 16 MiB
     -> resolveCapabilityConfig("TRANSCRIPTION")
     -> executeResolvedCapability
        -> transcriptionProvider / AiProvider.createAudioTranscription
        -> domainAudioTranscription remove raw e normaliza texto
  -> consumidor usa text; metadados são opcionais
```

- O baseline de produção continua `openai` + `whisper-1`. A #927 registrou `gpt-4o-mini-transcribe` como candidato, mas a aplicação operacional da mudança depende da janela autorizada da #962.
- `whisper-1` usa `verbose_json`; modelos GPT-4o de transcrição usam `json`.
- O contrato raiz e o contrato de domínio exigem `task` e `text`; `language`, `duration`, `segments` e `usage` são opcionais. Adapters não fabricam `segments: []`, `duration: 0` ou idioma vazio quando o provider omite esses campos.
- Data URL sem `;base64`, base64 não canônico, MIME não permitido, payload vazio, arquivo acima de 16 MiB ou configuração inválida falham antes da criação do adapter.
- Retry e fallback pertencem exclusivamente ao executor comum. Fallback permanece desabilitado por padrão; a #927 não aprovou cross-provider, que continua bloqueado em produção até nova evidência, revisão LGPD e autorização específicas por capacidade.
- O benchmark usa o mesmo entrypoint produtivo, seis fixtures sintéticos PT-BR, uma tentativa, sem fallback e execução sequencial. O resultado sanitizado não contém áudio, prompt nem transcrição.
- Detalhes do contrato e do benchmark ficam em `docs/design-docs/transcription-capability.md` e `docs/benchmarks/transcription/`.

### Contrato de `IMAGE_ANNOTATION` (#925)

```text
WhatsApp com preferência ativa
  -> annotatedImage.generateAnnotatedMealImage
     -> resolveImageAnnotationRuntimeConfig
        -> local: valida foto, auto-orienta cópia e compõe SVG via Sharp
        -> external: valida foto e resolveCapabilityConfig("IMAGE_ANNOTATION")
             -> executeResolvedCapability
                -> AiProvider.createImageGeneration com originalImages
        -> off: não produz derivado
  -> resposta textual e refeição continuam independentes do artefato auxiliar
```

- `local` é o default e não cria adapter externo, mesmo que `AI_VISION_PROVIDER` ou `AI_MEAL_VISION_PROVIDER` apontem para outro provider.
- `external` exige configuração explícita da capacidade e representa novo envio da foto ao provider de imagem.
- Uma tentativa do executor corresponde a exatamente uma operação de imagem; existe no máximo uma chamada posterior de fallback.
- Fallback externo permanece desabilitado por padrão; provider diferente exige opt-in específico e continua bloqueado em produção. A #927 preservou `IMAGE_ANNOTATION` em modo local e não recomendou promoção externa.
- A transição `external -> local` só ocorre com `AI_IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODE=local`; é degradação funcional do consumidor, não fallback de provider.
- O original e o derivado têm buffers e chaves de storage distintos. Falha de renderização, provider, upload ou envio não remove o original nem bloqueia o registro textual.
- Um cartão-resumo sem a foto original é outro tipo de artefato e não pode ser apresentado como anotação.
- O resultado normalizado distingue `mode`, `artifactKind`, `degradation`, `providerSource`, `attempts` e `skippedReason` sem expor foto, prompt, payload ou resposta bruta.
- Detalhes de segurança, privacidade, rollout e rollback ficam em `docs/design-docs/image-annotation-capability.md`.

**Migração do SDK Gemini**: `server/_core/geminiProvider.ts` usa `@google/genai` e a superfície `models.generateContent`. Structured Output usa `responseJsonSchema`, preservando `additionalProperties: false`, tipos anuláveis, limites numéricos e demais recursos presentes nos schemas reais do projeto. O fluxo legado de refeição é testado pelo entrypoint `mealAiExtraction` em variantes textual e visual, usando o data URL inline realmente produzido pelo pipeline do WhatsApp. Metadados de usage são normalizados em `AiProviderTextResponse.usage` quando o provider os retorna.

**Compatibilidade legada**: `AI_VISION_PROVIDER`, `GEMINI_MODEL`, `OPENAI_MODEL` e as variáveis `OPENAI_WHATSAPP_INTENT_*` continuam disponíveis durante a transição. O provider é resolvido antes do modelo; uma variável OpenAI específica de intenção nunca sobrescreve o modelo quando o provider resolvido é Gemini. O resolvedor inclui aviso `[deprecated]` sanitizado em `diagnostics` quando usa compatibilidade legada. `TRANSCRIPTION` usa `AI_TRANSCRIPTION_*`; `IMAGE_ANNOTATION` usa seu modo e `AI_IMAGE_ANNOTATION_*`; nenhuma das duas depende de `AI_VISION_PROVIDER`.

## Regras de dependência

- `client/` pode importar de `shared/`, mas não deve importar de `server/`.
- `server/` pode importar de `shared/`, `drizzle/`, `server/modules/` e `server/repositories/`.
- `shared/` não deve depender de `client/` nem `server/`.
- Serviços não devem depender de componentes React.
- Schemas devem ser reutilizados pelo router e, quando útil, pelo frontend via tipos inferidos.
- O SDK oficial da OpenAI deve ficar restrito à camada `_core` do backend.
- `voiceTranscription`, inferência nutricional e anotação externa devem usar suas capacidades específicas; o compositor local não acessa provider.
- Falha de imagem auxiliar nunca deve bloquear criação ou confirmação de refeição.
- A foto original nunca deve ser sobrescrita pelo derivado; resumo visual separado não pode mascarar ausência de anotação.
- Fluxos multimodais devem usar imagem e áudio inline para inferência e transcrição quando houver mídia anexada; upload para storage serve persistência e não pode ser pré-requisito para a IA consumir a mídia.
- Dependências legadas remanescentes devem ficar documentadas e fora do fluxo principal de refeição.
- Páginas profissionais podem reutilizar componentes visuais genéricos, mas não devem importar páginas da Área do Paciente.
- Regras profissionais devem viver em módulos de domínio/serviço, não em tabs ou páginas React.
- Cálculos de metas, relatórios e timezone devem ter uma fonte canônica compartilhada.
- Autorização profissional não pode depender apenas da visibilidade do menu ou da rota no frontend.

## Plano de extração de `server/db.ts`

A extração de `server/db.ts` deve acontecer em PRs pequenos, cada um focado em um domínio principal e sem mudança funcional intencional. A assinatura pública exportada por `server/db.ts` deve ser preservada enquanto routers e serviços consumidores forem migrados gradualmente.

Checklist recomendado:

- [x] `admin/logs`: preparar serviço isolado para logs administrativos e inferências, mantendo sanitização de detalhes antes de gravar em memória ou banco.
- [x] `users/profile`: mover stores e funções de usuário, onboarding, perfil, preferências, restrições e peso inicial (`server/modules/users/service.ts`), preservando a assinatura pública exportada por `server/db.ts` e expondo acessores para os domínios que ainda leem essa memória (peso semanal, exportação de privacidade e purge de conta).
- [ ] `meals`: seguir o plano detalhado em `docs/exec-plans/active/extract-meals-from-db.md` antes de mover código. A extração deve ser dividida em sublotes pequenos para favoritos, inferências pendentes/mídia, refeições confirmadas/totais, hábitos derivados e agregadores/admin/privacidade, mantendo `server/db.ts` como fachada compatível até a migração dos consumidores.
- [x] `foods`: mover catálogo em memória, favoritos de alimentos, ranking, busca, criação e atualização de alimentos do usuário (`server/modules/foods/catalog.ts`), mantendo `mealStore` e `mealsRepository` como dependências injetadas até a extração do domínio `meals`.
- [x] `water/exercises`: mover metas de água, logs de hidratação, exercícios e consultas por data (`server/modules/water/store.ts`, `server/modules/exercises/store.ts`), preservando a assinatura pública exportada por `server/db.ts`.
- [x] `goals/gamification`: mover metas nutricionais, configurações de gamificação, snapshots semanais de badges e cálculo de conquistas (`server/modules/goals/store.ts`, `server/modules/gamification/store.ts`), preservando `server/db.ts` como fachada compatível.
- [x] `privacy/account`: mover exportação de privacidade, exclusão de dados em memória e orquestração de purge por domínio (`server/modules/privacy/service.ts`), preservando `server/db.ts` como fachada compatível; a orquestração recebe cada domínio como dependência explícita porque `meals` ainda não foi extraído de `server/db.ts`.
- [ ] Atualizar esta seção a cada PR concluído, incluindo qualquer fronteira nova validada por `pnpm architecture:check`.

Regras para cada PR de extração:

- tocar um domínio principal por vez;
- preservar comportamento observável e formatos de retorno;
- adicionar teste focado quando a extração mover sanitização, ordenação, fallback em memória ou persistência;
- evitar misturar refatoração com correção funcional, mudança visual ou alteração de contrato de API;
- manter `pnpm test`, `pnpm architecture:check` e `pnpm docs:check` verdes.

## Privacidade e dados sensíveis

Dados de saúde e alimentação são sensíveis. Campos como `sourceText`, `transcript`, `mediaJson`, restrições alimentares, objetivos, peso, telefone, logs de inferência e tokens exigem cuidado extra.

Proibições:

- não logar texto cru de refeição, transcrição, fotos, base64, prompts de anotação, URLs assinadas, tokens ou telefone completo;
- não enviar dados sensíveis para analytics;
- não retornar detalhes internos de erro para o usuário final;
- não persistir novo dado sensível sem documentar finalidade, retenção e exclusão;
- não expor dados de um paciente a profissional sem vínculo vigente e escopo autorizado;
- não misturar dados pessoais do nutricionista com dados do paciente selecionado.

A anotação externa representa tratamento adicional da foto e só pode ocorrer no modo explicitamente configurado. O modo local não envia foto nem dados nutricionais a provider de imagem. Original e derivado seguem retenção, exportação e exclusão como artefatos independentes vinculados à refeição.

## Comandos de qualidade

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm agent:check
```

`pnpm agent:check` é o gate recomendado para mudanças feitas com auxílio de agentes.

## Aposentadoria do legado profissional

A experiência profissional atual é a única interface funcional. O endereço `/professional/legacy` existe apenas como redirecionamento de bookmark para `/professional` e não carrega componentes, estado ou APIs antigos. Perfil, autorizações e acompanhamento usam exclusivamente as tabelas canônicas em runtime; leitura, migração e remoção das três chaves JSON antigas são permitidas somente pelos comandos operacionais documentados em `docs/runbooks/professional-legacy-retirement.md`.

## Observabilidade de IA e catálogo de preços (#926)

`executeResolvedCapability` é a fronteira canônica para telemetria técnica das capacidades externas de IA. Cada tentativa concluída produz um `AiInferenceEvent` schema 1 com capacidade, origem, provider/modelo configurados e efetivos, papel da chamada, índice, latência, resultado, usage normalizado, ferramentas efetivamente executadas, política de fallback e custo estimado.

- `server/_core/ai/providerBoundary.ts` envolve o adapter resolvido, remove `raw` e `usage.raw`, normaliza unidades faturáveis e converte exceções do SDK para a taxonomia comum sem preservar mensagem ou causa nativa. O domínio não deve depender da identidade do objeto bruto do adapter; deve usar `providerId`, modelo e métodos do contrato interno.
- `server/_core/ai/observability.ts` constrói eventos de baixa cardinalidade. Primário, retry, fallback e escalonamento são papéis distintos; same-provider, cross-provider e degradação local também permanecem separados.
- `server/modules/aiObservability/logSink.ts` reutiliza `logInferenceEvent` com `eventType=ai.inference_call`. Não existe tabela, router ou fonte concorrente criada por #926. Falha do sink é best effort e não altera a inferência.
- `server/_core/ai/pricingCatalog.ts` é a fonte versionada e datada para estimativa em USD. Preço ou usage insuficiente resulta em `null`; a estimativa não representa cobrança ou faturamento.
- Prompt, texto, transcrição, foto, base64, URL assinada, resposta, reasoning textual, headers, segredos, erro bruto e objeto de SDK não podem atravessar a fronteira nem ser persistidos na telemetria.

O contrato operacional detalhado e o processo de atualização do catálogo ficam em `docs/design-docs/ai-observability-pricing.md`.
