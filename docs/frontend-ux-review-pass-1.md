# Frontend UX Review Pass 1

## Diagnóstico

### Navegação e hierarquia

- `/log-meal` misturava quatro tarefas pesadas na mesma rolagem: foto, IA multimodal, cadastro manual e lista de registros.
- `/settings` concentrava muitos blocos longos, com cartões dentro de cartões, o que aumentava a sensação de formulário infinito.
- `/meals` já tinha agrupamento funcional, mas faltava uma entrada de contexto mais forte para o resumo do dia e as ações principais.
- `/reports` tinha boa densidade informacional, mas ainda não conversava visualmente com o novo padrão aplicado em Configurações e Registro.

### Uso de espaço e rolagem

- Havia muito conteúdo empilhado verticalmente, especialmente em desktop, sem aproveitar bem o espaço horizontal.
- Os horários de refeições habituais ocupavam linhas excessivamente altas e com hierarquia repetitiva.
- A revisão de registros e o lançamento manual competiam visualmente entre si.

### Consistência visual

- Faltava um padrão compartilhado de cabeçalho de página para orientar objetivo, contexto e ações.
- Botões principais e resumos estavam distribuídos de forma pouco previsível entre telas parecidas.

## Plano priorizado

1. Reduzir rolagem e separar tarefas principais em superfícies dedicadas.
2. Padronizar cabeçalhos e resumos para melhorar leitura rápida.
3. Compactar blocos longos com melhor uso de grids em desktop e tablet.
4. Preservar fluxos e APIs existentes sem alterar regras de negócio.

## Implementado nesta branch

- Criado componente compartilhado `PageIntro` para padronizar cabeçalhos de páginas com contexto, métricas e ações.
- Reorganizada a tela `/settings` em abas: `Perfil`, `Objetivos e rotina` e `Refeições habituais`.
- Compactada a seção de refeições habituais em linhas editáveis, reduzindo cartões aninhados e rolagem.
- Reestruturada a tela `/log-meal` em abas: `IA multimodal`, `Foto`, `Manual` e `Hoje`.
- Mantida a edição de refeição acessível a partir da aba `Hoje`, redirecionando o usuário para o modo manual dentro da mesma tela.
- Refinada a tela `/meals` com cabeçalho consistente e melhor apresentação do resumo diário.
- Alinhada a tela `/reports` ao mesmo padrão de entrada visual com `PageIntro`, deixando a abertura da página mais coerente com o restante do app.
- Ajustado o seletor de dia de `/meals` para manter navegação e data no mesmo bloco horizontal.
- Tornados recolhíveis os grupos de refeição em `/meals`, com resumo de data e contagem na mesma linha.
- Compactada a lista de alimentos em linhas únicas clicáveis para abrir a edição da refeição diretamente da revisão do dia.
- Refinado o cabeçalho de cada grupo de refeição para reunir nome, data e contagens em uma única linha e remover a data repetida dentro dos blocos internos.
- Unificados em um único bloco os alimentos de lançamentos diferentes dentro da mesma refeição do dia, preservando a edição individual de cada lançamento na faixa de ações.

## Validação

Validação local não executada neste ambiente porque o repositório não pôde ser clonado aqui e os binários do projeto não estão disponíveis localmente.

Validações recomendadas na PR/CI:

- `pnpm check`
- `pnpm test`
- `pnpm architecture:check`
- validação manual de `/settings`, `/log-meal`, `/meals` e `/reports` em desktop e mobile
