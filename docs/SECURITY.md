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
- Fallback entre providers de uma mesma capacidade nunca envia dados ao segundo provider sem que `AI_<CAPABILITY>_CROSS_PROVIDER_FALLBACK_ENABLED=true` esteja explicitamente configurado para aquela capacidade. Em `NODE_ENV=production`, essa flag não libera o segundo envio: cross-provider permanece bloqueado fail-closed até benchmark, revisão de privacidade e rollout aprovados na #927.
- O executor comum fornece `AbortSignal` a cada chamada. Depois de timeout, retry ou fallback só pode começar após a chamada anterior confirmar encerramento. Provider que ignora o cancelamento encerra a execução em modo fail-closed, sem segundo envio.
- Erros concretos de SDK/HTTP são classificados pela fronteira comum. Erros desconhecidos são não recuperáveis por padrão e não acionam fallback.
- Resolução de capacidade por variável legada (`AI_VISION_PROVIDER`, `OPENAI_MODEL`, `GEMINI_MODEL`, etc.) inclui aviso `[deprecated]` sanitizado em `diagnostics`, sem expor o valor configurado.

## Checklist para mudanças

- [ ] A procedure correta foi usada (`protectedProcedure` ou `adminProcedure`)?
- [ ] Há validação Zod para input externo?
- [ ] Erros conhecidos são traduzidos para mensagens seguras?
- [ ] Não há segredo em código, teste ou documentação?
- [ ] Tokens e telefones não aparecem completos em logs?

### Fronteira dos consumidores #922

Refeição e intenção do WhatsApp recebem respostas por `_core/ai/domainTextResponse.ts`, que remove `raw` do SDK e `usage.raw`. O executor preserva a taxonomia fail-closed: autenticação, modelo inexistente, operação incompatível, bloqueio de segurança e configuração inválida não podem provocar reenvio ao mesmo provider nem a fallback.

### Fronteira dos consumidores #923

`QUESTION` (assistente de perguntas do WhatsApp) e `NUTRITION_SEARCH` (`findPackagedSnackByWebSearch`) também recebem respostas por `_core/ai/domainTextResponse.ts`, com a mesma remoção de `raw`/`usage.raw` e a mesma taxonomia fail-closed. Cada chamada dessa fronteira executa exatamente uma chamada ao provider; recuperação, retry e fallback pertencem exclusivamente a `executeResolvedCapability`. Fonte ausente, URL-only ou evidência nutricional insuficiente degrada localmente sem probe oculto. `EMBEDDING` continua inelegível no Gemini por ausência do método `embeddings` no adapter, o que torna cross-provider fallback indisponível para essa capacidade independentemente de opt-in.

### Fronteira de transcrição #924

`TRANSCRIPTION` aceita somente áudio validado antes da rede. Data URL sem marcador `;base64`, base64 não canônico, MIME não permitido, payload vazio, arquivo acima de 16 MiB ou configuração inválida falham antes de instanciar o adapter. O domínio exige texto útil e recebe provider/modelo efetivos; `language`, `duration`, `segments` e `usage` são opcionais, e `raw` do SDK não atravessa `_core`.

Áudio, transcrição, prompt, base64 e URL de mídia não podem compor diagnóstico, telemetria ou resultado de benchmark. O callback duplicado do WhatsApp é descartado antes do download e da transcrição. Fallback de `TRANSCRIPTION` permanece desabilitado por padrão; cross-provider continua bloqueado em produção até benchmark, revisão LGPD e rollout da #927.

### Smokes temporários com providers externos

O workflow temporário da issue #922 foi aposentado depois da validação daquela entrega. Testes versionados não devem depender de workflows temporários já removidos. Para #923, `scripts/issue-923-live-provider-smoke.ts` fornece um harness que valida `QUESTION` em modo sem busca, `QUESTION` com pesquisa real, `NUTRITION_SEARCH` com fonte citada em uma única tentativa governada pelo executor e `EMBEDDING` com vetor real. O workflow executa automaticamente somente para o repositório, proprietário e branch confiáveis, confere que o checkout corresponde ao `HEAD` selecionado da PR e desabilita persistência de credenciais no checkout. Não há revisão manual do head nem variável `AI_SMOKE_APPROVED_SHA`.

Testes e smokes reais de IA no GitHub Actions usam sempre os secrets de repositório padronizados `OPENAI_API_KEY` e `GEMINI_API_KEY`; aliases `AI_SMOKE_*` não devem ser criados. Os secrets são injetados somente no passo final que realiza as chamadas externas, depois de checkout, validação de identidade, setup e instalação sem credenciais. O harness permite modelos separados por `SMOKE_QUESTION_MODEL` e `SMOKE_NUTRITION_MODEL`; no Gemini, a pesquisa nutricional requer Gemini 3, enquanto perguntas podem continuar em Gemini 2.5. Ausência da chave necessária deve falhar fechado e ser registrada como limitação, não como smoke aprovado.

O benchmark de #924 é executado localmente em ambiente autorizado e não deve motivar workflow novo, rerun manual ou exposição de `OPENAI_API_KEY`. Somente o JSON sanitizado descrito em `docs/benchmarks/transcription/results/README.md` pode ser versionado.
