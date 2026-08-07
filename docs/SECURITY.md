# Segurança

## Superfícies críticas

- Autenticação e sessão.
- Banco MySQL/TiDB e migrações.
- WhatsApp Business Cloud API.
- Storage de mídia.
- IA, transcrição e geração de imagem.
- Administração de tokens e segredos.

## Regras

- Segredos devem vir do ambiente ou de armazenamento criptografado; nunca commitar tokens.
- Mensagens de erro públicas não devem expor stack, SQL, token, URL assinada ou payload bruto.
- Webhooks devem validar token e tratar payload inválido com segurança.
- Histórico persistido do WhatsApp é entrada não confiável: consumidores LLM devem reinspecionar turnos inbound, excluir conteúdo bloqueado e delimitar conteúdo permitido; respostas outbound anteriores também devem ser delimitadas e ter marcadores forjados neutralizados, pois podem refletir conteúdo do usuário ou de fontes externas. Essa proteção é transitiva: o LLM resumidor recebe inbound e outbound delimitados, e todo resumo persistido é novamente delimitado antes de entrar nas instruções de outro consumidor.
- Rotas administrativas devem usar `adminProcedure`.
- Logs devem ser úteis para operação, mas sanitizados para dados sensíveis.
- Ativação/revisão de meta profissional valida no backend perfil ativo, autorização aprovada, acompanhamento ativo, ator e paciente. A chave única por paciente protege também contra corrida entre profissionais.
- Retry de notificação de meta só pode ser executado pelo profissional autor e nunca retorna ou registra a justificativa privada.
- O resolvedor de configuração de IA por capacidade (`server/_core/ai/configResolver.ts`, #921) nunca inclui valor de segredo, payload, prompt ou mídia em seus diagnósticos — apenas identificadores de capacidade/provider e a razão do estado (`ready`/`degraded`/`disabled`/`invalid`).
- `OPENAI_BASE_URL` não vazio é tratado automaticamente como endpoint `openai-compatible`; nenhuma operação é considerada disponível até ser listada em `AI_OPENAI_COMPATIBLE_OPERATIONS`.
- Fallback entre providers de uma mesma capacidade nunca envia dados ao segundo provider sem que `AI_<CAPABILITY>_CROSS_PROVIDER_FALLBACK_ENABLED=true` esteja explicitamente configurado para aquela capacidade. Em `NODE_ENV=production`, essa flag não libera o segundo envio: a #927 não aprovou cross-provider, que permanece bloqueado fail-closed até nova evidência, revisão de privacidade e autorização operacional específicas.
- O executor comum fornece `AbortSignal` a cada chamada. Depois de timeout, retry ou fallback só pode começar após a chamada anterior confirmar encerramento. Provider que ignora o cancelamento encerra a execução em modo fail-closed, sem segundo envio.
- Erros concretos de SDK/HTTP são classificados pela fronteira comum. Erros desconhecidos são não recuperáveis por padrão e não acionam fallback.
- Resolução de capacidade por variável legada (`AI_VISION_PROVIDER`, `OPENAI_MODEL`, `GEMINI_MODEL`, etc.) inclui aviso `[deprecated]` sanitizado em `diagnostics`, sem expor o valor configurado.
- Código mutável de uma PR não pode receber secrets permanentes do repositório para executar smoke ou benchmark de provider. Validação em PR usa testes herméticos, fake server, contract tests, replay sanitizado ou doubles. Uma coleta real deve ocorrer em contexto confiável que execute código já revisado.

## Checklist para mudanças

- [ ] A procedure correta foi usada (`protectedProcedure` ou `adminProcedure`)?
- [ ] Há validação Zod para input externo?
- [ ] Erros conhecidos são traduzidos para mensagens seguras?
- [ ] Não há segredo em código, teste ou documentação?
- [ ] Tokens e telefones não aparecem completos em logs?
- [ ] Nenhum workflow de PR entrega credencial real a código alterável pelo próprio head?

### Fronteira dos consumidores #922

Refeição e intenção do WhatsApp recebem respostas por `_core/ai/domainTextResponse.ts`, que remove `raw` do SDK e `usage.raw`. O executor preserva a taxonomia fail-closed: autenticação, modelo inexistente, operação incompatível, bloqueio de segurança e configuração inválida não podem provocar reenvio ao mesmo provider nem a fallback.

### Fronteira dos consumidores #923

`QUESTION` (assistente de perguntas do WhatsApp) e `NUTRITION_SEARCH` (`findPackagedSnackByWebSearch`) também recebem respostas por `_core/ai/domainTextResponse.ts`, com a mesma remoção de `raw`/`usage.raw` e a mesma taxonomia fail-closed. Cada tentativa dessa fronteira executa exatamente uma chamada ao provider; recuperação, retry e fallback pertencem exclusivamente a `executeResolvedCapability`. Fonte ausente, URL-only ou evidência nutricional insuficiente degrada localmente sem probe oculto. `EMBEDDING` continua inelegível no Gemini por ausência do método `embeddings` no adapter, o que torna cross-provider fallback indisponível para essa capacidade independentemente de opt-in.

### Fronteira de transcrição #924

`TRANSCRIPTION` aceita somente áudio validado antes da rede. Data URL sem marcador `;base64`, base64 não canônico, MIME não permitido, payload vazio, arquivo acima de 16 MiB ou configuração inválida falham antes de instanciar o adapter. O domínio exige texto útil e recebe provider/modelo efetivos; `language`, `duration`, `segments` e `usage` são opcionais, e `raw` do SDK não atravessa `_core`.

Áudio, transcrição, prompt, base64 e URL de mídia não podem compor diagnóstico, telemetria ou resultado de benchmark. O callback duplicado do WhatsApp é descartado antes do download e da transcrição. Fallback de `TRANSCRIPTION` permanece desabilitado por padrão; a #927 não aprovou cross-provider, que continua bloqueado em produção até nova evidência, revisão LGPD e autorização operacional específicas.

### Fronteira de anotação de imagem #925

`IMAGE_ANNOTATION` é independente de `MEAL_VISION`. O modo `local` é o default e compõe uma camada determinística sobre uma cópia auto-orientada da foto original, sem chamada externa. O modo `external` exige configuração executável específica da capacidade (`AI_IMAGE_ANNOTATION_*`) e representa um novo envio da foto ao provider de imagem.
Para OpenAI nativa, somente modelos de imagem explicitamente aprovados pela matriz são aceitos. Em endpoint `openai-compatible`, além de `image_generation,image_edit` em `AI_OPENAI_COMPATIBLE_OPERATIONS`, o ID exato do modelo deve constar em `AI_OPENAI_COMPATIBLE_IMAGE_MODELS`; configuração incompatível falha antes da criação do adapter e do envio da foto.

A foto original e o derivado usam buffers e chaves de storage distintos. Falha local, externa, de upload ou de envio do derivado não remove o original, não altera a resposta textual e não bloqueia o registro da refeição. Um cartão-resumo sem a foto original é outro artefato e nunca pode ser apresentado como anotação.

Fallback externo permanece desabilitado por padrão. Provider diferente exige opt-in explícito por capacidade e continua bloqueado em produção; a #927 preservou o modo local e não autorizou novo compartilhamento. A degradação `external -> local` só ocorre com `AI_IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODE=local`; ela não é fallback de provider e não cria novo compartilhamento externo.

Entradas base64 são validadas quanto a forma canônica e tamanho estimado antes da alocação do buffer decodificado. Logs e telemetria registram somente modo, degradação, origem normalizada, tentativas, tipo do artefato e código de falha sanitizado; foto, base64, URL assinada, prompt, conteúdo nutricional, resposta bruta, segredo e mensagem do SDK são proibidos.

### Smokes e benchmarks com providers externos

O workflow temporário da issue #922 foi aposentado depois da validação daquela entrega. Testes versionados não devem depender de workflows temporários já removidos.

O harness `scripts/issue-923-live-provider-smoke.ts` e o benchmark `scripts/issue-924-transcription-benchmark.ts` podem ser executados somente em contexto confiável. Restringir repositório, proprietário, branch ou SHA não torna seguro entregar um secret a código ainda controlado pela PR: o próprio head pode ler ou exfiltrar a credencial. Portanto, workflows de `pull_request` não devem executar esses harnesses com `OPENAI_API_KEY`, `GEMINI_API_KEY` ou aliases.

Para PRs, provar comportamento com testes herméticos, adapters determinísticos, fake server, replay sanitizado e controles de contagem de chamadas. Quando uma comparação real for necessária, executá-la localmente ou em infraestrutura protegida sobre código imutável e revisado, disponibilizando a chave somente no processo externo. O resultado deve ser sanitizado, vinculado ao SHA testado, hasheado e versionado antes de ser usado como evidência durável.

Os resultados de `751c3c7096748c16a1546b2ab8161e512ecf133a` e `7758bbdafc0b80f6b0ac37338eff4bd2005450e9` permanecem versionados apenas como histórico não canônico. O primeiro foi produzido por workflow de `pull_request` que disponibilizou `OPENAI_API_KEY` ao código mutável da PR; o segundo não possui atestação de execução confiável suficiente. Hash e sanitização comprovam integridade do arquivo, não a custódia do segredo nem a confiabilidade do executor. A execução canônica confiável está registrada no `evidence-manifest.json`, vinculada ao SHA testado, ao run, ao artifact e aos respectivos hashes; sua reutilização exige que runtime, harness e fixtures permaneçam inalterados.

### Telemetria técnica de IA (#926)

A fronteira `providerBoundary` deve remover `raw`, `usage.raw` e mensagens/causas nativas do SDK antes de entregar a resposta ao domínio ou à observabilidade. O evento persistido contém somente enums e números normalizados, identificadores de provider/modelo limitados e correlação técnica sanitizada.

- É proibido serializar exceção completa, request, headers, token, prompt, texto, transcrição, foto, base64, URL assinada, resposta completa ou reasoning textual.
- Chaves de correlação relacionadas a conteúdo, mídia, erro, segredo, autenticação, cookie, header, token ou URL são descartadas; objetos e arrays arbitrários não são aceitos.
- Cross-provider pode ser identificado por metadados de política, sem registrar o conteúdo reenviado.
- O sink usa `logInferenceEvent` e deve falhar isoladamente. Erro do sink não pode alterar retry, fallback ou retorno funcional.
- Testes de PR permanecem herméticos e sem credenciais. Nenhum workflow ou aprovação manual foi adicionado por #926.
