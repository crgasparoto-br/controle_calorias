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
- Fallback entre providers de uma mesma capacidade nunca envia dados ao segundo provider sem que `AI_<CAPABILITY>_CROSS_PROVIDER_FALLBACK_ENABLED=true` esteja explicitamente configurado para aquela capacidade; sem essa flag, um provider de fallback diferente do primário fica marcado como não elegível e nenhuma chamada é feita a ele.
- Resolução de capacidade por variável de ambiente legada (`AI_VISION_PROVIDER`, `OPENAI_MODEL`, etc.) emite aviso de depreciação apenas em log sanitizado, nunca lança exceção nem interrompe o fluxo.

## Checklist para mudanças

- [ ] A procedure correta foi usada (`protectedProcedure` ou `adminProcedure`)?
- [ ] Há validação Zod para input externo?
- [ ] Erros conhecidos são traduzidos para mensagens seguras?
- [ ] Não há segredo em código, teste ou documentação?
- [ ] Tokens e telefones não aparecem completos em logs?
