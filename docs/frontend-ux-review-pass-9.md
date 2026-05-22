# Frontend UX Review Pass 9

## Escopo

Passada de centralização da experiência de registro, com foco na tela `log-meal` e na nomenclatura apresentada para `Record`.

## Diagnóstico atacado

- o cabeçalho superior exibido no print anexo misturava resumo, navegação e contexto em uma área que competia com o cadastro;
- o topo da página e o cartão principal repetiam mensagens longas sobre o mesmo fluxo;
- o usuário precisava alternar entre telas para registrar refeição, água, exercício e peso;
- a organização anterior deixava água, exercícios e peso muito separados do menu principal da tela;
- a aba `Hoje` mantinha um fluxo de consulta dentro de uma tela que agora deve ser exclusivamente de cadastro;
- os controles de abrir e fechar criavam fricção visual em cards e seções que já podem permanecer expostos;
- o upload de foto podia falhar quando o storage não respondia durante a criação do draft;
- a rota `log-meal` ainda aparecia com um nome técnico demais para um fluxo cotidiano.

## Melhorias aplicadas

- remoção do cabeçalho superior exibido no print anexo para deixar a tela `Record` focada em cadastro;
- simplificação dos textos da tela e do cartão principal de registro com IA;
- criação do alias `/record` e atualização do nome exibido na navegação principal;
- transformação de água, exercícios e peso atual em abas próprias dentro da `Record`;
- remoção da aba `Hoje` para manter a página orientada apenas a entrada de dados;
- inclusão de data e hora na atualização de peso, com histórico recente para acompanhamento;
- remoção dos botões de abrir e fechar dos cards e das seções analíticas de relatórios;
- correção do fluxo de foto com fallback inline quando o upload para storage falha no draft.

## Telas alteradas

- `client/src/features/meals/legacy/UnifiedLogMealPageContainer.tsx`
- `client/src/features/meals/components/MealAiTabContent.tsx`
- `client/src/components/DashboardLayout.tsx`
- `client/src/App.tsx`
- `client/src/components/ui/card.tsx`
- `client/src/pages/ReportsPage.tsx`
- `server/modules/meals/service.ts`

## Validação

Validação automática local não executada neste ambiente porque o repositório não está clonado no workspace atual.
A checagem final deve seguir `pnpm check`, `pnpm test` e `pnpm architecture:check`, além da revisão manual da tela `Record`.
