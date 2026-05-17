# Arquitetura do Controle de Calorias

O projeto é um monólito moderno orientado a produto. A decisão arquitetural atual é manter frontend, backend, autenticação, integrações, persistência e contratos tipados no mesmo repositório para acelerar evolução, reduzir coordenação operacional e facilitar validação por agentes.

## Stack principal

| Camada | Tecnologia | Responsabilidade |
|---|---|---|
| Frontend | React + Vite + Tailwind | Fluxos web, dashboard, formulários e visualizações |
| Backend | Express + tRPC | Contratos tipados, autenticação, orquestração e casos de uso |
| Banco | MySQL/TiDB + Drizzle | Persistência relacional, migrações e integridade referencial |
| IA | Provider OpenAI isolado no backend para transcrição, com helpers legados ainda presentes para fluxos não migrados | Inferência nutricional multimodal |
| Canal externo | WhatsApp Business Cloud API | Entrada e saída conversacional oficial |
| Testes | Vitest | Cobertura de regras, routers e UI |

## Fronteiras de camadas

```text
client/src/pages        -> composição de tela e chamadas tRPC
client/src/components   -> componentes reutilizáveis de UI
server/nutritionRouter  -> composição de routers, autenticação, schemas e serviços
server/modules/*        -> regra de negócio por domínio
server/repositories/*   -> acesso a dados reutilizável por domínio
server/_core/openaiClient.ts -> cliente oficial da OpenAI, isolado do domínio
server/_core/aiProvider.ts -> interface interna e factory do provider
server/db.ts            -> persistência legada e funções agregadoras ainda centralizadas
drizzzle/schema.ts      -> fonte de verdade do modelo relacional
shared/*                -> tipos, cálculos e mensagens sem dependência de ambiente
```

## Convenção por domínio backend

Novos domínios devem seguir a estrutura abaixo:

```text
server/modules/<dominio>/
  schemas.ts   # contratos zod e validação de entrada
  service.ts   # regra de negócio e orquestração
  types.ts     # opcional, tipos locais complexos
  __tests__/   # opcional, testes próximos do domínio
```

O `nutritionRouter.ts` deve permanecer fino: validar entrada, chamar serviço, traduzir erros conhecidos para `TRPCError` e emitir analytics sem dados sensíveis.

## Regras de dependência

- `client/` pode importar de `shared/`, mas não deve importar de `server/`.
- `server/` pode importar de `shared/`, `drizzle/`, `server/modules/` e `server/repositories/`.
- `shared/` não deve depender de `client/` nem `server/`.
- Serviços não devem depender de componentes React.
- Schemas devem ser reutilizados pelo router e, quando útil, pelo frontend via tipos inferidos.
- O SDK oficial da OpenAI deve ficar restrito a `server/_core/openaiClient.ts` e à camada de provider backend.
- `server/_core/voiceTranscription.ts` deve consumir apenas a interface interna do provider, sem acoplamento direto ao SDK.

## Privacidade e dados sensíveis

Dados de saúde e alimentação são sensíveis. Campos como `sourceText`, `transcript`, `mediaJson`, restrições alimentares, objetivos, peso, telefone, logs de inferência e tokens exigem cuidado extra.

Proibições:

- não logar texto cru de refeição, transcrição, tokens, URLs assinadas ou telefone completo;
- não enviar dados sensíveis para analytics;
- não retornar detalhes internos de erro para o usuário final;
- não persistir novo dado sensível sem documentar finalidade, retenção e exclusão.

## Comandos de qualidade

```bash
pnpm check
pnpm test
pnpm architecture:check
pnpm docs:check
pnpm agent:check
```

`pnpm agent:check` é o gate recomendado para mudanças feitas com auxílio de agentes.
