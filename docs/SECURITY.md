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
- Rotas administrativas devem usar `adminProcedure`.
- Logs devem ser úteis para operação, mas sanitizados para dados sensíveis.
- Ativação/revisão de meta profissional valida no backend perfil ativo, autorização aprovada, acompanhamento ativo, ator e paciente. A chave única por paciente protege também contra corrida entre profissionais.
- Retry de notificação de meta só pode ser executado pelo profissional autor e nunca retorna ou registra a justificativa privada.
- O resolvedor de configuração de IA por capacidade (`server/_core/ai/configResolver.ts`, #921) nunca inclui valor de segredo, payload, prompt ou mídia em seus diagnósticos — apenas identificadores de capacidade/provider e a razão do estado (`ready`/`degraded`/`disabled`/`invalid`).
- `OPENAI_BASE_URL` não vazio é tratado automaticamente como endpoint `openai-compatible`; nenhuma operação é considerada disponível até ser listada em `AI_OPENAI_COMPATIBLE_OPERATIONS`.
- Fallback entre providers de uma mesma capacidade nunca envia dados ao segundo provider sem que `AI_<CAPABILITY>_CROSS_PROVIDER_FALLBACK_ENABLED=true` esteja explicitamente configurado para aquela capacidade; sem essa flag, o fallback fica inelegível.
- O executor comum fornece `AbortSignal` a cada chamada. Depois de timeout, retry ou fallback só pode começar após a chamada anterior confirmar encerramento. Provider que ignora o cancelamento encerra a execução em modo fail-closed, sem segundo envio.
- Erros concretos de SDK/HTTP são classificados pela fronteira comum. Erros desconhecidos são não recuperáveis por padrão e não acionam fallback.
- Resolução de capacidade por variável legada (`AI_VISION_PROVIDER`, `OPENAI_MODEL`, `GEMINI_MODEL`, etc.) inclui aviso `[deprecated]` sanitizado em `diagnostics`, sem expor o valor configurado.

## Checklist para mudanças

- [ ] A procedure correta foi usada (`protectedProcedure` ou `adminProcedure`)?
- [ ] Há validação Zod para input externo?
- [ ] Erros conhecidos são traduzidos para mensagens seguras?
- [ ] Não há segredo em código, teste ou documentação?
- [ ] Tokens e telefones não aparecem completos em logs?
