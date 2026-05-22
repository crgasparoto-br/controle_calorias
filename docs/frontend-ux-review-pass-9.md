# Frontend UX Review Pass 9

## Escopo

Passada de centralização da experiência de registro, com foco na tela `log-meal` e na nomenclatura apresentada para `Record`.

## Diagnóstico atacado

- a tela tinha um bloco visual de modos que competia com a ação principal e repetia informação desnecessária;
- o topo da página e o cartão principal repetiam mensagens longas sobre o mesmo fluxo;
- o usuário precisava alternar entre telas para registrar refeição, água, exercício e peso;
- o upload de foto podia falhar quando o storage não respondia durante a criação do draft;
- a rota `log-meal` ainda aparecia com um nome técnico demais para um fluxo cotidiano.

## Melhorias aplicadas

- remoção do bloco visual de modos exibido no print anexo;
- simplificação dos textos da tela e do cartão principal de registro com IA;
- criação do alias `/record` e atualização do nome exibido na navegação principal;
- incorporação dos registros de água, exercício e peso na mesma tela de `Record`;
- correção do fluxo de foto com fallback inline quando o upload para storage falha no draft;
- padronização do texto dos controles de abrir e fechar nos cards colapsáveis.

## Telas alteradas

- `client/src/features/meals/legacy/UnifiedLogMealPageContainer.tsx`
- `client/src/features/meals/components/MealAiTabContent.tsx`
- `client/src/components/DashboardLayout.tsx`
- `client/src/App.tsx`
- `client/src/components/ui/card.tsx`
- `server/modules/meals/service.ts`

## Validação

Validação automática local não executada neste ambiente porque o repositório não está clonado no workspace atual.
A checagem final deve seguir `pnpm check`, `pnpm test` e `pnpm architecture:check`, além da revisão manual da tela `Record`.
