# Proteção arquitetural de timezone

`pnpm architecture:check` executa `scripts/timezone-architecture.ts` sobre código executável em `client/src`, `server` e `shared`.

O check bloqueia:

- literal funcional `America/Sao_Paulo` fora de `shared/timeZone.ts`;
- constantes locais de fallback temporal;
- timezone do navegador como autoridade de negócio;
- limites de calendário construídos por concatenação UTC fixa;
- resolvers/conversores IANA paralelos;
- conversão direta de `datetime-local`;
- cálculo manual de offset fora do helper central;
- resolução de perfil/timezone dentro de loops, como proteção contra N+1.

Testes, fixtures, datasets de regressão e documentação podem citar múltiplos timezones. A allowlist executável é mínima: o módulo central e os adapters de compatibilidade que apenas delegam aos helpers compartilhados.

As fixtures automatizadas em `scripts/timezone-architecture.test.ts` provam violações negativas e usos legítimos.
