# Validação visual das metas por dia da semana

A página `/goals` carregou corretamente após a aplicação da migração de metas por dia da semana.

## Evidências confirmadas

- O título da página exibe **"Planejamento nutricional por dia da semana"**.
- Há blocos distintos para **segunda-feira até domingo**.
- Cada dia mostra campos de **calorias**, **proteínas**, **carboidratos** e **gorduras**.
- A seção **"Soma planejada da semana"** aparece com totais agregados.
- A seção **"Foco do dia atual"** aparece com a meta ativa do dia.
- O carregamento ocorreu sem repetição do erro de coluna ausente na validação visual desta rota.

## Valores observados na interface

| Indicador | Valor |
|---|---|
| Calorias semanais | 15400 kcal |
| Proteínas na semana | 1120 g |
| Carboidratos na semana | 1680 g |
| Gorduras na semana | 490 g |
| Meta ativa hoje | Quinta-feira |
| Calorias planejadas hoje | 2200 kcal |

## Observação

A interface já demonstra o planejamento por dia e o acumulado semanal. A próxima validação deve consolidar evidências complementares de dashboard e relatórios usando a nova estrutura de metas.

## Evidências complementares em relatórios

A página `/reports` carregou corretamente após a migração e preservou a estrutura semanal iniciando em segunda-feira.

| Evidência | Observação |
|---|---|
| Janela semanal | Os rótulos aparecem de **seg.** até **dom.** |
| Comparação calórica | O gráfico **Calorias consumidas versus meta** permanece visível |
| Detalhamento por refeição | A seção **Alimentos registrados por refeição** mostra itens, porções, macros, calorias e horário |
| Resumo analítico | A seção **Leitura da semana** continua listando saldo e macros por dia |

Essas evidências complementam a suíte automatizada já executada com **18 testes passando**, incluindo a validação do dashboard e da nova estrutura semanal de metas.
