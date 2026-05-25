# Especificação de produto: metas e relatórios

## Objetivo

Ajudar o usuário a acompanhar consumo nutricional, progresso semanal e aderência a metas de calorias, proteínas, carboidratos e gorduras.

## Regras de produto

- Metas devem aceitar regra padrão e exceções por janela de tempo.
- Valores potencialmente inseguros devem gerar aviso ou bloqueio antes da persistência.
- Relatórios semanais usam semana iniciando na segunda-feira.
- Refeições confirmadas devem exibir itens, porções, macros, calorias e horário.
- Hoje e relatórios devem usar a mesma fonte de totais para evitar divergência.

## Critérios de aceite

- Alteração de meta atualiza dashboard e relatórios.
- Relatório semanal não inclui rascunhos não confirmados.
- Eventos analíticos não contêm dados sensíveis de saúde ou refeição crua.
