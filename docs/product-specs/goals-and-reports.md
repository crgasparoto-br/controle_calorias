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
- A organização visual de Relatórios deve começar por um resumo do período com cards de decisão antes dos blocos analíticos detalhados.
- Meta ajustada de calorias é a meta base do dia somada às calorias de exercícios registradas no mesmo dia, quando houver gasto aplicável.
- A distribuição percentual de macronutrientes deve ser calculada por calorias: proteína e carboidrato usam 4 kcal/g, gordura usa 9 kcal/g.
- A qualidade alimentar em Relatórios deve ser agregada por período e não deve listar alimentos individualmente.
- Alimentos sem classificação disponível devem entrar como `não classificados` para não inflar artificialmente percentuais de ultraprocessados ou in natura/minimamente processados.
- O detalhamento alimento por alimento deve permanecer em Refeições registradas; Relatórios pode apontar para essa tela quando o usuário precisar auditar um dia específico.
- O gráfico de evolução de peso deve usar os registros de peso existentes nos dias do período selecionado para demonstrar oscilações, mantendo estado vazio quando não houver peso no intervalo.

## Relatórios orientados a metas

A tela de Relatórios deve responder primeiro se o usuário está evoluindo em relação às metas nutricionais e hábitos de suporte.

A experiência deve conter:

- resumo do período com cards principais de aderência calórica, média consumida, média da meta ajustada, desvio médio, variação de peso, qualidade alimentar, água e exercícios;
- aderência calórica com percentual médio, desvio médio e dias abaixo, dentro e acima da faixa ideal;
- gráfico de consumido vs meta ajustada, mantendo a meta base como referência complementar quando útil;
- comparação de macronutrientes em gramas e em distribuição percentual planejada vs realizada;
- comparação visual entre percentual planejado e percentual realizado por macro;
- macro mais distante da meta;
- contadores de dias com proteína dentro da faixa e gordura acima da meta;
- visão agregada de qualidade alimentar com proteína, fibras, frutas, legumes/verduras, ultraprocessados e regularidade quando houver classificação disponível;
- dias com frutas registradas no período;
- dias com legumes/verduras registrados no período;
- percentual estimado de calorias vindas de ultraprocessados;
- percentual estimado de calorias vindas de alimentos in natura/minimamente processados, quando houver classificação disponível;
- percentual de calorias não classificadas para deixar clara a limitação dos dados;
- índice simples de qualidade alimentar calculado apenas sobre calorias classificadas, sem linguagem moralizante;
- evolução de peso como sinal de apoio, usando os registros reais do período para mostrar oscilações quando houver mais de um peso registrado;
- água como contexto da meta, incluindo consumo vs meta de água, média diária, percentual médio de aderência e dias com meta batida;
- exercícios como contexto da meta, incluindo frequência de dias ativos, gasto estimado e comparação da meta ajustada média entre dias com e sem exercício;
- comparação de aderência calórica entre dias com exercício e dias sem exercício, para explicar o efeito do gasto estimado na leitura da meta ajustada;
- detalhamento diário com consumo, meta ajustada, diferença em kcal e percentual de aderência como bloco secundário, depois dos principais sinais de decisão.

Quando faltarem dados de peso, qualidade alimentar, água ou exercícios, a tela deve exibir estado vazio claro sem bloquear a leitura das demais métricas.

Quando não houver meta de macronutrientes configurada, a seção de macros deve exibir fallback claro sem tentar inferir meta a partir dos alimentos registrados.

## Critérios de aceite

- Alteração de meta atualiza dashboard e relatórios.
- Relatório semanal não inclui rascunhos não confirmados.
- Eventos analíticos não contêm dados sensíveis de saúde ou refeição crua.
- Hoje deixa claro qual dia está ativo e permite voltar para hoje.
- Registros e Relatórios deixam claro qual período está ativo e qual intervalo está sendo analisado.
- Relatórios exibem comparação entre meta ajustada e realizado sempre que houver meta disponível.
- Relatórios recalculam a meta ajustada e a aderência quando o usuário altera o período selecionado.
- Relatórios deixam claro no primeiro bloco se o usuário está aderindo, desviando ou sem dados suficientes para os principais sinais.
- Relatórios exibem, por dia, consumo, meta ajustada, diferença em kcal e percentual de aderência.
- Relatórios permitem entender se o usuário bateu calorias, mas errou a composição de macronutrientes.
- Relatórios exibem comparação visual entre percentual planejado e percentual realizado de macros.
- Relatórios exibem comparação em gramas por macro para evitar distorção de leitura.
- Relatórios recalculam médias e percentuais de macros quando o período selecionado muda.
- Relatórios exibem qualidade alimentar agregada por período, sem detalhar alimentos individualmente.
- Relatórios separam calorias classificadas e não classificadas nos indicadores de qualidade alimentar.
- Relatórios exibem água e exercícios como indicadores de apoio às metas, sem transformar Reports em dashboard detalhado de treinos ou hidratação.
- Relatórios usam registros reais de peso do período selecionado no gráfico de evolução de peso quando houver dados no intervalo.
- Relatórios não duplicam a experiência operacional de Refeições registradas.
