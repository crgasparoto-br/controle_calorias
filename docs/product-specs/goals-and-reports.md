# Especificação de produto: metas e relatórios

## Objetivo

Ajudar o usuário a acompanhar consumo nutricional, progresso semanal e aderência a metas de calorias, proteínas, carboidratos e gorduras.

## Regras de produto

- Metas devem aceitar regra padrão e exceções por janela de tempo.
- Valores potencialmente inseguros devem gerar aviso ou bloqueio antes da persistência.
- Relatórios semanais usam semana iniciando na segunda-feira.
- Refeições confirmadas devem exibir itens, porções, macros, calorias e horário.
- Hoje e relatórios devem usar a mesma fonte de totais para evitar divergência.
- Hoje permanece focado no dia atual e não deve depender de consultas históricas pesadas.
- Registros deve permitir consulta operacional por dia, semana, mês e período configurável.
- Registros deve incluir refeições, hidratação e atividade física no mesmo intervalo ativo para revisão operacional.
- Relatórios deve permitir análise por dia, semana, mês e período configurável com o mesmo padrão visual de seleção.

## Critérios de aceite

- Alteração de meta atualiza dashboard e relatórios.
- Relatório semanal não inclui rascunhos não confirmados.
- Eventos analíticos não contêm dados sensíveis de saúde ou refeição crua.
- Registros e Relatórios deixam claro qual período está ativo e qual intervalo está sendo analisado.