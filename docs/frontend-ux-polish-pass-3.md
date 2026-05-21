# Frontend UX polish pass 3

## Diagnóstico

A terceira rodada foi direcionada a polimento global e consistência visual após as PRs #51 e #52. O objetivo foi evitar uma nova reorganização grande de telas e atacar pontos de menor risco que ainda impactavam a experiência:

- o `PageIntro` já estava presente em várias telas, mas ações no cabeçalho podiam ficar comprimidas em mobile quando havia filtro, botão e resumo no mesmo bloco;
- os indicadores do cabeçalho ficavam visualmente próximos demais da descrição em alguns contextos, reduzindo a separação entre contexto e métricas;
- estados vazios, erro, informação e carregamento ainda apareciam como blocos locais por tela, criando risco de microcopy e espaçamento divergentes;
- as telas principais já tinham boa organização, então a prioridade foi criar base reutilizável sem alterar fluxo, dados ou regras de negócio.

## Plano priorizado

1. Ajustar o `PageIntro` para melhorar quebra de ações em mobile e dar mais respiro aos indicadores.
2. Criar um componente reutilizável para estados de UI, cobrindo vazio, erro, informação e carregamento.
3. Manter a PR pequena e segura, preparando substituições graduais nas próximas passadas em vez de editar todos os estados de uma vez.
4. Validar visualmente as páginas que usam `PageIntro` e os pontos onde o novo padrão poderá ser aplicado.

## Implementado

### `client/src/components/PageIntro.tsx`

- Ações agora ocupam largura total em mobile e voltam a layout em linha quando há espaço suficiente.
- O bloco de métricas recebeu uma área própria com fundo sutil, melhorando separação visual entre texto introdutório e indicadores.
- O fundo foi simplificado para `bg-card`, reduzindo variação visual e deixando o componente mais previsível em diferentes superfícies.

### `client/src/components/UXState.tsx`

- Novo componente reutilizável para estados de interface.
- Suporta variantes `empty`, `error`, `info` e `loading`.
- Aceita título, descrição, ações opcionais, ícone customizado, modo compacto e `className`.
- Centraliza ícones, espaçamento e tom visual para futuros estados vazios/erro/loading.

## Validação recomendada

### Automática

- `pnpm check`
- `pnpm test`
- `pnpm architecture:check`
- `pnpm build`

### Visual/manual

- `/` Dashboard: verificar cabeçalho, métricas e ações em mobile, tablet e desktop.
- `/reports`: verificar cabeçalho com ações e cards de métricas no topo.
- `/log-meal`: verificar abas e cabeçalho com seletor de dia + botão de registros.
- `/meals`: verificar cabeçalho com seletor de dia e cards de resumo.
- `/settings`: confirmar que o padrão visual segue consistente com as telas anteriores.

## Fora de escopo

- Nenhuma regra de negócio foi alterada.
- Nenhuma funcionalidade foi removida.
- Nenhum arquivo foi deletado.
- Nenhuma PR deve ser mergeada automaticamente.
