# Busca do catalogo no registro manual de refeicoes

## Objetivo

Atualizar o registro manual para usar o catalogo global de alimentos, mantendo compatibilidade com o preenchimento livre atual.

## Fluxo implementado

```text
buscar alimento -> selecionar alimento -> escolher porcao ou informar gramas -> revisar macros -> salvar refeicao
```

## Comportamento no frontend

No editor de item manual:

- a busca usa `foods.catalogSearch`;
- resultados indicam se o alimento e global ou personalizado;
- ao selecionar um alimento, o item recebe `foodId` e `source = catalog`;
- quando o alimento tem porcoes, a UI exibe botoes de medidas caseiras;
- ao escolher uma porcao, a UI envia `portionId` e `portionQuantity`;
- quando o usuario informa gramas manualmente, o fluxo limpa a porcao e usa `estimatedGrams`;
- calorias e macros sao recalculados localmente para previa, mas o backend segue sendo a fonte final do snapshot nutricional.

## Contrato enviado ao backend

O item de refeicao pode ser salvo com uma das combinacoes:

```text
foodId + portionId + portionQuantity
foodId + estimatedGrams
campos livres antigos sem foodId
```

O backend da pilha anterior converte porcoes para gramas e salva snapshot nutricional no momento da refeicao.

## Compatibilidade

O fluxo antigo continua funcionando para alimentos livres ou itens vindos da IA que ainda nao tenham `foodId`. Isso permite migrar a experiencia de registro manual sem bloquear os demais modos de registro.

## Validacoes pendentes

Esta PR precisa ser validada com:

- `pnpm check`
- `pnpm test`
- `pnpm architecture:check`
- `pnpm docs:check`
- `pnpm agent:check`

Tambem recomenda validacao visual no registro manual, cobrindo:

- busca por alimento global;
- selecao de porcao cadastrada;
- entrada manual em gramas;
- salvamento final da refeicao;
- exibicao dos macros recalculados antes de salvar.
