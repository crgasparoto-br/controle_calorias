# Especificação de produto: metas e relatórios

## Objetivo

Ajudar o usuário a acompanhar consumo nutricional, progresso semanal e aderência a metas de calorias, proteínas, carboidratos e gorduras.

## Regras de produto

- Metas devem aceitar regra padrão e exceções por janela de tempo.
- Valores potencialmente inseguros devem gerar aviso ou bloqueio antes da persistência.
- Relatórios semanais usam semana iniciando na segunda-feira.
- Refeições confirmadas devem exibir itens, porções, macros, calorias e horário.
- Hoje e relatórios devem usar a mesma fonte de totais para evitar divergência.
- Hoje permanece focado no dia selecionado, inicia em hoje e não deve depender de consultas históricas pesadas.
- Hoje deve permitir navegação simples entre dias próximos e oferecer retorno rápido para hoje.
- Registros deve permitir consulta operacional por dia, semana, mês e período configurável.
- Registros deve incluir refeições, hidratação e atividade física no mesmo intervalo ativo para revisão operacional.
- Relatórios deve permitir análise por dia, semana, mês e período configurável com o mesmo padrão visual de seleção.
- Relatórios devem priorizar aderência às metas e evolução, não listagem detalhada de alimentos.
- A leitura principal de relatórios deve comparar consumido vs meta ajustada, macros planejados vs realizados, peso, qualidade alimentar, água e exercícios.
- O detalhamento alimento por alimento deve permanecer em Refeições registradas; Relatórios pode apontar para essa tela quando o usuário precisar auditar um dia específico.

## Relatórios orientados a metas

A tela de Relatórios deve responder primeiro se o usuário está evoluindo em relação às metas nutricionais e hábitos de suporte.

A experiência deve conter:

- resumo do período com consumo total, meta do período, desvio e exercícios;
- aderência calórica com percentual médio, desvio médio e dias abaixo, dentro e acima da faixa ideal;
- gráfico de consumido vs meta ajustada;
- comparação de macronutrientes em gramas e em distribuição percentual planejada vs realizada;
- macro mais distante da meta;
- visão agregada de qualidade alimentar com proteína, fibras, frutas, legumes/verduras, ultraprocessados e regularidade quando houver classificação disponível;
- evolução de peso como sinal de apoio, com mensagem cautelosa quando faltarem registros;
- água e exercícios como contexto da meta, incluindo consumo vs meta de água, dias com meta batida, dias ativos e gasto estimado.

Quando faltarem dados de peso, qualidade alimentar, água ou exercícios, a tela deve exibir estado vazio claro sem bloquear a leitura das demais métricas.

## Critérios de aceite

- Alteração de meta atualiza dashboard e relatórios.
- Relatório semanal não inclui rascunhos não confirmados.
- Eventos analíticos não contêm dados sensíveis de saúde ou refeição crua.
- Hoje deixa claro qual dia está ativo e permite voltar para hoje.
- Registros e Relatórios deixam claro qual período está ativo e qual intervalo está sendo analisado.
- Relatórios exibem comparação entre meta e realizado sempre que houver meta disponível.
- Relatórios não duplicam a experiência operacional de Refeições registradas.
