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
server/_core/ai/               -> fundação multi-provider (#921): registro de capacidades, matriz de suporte, resolvedor por capacidade e executor comum de política
server/_core/voiceTranscription.ts -> helper de transcrição baseado no provider interno
server/_core/imageGeneration.ts -> helper visual auxiliar opcional, não bloqueante
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
- `replyFormatting.ts` -> formatação compartilhada de número e horário nas respostas do WhatsApp.
- `mealConsolidationService.ts` / `mealConsolidation.ts` -> consolidação de refeições do mesmo dia/tipo (ver #663).

A assinatura pública exportada por `server/whatsappWebhook.ts` (`handleWhatsAppWebhook`, `verifyWhatsAppWebhook`, `__resetWhatsAppWebhookDeduplicationForTests`) deve ser preservada ao mover código para esses módulos.

Fluxos de comunicação profissional devem reutilizar o contrato central de mensagens e o transporte oficial. Não criar cliente, formatter ou fila paralela somente para a Área Profissional.

## Fundação multi-provider de IA (#921)

`server/_core/ai/` é a fundação compartilhada para evoluir a seleção de IA de global (`AI_VISION_PROVIDER`) para uma configuração independente por capacidade de produto. Esta issue cria a fundação e migra apenas o SDK do Gemini; **nenhum consumidor existente foi migrado** para este resolvedor (meal, WhatsApp, busca, transcrição, imagem continuam usando `server/_core/aiProvider.ts` / `AI_VISION_PROVIDER` / clientes diretos como antes). A migração de cada consumidor é escopo das subissues seguintes de #917.

- `capabilities.ts` — registro tipado das capacidades do produto (`MEAL_TEXT`, `MEAL_VISION`, `WHATSAPP_INTENT`, `QUESTION`, `NUTRITION_SEARCH`, `EMBEDDING`, `TRANSCRIPTION`, `IMAGE_ANNOTATION`, `FOOD_CLASSIFICATION`). Cada capacidade declara as operações (`AiOperation`) que precisa de um adapter: `text`, `vision`, `structured_output`, `web_search`, `embeddings`, `transcription`, `image_generation`, `image_edit`. `FOOD_CLASSIFICATION` é reservada — por decisão registrada em #922, a classificação NOVA continua embutida no structured output de `MEAL_TEXT`/`MEAL_VISION` e não tem consumidor próprio ainda.
- `supportMatrix.ts` — matriz de suporte por adapter (`openai`, `gemini`, `openai-compatible`), declarada como dado e nunca inferida do nome do provider ou prefixo do modelo. Para `openai-compatible` (quando `OPENAI_BASE_URL` aponta para um endpoint compatível), só operações listadas explicitamente em `AI_OPENAI_COMPATIBLE_OPERATIONS` são consideradas suportadas — nada é assumido por padrão (Structured Outputs, Web Search, embeddings, áudio e imagem ficam indisponíveis até validação explícita).
- `policyDefaults.ts` — módulo único com os defaults de timeout (`30000ms`) e tentativas (`1`, equivalente ao baseline sem retry), reaproveitado por todo o resolvedor.
- `configResolver.ts` — resolvedor por capacidade. Para cada capacidade: seleciona primeiro o adapter (provider) e só então resolve o modelo; aplica a precedência `AI_<CAPABILITY>_* novo` > `variável legada compatível` > `default equivalente ao baseline`; valida se o adapter resolvido suporta as operações exigidas pela capacidade (rejeitando localmente quando não suporta); resolve política de fallback própria da capacidade (desabilitada por padrão; cross-provider exige `AI_<CAPABILITY>_CROSS_PROVIDER_FALLBACK_ENABLED=true` explícito, senão nenhum dado é enviado ao segundo provider); produz um dos estados `ready` / `degraded` / `disabled` / `invalid` com diagnóstico sanitizado (nunca inclui segredo, payload, prompt ou mídia). Alterar a política de uma capacidade nunca altera outra.
- `policyExecutor.ts` — fronteira comum reutilizável para retry/timeout/fallback: executa o primário, aplica só os retries permitidos por `maxAttempts` (contagem total de chamadas do primário, incluindo a primeira), e — apenas se o fallback resolvido estiver elegível — executa no máximo uma chamada de fallback após o primário se esgotar. Nunca volta ao primário, nunca encadeia um terceiro modelo/provider e nunca executa primário e fallback em paralelo. Expõe as classes `AiOperationalError` (timeout, rede, rate limit recuperável, saída vazia, JSON/payload inválido — elegível a retry/fallback) e `AiNonRetryableError` (segredo ausente, autenticação inválida, modelo inexistente, combinação incompatível, bloqueio de segurança, config inválida, ou resultado funcional válido — nunca elegível): o executor decide retry/fallback olhando só essas duas classes; **mapear um erro real de SDK/HTTP de um provider para uma das duas é responsabilidade do adapter/consumidor que chamar `executeWithPolicy`** e ainda não está implementado para nenhum provider nesta issue (nenhum consumidor foi migrado). Um tipo `AiQualityEscalationHook` fica preparado para uma futura política de escalonamento de qualidade explicitamente configurada, mas não é invocado por este executor.

**Distinção importante**: degradação funcional (ex.: busca cair para modo não semântico quando embeddings falham, anotação de imagem em modo local) é responsabilidade da capacidade consumidora, não é fallback de provider e não é implementada por este resolvedor/executor — apenas o conceito está documentado aqui para não ser confundido com o fallback entre providers.

**Migração do SDK Gemini**: `server/_core/geminiProvider.ts` usa `@google/genai` (SDK atual do Google), adotando a superfície `models.generateContent` — chamadas single-turn sem estado, suficientes para o uso atual do projeto (texto, visão, structured output); a superfície de Interactions/sessão não foi adotada por não haver necessidade de estado entre chamadas. `@google/generative-ai` (SDK legado) foi removido do `package.json`. O comportamento observável dos consumidores atuais (`mealAiExtraction`, WhatsApp) foi preservado.

**Compatibilidade legada**: `ENV.visionModel`, `AI_VISION_PROVIDER`, `GEMINI_MODEL`, `OPENAI_MODEL` e as demais variáveis legadas continuam funcionando sem alteração — nenhuma foi removida. Quando uma capacidade é resolvida por variável legada, o resolvedor inclui um item `[deprecated]` sanitizado em `diagnostics` (o array retornado por `resolveCapabilityConfig`), nunca uma exceção. Nesta subissue nenhum consumidor chama o resolvedor, portanto esse diagnóstico ainda não é emitido como log de aplicação — cabe à subissue que migrar cada consumidor decidir onde e como reportá-lo (ex.: log estruturado, métrica).

## Regras de dependência

- `client/` pode importar de `shared/`, mas não deve importar de `server/`.
- `server/` pode importar de `shared/`, `drizzle/`, `server/modules/` e `server/repositories/`.
- `shared/` não deve depender de `client/` nem `server/`.
- Serviços não devem depender de componentes React.
- Schemas devem ser reutilizados pelo router e, quando útil, pelo frontend via tipos inferidos.
- O SDK oficial da OpenAI deve ficar restrito à camada `_core` do backend.
- `voiceTranscription`, inferência nutricional e visual auxiliar não devem chamar o provider legado.
- Falha de imagem auxiliar nunca deve bloquear criação ou confirmação de refeição.
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

- não logar texto cru de refeição, transcrição, tokens, URLs assinadas ou telefone completo;
- não enviar dados sensíveis para analytics;
- não retornar detalhes internos de erro para o usuário final;
- não persistir novo dado sensível sem documentar finalidade, retenção e exclusão;
- não expor dados de um paciente a profissional sem vínculo vigente e escopo autorizado;
- não misturar dados pessoais do nutricionista com dados do paciente selecionado.

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
