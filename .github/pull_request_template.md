## Problema

<!-- Descreva a issue, risco ou melhoria tratada. -->

## Solução

<!-- Liste as mudanças principais e o limite intencional do PR. -->

## Áreas sensíveis tocadas

- [ ] Autenticação/sessão
- [ ] Segredos ou variáveis de ambiente
- [ ] Banco, schema, migrations ou persistência
- [ ] WhatsApp, webhooks ou integrações externas
- [ ] OpenAI, IA ou processamento de mensagens
- [ ] Fluxo nutricional, refeições, metas ou relatórios
- [ ] Nenhuma área sensível

## Validações

Status check obrigatório:

- [ ] `Delivery V2 risk` classificou a PR e `Agent-first gate` passou no `head_sha` exato contra `main` ou `develop`
- Perfil efetivo: <!-- FAST / STANDARD / CRITICAL -->
- Promoção de risco: <!-- sim / não / não aplicável -->

Comandos relevantes executados pelo perfil (marque somente os aplicáveis):

- [ ] `pnpm check`
- [ ] testes relacionados (`vitest related`) ou `pnpm test` equivalente completo
- [ ] `pnpm architecture:check`
- [ ] `pnpm docs:check`
- [ ] `pnpm build`
- [ ] `pnpm agent:check`
- [ ] `pnpm db:check-integrity`
- [ ] Outro smoke/manual check descrito abaixo

Banco e integridade:

- `DATABASE_URL` no CI: <!-- disponível / não disponível / não aplicável -->
- `db:check-integrity`: <!-- executado / pulado / não aplicável -->
- Validação alternativa ou risco residual quando pulado: <!-- descreva ou marque não aplicável -->

Vercel:

- Preview/deploy: <!-- passou / falhou por código / falhou por limite externo / não aplicável -->
- Observação: Vercel não substitui `Agent-first gate` nem os comandos exigidos pelo perfil Delivery V2.

## Riscos e pendências

<!-- Descreva riscos conhecidos, limitações de validação e próximos passos. -->
