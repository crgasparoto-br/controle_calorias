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

## Checklist para mudanças

- [ ] A procedure correta foi usada (`protectedProcedure` ou `adminProcedure`)?
- [ ] Há validação Zod para input externo?
- [ ] Erros conhecidos são traduzidos para mensagens seguras?
- [ ] Não há segredo em código, teste ou documentação?
- [ ] Tokens e telefones não aparecem completos em logs?
