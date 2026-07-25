# Segurança

## Superfícies críticas

- Autenticação e sessão.
- Banco MySQL/TiDB e migrações.
- WhatsApp Business Cloud API.
- Storage de mídia.
- IA, transcrição e geração de imagem.
- Administração de tokens e segredos.
- Billing, webhooks de pagamento e exceções administrativas.

## Regras

- Segredos devem vir do ambiente ou de armazenamento criptografado; nunca commitar tokens.
- Mensagens de erro públicas não devem expor stack, SQL, token, URL assinada ou payload bruto.
- Webhooks devem validar token e tratar payload inválido com segurança. Webhooks de billing autenticam o corpo bruto, mas persistem somente evento e metadata normalizados; cartão, CVV, token e segredo do provider são proibidos.
- Rotas administrativas devem usar `adminProcedure`. Concessões e revogações comerciais derivam autoria da sessão e preservam histórico.
- Logs devem ser úteis para operação, mas sanitizados para dados sensíveis.
- Ativação/revisão de meta profissional valida no backend perfil ativo, autorização aprovada, acompanhamento ativo, ator e paciente. A chave única por paciente protege também contra corrida entre profissionais.
- Retry de notificação de meta só pode ser executado pelo profissional autor e nunca retorna ou registra a justificativa privada.
- A conclusão pública do onboarding pelo WhatsApp não confirma se e-mail, telefone ou conta existem. Conflitos de conta usam resposta genérica e preservam o token somente enquanto ele continuar válido.
- Vincular um lead do WhatsApp a uma conta existente exige sessão autenticada e o token opaco recebido no próprio canal. Claim do lead, verificação de conflito, associação da conta e vínculo do telefone devem ocorrer transacionalmente e não podem trocar um usuário já convertido.
- `completion_error_code` usa vocabulário fechado. Mensagens de exceção, e-mail, telefone, senha, token e detalhes de banco não podem ser persistidos nesse campo.
- Retornos após login aceitam somente caminhos internos da aplicação; URLs absolutas, protocol-relative ou normalizadas para outro origin devem ser rejeitadas.

## Checklist para mudanças

- [ ] A procedure correta foi usada (`protectedProcedure` ou `adminProcedure`)?
- [ ] Há validação Zod para input externo?
- [ ] Erros conhecidos são traduzidos para mensagens seguras?
- [ ] Fronteiras públicas evitam enumeração de conta, telefone ou tenant?
- [ ] Retornos de autenticação foram validados contra redirecionamento externo?
- [ ] Não há segredo em código, teste ou documentação?
- [ ] Tokens e telefones não aparecem completos em logs?
