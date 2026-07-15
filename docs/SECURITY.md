# Segurança

## Superfícies críticas

- Autenticação e sessão.
- Banco MySQL/TiDB e migrações.
- WhatsApp Business Cloud API.
- Storage de mídia.
- IA, transcrição e geração de imagem.
- Administração de tokens e segredos.
- Autorização profissional-paciente e revogação de consentimento.

## Regras

- Segredos devem vir do ambiente ou de armazenamento criptografado; nunca commitar tokens.
- Mensagens de erro públicas não devem expor stack, SQL, token, URL assinada ou payload bruto.
- Callbacks interativos do WhatsApp devem validar assinatura, usuário, telefone/canal ativo, tipo da pendência e ação permitida antes de consumir a operação por compare-and-set.
- O check de arquitetura deve falhar quando um handler envia mensagem funcional diretamente à Cloud API fora dos adaptadores autorizados.
- Webhooks devem validar token e tratar payload inválido com segurança.
- Rotas administrativas devem usar `adminProcedure`.
- Logs devem ser úteis para operação, mas sanitizados para dados sensíveis.
- APIs profissionais devem reler a autorização persistida em cada operação protegida; cache de tela ou memória do processo não pode manter acesso depois de `revoked`.
- Transições de autorização e acompanhamento devem validar que o ator é o profissional ou paciente do vínculo e usar a trilha auditável sem incluir motivos sensíveis em logs.

## Checklist para mudanças

- [ ] A procedure correta foi usada (`protectedProcedure` ou `adminProcedure`)?
- [ ] Há validação Zod para input externo?
- [ ] Erros conhecidos são traduzidos para mensagens seguras?
- [ ] Não há segredo em código, teste ou documentação?
- [ ] Tokens e telefones não aparecem completos em logs?
