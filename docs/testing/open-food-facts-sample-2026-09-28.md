# Relatório de amostra Open Food Facts — 2026-09-28

## Decisão

**Rollout não aprovado.** O adapter foi exercitado com a flag explicitamente habilitada apenas no processo de validação, mas `OPEN_FOOD_FACTS_ENABLED` continua ausente/desligado na configuração normal. A amostra confirma o shape do candidato e a necessidade de fallback, mas não é evidência suficiente de cobertura/qualidade brasileira para ativação.

## Protocolo

Foram consultados cinco EANs públicos iniciados por `789`, representando produtos industrializados brasileiros. O processo usou somente o endpoint de produto por código de barras, `User-Agent` identificável, campos mínimos, timeout e retry limitado. O relatório não armazena payload nutricional, imagens ou dados pessoais.

| EAN consultado | Primeira observação | Campos de identidade | Macros obrigatórios por 100 g | Observação |
|---|---|---:|---:|---|
| `7894900011517` | encontrado | nome + marca | 4/4 | fibras, açúcares e sódio ausentes na resposta observada |
| `7891000100103` | encontrado | nome + marca | 4/4 | campos opcionais completos na resposta observada |
| `7896004400057` | indisponível | — | — | provider respondeu de forma transitória indisponível |
| `7891037000130` | indisponível | — | — | provider respondeu de forma transitória indisponível |
| `7896045500108` | indisponível | — | — | nova execução classificou o código como `not_found` após tentativas |

A segunda janela de consulta, executada após a correção de classificação HTTP 404, observou `0/5` respostas completas, `4/5` indisponíveis e `1/5` não encontrado. Isso demonstra que a disponibilidade do provider deve ser tratada como variável operacional e que a amostra não pode autorizar publicação automática.

## Resultado agregado

- **Amostra:** 5 EANs públicos brasileiros.
- **Identidade completa na primeira janela:** 2/2 produtos encontrados (100% dos encontrados; 40% da amostra total).
- **Macros obrigatórios completos na primeira janela:** 2/2 produtos encontrados.
- **Campos opcionais:** variaram; a ausência permanece `null`, sem conversão para zero.
- **Divergência contra embalagem:** não avaliada nesta execução, pois não houve coleta de rótulos oficiais correspondentes. O gate de qualidade brasileira permanece aberto.
- **Duplicidades:** não avaliadas; o adapter não publica nem faz merge no catálogo.
- **Rate limit/indisponibilidade:** observados estados transitórios de indisponibilidade em consultas subsequentes; não houve habilitação de rollout.

## Conclusão operacional

A amostra valida que o adapter pode preservar código, identidade, disponibilidade de campos, data e proveniência sem importar imagens ou publicar o retorno. Ela **não** valida precisão nutricional, cobertura representativa ou divergência contra rótulo. Antes de qualquer ativação, deve ser executada uma nova amostra versionada com rótulos oficiais pareados, revisão de licença/atribuição e uma janela de volume compatível com o limite oficial do provider.

Fontes consultadas:

- [Documentação oficial da API](https://openfoodfacts.github.io/openfoodfacts-server/api/)
- [Tutorial oficial de produto por código de barras](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorial-off-api/)
- [Política oficial de dados e reutilização](https://world.openfoodfacts.org/data)
