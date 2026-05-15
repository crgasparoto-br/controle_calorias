# Confiabilidade

## Objetivo

Garantir que os fluxos críticos possam ser validados por humanos e agentes antes de deploy ou merge.

## Fluxos críticos

- Autenticação e sessão.
- Registro de refeição por texto, imagem e áudio.
- Confirmação de rascunho de refeição.
- Relatórios e dashboard.
- WhatsApp inbound e outbound.
- Exportação e exclusão de dados.
- Migrações e integridade referencial.

## Gates recomendados

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm agent:check
```

Quando houver `DATABASE_URL` disponível:

```bash
pnpm db:check-integrity
```

## Estratégia de testes

- Testes unitários para cálculos nutricionais e validação de schemas.
- Testes de serviço para confirmação de refeição, metas e WhatsApp.
- Smoke tests futuros para web, WhatsApp e banco.
- Checks estruturais para impedir drift de arquitetura e documentação.

## Incidentes comuns a prevenir

- Migração não aplicada em produção.
- Divergência entre rascunho e confirmação.
- Log de dados sensíveis.
- Falha silenciosa no envio WhatsApp.
- Relatório semanal divergente do dashboard.
