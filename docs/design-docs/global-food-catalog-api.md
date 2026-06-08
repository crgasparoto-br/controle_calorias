# Design tecnico: API do catalogo global de alimentos

Parent: #150
Issue: #154
Depends on: #151, #152

## Objetivo

A API do catalogo global expoe consultas para alimentos globais e personalizados sem alterar a busca legada ainda usada pelo frontend atual.

## Procedures tRPC

| Procedure | Entrada | Saida |
|---|---|---|
| `foods.catalogSearch` | `{ query?: string, limit?: number, includeInactive?: boolean }` | Lista de alimentos acessiveis ao usuario |
| `foods.catalogGet` | `{ foodId: number }` | Alimento acessivel ao usuario com porcoes |

A busca legada `foods.search` permanece ativa para compatibilidade com `foodCatalog` ate a migracao de frontend e registro manual.

## Regra de escopo

A consulta sempre aplica:

```text
foods.owner_user_id IS NULL OR foods.owner_user_id = <usuario autenticado>
```

Assim:

- alimentos globais ficam visiveis para todos;
- alimentos personalizados so aparecem para o usuario dono;
- tentativa de consultar alimento personalizado de outro usuario retorna `NOT_FOUND`.

## Busca

`foods.catalogSearch` procura em:

- `foods.normalized_name`
- `food_aliases.normalized_alias`

Por padrao, a busca retorna apenas alimentos `active`. Quando `includeInactive` e `true`, alimentos `deprecated` e `merged` tambem podem aparecer, mas ficam rebaixados no ranking.

## Ranking inicial

A ordenacao inicial prioriza:

1. alimentos `active`;
2. match exato de nome normalizado;
3. match por prefixo;
4. alimentos com fonte registrada;
5. alimentos globais;
6. nome alfabetico.

Favoritos, recentes e ranking avancado ficam fora desta fatia e serao tratados na #161.

## Contrato de resposta

Cada alimento retorna:

- identificacao e escopo (`global` ou `user`);
- fonte, versao e codigo de origem quando existirem;
- nome, categoria, marca e status;
- nutrientes por 100 g;
- nutrientes extras parseados de `nutrients_json`;
- porcoes cadastradas em `catalogGet`.

## Compatibilidade

A implementacao usa SQL parametrizado contra as tabelas criadas na #151 para evitar dependencia temporaria dos exports de `drizzle/schema.ts`, que ainda estao pendentes na PR base. Quando a #151 sincronizar a fonte de verdade do schema, esta API pode ser refatorada para usar os objetos Drizzle tipados.
