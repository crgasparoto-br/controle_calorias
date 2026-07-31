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

### Smoke real protegido da issue #922

O workflow `.github/workflows/issue-922-live-provider-smoke.yml` executa código do head da pull request e, por isso, nunca pode receber credenciais comuns de produção ou credenciais disponíveis automaticamente para qualquer PR.

Controles obrigatórios:

- o job usa o ambiente protegido `issue-922-live-smoke` e esse ambiente deve exigir aprovação manual de um mantenedor antes de liberar secrets;
- o repositório deve definir `ISSUE_922_SMOKE_APPROVED_SHA` com o SHA exato revisado; o job falha antes da instalação e antes de qualquer secret quando a variável está vazia ou diverge do head;
- a aprovação e `ISSUE_922_SMOKE_APPROVED_SHA` devem ser renovadas após qualquer mudança do SHA da pull request;
- somente PR do repositório `crgasparoto-br/controle_calorias`, criada por `crgasparoto-br` e com branch `feat/922-ai-capabilities-meal-whatsapp*` é elegível;
- as únicas credenciais aceitas são `ISSUE_922_SMOKE_OPENAI_API_KEY` ou `ISSUE_922_SMOKE_GEMINI_API_KEY`, exclusivas para smoke, com quota e permissões mínimas; não reutilizar credencial de produção;
- os secrets ficam restritos ao passo final de smoke e não são disponibilizados durante checkout, instalação de dependências ou validações anteriores;
- `persist-credentials` permanece desabilitado no checkout do head;
- a ausência de credencial dedicada deve falhar de forma explícita, sem fallback para `OPENAI_API_KEY` ou `GEMINI_API_KEY` genéricas.

A proteção do ambiente, a aprovação do SHA e a criação/rotação das credenciais são configurações operacionais do GitHub/OpenAI ou Gemini e não devem ser simuladas por arquivo versionado.
