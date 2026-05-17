# Arquitetura do Controle de Calorias

O projeto permanece como um monólito orientado a produto. Frontend, backend, autenticação, integrações, persistência e contratos tipados ficam no mesmo repositório para acelerar evolução, reduzir coordenação operacional e simplificar validação por agentes.

## Stack principal

| Camada | Tecnologia | Responsabilidade |
|---|---|---|
| Frontend | React + Vite + Tailwind | Fluxos web, dashboard, formulários e visualizações |
| Backend | Express + tRPC | Contratos tipados, autenticação, orquestração e casos de uso |
| Banco | MySQL/TiDB + Drizzle | Persistência relacional, migrações e integridade referencial |
| IA principal | Provider OpenAI isolado no backend | Transcrição, inferência nutricional multimodal e visual auxiliar opcional |
| IA legada remanescente | Forge restrito ao assistente educativo | Sugestões alimentares fora do fluxo principal de refeição |
| Canal externo | WhatsApp Business Cloud API | Entrada e saída conversacional oficial |
| Testes | Vitest | Cobertura de regras, routers e UI |

## Fronteiras de camadas

```text
client/src/pages              -> composição de tela e chamadas tRPC
client/src/components         -> componentes reutilizáveis de UI
server/nutritionRouter        -> composição de routers, autenticação, schemas e serviços
server/modules/*              -> regra de negócio por domínio
server/repositories/*         -> acesso a dados reutilizável por domínio
server/_core/openaiClient.ts  -> cliente oficial da OpenAI, isolado do domínio
server/_core/aiProvider.ts    -> interface interna e factory do provider
server/_core/voiceTranscription.ts -> helper de transcrição baseado no provider interno
server/_core/imageGeneration.ts -> helper visual auxiliar opcional, não bloqueante
server/db.ts                  -> persistência legada e funções agregadoras ainda centralizadas
drizzzle/schema.ts            -> fonte de verdade do modelo relacional
shared/*                      -> tipos, cálculos e mensagens sem dependência de ambiente
```

## Regras de dependência

- `client/` pode importar de `shared/`, mas não deve importar de `server/`.
- `server/` pode importar de `shared/`, `drizzle/`, `server/modules/` e `server/repositories/`.
- `shared/` não deve depender de `client/` nem `server/`.
- Serviços não devem depender de componentes React.
- Schemas devem ser reutilizados pelo router e, quando útil, pelo frontend via tipos inferidos.
- O SDK oficial da OpenAI deve ficar restrito à camada `_core` do backend.
- `voiceTranscription`, inferência nutricional e visual auxiliar não devem chamar o provider legado.
- Falha de imagem auxiliar nunca deve bloquear criação ou confirmação de refeição.
- Dependências legadas remanescentes devem ficar documentadas e fora do fluxo principal de refeição.

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
