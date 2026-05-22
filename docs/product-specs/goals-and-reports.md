# Especificação de produto: metas e relatórios

## Objetivo

Ajudar o usuário a acompanhar consumo nutricional, progresso semanal e aderência a metas de calorias, proteínas, carboidratos e gorduras.

## Regras de produto

- Metas devem aceitar regra padrão e exceções por janela de tempo.
- Valores potencialmente inseguros devem gerar aviso ou bloqueio antes da persistência.
- Relatórios semanais usam semana iniciando na segunda-feira.
- Refeições confirmadas devem exibir itens, porções, macros, calorias e horário.
- Dashboard e relatórios devem usar a mesma fonte de totais para evitar divergência.
- Datas e horários exibidos no cliente devem respeitar locale e fuso horário configurados pelo usuário.
- Agrupamentos diários exibidos no cliente devem considerar o fuso horário configurado, evitando mudar a refeição de dia por efeito de UTC.

## Critérios de aceite

- Alteração de meta atualiza dashboard e relatórios.
- Relatório semanal não inclui rascunhos não confirmados.
- Eventos analíticos não contêm dados sensíveis de saúde ou refeição crua.
