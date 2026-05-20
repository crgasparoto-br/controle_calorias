# Frontend UX Review Pass 2

## Escopo

Segunda passada de UX/UI focada no Dashboard principal, após a consolidação da PR #51.

## Diagnóstico atacado

- excesso de densidade visual no Dashboard, com pouca separação entre leitura rápida, análise semanal e formulários de registro;
- repetição de padrões de card sem hierarquia clara entre o que pede ação imediata e o que é histórico;
- rolagem longa com blocos úteis, mas pouco agrupados por contexto de uso;
- aproveitamento insuficiente do topo da página para orientar a jornada do dia.

## Melhorias aplicadas

- adoção do `PageIntro` também no Dashboard para alinhar a entrada da tela ao padrão já usado em outras páginas;
- reorganização do Dashboard em seções mais claras: `Foco do dia`, `Qualidade e consistência`, `Panorama rápido`, `Energia e semana`, `Registros rápidos` e `Histórico recente`;
- destaque mais claro para ações principais (`Registrar refeição` e `Abrir relatórios`);
- agrupamento entre exercícios e hidratação para reduzir troca de contexto;
- refinamento da visão semanal combinada para melhor adaptação em larguras intermediárias;
- melhoria da leitura dos blocos finais de histórico e progresso nutricional.

## Telas alteradas

- `client/src/pages/Home.tsx`

## Validação

Validação automática local não executada neste ambiente porque o repositório não está clonado no workspace atual.
A checagem de build, typecheck e validação visual deve seguir o fluxo já usado no repositório e no preview da PR.
